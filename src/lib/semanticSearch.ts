/**
 * Semantic search, predictive type-ahead autocomplete, and Gmail query translation utilities.
 */

export interface SemanticSuggestion {
  id: string;
  title: string;
  subtitle: string;
  query: string;
  category: 'semantic' | 'date' | 'sender' | 'attachment' | 'quick_filter' | 'recent';
  badge?: string;
  inAnywhere?: boolean;
}

export interface ParsedQueryResponse {
  operators: {
    from?: string;
    to?: string;
    subject?: string;
    after?: string;
    before?: string;
    newer_than?: string;
    older_than?: string;
    has?: string;
    larger?: string;
    is?: string;
    folder?: string;
    general?: string;
    inAnywhere?: boolean;
    limit?: number;
    sortBy?: 'date' | 'size' | 'sender';
    sortDesc?: boolean;
  };
  explanation: string;
  suggestedFolder?: string;
  suggestedGmailCategory?: string;
  query: string;
  limit?: number;
  sortBy?: 'date' | 'size' | 'sender';
  sortDesc?: boolean;
}

export interface LocalParsedResult {
  query: string;
  explanation: string;
  inAnywhere: boolean;
  limit?: number;
  sortBy?: 'date' | 'size' | 'sender';
  sortDesc?: boolean;
}

// In-memory cache for fast autocomplete lookups during typing
const autocompleteCache = new Map<string, SemanticSuggestion[]>();

/**
 * Local instantaneous natural language heuristics parser for fallback and instant previews.
 */
export function parseNaturalLanguageLocal(input: string): LocalParsedResult {
  const raw = input.trim();
  if (!raw) return { query: raw, explanation: '', inAnywhere: false };

  // If already pure valid Gmail syntax (e.g. from:foo after:2020), pass through directly
  if (/^(from|to|subject|label|after|before|newer_than|older_than|is|has|larger|smaller|filename|in):/i.test(raw) && !/\b(an email from|emails about|emails with|find my|find me|look for|my tax|first \d+|last \d+|latest \d+|oldest \d+)\b/i.test(raw)) {
    return {
      query: raw,
      explanation: raw,
      inAnywhere: /in:anywhere/i.test(raw)
    };
  }

  let q = raw;

  // Typo normalizations
  q = q.replace(/\breurns\b/gi, 'returns')
       .replace(/\bretuns\b/gi, 'returns')
       .replace(/\battachements?\b/gi, 'attachments')
       .replace(/\batachments?\b/gi, 'attachments')
       .replace(/\battachmnts?\b/gi, 'attachments')
       .replace(/\breciepts?\b/gi, 'receipts')
       .replace(/\buniveristy\b/gi, 'university')
       .replace(/\bcolege\b/gi, 'college')
       .replace(/\bcalender\b/gi, 'calendar')
       .replace(/\bsubcription\b/gi, 'subscription')
       .replace(/\bsubsciptions?\b/gi, 'subscriptions')
       .replace(/\bemalils?\b/gi, 'emails');

  let inAnywhere = false;
  let limit: number | undefined = undefined;
  let sortBy: 'date' | 'size' | 'sender' | undefined = undefined;
  let sortDesc: boolean | undefined = undefined;
  let explanationDesc = '';
  const parts: string[] = [];

  // Detect explicit numerical limits and chronological direction
  // Case 1: "first 5", "first 5 emails", "oldest 5", "earliest 5", "first 5 from ... ever"
  const oldestFirstMatch = q.match(/\b(?:first|oldest|earliest)\s+(\d+)\b/i) ||
                           q.match(/\b(\d+)\s+(?:oldest|earliest)\b/i);
  if (oldestFirstMatch) {
    limit = parseInt(oldestFirstMatch[1], 10);
    sortBy = 'date';
    sortDesc = false; // Ascending date: oldest first = earliest history!
    inAnywhere = true;
    explanationDesc = `First ${limit} emails ever (Oldest First)`;
    q = q.replace(/\b(?:first|oldest|earliest)\s+\d+\s*(?:emails?|messages?|threads?|results?|items?)?(?:\s*ever)?\b/gi, ' ')
         .replace(/\b\d+\s+(?:oldest|earliest)\s*(?:emails?|messages?|threads?|results?|items?)?(?:\s*ever)?\b/gi, ' ')
         .trim();
  }

  // Case 2: "latest 5", "last 5", "recent 5", "newest 5", "top 5"
  const newestFirstMatch = q.match(/\b(?:latest|last|recent|newest|top)\s+(\d+)\b/i) ||
                           q.match(/\b(\d+)\s+(?:latest|newest|recent|last)\b/i);
  if (!limit && newestFirstMatch) {
    limit = parseInt(newestFirstMatch[1], 10);
    sortBy = 'date';
    sortDesc = true; // Descending date: newest first
    explanationDesc = `Latest ${limit} emails`;
    q = q.replace(/\b(?:latest|last|recent|newest|top)\s+\d+\s*(?:emails?|messages?|threads?|results?|items?)?\b/gi, ' ')
         .replace(/\b\d+\s+(?:latest|newest|recent|last)\s*(?:emails?|messages?|threads?|results?|items?)?\b/gi, ' ')
         .trim();
  }

  // Case 3: "top 5 largest", "5 biggest"
  const sizeLimitMatch = q.match(/\b(?:top|biggest|largest)\s+(\d+)\s*(?:largest|biggest)?\b/i) ||
                         q.match(/\b(\d+)\s+(?:largest|biggest)\b/i);
  if (sizeLimitMatch && (/largest|biggest|size/i.test(q))) {
    limit = parseInt(sizeLimitMatch[1], 10);
    sortBy = 'size';
    sortDesc = true;
    explanationDesc = `Top ${limit} largest emails`;
    q = q.replace(/\b(?:top|biggest|largest)\s+\d+\s*(?:largest|biggest)?\s*(?:emails?|messages?)?\b/gi, ' ')
         .replace(/\b\d+\s+(?:largest|biggest)\s*(?:emails?|messages?)?\b/gi, ' ')
         .trim();
  }

  // Remove conversational prefix filler words (e.g. "My tax returns for 2013", "find my...", "emails with...")
  q = q.replace(/^(?:an\s+email\s+from|an\s+email\s+about|an\s+email\s+with|emails\s+from|emails\s+about|emails\s+with|emails\s+to|find\s+my|find\s+me|find|show\s+me|where\s+is|look\s+for|search\s+for|all\s+emails\s+about|all\s+emails\s+from|all\s+emails\s+with|my\s+emails\s+from|my)\s+/i, '');

  // Extract explicit sender targeting (e.g. "from John", "from john@example.com", "from a sender" -> handled gracefully)
  const senderMatch = q.match(/\bfrom\s+([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9._-]+)\b/i);
  if (senderMatch && !/^(?:anywhere|inbox|sent|trash|spam|me|today|yesterday|now)$/i.test(senderMatch[1])) {
    const senderTarget = senderMatch[1];
    if (senderTarget.toLowerCase() !== 'a' && senderTarget.toLowerCase() !== 'the' && senderTarget.toLowerCase() !== 'sender') {
      parts.push(`from:${senderTarget}`);
      if (explanationDesc) {
        explanationDesc += ` from ${senderTarget}`;
      }
      q = q.replace(senderMatch[0], ' ').trim();
    } else {
      // If user literally typed "from a sender" or "from sender"
      q = q.replace(/\bfrom\s+(?:a\s+)?sender\b/gi, ' ').trim();
    }
  }

  // Specific attachment constraints (e.g. "attachments only", "with attachments only", "with pdf")
  if (/\b(?:attachments?\s+only|only\s+attachments?|with\s+attachments?\s+only|emails?\s+with\s+attachments?\s+only|with\s+attachments?|has\s+attachments?|has\s+files?|has\s+pdf|pdf\s+attachments?|pdfs?\s+only|with\s+pdfs?)\b/i.test(q)) {
    if (/pdf/i.test(q)) {
      parts.push('filename:pdf');
    } else {
      parts.push('has:attachment');
    }
    q = q.replace(/\b(?:attachments?\s+only|only\s+attachments?|with\s+attachments?\s+only|emails?\s+with\s+attachments?\s+only|with\s+attachments?|has\s+attachments?|has\s+files?|has\s+pdf|pdf\s+attachments?|pdfs?\s+only|with\s+pdfs?)\b/gi, ' ').trim();
  }

  // Year range detection (e.g. "between 2014 and 2018", "from 2014 to 2018")
  const yearRangeMatch = q.match(/\b(?:between|from)\s*(19\d\d|20\d\d)\s*(?:and|to)\s*(19\d\d|20\d\d)\b/i);
  if (yearRangeMatch) {
    const startYear = parseInt(yearRangeMatch[1], 10);
    const endYear = parseInt(yearRangeMatch[2], 10);
    parts.push(`after:${startYear - 1}/12/31 before:${endYear + 1}/01/01`);
    inAnywhere = true;
    q = q.replace(yearRangeMatch[0], ' ').trim();
  }

  // Single year detection (e.g. "for 2013", "from 2016", "in 2016", "only from 2016", "during 2016", "2016")
  const yearMatch = q.match(/\b(?:from|for|in|of|during|year|back\s+in|only\s+from|dating\s+back\s+to)?\s*(19\d\d|20\d\d)\b/i);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    const startYear = year - 1;
    const endYear = year + 1;
    parts.push(`after:${startYear}/12/31 before:${endYear}/01/01`);
    inAnywhere = true;
    q = q.replace(yearMatch[0], ' ').trim();
  }

  // Relative dates
  if (/\b(?:last\s+week|past\s+week|past\s+7\s+days)\b/i.test(q)) {
    parts.push('newer_than:7d');
    q = q.replace(/\b(?:last\s+week|past\s+week|past\s+7\s+days)\b/gi, ' ').trim();
  } else if (/\b(?:last\s+month|past\s+month|past\s+30\s+days)\b/i.test(q)) {
    parts.push('newer_than:30d');
    q = q.replace(/\b(?:last\s+month|past\s+month|past\s+30\s+days)\b/gi, ' ').trim();
  } else if (/\b(?:last\s+year|past\s+year)\b/i.test(q)) {
    parts.push('newer_than:1y');
    inAnywhere = true;
    q = q.replace(/\b(?:last\s+year|past\s+year)\b/gi, ' ').trim();
  } else if (/\bolder\s+than\s+(\d+)\s*(?:years?|y)\b/i.test(q)) {
    const m = q.match(/\bolder\s+than\s+(\d+)\s*(?:years?|y)\b/i);
    if (m) parts.push(`older_than:${m[1]}y`);
    inAnywhere = true;
    q = q.replace(/\bolder\s+than\s+\d+\s*(?:years?|y)\b/gi, ' ').trim();
  } else if (/\bbefore\s+(19\d\d|20\d\d)\b/i.test(q)) {
    const m = q.match(/\bbefore\s+(19\d\d|20\d\d)\b/i);
    if (m) parts.push(`before:${m[1]}/01/01`);
    inAnywhere = true;
    q = q.replace(/\bbefore\s+(?:19\d\d|20\d\d)\b/gi, ' ').trim();
  } else if (/\b(?:after|since)\s+(19\d\d|20\d\d)\b/i.test(q)) {
    const m = q.match(/\b(?:after|since)\s+(19\d\d|20\d\d)\b/i);
    if (m) parts.push(`after:${parseInt(m[1], 10) - 1}/12/31`);
    inAnywhere = true;
    q = q.replace(/\b(?:after|since)\s+(?:19\d\d|20\d\d)\b/gi, ' ').trim();
  }

  // Common semantic concepts & synonym expansions
  if (/\b(?:taxes?|tax\s+returns?|1099|w2|irs|turbotax)\b/i.test(q)) {
    parts.push('(tax OR taxes OR 1099 OR W2 OR IRS OR "tax return" OR "tax returns" OR turbotax)');
    inAnywhere = true;
    q = q.replace(/\b(?:taxes?|tax\s+returns?|1099|w2|irs|turbotax)\b/gi, ' ').trim();
  } else if (/\b(?:college|university|campus|school|alumni|tuition|admissions?)\b/i.test(q)) {
    parts.push('(college OR university OR from:.edu OR campus OR alumni OR tuition OR admissions)');
    inAnywhere = true;
    q = q.replace(/\b(?:college|university|campus|school|alumni|tuition|admissions?)\b/gi, ' ').trim();
  } else if (/\b(?:receipts?|invoices?|orders?|payments?|bills?|billing)\b/i.test(q)) {
    parts.push('(receipt OR invoice OR order OR confirmation OR payment OR bill)');
    q = q.replace(/\b(?:receipts?|invoices?|orders?|payments?|bills?|billing)\b/gi, ' ').trim();
  } else if (/\b(?:flights?|airlines?|boarding\s+pass|tickets?|itinerary|hotel|reservations?)\b/i.test(q)) {
    parts.push('(flight OR airline OR boarding OR ticket OR itinerary OR reservation)');
    q = q.replace(/\b(?:flights?|airlines?|boarding\s+pass|tickets?|itinerary|hotel|reservations?)\b/gi, ' ').trim();
  } else if (/\b(?:newsletters?|digest|weekly\s+roundup|subscriptions?)\b/i.test(q)) {
    parts.push('(newsletter OR digest OR unsubscribe OR "view in browser")');
    q = q.replace(/\b(?:newsletters?|digest|weekly\s+roundup|subscriptions?)\b/gi, ' ').trim();
  } else if (/\b(?:medical|doctor|hospital|clinic|prescriptions?|health|lab\s+results)\b/i.test(q)) {
    parts.push('(medical OR doctor OR hospital OR clinic OR prescription OR health)');
    inAnywhere = true;
    q = q.replace(/\b(?:medical|doctor|hospital|clinic|prescriptions?|health|lab\s+results)\b/gi, ' ').trim();
  } else if (/\b(?:bank\s+statements?|statements?|wire\s+transfer|direct\s+deposit)\b/i.test(q)) {
    parts.push('(statement OR "bank statement" OR balance OR deposit OR wire)');
    inAnywhere = true;
    q = q.replace(/\b(?:bank\s+statements?|statements?|wire\s+transfer|direct\s+deposit)\b/gi, ' ').trim();
  } else if (/\b(?:resumes?|cv|job\s+applications?|interviews?|job\s+offers?)\b/i.test(q)) {
    parts.push('(resume OR CV OR "job application" OR interview OR offer)');
    inAnywhere = true;
    q = q.replace(/\b(?:resumes?|cv|job\s+applications?|interviews?|job\s+offers?)\b/gi, ' ').trim();
  }

  // Unread filter
  if (/\b(?:unread|new\s+emails?)\b/i.test(q)) {
    parts.push('is:unread');
    q = q.replace(/\b(?:unread|new\s+emails?)\b/gi, ' ').trim();
  }

  // Starred / Flagged
  if (/\b(?:starred|flagged|important)\b/i.test(q)) {
    parts.push('is:starred');
    q = q.replace(/\b(?:starred|flagged|important)\b/gi, ' ').trim();
  }

  // Clean trailing "from", "about", "with", "sent", "received", "only", "emails", etc.
  q = q.replace(/\b(?:from|about|with|for|to|of|sent|received|by|on|only|emails?|things|like|type|find)\b/gi, ' ')
       .replace(/\s+/g, ' ')
       .trim();

  if (q.length > 0) {
    parts.push(q);
  }

  const finalQuery = parts.join(' ').trim() || raw;
  return {
    query: finalQuery,
    explanation: explanationDesc || finalQuery,
    inAnywhere,
    limit,
    sortBy,
    sortDesc
  };
}

/**
 * Generate quick local fallback suggestions when offline or during initial keystroke
 */
export function generateLocalSuggestions(input: string, recentQueries: string[] = []): SemanticSuggestion[] {
  const text = input.trim();
  if (!text) return [];

  const list: SemanticSuggestion[] = [];
  const local = parseNaturalLanguageLocal(text);

  if (local.query !== text) {
    list.push({
      id: 'local_translated',
      title: text,
      subtitle: local.query,
      query: local.query,
      category: 'semantic',
      inAnywhere: local.inAnywhere
    });
  }

  // Senders suggestion if user typed a name/word
  if (/^[a-zA-Z0-9_-]+$/.test(text)) {
    list.push({
      id: 'local_from',
      title: `From "${text}"`,
      subtitle: `Filter by sender`,
      query: `from:${text}`,
      category: 'sender',
      inAnywhere: false
    });
    list.push({
      id: 'local_subject',
      title: `Subject "${text}"`,
      subtitle: `Match subject line`,
      query: `subject:${text}`,
      category: 'quick_filter',
      inAnywhere: false
    });
  }

  // Matching recents
  const matchingRecents = recentQueries.filter(r => r.toLowerCase().includes(text.toLowerCase()) && r !== text).slice(0, 2);
  for (const r of matchingRecents) {
    list.push({
      id: `recent_${r}`,
      title: r,
      subtitle: 'Recent search',
      query: r,
      category: 'recent'
    });
  }

  return list;
}

/**
 * Fetches semantic predictive search suggestions from the AI backend
 */
export async function fetchSemanticAutocomplete(
  prompt: string,
  aiSettings: any,
  localContext?: { topSenders?: string[] },
  signal?: AbortSignal
): Promise<SemanticSuggestion[]> {
  const key = prompt.trim().toLowerCase();
  if (!key || key.length < 2) return [];

  if (autocompleteCache.has(key)) {
    return autocompleteCache.get(key)!;
  }

  try {
    const res = await fetch('/api/semantic-autocomplete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt.trim(),
        settings: aiSettings,
        localContext
      }),
      signal
    });

    if (!res.ok) {
      return generateLocalSuggestions(prompt);
    }

    const data = await res.json();
    const suggestions: SemanticSuggestion[] = data.suggestions || [];

    if (suggestions.length > 0) {
      autocompleteCache.set(key, suggestions);
      return suggestions;
    }

    return generateLocalSuggestions(prompt);
  } catch (err: any) {
    if (err.name === 'AbortError') return [];
    return generateLocalSuggestions(prompt);
  }
}

/**
 * Recent searches manager in localStorage
 */
const RECENT_SEARCHES_KEY = 'mailflow_recent_searches';

export function getRecentSearches(): string[] {
  try {
    const saved = localStorage.getItem(RECENT_SEARCHES_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
}

export function saveRecentSearch(query: string) {
  const clean = query.trim();
  if (!clean || clean.length < 2) return;
  try {
    const existing = getRecentSearches().filter(q => q.toLowerCase() !== clean.toLowerCase());
    const updated = [clean, ...existing].slice(0, 10);
    localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(updated));
  } catch {}
}

export function clearRecentSearches() {
  try {
    localStorage.removeItem(RECENT_SEARCHES_KEY);
  } catch {}
}
