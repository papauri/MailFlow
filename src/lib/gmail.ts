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

  const response = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
  
  if (response.status === 429 && retries > 0) {
    console.warn(`Rate limit hit on ${endpoint}. Retrying in ${backoff}ms...`);
    await new Promise(r => setTimeout(r, backoff));
    return fetchGmailAPI(endpoint, options, retries - 1, backoff * 1.5);
  }

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    const errMsg = err.error?.message || '';
    if (response.status === 401 || errMsg.includes('invalid authentication credentials') || errMsg.includes('expired') || (response.status === 403 && errMsg.includes('Insufficient Permission'))) {
      logout().then(() => {
        window.location.reload();
      });
      throw new Error("Authentication expired or missing permissions. Please log in again.");
    }
    throw new Error(err.error?.message || `Gmail API Error: ${response.status}`);
  }
  
  if (response.status === 204) return null;
  return response.json();
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
    const chunkDetails = await processInChunks(newThreads, 15, async (thread: any) => {
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

export async function searchEmailsPaginated(query: string, maxResults = 50, pageToken = ""): Promise<{ emails: EmailData[], nextPageToken?: string }> {
  let url = `/threads?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  if (pageToken) url += `&pageToken=${pageToken}`;

  const listResult = await fetchGmailAPI(url);
  if (!listResult || !listResult.threads) return { emails: [] };
  
  const chunkDetails = await processInChunks(listResult.threads, 15, async (thread: any) => {
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
  await fetchGmailAPI('/messages/batchModify', {
    method: 'POST',
    body: JSON.stringify({ ids, addLabelIds, removeLabelIds })
  });
}

export async function batchTrashEmails(ids: string[]) {
  if (ids.length === 0) return;
  await batchModifyEmails(ids, ['TRASH'], ['INBOX']);
}

export async function batchDeleteEmails(ids: string[]) {
  if (ids.length === 0) return;
  await fetchGmailAPI('/messages/batchDelete', {
    method: 'POST',
    body: JSON.stringify({ ids })
  });
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

export async function emptyAllTrash(onProgress?: (deletedCount: number) => void) {
  let pageToken = "";
  let totalDeleted = 0;
  let hasMore = true;

  while (hasMore) {
    let url = `/messages?q=${encodeURIComponent('in:trash')}&maxResults=1000`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    
    const listResult = await fetchGmailAPI(url);
    if (!listResult || !listResult.messages || listResult.messages.length === 0) {
      break;
    }
    
    const ids = listResult.messages.map((m: any) => m.id);
    await batchDeleteEmails(ids);
    
    totalDeleted += ids.length;
    if (onProgress) {
      onProgress(totalDeleted);
    }
    
    pageToken = listResult.nextPageToken;
    if (!pageToken) {
      hasMore = false;
    }
  }
  return totalDeleted;
}

export async function markAllAsReadByQuery(query: string, onProgress?: (markedCount: number) => void) {
  let pageToken = "";
  let totalMarked = 0;
  let hasMore = true;

  while (hasMore) {
    let url = `/messages?q=${encodeURIComponent(query + ' is:unread')}&maxResults=1000`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    
    const listResult = await fetchGmailAPI(url);
    if (!listResult || !listResult.messages || listResult.messages.length === 0) {
      break;
    }
    
    const ids = listResult.messages.map((m: any) => m.id);
    await batchMarkAsRead(ids);
    
    totalMarked += ids.length;
    if (onProgress) {
      onProgress(totalMarked);
    }
    
    pageToken = listResult.nextPageToken;
    if (!pageToken) {
      hasMore = false;
    }
  }
  return totalMarked;
}

export async function countEmails(query: string): Promise<number | string> {
  try {
    let total = 0;
    let pageToken = "";
    let pages = 0;
    
    do {
      let url = `/threads?q=${encodeURIComponent(query)}&maxResults=500`;
      if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
      const res = await fetchGmailAPI(url);
      
      if (!res || !res.threads || res.threads.length === 0) break;
      total += res.threads.length;
      pageToken = res.nextPageToken;
      pages++;
    } while (pageToken && pages < 10); // Check up to 5,000 emails max to save API calls
    
    if (pageToken) {
      return "5,000+";
    }
    
    return total;
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
