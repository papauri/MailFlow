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
    if (response.status === 401 || response.status === 403 || errMsg.includes('invalid authentication credentials')) {
      logout().then(() => {
        window.location.reload();
      });
      throw new Error("Authentication expired. Please log in again.");
    }
    throw new Error(err.error?.message || `Gmail API Error: ${response.status}`);
  }
  
  if (response.status === 204) return null;
  return response.json();
}

export interface EmailData {
  id: string;
  threadId: string;
  snippet: string;
  date: Date;
  sender: string;
  subject: string;
  labelIds: string[];
  sizeEstimate?: number;
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
  let allMessages: any[] = [];
  let pageToken = "";
  let totalDetailed: EmailData[] = [];
  let fetchedIds = new Set<string>();
  
  while (allMessages.length < maxResults) {
    const limit = Math.min(500, maxResults - allMessages.length);
    let url = `/messages?q=${encodeURIComponent(query)}&maxResults=${limit}`;
    if (pageToken) url += `&pageToken=${pageToken}`;

    const listResult = await fetchGmailAPI(url);
    if (!listResult || !listResult.messages) break;
    
    const newMessages = listResult.messages.filter((m: any) => !fetchedIds.has(m.id));
    newMessages.forEach((m: any) => fetchedIds.add(m.id));
    allMessages.push(...newMessages);
    
    // Process this batch immediately
    const chunkDetails = await processInChunks(newMessages, 15, async (msg: any) => {
      try {
        const detail = await fetchGmailAPI(`/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
        const headers = detail.payload?.headers || [];
        
        return {
          id: detail.id,
          threadId: detail.threadId,
          snippet: detail.snippet,
          labelIds: detail.labelIds || [],
          sender: headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender',
          subject: headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)',
          date: new Date(headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date()),
          sizeEstimate: detail.sizeEstimate || 0,
        } as EmailData;
      } catch (err) {
        console.error(`Error fetching message ${msg.id}`, err);
        return null;
      }
    });

    const validDetails = chunkDetails.filter(Boolean) as EmailData[];
    totalDetailed.push(...validDetails);
    
    if (onProgress && validDetails.length > 0) {
      onProgress(validDetails);
    }
    
    pageToken = listResult.nextPageToken;
    if (!pageToken) break;
  }

  return totalDetailed;
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

export async function countEmails(query: string): Promise<number | string> {
  try {
    let total = 0;
    let pageToken = "";
    let pages = 0;
    
    do {
      let url = `/messages?q=${encodeURIComponent(query)}&maxResults=500`;
      if (pageToken) url += `&pageToken=${pageToken}`;
      const res = await fetchGmailAPI(url);
      
      if (!res || !res.messages) break;
      total += res.messages.length;
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
