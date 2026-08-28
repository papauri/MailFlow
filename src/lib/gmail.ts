import { getAccessToken, logout } from "./firebase";
import { quotaFetch, withQuota, inferCost, reportThrottle, MESSAGES_GET_COST } from "./gmailQuota";

const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

/**
 * Every Gmail call in the app goes through here, and therefore through the quota
 * governor in `gmailQuota.ts`.
 *
 * Pacing, retrying, and backoff used to live in this function: three retries on a
 * fixed 1.5× backoff, with no idea what anything cost and no coordination between
 * concurrent callers. Two views opening at once each backed off privately and
 * together still overspent. That is all the governor's job now, so what remains here
 * is the part specific to Gmail's payloads — decoding, and telling a genuine
 * authorisation failure apart from congestion.
 */
export async function fetchGmailAPI(
  endpoint: string,
  options: RequestInit = {},
  signal?: AbortSignal
): Promise<any> {
  const token = await getAccessToken();
  if (!token) throw new Error("Authentication required");

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  const response = await quotaFetch(
    `${BASE_URL}${endpoint}`,
    { ...options, headers, signal },
    {
      cost: inferCost(endpoint, (options.method as string) || 'GET'),
      signal,
      label: endpoint.split('?')[0],
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const errMsg = (err.error?.message || '').toLowerCase();
    // Scope and credential failures are terminal — the governor has already retried
    // anything that was merely congestion, so reaching here means re-auth is needed.
    if (
      response.status === 401 ||
      errMsg.includes('invalid authentication credentials') ||
      errMsg.includes('expired') ||
      (response.status === 403 && errMsg.includes('insufficient'))
    ) {
      logout().then(() => {
        window.location.reload();
      }).catch(() => {
        window.location.reload();
      });
      // Return a promise that never resolves so downstream code doesn't crash 
      // while we wait for the page to reload.
      return new Promise(() => {});
    }
    throw new Error(err.error?.message || `Gmail API Error: ${response.status}`);
  }

  if (response.status === 204) return null;
  const text = await response.text();
  if (!text || text.trim() === '') return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    return text;
  }
}

export interface EmailData {
  id: string;
  threadId: string;
  messageIds?: string[];
  snippet: string;
  date: Date;
  sender: string;
  subject: string;
  labelIds: string[];
  sizeEstimate?: number;
  listUnsubscribe?: string;
  messages?: { id: string; sender: string; snippet: string; date: Date; subject: string; labelIds: string[]; listUnsubscribe?: string; }[];
}

/**
 * Runs `processor` over `items`, `chunkSize` at a time.
 *
 * This used to carry its own rate limiting: a fixed 200ms pause between chunks,
 * justified in a comment that priced `threads.get` at 5 units when it is 10. Ten
 * threads per 200ms is 500 units per second — twice the ceiling — so the mechanism
 * meant to protect the quota was the thing spending it.
 *
 * Pacing belongs to the quota governor, which prices each call and sees every caller
 * at once. `chunkSize` is now only a batching hint; the governor decides when each
 * request actually leaves.
 */
export async function processInChunks<T, R>(items: T[], chunkSize: number, processor: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(processor));
    results.push(...chunkResults);
  }
  return results;
}

export async function searchEmails(query: string, maxResults = 500, onProgress?: (emails: EmailData[]) => void): Promise<EmailData[]> {
  let allThreads: any[] = [];
  let pageToken = "";
  let totalDetailed: EmailData[] = [];
  let fetchedIds = new Set<string>();
  
  while (allThreads.length < maxResults) {
    const limit = Math.min(500, maxResults - allThreads.length);
    let url = `/threads?q=${encodeURIComponent(query)}&maxResults=${limit}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const listResult = await fetchGmailAPI(url);
    if (!listResult || !listResult.threads) break;
    
    const newThreads = listResult.threads.filter((t: any) => !fetchedIds.has(t.id));
    newThreads.forEach((t: any) => fetchedIds.add(t.id));
    allThreads.push(...newThreads);
    
    // Process this batch immediately
    const chunkDetails = await processInChunks(newThreads, 8, async (thread: any) => {
      try {
        const detail = await fetchGmailAPI(`/threads/${thread.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=List-Unsubscribe`);
        if (!detail.messages || detail.messages.length === 0) return null;
        
        const firstMsg = detail.messages[0];
        const lastMsg = detail.messages[detail.messages.length - 1];
        
        const firstHeaders = firstMsg.payload?.headers || [];
        const lastHeaders = lastMsg.payload?.headers || firstHeaders;
        
        const sizeEstimate = detail.messages.reduce((sum: number, m: any) => sum + (m.sizeEstimate || 0), 0);
        const messageIds = detail.messages.map((m: any) => m.id);
        const labelIds = [...new Set(detail.messages.flatMap((m: any) => m.labelIds || []))] as string[];

        return {
          id: thread.id,
          threadId: thread.id,
          messageIds: messageIds,
          snippet: detail.messages.length > 1 ? `(${detail.messages.length}) ${lastMsg.snippet || thread.snippet}` : (lastMsg.snippet || thread.snippet),
          labelIds: labelIds,
          sender: firstHeaders.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender',
          subject: firstHeaders.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)',
          date: new Date(lastMsg.internalDate ? parseInt(lastMsg.internalDate) : (lastHeaders.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date())),
          sizeEstimate: sizeEstimate,
          listUnsubscribe: detail.messages.flatMap((m: any) => m.payload?.headers || []).find((h: any) => h.name.toLowerCase() === 'list-unsubscribe')?.value,
        } as EmailData;
      } catch (err) {
        console.error(`Error fetching thread ${thread.id}`, err);
        return null;
      }
    });

    const validDetails = chunkDetails.filter(Boolean) as EmailData[];
    totalDetailed.push(...validDetails);
    
    if (onProgress) {
      onProgress(totalDetailed);
    }
    
    pageToken = listResult.nextPageToken;
    if (!pageToken) break;
  }

  return totalDetailed;
}

export async function searchEmailsPaginated(query: string, maxResults = 50, pageToken = "", labelId?: string): Promise<{ emails: EmailData[], nextPageToken?: string }> {
  let url = `/threads?maxResults=${maxResults}`;
  if (query) url += `&q=${encodeURIComponent(query)}`;
  if (labelId) url += `&labelIds=${encodeURIComponent(labelId)}`;
  if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

  const listResult = await fetchGmailAPI(url);
  if (!listResult || !listResult.threads) return { emails: [] };
  
  const chunkDetails = await processInChunks(listResult.threads, 10, async (thread: any) => {
    try {
      const detail = await fetchGmailAPI(`/threads/${thread.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=List-Unsubscribe`);
      if (!detail.messages || detail.messages.length === 0) return null;
      
      const firstMsg = detail.messages[0];
      const lastMsg = detail.messages[detail.messages.length - 1];
      
      const firstHeaders = firstMsg.payload?.headers || [];
      const lastHeaders = lastMsg.payload?.headers || firstHeaders;
      
      const sizeEstimate = detail.messages.reduce((sum: number, m: any) => sum + (m.sizeEstimate || 0), 0);
      const messageIds = detail.messages.map((m: any) => m.id);
      const labelIds = [...new Set(detail.messages.flatMap((m: any) => m.labelIds || []))] as string[];

      return {
        id: thread.id,
        threadId: thread.id,
        messageIds: messageIds,
        snippet: detail.messages.length > 1 ? `(${detail.messages.length}) ${lastMsg.snippet || thread.snippet}` : (lastMsg.snippet || thread.snippet),
        labelIds: labelIds,
        sender: firstHeaders.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender',
        subject: firstHeaders.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)',
        date: new Date(lastMsg.internalDate ? parseInt(lastMsg.internalDate) : (lastHeaders.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date())),
        sizeEstimate: sizeEstimate,
        listUnsubscribe: detail.messages.flatMap((m: any) => m.payload?.headers || []).find((h: any) => h.name.toLowerCase() === 'list-unsubscribe')?.value,
      } as EmailData;
    } catch (err) {
      console.error(`Error fetching thread ${thread.id}`, err);
      return null;
    }
  });

  const validDetails = chunkDetails.filter(Boolean) as EmailData[];
  return { emails: validDetails, nextPageToken: listResult.nextPageToken };
}

export async function batchModifyEmails(ids: string[], addLabelIds: string[], removeLabelIds: string[]) {
  if (ids.length === 0) return;
  const CHUNK_SIZE = 500;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    await fetchGmailAPI('/messages/batchModify', {
      method: 'POST',
      body: JSON.stringify({ ids: chunk, addLabelIds, removeLabelIds })
    });
  }
}

export async function batchTrashEmails(ids: string[]) {
  if (ids.length === 0) return;
  await batchModifyEmails(ids, ['TRASH'], ['INBOX']);
}

/**
 * Moves every message matching a query to Trash, paging until the query is empty.
 *
 * Deliberately re-runs the *first* page each round rather than following
 * nextPageToken: trashing a message removes it from queries scoped with `-in:trash`,
 * so the cursor from the previous round points into a result set that no longer
 * exists. Refetching page one and stopping when it comes back empty is the only
 * correct way to drain it.
 *
 * The caller supplies the query, so this inherits whatever scope it carries — it
 * never widens it. `maxRounds` is a runaway guard: if a message somehow keeps
 * matching after being trashed we stop instead of looping forever.
 */
export async function trashAllByQuery(
  query: string,
  onProgress?: (trashedSoFar: number) => void,
  maxRounds: number = 200
): Promise<number> {
  const PAGE_SIZE = 500;
  let total = 0;

  for (let round = 0; round < maxRounds; round++) {
    const res = await fetchGmailAPI(`/messages?q=${encodeURIComponent(query)}&maxResults=${PAGE_SIZE}`);
    const messages = res?.messages;
    if (!messages || messages.length === 0) break;

    const ids = messages.map((m: any) => m.id);
    await batchTrashEmails(ids);

    total += ids.length;
    if (onProgress) onProgress(total);

    // A short page means we just drained the tail.
    if (ids.length < PAGE_SIZE) break;
  }

  return total;
}

/**
 * Archives every message matching a query (removes INBOX, keeps the mail).
 * Scoped with `in:inbox` by the caller so each round drains as messages leave it.
 */
export async function archiveAllByQuery(
  query: string,
  onProgress?: (archivedSoFar: number) => void,
  maxRounds: number = 200
): Promise<number> {
  const PAGE_SIZE = 500;
  let total = 0;

  for (let round = 0; round < maxRounds; round++) {
    // Parenthesised: Gmail binds implicit AND tighter than OR, so appending a term
    // to a query containing OR would otherwise attach it to the last clause only.
    const scoped = query.includes('in:inbox') ? query : `(${query}) in:inbox`;
    const res = await fetchGmailAPI(`/messages?q=${encodeURIComponent(scoped)}&maxResults=${PAGE_SIZE}`);
    const messages = res?.messages;
    if (!messages || messages.length === 0) break;

    const ids = messages.map((m: any) => m.id);
    await batchArchiveEmails(ids);

    total += ids.length;
    if (onProgress) onProgress(total);
    if (ids.length < PAGE_SIZE) break;
  }

  return total;
}

export async function batchDeleteEmails(ids: string[]) {
  if (ids.length === 0) return;
  const CHUNK_SIZE = 500;
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    const chunk = ids.slice(i, i + CHUNK_SIZE);
    await fetchGmailAPI('/messages/batchDelete', {
      method: 'POST',
      body: JSON.stringify({ ids: chunk })
    });
  }
}

export async function batchArchiveEmails(ids: string[]) {
  if (ids.length === 0) return;
  await batchModifyEmails(ids, [], ['INBOX']);
}

export async function batchMarkAsRead(ids: string[]) {
  if (ids.length === 0) return;
  await batchModifyEmails(ids, [], ['UNREAD']);
}

export async function getLabels() {
  const res = await fetchGmailAPI('/labels');
  return res?.labels || [];
}

export async function emptyAllTrash(
  queryOrProgress?: string | ((deletedCount: number) => void),
  optionalProgress?: (deletedCount: number) => void
) {
  const query = typeof queryOrProgress === 'string' ? queryOrProgress : "in:trash OR in:spam";
  const onProgress = typeof queryOrProgress === 'function' ? queryOrProgress : optionalProgress;

  // Same drain-by-refetch reasoning as markAllAsReadByQuery: deleted messages leave
  // the result set, so a previously-taken nextPageToken would skip over survivors.
  const PAGE_SIZE = 500;
  const MAX_ROUNDS = 400;
  let totalDeleted = 0;

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const url = `/messages?q=${encodeURIComponent(query)}&maxResults=${PAGE_SIZE}`;
    const listResult = await fetchGmailAPI(url);
    const messages = listResult?.messages;
    if (!messages || messages.length === 0) break;

    const ids = messages.map((m: any) => m.id);
    await batchDeleteEmails(ids);

    totalDeleted += ids.length;
    if (onProgress) onProgress(totalDeleted);

    if (ids.length < PAGE_SIZE) break;
  }
  return totalDeleted;
}

export async function markAllAsReadByQuery(
  query: string,
  onProgress?: (markedCount: number) => void,
  maxRounds: number = 200
) {
  // Drains by re-running the first page, not by following nextPageToken: marking a
  // message read removes it from the `is:unread` set, so a cursor taken before the
  // mutation points into a result set that no longer exists and silently skips
  // messages. maxResults is 500 because that is the API's real ceiling.
  const PAGE_SIZE = 500;
  let totalMarked = 0;

  for (let round = 0; round < maxRounds; round++) {
    // Parenthesised for the same reason as archiveAllByQuery: `a OR b is:unread`
    // parses as `a OR (b is:unread)`, which would sweep everything matching `a`.
    const url = `/messages?q=${encodeURIComponent(`(${query}) is:unread`)}&maxResults=${PAGE_SIZE}`;
    const listResult = await fetchGmailAPI(url);
    const messages = listResult?.messages;
    if (!messages || messages.length === 0) break;

    const ids = messages.map((m: any) => m.id);
    await batchMarkAsRead(ids);

    totalMarked += ids.length;
    if (onProgress) onProgress(totalMarked);

    if (ids.length < PAGE_SIZE) break;
  }
  return totalMarked;
}

/**
 * Pages a query to count it exactly, up to a bound.
 *
 * This used to page the entire mailbox with no ceiling, and Inbox Health opens eight
 * of them at once. On a large account that is hundreds of sequential requests before
 * the first number appears — the dominant cost in the app, spent to distinguish
 * "31,402" from "20,000+" in a summary tile nobody reads that precisely.
 *
 * Past the bound it returns Gmail's own estimate, which is dependable at this page
 * size. Never reports less than the messages actually seen, so the number can be
 * imprecise but not wrong in the direction that matters.
 */
/**
 * Optional page ceiling for a count. There is no default one.
 *
 * Counting used to stop at 20 pages and report Gmail's estimate beyond it, so
 * every figure past 10,000 was approximate and the app had no way to say which.
 * The loop now runs until the query is exhausted. `maxPages` remains for a caller
 * that deliberately wants a bounded probe rather than an answer.
 */
export const COUNT_MAX_PAGES = 20;

export async function countEmails(query: string, maxPages?: number, onProgress?: (total: number) => void): Promise<number> {
  try {
    let total = 0;
    let pageToken = "";
    let lastEstimate = 0;
    const pageCeiling = maxPages && maxPages > 0 ? maxPages : Infinity;

    for (let page = 0; page < pageCeiling; page++) {
      let url = `/messages?q=${encodeURIComponent(query)}&maxResults=500`;
      if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
      const res = await fetchGmailAPI(url);

      if (!res || !res.messages || res.messages.length === 0) {
        if (onProgress) onProgress(total);
        return total;
      }
      total += res.messages.length;
      if (typeof res.resultSizeEstimate === 'number') lastEstimate = res.resultSizeEstimate;
      
      if (onProgress) onProgress(Math.max(total, lastEstimate));

      pageToken = res.nextPageToken;
      if (!pageToken) {
        if (onProgress) onProgress(total);
        return total;
      }
    }

    const finalCount = Math.max(total, lastEstimate);
    if (onProgress) onProgress(finalCount);
    return finalCount;
  } catch (err) {
    return 0;
  }
}

/**
 * Sample size for the storage estimate.
 *
 * Thirty messages puts the standard error of the mean at roughly a fifth of the
 * population's own spread, which is comfortably tighter than the precision a
 * "~1.4 GB" figure claims. Raising it further buys accuracy nobody can see, at 5
 * quota units a message.
 */
const SIZE_SAMPLE_SIZE = 30;

/**
 * Estimated total bytes behind a query: mean message size × message count.
 *
 * The units have to match on both sides of that multiplication, and they did not.
 * The sample was drawn from `/threads` and each thread's size was summed across
 * *all* its messages, while `count` comes from `countEmails`, which counts
 * *messages*. On a mailbox whose threads average three messages the estimate came
 * out three times too large, and every storage figure in Inbox Health — the
 * "reclaimable" badge, the breakdown bar, the recommendation ranking — inherited
 * that inflation.
 *
 * Sampling messages directly makes both sides per-message. It is still an estimate
 * drawn from the newest page of results, which is the honest limit of doing this
 * without walking the whole mailbox; the figures are labelled with a ~ throughout.
 */
export async function estimateQuerySize(query: string, countStr: number | string): Promise<number> {
  const count = typeof countStr === 'string' ? parseInt(countStr.replace(/\D/g, '')) || 0 : countStr;
  if (count <= 0) return 0;

  try {
    const ids = await listMessageIds(query, Math.min(SIZE_SAMPLE_SIZE, count));
    if (ids.length === 0) return 0;

    const sample = await fetchMessagesMetadataBatch(ids);
    const sizes = sample.map((m: any) => m.sizeEstimate || 0).filter((n: number) => n > 0);
    if (sizes.length === 0) return 0;

    const meanBytesPerMessage = sizes.reduce((a: number, b: number) => a + b, 0) / sizes.length;
    return meanBytesPerMessage * count;
  } catch (err) {
    return 0;
  }
}


export async function createLabel(name: string) {
  return await fetchGmailAPI('/labels', {
    method: 'POST',
    body: JSON.stringify({
      name: name,
      labelListVisibility: 'labelShow',
      messageListVisibility: 'show'
    })
  });
}

export async function deleteLabel(id: string) {
  return await fetchGmailAPI(`/labels/${id}`, {
    method: 'DELETE'
  });
}

export async function renameLabel(id: string, name: string) {
  return await fetchGmailAPI(`/labels/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      name: name
    })
  });
}

export async function createFilter(query: string, addLabelIds: string[], removeLabelIds: string[] = ['INBOX']) {
  const action: any = {};
  if (addLabelIds && addLabelIds.length > 0) action.addLabelIds = addLabelIds;
  if (removeLabelIds && removeLabelIds.length > 0) action.removeLabelIds = removeLabelIds;
  
  return await fetchGmailAPI('/settings/filters', {
    method: 'POST',
    body: JSON.stringify({
      criteria: { query },
      action
    })
  });
}


// ---------------------------------------------------------------------------
// Batch metadata fetching
// ---------------------------------------------------------------------------

/**
 * Fetches metadata for many messages in a handful of HTTP calls.
 *
 * The analysis views were fetching one request per message, so scanning a category
 * of a few thousand meant thousands of round trips — slow enough to look broken, and
 * heavy on the user's quota. Shrinking the sample fixed the wait but starved the
 * clustering, which needs volume to find anything.
 *
 * Gmail's batch endpoint takes up to 100 sub-requests per call, turning 2,000
 * messages into ~20 requests instead of 2,000. That is what makes scanning a whole
 * category on load practical.
 */

const BATCH_URL = 'https://www.googleapis.com/batch/gmail/v1';

/**
 * Sub-requests per batch call.
 *
 * Gmail allows 100, and this used to send 100 — but a batch is billed per inner
 * request, so that is 500 quota units in a single HTTP call against a ceiling of 250
 * per second, and they were sent back to back with no pause at all.
 *
 * Fifteen costs 75 units, which fits inside what the governor's bucket holds. That
 * matters: a request dearer than the bucket has to overdraw it, and the overdraft
 * lands on top of the sustained rate in the worst-case second. Keeping every request
 * within capacity is what makes the ceiling a guarantee rather than an average.
 *
 * Total throughput is set by the quota rate, not the round trips, so a smaller batch
 * costs little beyond a few more requests.
 */
const BATCH_SIZE = 15;

const METADATA_HEADERS = ['Subject', 'From', 'Date', 'List-Unsubscribe'];

function buildBatchBody(ids: string[], boundary: string): string {
  const headerQuery = METADATA_HEADERS.map(h => `metadataHeaders=${h}`).join('&');
  return ids
    .map(id =>
      `--${boundary}\r\n` +
      `Content-Type: application/http\r\n` +
      `Content-ID: <${id}>\r\n\r\n` +
      `GET /gmail/v1/users/me/messages/${id}?format=metadata&${headerQuery}\r\n\r\n`
    )
    .join('') + `--${boundary}--\r\n`;
}

/**
 * Pulls the JSON payloads out of a multipart/mixed batch response.
 *
 * Deliberately forgiving: a sub-request that failed (a deleted message, a
 * permissions edge) is skipped rather than failing the whole batch, since losing one
 * message from a sample of thousands changes nothing but losing the batch does.
 */
function parseBatchResponse(text: string, boundary?: string): any[] {
  const results: any[] = [];
  // Split on the boundary the server actually used. Guessing it from a "--batch"
  // prefix worked only while Google chose a boundary starting that way; if it ever
  // did not, parts would merge and the scan would silently return a fraction of the
  // messages rather than failing outright.
  const parts = boundary ? text.split(`--${boundary}`) : text.split(/--batch\S*/);
  for (const part of parts) {
    const start = part.indexOf('{');
    if (start === -1) continue;
    const end = part.lastIndexOf('}');
    if (end <= start) continue;
    try {
      const parsed = JSON.parse(part.slice(start, end + 1));
      if (parsed && parsed.id && !parsed.error) results.push(parsed);
    } catch {
      // Not a JSON payload (status line, epilogue) — skip.
    }
  }
  return results;
}

/** Message metadata shaped the way the analysis models expect. */
function shapeMessage(msg: any): any {
  const headers = msg.payload?.headers || [];
  const find = (name: string) =>
    headers.find((h: any) => h.name?.toLowerCase() === name)?.value;

  const internal = msg.internalDate ? new Date(parseInt(msg.internalDate, 10)) : null;
  const headerDate = find('date') ? new Date(find('date')!) : null;
  const date = internal && !isNaN(internal.getTime()) ? internal
    : (headerDate && !isNaN(headerDate.getTime()) ? headerDate : new Date());

  return {
    id: msg.id,
    threadId: msg.threadId,
    messageIds: [msg.id],
    snippet: msg.snippet || '',
    sender: find('from') || 'Unknown Sender',
    subject: find('subject') || '(No Subject)',
    date,
    sizeEstimate: msg.sizeEstimate || 0,
    labelIds: msg.labelIds || [],
    listUnsubscribe: find('list-unsubscribe'),
  };
}

export async function fetchMessagesMetadataBatch(
  ids: string[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
  onChunk?: (chunk: any[]) => void
): Promise<any[]> {
  if (ids.length === 0) return [];
  const token = await getAccessToken();
  if (!token) throw new Error('Authentication required');

  const out: any[] = [];
  /** Retries for the chunk currently being fetched; reset whenever we move on. */
  let chunkAttempt = 0;
  const MAX_CHUNK_ATTEMPTS = 4;

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const boundary = `batch_${Math.random().toString(36).slice(2)}`;

    try {
      // Priced as what it really is: one `messages.get` per sub-request. Sending this
      // unmetered was the single largest source of quota overruns in the app.
      const res = await withQuota(
        chunk.length * MESSAGES_GET_COST,
        () => fetch(BATCH_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': `multipart/mixed; boundary=${boundary}`,
          },
          body: buildBatchBody(chunk, boundary),
          signal,
        }),
        signal
      );

      if (!res.ok) {
        // A throttle is not a failure, it is a "wait" — dropping the chunk here meant
        // silently analysing a mailbox with fifty messages missing from the sample.
        // Rewind so the same chunk is retried once the governor's cooldown expires,
        // bounded so a persistent error cannot spin.
        const retryable = res.status === 429 || res.status === 403 || res.status >= 500;
        if (retryable && chunkAttempt < MAX_CHUNK_ATTEMPTS) {
          chunkAttempt++;
          reportThrottle();
          i -= BATCH_SIZE;
          continue;
        }
        console.warn(`Batch metadata request failed (${res.status}); skipping ${chunk.length} messages.`);
        chunkAttempt = 0;
        continue;
      }
      chunkAttempt = 0;

      // Content-Type carries the boundary: multipart/mixed; boundary=batch_xxx
      const contentType = res.headers?.get?.('content-type') || '';
      const declared = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
      const responseBoundary = declared ? (declared[1] || declared[2]) : undefined;

      const parsed = parseBatchResponse(await res.text(), responseBoundary);
      // A batch that returns far fewer parts than requested means the response was
      // not parsed properly, and silently analysing a fraction of the mailbox is
      // worse than saying so.
      if (parsed.length < chunk.length / 2) {
        console.warn(
          `Batch returned ${parsed.length} of ${chunk.length} messages — response may not have parsed correctly.`
        );
      }
      const shapedChunk = parsed.map(shapeMessage);
      out.push(...shapedChunk);
      if (onChunk) onChunk(shapedChunk);
    } catch (err) {
      if (signal?.aborted) break;
      console.warn('Batch metadata request errored; continuing.', err);
    }

    if (onProgress) onProgress(Math.min(i + BATCH_SIZE, ids.length), ids.length);
  }

  return out;
}

/** Message ids matching a query, paged. One request per 500 ids. */
export async function listMessageIds(
  query: string,
  /**
   * Optional ceiling. Omit it — the default is every matching message.
   *
   * This used to default to 2,000, which silently truncated whatever the caller
   * asked for. A truncated list is not a smaller answer, it is a wrong one: a
   * purge misses mail it claimed to clear, and an audit misses senders it claimed
   * to have checked. Pass a limit only where a bounded *sample* is genuinely what
   * is wanted, and say so at the call site.
   */
  limit?: number,
  signal?: AbortSignal,
  onProgress?: (found: number) => void
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = '';
  const ceiling = limit && limit > 0 ? limit : Infinity;

  while (ids.length < ceiling) {
    if (signal?.aborted) break;
    // 500 is Gmail's own page size, not a cap on the result — the loop keeps
    // following nextPageToken until the query is exhausted.
    let url = `/messages?q=${encodeURIComponent(query)}&maxResults=500`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

    const res = await fetchGmailAPI(url);
    const batch = res?.messages || [];
    if (batch.length === 0) break;

    ids.push(...batch.map((m: any) => m.id));
    if (onProgress) onProgress(ids.length);
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }

  return ceiling === Infinity ? ids : ids.slice(0, ceiling);
}

/**
 * High-speed whole-folder metadata scanner using Gmail's multipart batch endpoint.
 *
 * 1. Retrieves message IDs in 500-message pages (~0.2s).
 * 2. Fetches metadata in 15-subrequest multipart batches via Google Batch API.
 * 3. Uses `messages.get` (5 quota units) instead of `threads.get` (10 units), cutting
 *    quota consumption in half and HTTP roundtrips by 15x.
 * 4. Yields live progress metrics to callers for real-time progress bars.
 */
export async function scanFolderMetadata(
  query: string,
  /** Optional ceiling. Omit it to scan every message the query matches. */
  limit?: number,
  onProgress?: (done: number, total: number, phase: 'listing' | 'fetching') => void,
  signal?: AbortSignal,
  onChunk?: (chunk: EmailData[]) => void
): Promise<EmailData[]> {
  if (onProgress) onProgress(0, 0, 'listing');

  // Progress during listing too: on a large mailbox the id sweep alone takes long
  // enough that a bar frozen at zero looks like a hang.
  const ids = await listMessageIds(
    query,
    limit,
    signal,
    found => { if (onProgress) onProgress(0, found, 'listing'); }
  );
  if (ids.length === 0) return [];

  if (onProgress) onProgress(0, ids.length, 'fetching');

  const rawMessages = await fetchMessagesMetadataBatch(
    ids,
    (done, total) => {
      if (onProgress) onProgress(done, total, 'fetching');
    },
    signal,
    onChunk
  );

  return rawMessages as EmailData[];
}


/**
 * The real size of this mailbox.
 *
 * Every health figure used to be judged against fixed constants — full unread
 * penalty at 600 messages, full spam penalty at 400 — chosen without reference to
 * how big the mailbox actually is. On any well-used account all of them are
 * exceeded at once, so the score pins to its floor and stops responding to real
 * progress. Judging clutter as a *share* of the mailbox needs the denominator, and
 * this is it.
 *
 * `users.getProfile` is one request costing a single quota unit, against the 5 units
 * per page a counting walk spends, so this is the cheapest number the API sells.
 */
export interface MailboxProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
}

export async function fetchMailboxProfile(): Promise<MailboxProfile | null> {
  try {
    const res = await fetchGmailAPI('/profile');
    if (!res) return null;
    return {
      emailAddress: res.emailAddress || '',
      messagesTotal: Number(res.messagesTotal) || 0,
      threadsTotal: Number(res.threadsTotal) || 0,
    };
  } catch {
    // Size-relative scoring degrades to the fixed reference points without this,
    // so a failure here is a loss of precision rather than of function.
    return null;
  }
}

/**
 * Exact message totals for one system label, for 1 quota unit.
 *
 * Gmail maintains these counters itself, so `labels.get('INBOX')` is both cheaper
 * and more accurate than paging a query — no 10,000-message bound, no estimate.
 */
export async function fetchLabelTotals(
  labelId: string
): Promise<{ messagesTotal: number; messagesUnread: number } | null> {
  try {
    const res = await fetchGmailAPI(`/labels/${encodeURIComponent(labelId)}`);
    if (!res) return null;
    return {
      messagesTotal: Number(res.messagesTotal) || 0,
      messagesUnread: Number(res.messagesUnread) || 0,
    };
  } catch {
    return null;
  }
}

/**
 * Everything the health score measures itself against.
 *
 * Each clutter metric belongs to a population, and it is that population — not a
 * number someone picked — that says how bad the metric is. "Three thousand stale
 * promotions" means nothing on its own; "three thousand of your four thousand
 * promotional messages are stale" is a complete statement, and its worst case is
 * definitionally all of them.
 *
 * Both fields are real counts Gmail maintains itself — `users.getProfile` and the
 * `INBOX` label — so they cost one quota unit each and are exact: no paging, no
 * 10,000-message bound, no estimate.
 */
export interface MailboxComposition {
  /** Every message in the account. */
  mailboxTotal: number;
  /** Messages in the inbox — the population unread pressure is measured against. */
  inboxTotal: number;
}

export async function fetchMailboxComposition(): Promise<MailboxComposition> {
  const [profile, inbox] = await Promise.all([
    fetchMailboxProfile(),
    fetchLabelTotals('INBOX'),
  ]);
  return {
    mailboxTotal: profile?.messagesTotal ?? 0,
    inboxTotal: inbox?.messagesTotal ?? 0,
  };
}

/**
 * Spam and trash, counted exactly from Gmail's own label totals.
 *
 * Gmail maintains a running count on every system label, so this is two requests
 * at one quota unit each and needs no paging at all — against the hundreds of
 * requests it takes to walk `in:spam OR in:trash` on a large mailbox. Falls back
 * to null when either label is unavailable so the caller can page instead.
 */
export async function fetchSpamAndTrashTotal(): Promise<number | null> {
  const [spam, trash] = await Promise.all([
    fetchLabelTotals('SPAM'),
    fetchLabelTotals('TRASH'),
  ]);
  if (!spam && !trash) return null;
  return (spam?.messagesTotal ?? 0) + (trash?.messagesTotal ?? 0);
}

/** Back-compat shim for callers that only need the two headline totals. */
export async function fetchMailboxSize(): Promise<{ mailboxTotal: number; inboxTotal: number }> {
  const c = await fetchMailboxComposition();
  return { mailboxTotal: c.mailboxTotal, inboxTotal: c.inboxTotal };
}


/**
 * Message count for a query, in one request where possible.
 *
 * An earlier version asked for resultSizeEstimate with maxResults=1. Gmail's
 * estimate is unreliable at that page size — it returned the same figure for every
 * folder, which made the distribution chart meaningless. Requesting a full page
 * instead gives an exact count whenever the folder fits in one, and only falls back
 * to the estimate for folders larger than that, where a proportional chart does not
 * need exactness anyway.
 */
export async function estimateMessageCount(query: string): Promise<number> {
  try {
    const res = await fetchGmailAPI(`/messages?q=${encodeURIComponent(query)}&maxResults=500`);
    const messages = res?.messages || [];

    // No next page means we have seen everything: this is exact.
    if (!res?.nextPageToken) return messages.length;

    // Larger than one page. The estimate is far more sensible at this page size,
    // but never report less than what we have actually seen.
    const est = typeof res?.resultSizeEstimate === 'number' ? res.resultSizeEstimate : 0;
    return Math.max(est, messages.length);
  } catch {
    return 0;
  }
}
