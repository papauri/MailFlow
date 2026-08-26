import { getAccessToken, logout } from "./firebase";

const BASE_URL = "https://gmail.googleapis.com/gmail/v1/users/me";

export async function fetchGmailAPI(endpoint: string, options: RequestInit = {}, retries = 3, backoff = 1000): Promise<any> {
  const token = await getAccessToken();
  if (!token) throw new Error("Authentication required");

  const headers = {
    ...options.headers,
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };

  let response;
  try {
    response = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
  } catch (err) {
    if (retries > 0) {
      console.warn(`Network error on ${endpoint} (${err.message || err}). Retrying in ${backoff}ms...`);
      await new Promise(r => setTimeout(r, backoff));
      return fetchGmailAPI(endpoint, options, retries - 1, backoff * 1.5);
    }
    throw err;
  }
  
  if ((response.status === 429 || response.status >= 500) && retries > 0) {
    console.warn(`Status ${response.status} hit on ${endpoint}. Retrying in ${backoff}ms...`);
    await new Promise(r => setTimeout(r, backoff));
    return fetchGmailAPI(endpoint, options, retries - 1, backoff * 1.5);
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const errMsg = err.error?.message || '';
    if (response.status === 401 || errMsg.toLowerCase().includes('invalid authentication credentials') || errMsg.toLowerCase().includes('expired') || (response.status === 403 && (errMsg.toLowerCase().includes('insufficient permission') || errMsg.toLowerCase().includes('insufficient authentication scopes') || errMsg.toLowerCase().includes('insufficient')))) {
      logout().catch(() => {});
      setTimeout(() => {
        window.location.reload();
      }, 500);
      throw new Error("Authentication expired or missing permissions. Please log in again.");
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

// Simple chunking to avoid slamming the API too hard at once
export async function processInChunks<T, R>(items: T[], chunkSize: number, processor: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    const chunk = items.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(chunk.map(processor));
    results.push(...chunkResults);
    // Add delay between chunks to respect 250 quota units / second limit (threads.get is 5 units)
    if (i + chunkSize < items.length) {
      await new Promise(resolve => setTimeout(resolve, 200));
    }
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
    const scoped = query.includes('in:inbox') ? query : `${query} in:inbox`;
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
    const url = `/messages?q=${encodeURIComponent(query + ' is:unread')}&maxResults=${PAGE_SIZE}`;
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

export async function countEmails(query: string): Promise<number> {
  try {
    let total = 0;
    let pageToken = "";
    
    do {
      let url = `/messages?q=${encodeURIComponent(query)}&maxResults=500`;
      if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
      const res = await fetchGmailAPI(url);
      
      if (!res || !res.messages || res.messages.length === 0) break;
      total += res.messages.length;
      pageToken = res.nextPageToken;
    } while (pageToken); // Check all emails to get accurate count
    
    return total;
  } catch (err) {
    return 0;
  }
}

export async function estimateQuerySize(query: string, countStr: number | string): Promise<number> {
  const count = typeof countStr === 'string' ? parseInt(countStr.replace(/\D/g, '')) || 0 : countStr;
  if (count === 0) return 0;

  try {
    // 1. Fetch a single small page of results
    const res = await fetchGmailAPI(`/threads?q=${encodeURIComponent(query)}&maxResults=10`);
    if (!res || !res.threads || res.threads.length === 0) return 0;
    
    // 2. Fetch details for this sample
    const sampleDetails = await processInChunks(res.threads, 5, async (thread: any) => {
      try {
        const detail = await fetchGmailAPI(`/threads/${thread.id}?format=metadata`);
        if (!detail.messages || detail.messages.length === 0) return 0;
        return detail.messages.reduce((sum: number, m: any) => sum + (m.sizeEstimate || 0), 0);
      } catch (e) {
        return 0;
      }
    });
    
    // 3. Average the sizes
    const validSizes = sampleDetails.filter(s => s > 0);
    if (validSizes.length === 0) return 0;
    
    const avgSize = validSizes.reduce((a, b) => a + b, 0) / validSizes.length;
    
    // 4. Multiply by total count
    return avgSize * count;
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
const BATCH_SIZE = 100;

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
  signal?: AbortSignal
): Promise<any[]> {
  if (ids.length === 0) return [];
  const token = await getAccessToken();
  if (!token) throw new Error('Authentication required');

  const out: any[] = [];

  for (let i = 0; i < ids.length; i += BATCH_SIZE) {
    if (signal?.aborted) break;
    const chunk = ids.slice(i, i + BATCH_SIZE);
    const boundary = `batch_${Math.random().toString(36).slice(2)}`;

    try {
      const res = await fetch(BATCH_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': `multipart/mixed; boundary=${boundary}`,
        },
        body: buildBatchBody(chunk, boundary),
        signal,
      });

      if (!res.ok) {
        // One failed batch should not lose the rest of the scan.
        console.warn(`Batch metadata request failed (${res.status}); skipping ${chunk.length} messages.`);
        continue;
      }

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
      out.push(...parsed.map(shapeMessage));
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
  limit: number = 2000,
  signal?: AbortSignal
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken = '';

  while (ids.length < limit) {
    if (signal?.aborted) break;
    let url = `/messages?q=${encodeURIComponent(query)}&maxResults=500`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

    const res = await fetchGmailAPI(url);
    const batch = res?.messages || [];
    if (batch.length === 0) break;

    ids.push(...batch.map((m: any) => m.id));
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }

  return ids.slice(0, limit);
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
