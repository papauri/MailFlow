/**
 * Email Intelligence & Algorithmic Utilities
 * Production-grade algorithms for sender parsing, root domain normalization,
 * TF-IDF vectorization, Bayesian rule confidence, and health indexing.
 */

// Comprehensive ccTLD Registry for precise two-level domain extraction
const TWO_LEVEL_TLDS = new Set([
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'me.uk', 'net.uk',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au',
  'co.jp', 'ne.jp', 'or.jp', 'ac.jp', 'go.jp',
  'com.br', 'org.br', 'net.br', 'gov.br',
  'co.nz', 'net.nz', 'org.nz', 'govt.nz',
  'co.za', 'org.za', 'net.za', 'gov.za',
  'com.sg', 'org.sg', 'edu.sg', 'gov.sg',
  'co.in', 'net.in', 'org.in', 'gen.in', 'firm.in',
  'com.mx', 'org.mx', 'net.mx', 'edu.mx', 'gob.mx',
  'com.ar', 'org.ar', 'net.ar', 'gov.ar',
  'com.tr', 'org.tr', 'net.tr', 'gov.tr',
  'co.kr', 'ne.kr', 'or.kr', 're.kr',
  'com.tw', 'org.tw', 'net.tw', 'idv.tw',
  'com.hk', 'org.hk', 'net.hk', 'edu.hk',
  'co.il', 'org.il', 'net.il', 'ac.il',
  'com.ph', 'org.ph', 'net.ph', 'edu.ph',
  'com.my', 'org.my', 'net.my', 'edu.my',
  'com.co', 'org.co', 'net.co', 'edu.co',
  'co.th', 'or.th', 'ac.th', 'go.th',
  'com.ng', 'org.ng', 'net.ng', 'edu.ng'
]);

// Generic public webmail domains (freemail providers)
export const GENERIC_FREEMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'yahoo.fr', 'yahoo.de',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com',
  'aol.com', 'zoho.com', 'protonmail.com', 'proton.me', 'mail.com', 'gmx.com',
  'yandex.com', 'yandex.ru', 'qq.com', '163.com', '126.com', 'sina.com'
]);

// Enterprise & Consumer Brand Dictionary
export const KNOWN_BRAND_MAP: Record<string, { brand: string; rootDomain: string; category?: string }> = {
  'amazon.com': { brand: 'Amazon', rootDomain: 'amazon.com', category: 'Purchases' },
  'amazon.co.uk': { brand: 'Amazon UK', rootDomain: 'amazon.co.uk', category: 'Purchases' },
  'amazon.de': { brand: 'Amazon DE', rootDomain: 'amazon.de', category: 'Purchases' },
  'amazon.ca': { brand: 'Amazon CA', rootDomain: 'amazon.ca', category: 'Purchases' },
  'ebay.com': { brand: 'eBay', rootDomain: 'ebay.com', category: 'Purchases' },
  'walmart.com': { brand: 'Walmart', rootDomain: 'walmart.com', category: 'Purchases' },
  'target.com': { brand: 'Target', rootDomain: 'target.com', category: 'Purchases' },
  'aliexpress.com': { brand: 'AliExpress', rootDomain: 'aliexpress.com', category: 'Purchases' },
  'etsy.com': { brand: 'Etsy', rootDomain: 'etsy.com', category: 'Purchases' },
  'apple.com': { brand: 'Apple', rootDomain: 'apple.com', category: 'Purchases' },
  'google.com': { brand: 'Google', rootDomain: 'google.com', category: 'Services' },
  'microsoft.com': { brand: 'Microsoft', rootDomain: 'microsoft.com', category: 'Services' },
  'github.com': { brand: 'GitHub', rootDomain: 'github.com', category: 'Dev' },
  'gitlab.com': { brand: 'GitLab', rootDomain: 'gitlab.com', category: 'Dev' },
  'bitbucket.org': { brand: 'Bitbucket', rootDomain: 'bitbucket.org', category: 'Dev' },
  'vercel.com': { brand: 'Vercel', rootDomain: 'vercel.com', category: 'Dev' },
  'netlify.com': { brand: 'Netlify', rootDomain: 'netlify.com', category: 'Dev' },
  'digitalocean.com': { brand: 'DigitalOcean', rootDomain: 'digitalocean.com', category: 'Dev' },
  'cloudflare.com': { brand: 'Cloudflare', rootDomain: 'cloudflare.com', category: 'Dev' },
  'atlassian.com': { brand: 'Atlassian', rootDomain: 'atlassian.com', category: 'Dev' },
  'atlassian.net': { brand: 'Atlassian', rootDomain: 'atlassian.net', category: 'Dev' },
  'jira.com': { brand: 'Jira', rootDomain: 'jira.com', category: 'Dev' },
  'linear.app': { brand: 'Linear', rootDomain: 'linear.app', category: 'Dev' },
  'sentry.io': { brand: 'Sentry', rootDomain: 'sentry.io', category: 'Dev' },
  'datadoghq.com': { brand: 'Datadog', rootDomain: 'datadoghq.com', category: 'Dev' },
  'stripe.com': { brand: 'Stripe', rootDomain: 'stripe.com', category: 'Finance' },
  'paypal.com': { brand: 'PayPal', rootDomain: 'paypal.com', category: 'Finance' },
  'chase.com': { brand: 'Chase', rootDomain: 'chase.com', category: 'Finance' },
  'bankofamerica.com': { brand: 'Bank of America', rootDomain: 'bankofamerica.com', category: 'Finance' },
  'wellsfargo.com': { brand: 'Wells Fargo', rootDomain: 'wellsfargo.com', category: 'Finance' },
  'citi.com': { brand: 'Citibank', rootDomain: 'citi.com', category: 'Finance' },
  'capitalone.com': { brand: 'Capital One', rootDomain: 'capitalone.com', category: 'Finance' },
  'revolut.com': { brand: 'Revolut', rootDomain: 'revolut.com', category: 'Finance' },
  'wise.com': { brand: 'Wise', rootDomain: 'wise.com', category: 'Finance' },
  'monzo.com': { brand: 'Monzo', rootDomain: 'monzo.com', category: 'Finance' },
  'robinhood.com': { brand: 'Robinhood', rootDomain: 'robinhood.com', category: 'Finance' },
  'coinbase.com': { brand: 'Coinbase', rootDomain: 'coinbase.com', category: 'Finance' },
  'uber.com': { brand: 'Uber', rootDomain: 'uber.com', category: 'Travel' },
  'ubereats.com': { brand: 'Uber Eats', rootDomain: 'ubereats.com', category: 'Purchases' },
  'doordash.com': { brand: 'DoorDash', rootDomain: 'doordash.com', category: 'Purchases' },
  'grubhub.com': { brand: 'Grubhub', rootDomain: 'grubhub.com', category: 'Purchases' },
  'lyft.com': { brand: 'Lyft', rootDomain: 'lyft.com', category: 'Travel' },
  'airbnb.com': { brand: 'Airbnb', rootDomain: 'airbnb.com', category: 'Travel' },
  'booking.com': { brand: 'Booking.com', rootDomain: 'booking.com', category: 'Travel' },
  'expedia.com': { brand: 'Expedia', rootDomain: 'expedia.com', category: 'Travel' },
  'delta.com': { brand: 'Delta Air Lines', rootDomain: 'delta.com', category: 'Travel' },
  'united.com': { brand: 'United Airlines', rootDomain: 'united.com', category: 'Travel' },
  'aa.com': { brand: 'American Airlines', rootDomain: 'aa.com', category: 'Travel' },
  'netflix.com': { brand: 'Netflix', rootDomain: 'netflix.com', category: 'Entertainment' },
  'spotify.com': { brand: 'Spotify', rootDomain: 'spotify.com', category: 'Entertainment' },
  'youtube.com': { brand: 'YouTube', rootDomain: 'youtube.com', category: 'Entertainment' },
  'disneyplus.com': { brand: 'Disney+', rootDomain: 'disneyplus.com', category: 'Entertainment' },
  'linkedin.com': { brand: 'LinkedIn', rootDomain: 'linkedin.com', category: 'Social' },
  'twitter.com': { brand: 'X (Twitter)', rootDomain: 'twitter.com', category: 'Social' },
  'x.com': { brand: 'X (Twitter)', rootDomain: 'x.com', category: 'Social' },
  'facebookmail.com': { brand: 'Facebook', rootDomain: 'facebook.com', category: 'Social' },
  'instagram.com': { brand: 'Instagram', rootDomain: 'instagram.com', category: 'Social' },
  'slack.com': { brand: 'Slack', rootDomain: 'slack.com', category: 'Productivity' },
  'notion.so': { brand: 'Notion', rootDomain: 'notion.so', category: 'Productivity' },
  'figma.com': { brand: 'Figma', rootDomain: 'figma.com', category: 'Productivity' },
  'canva.com': { brand: 'Canva', rootDomain: 'canva.com', category: 'Productivity' },
  'zoom.us': { brand: 'Zoom', rootDomain: 'zoom.us', category: 'Productivity' },
  'substack.com': { brand: 'Substack', rootDomain: 'substack.com', category: 'Newsletters' },
  'medium.com': { brand: 'Medium', rootDomain: 'medium.com', category: 'Newsletters' },
  'nytimes.com': { brand: 'The New York Times', rootDomain: 'nytimes.com', category: 'Newsletters' },
  'wsj.com': { brand: 'The Wall Street Journal', rootDomain: 'wsj.com', category: 'Newsletters' },
  'theverge.com': { brand: 'The Verge', rootDomain: 'theverge.com', category: 'Newsletters' },
  'techcrunch.com': { brand: 'TechCrunch', rootDomain: 'techcrunch.com', category: 'Newsletters' },
};

export interface SenderDetails {
  emailAddr: string;
  namePart: string;
  domain: string;
  rootDomain: string;
  brand: string;
  displayName: string;
  isGenericFreemail: boolean;
}

/**
 * Robust RFC 2047 & MIME Decoder
 */
export function decodeMimeWords(str: string): string {
  if (!str) return '';
  return str.replace(/=\?([^?]+)\?([BQbq])\?([^?]+)\?=/g, (_, charset, encoding, text) => {
    try {
      if (encoding.toUpperCase() === 'B') {
        return atob(text);
      } else if (encoding.toUpperCase() === 'Q') {
        const unescaped = text.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (__: string, hex: string) => 
          String.fromCharCode(parseInt(hex, 16))
        );
        return unescaped;
      }
    } catch {
      return text;
    }
    return text;
  });
}

/**
 * Extracts Root Domain from multi-level subdomains with ccTLD awareness
 * Example: 'bounce-123.mail.service.co.uk' -> 'service.co.uk'
 * Example: 'notifications.github.com' -> 'github.com'
 */
export function extractRootDomain(domain: string): string {
  if (!domain) return '';
  const cleanDomain = domain.toLowerCase().trim();
  const parts = cleanDomain.split('.');
  if (parts.length <= 2) return cleanDomain;

  const lastTwo = parts.slice(-2).join('.');
  if (TWO_LEVEL_TLDS.has(lastTwo)) {
    // Suffix is 2-level (e.g. .co.uk), root is last 3 parts
    return parts.slice(-3).join('.');
  }
  // Standard 1-level TLD (e.g. .com, .org), root is last 2 parts
  return parts.slice(-2).join('.');
}

/**
 * High-Precision Sender Details Extractor
 */
export function extractSenderDetails(rawSender: string = ''): SenderDetails {
  const decoded = decodeMimeWords(rawSender).trim();
  
  // Match standard format: "Name" <email@domain.com> or <email@domain.com>
  const match = decoded.match(/<([^>]+)>/);
  let emailAddr = (match ? match[1] : decoded).toLowerCase().trim();
  // Strip any accidental wrapping quotes or brackets
  emailAddr = emailAddr.replace(/^["'<]+|[>"']+$/g, '');
  
  let namePart = match ? decoded.replace(/<[^>]+>/, '').trim() : '';
  namePart = namePart.replace(/^["']|["']$/g, '').trim();
  
  const atIdx = emailAddr.indexOf('@');
  const domain = atIdx !== -1 ? emailAddr.substring(atIdx + 1).toLowerCase().trim() : emailAddr;
  const rootDomain = extractRootDomain(domain);
  const isGenericFreemail = GENERIC_FREEMAIL_DOMAINS.has(rootDomain);

  let cleanBrand = '';
  
  // 1. Check known brand registry
  if (KNOWN_BRAND_MAP[rootDomain]) {
    cleanBrand = KNOWN_BRAND_MAP[rootDomain].brand;
  } else if (KNOWN_BRAND_MAP[domain]) {
    cleanBrand = KNOWN_BRAND_MAP[domain].brand;
  } else {
    // 2. Check suffix match in known brands
    for (const [key, val] of Object.entries(KNOWN_BRAND_MAP)) {
      if (domain === key || domain.endsWith('.' + key)) {
        cleanBrand = val.brand;
        break;
      }
    }
  }

  // 3. Fallback brand extraction from root domain base name
  if (!cleanBrand) {
    const parts = rootDomain.split('.');
    const base = parts[0] || 'Unknown';
    if (base.length > 0) {
      cleanBrand = base.charAt(0).toUpperCase() + base.slice(1);
    }
  }

  // Determine ideal display name
  const displayName = namePart || cleanBrand || emailAddr;

  return {
    emailAddr,
    namePart,
    domain,
    rootDomain,
    brand: cleanBrand,
    displayName,
    isGenericFreemail
  };
}

// -------------------------------------------------------------
// NLP & TF-IDF Vectorization Engine for Mathematical Clustering
// -------------------------------------------------------------

const STOP_WORDS = new Set([
  'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i', 'it', 'for', 'not', 'on', 'with',
  'he', 'as', 'you', 'do', 'at', 'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
  'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their', 'what', 'so', 'up', 'out', 'if',
  'about', 'who', 'get', 'which', 'go', 'me', 'when', 'make', 'can', 'like', 'time', 'no', 'just',
  'him', 'know', 'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could', 'them', 'see', 'other',
  'than', 'then', 'now', 'look', 'only', 'come', 'its', 'over', 'think', 'also', 'back', 'after', 'use',
  'two', 'how', 'our', 'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because', 'any', 'these',
  'give', 'day', 'most', 'us', 'is', 'are', 'was', 'were', 'been', 'has', 'had', 're', 'fwd', 'fw',
  'view', 'browser', 'unsubscribe', 'email', 'click', 'here', 'please', 'reply', 'privacy', 'policy',
  'terms', 'copyright', 'reserved', 'rights', 'help', 'center', 'support', 'sent', 'using', 'service'
]);

/**
 * Stemming heuristic: normalizes common english plurals and suffixes
 */
function stemWord(word: string): string {
  if (word.length <= 4) return word;
  if (word.endsWith('ies') && word.length > 5) return word.slice(0, -3) + 'y';
  if (word.endsWith('es') && !word.endsWith('ses') && !word.endsWith('zes') && !word.endsWith('ches') && !word.endsWith('shes')) {
    return word.slice(0, -1);
  }
  if (word.endsWith('s') && !word.endsWith('ss') && !word.endsWith('us') && !word.endsWith('is')) {
    return word.slice(0, -1);
  }
  if (word.endsWith('ing') && word.length > 6) return word.slice(0, -3);
  if (word.endsWith('ed') && word.length > 5) return word.slice(0, -2);
  return word;
}

/**
 * Advanced tokenization extracting informative unigrams and bigrams
 */
export function tokenizeText(text: string): string[] {
  if (!text) return [];
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !STOP_WORDS.has(w))
    .map(stemWord);

  const tokens: string[] = [...words];

  // Extract informative 2-grams (e.g. "order confirmation", "flight receipt")
  for (let i = 0; i < words.length - 1; i++) {
    const bigram = `${words[i]}_${words[i + 1]}`;
    tokens.push(bigram);
  }

  return tokens;
}

/**
 * Builds normalized TF-IDF feature vectors
 */
export function buildTFIDFMatrix(documents: string[][]) {
  const docCount = documents.length;
  if (docCount === 0) return { vocab: [], vectors: [] };

  // Document Frequency
  const df: Record<string, number> = {};
  documents.forEach(doc => {
    const unique = new Set(doc);
    unique.forEach(term => {
      df[term] = (df[term] || 0) + 1;
    });
  });

  // Filter vocabulary (require term in at least 2 docs if >= 4 docs)
  const vocab = Object.keys(df).filter(term => docCount < 4 || df[term] >= 2);
  const vocabIndex: Record<string, number> = {};
  vocab.forEach((v, idx) => vocabIndex[v] = idx);

  // Compute Smoothed IDF: ln(1 + (1+N)/(1+DF)) + 1
  const idf: Record<string, number> = {};
  vocab.forEach(term => {
    idf[term] = Math.log(1 + ((1 + docCount) / (1 + df[term]))) + 1;
  });

  // Compute L2-normalized unit vectors
  const vectors: number[][] = documents.map(doc => {
    const vec = new Array(vocab.length).fill(0);
    const tf: Record<string, number> = {};
    doc.forEach(term => {
      if (vocabIndex[term] !== undefined) {
        tf[term] = (tf[term] || 0) + 1;
      }
    });

    let sumSq = 0;
    Object.keys(tf).forEach(term => {
      const idx = vocabIndex[term];
      const weight = (tf[term] / Math.max(1, doc.length)) * idf[term];
      vec[idx] = weight;
      sumSq += weight * weight;
    });

    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let i = 0; i < vec.length; i++) {
        vec[i] /= norm;
      }
    }
    return vec;
  });

  return { vocab, vectors };
}

/**
 * Cosine Similarity between unit vectors
 */
export function computeCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}

// -------------------------------------------------------------
// Bayesian Rule Confidence & Statistical Scoring Engine
// -------------------------------------------------------------

export interface BayesianRuleMetrics {
  folderMatchCount: number;
  totalSample: number;
  senderTotalInInbox: number;
  isDomainCandidate: boolean;
}

/**
 * Calculates a mathematically calibrated Bayesian confidence index
 * P(Category | Sender) adjusted by sample density and domain consistency.
 */
export function calculateBayesianConfidence({
  folderMatchCount,
  totalSample,
  senderTotalInInbox,
  isDomainCandidate
}: BayesianRuleMetrics): number {
  if (folderMatchCount <= 0) return 0.5;

  // Empirical ratio
  const empiricalRatio = folderMatchCount / Math.max(1, totalSample);
  
  // Volume scaling bonus (more historical evidence = higher confidence)
  const evidenceWeight = Math.min(0.2, Math.log10(1 + folderMatchCount) * 0.15);
  
  // Domain bonus
  const domainBonus = isDomainCandidate ? 0.05 : 0;
  
  // Base confidence
  const confidence = 0.75 + (empiricalRatio * 0.15) + evidenceWeight + domainBonus;
  
  return Math.min(0.99, Math.max(0.70, Math.round(confidence * 100) / 100));
}

// -------------------------------------------------------------
// Multi-Factor Inbox Health Index Algorithm
// -------------------------------------------------------------

export interface HealthScoreMetrics {
  unreadInbox: number;
  spamAndTrash: number;
  oldPromotions: number;
  largeFiles: number;
  oldMail?: number;
  unsubscribedCount?: number;
  activeFiltersCount?: number;
}

export interface HealthScoreBreakdown {
  score: number;
  baseScore: number;
  unreadPenalty: number;
  spamPenalty: number;
  promoPenalty: number;
  bloatPenalty: number;
  /** The share of bloatPenalty owed to >5MB attachments. */
  largeFilesPenalty: number;
  /** The share of bloatPenalty owed to >1 year old mail. */
  oldMailPenalty: number;
  totalDeductions: number;
  managementBonus: number;
  unsubBonus: number;
  filterBonus: number;
  totalBonus: number;
}

/**
 * Multi-Factor Adaptive Inbox Health Index Breakdown
 * Calculates transparent, mathematically precise point deductions and bonuses.
 */
export function computeInboxHealthBreakdown(metrics: HealthScoreMetrics): HealthScoreBreakdown {
  const {
    unreadInbox = 0,
    spamAndTrash = 0,
    oldPromotions = 0,
    largeFiles = 0,
    oldMail = 0,
    unsubscribedCount = 0,
    activeFiltersCount = 0
  } = metrics;

  // 1. Unread Pressure: Logarithmic decay (max 35 pts)
  const unreadPenalty = Math.min(35, unreadInbox > 0 ? (Math.log(1 + unreadInbox) / Math.log(1 + 600)) * 35 : 0);

  // 2. Clutter Factor: Spam & Trash (max 25 pts)
  const spamPenalty = Math.min(25, spamAndTrash > 0 ? (Math.log(1 + spamAndTrash) / Math.log(1 + 400)) * 25 : 0);

  // 3. Stale Promotions > 6 Months (max 20 pts)
  const promoPenalty = Math.min(20, oldPromotions > 0 ? (Math.log(1 + oldPromotions) / Math.log(1 + 500)) * 20 : 0);

  // 4. Bloat Factor: Large Emails > 5MB & Obsolete Mails > 1 Year (max 10 pts)
  const rawLargeFiles = largeFiles * 0.5;
  const rawOldMail = Math.min(500, oldMail) * 0.01;
  const bloatPenalty = Math.min(10, rawLargeFiles + rawOldMail);

  // Split the (capped) bloat deduction proportionally between its two causes so the
  // breakdown can show, and let the user actually clear, each half independently.
  // The two reported figures always sum back to bloatPenalty.
  const rawBloatTotal = rawLargeFiles + rawOldMail;
  const largeFilesPenalty = rawBloatTotal > 0 ? bloatPenalty * (rawLargeFiles / rawBloatTotal) : 0;
  const oldMailPenalty = rawBloatTotal > 0 ? bloatPenalty * (rawOldMail / rawBloatTotal) : 0;

  const totalDeductions = unreadPenalty + spamPenalty + promoPenalty + bloatPenalty;

  // 5. Positive Management Bonus: Rewards user cleanups & rules (up to +15 pts)
  const unsubBonus = Math.min(8, (unsubscribedCount || 0) * 1.5);
  const filterBonus = Math.min(7, (activeFiltersCount || 0) * 2.0);
  const managementBonus = Math.min(15, unsubBonus + filterBonus);

  const rawScore = 100 - totalDeductions + managementBonus;
  const score = Math.min(100, Math.max(12, Math.round(rawScore)));

  return {
    score,
    baseScore: 100,
    unreadPenalty: Math.round(unreadPenalty * 10) / 10,
    spamPenalty: Math.round(spamPenalty * 10) / 10,
    promoPenalty: Math.round(promoPenalty * 10) / 10,
    bloatPenalty: Math.round(bloatPenalty * 10) / 10,
    largeFilesPenalty: Math.round(largeFilesPenalty * 10) / 10,
    oldMailPenalty: Math.round(oldMailPenalty * 10) / 10,
    totalDeductions: Math.round(totalDeductions * 10) / 10,
    managementBonus: Math.round(managementBonus * 10) / 10,
    unsubBonus: Math.round(unsubBonus * 10) / 10,
    filterBonus: Math.round(filterBonus * 10) / 10,
    totalBonus: Math.round(managementBonus * 10) / 10,
  };
}

/**
 * Multi-Factor Adaptive Inbox Health Index
 * Uses logarithmic dampening to provide balanced, non-linear health ratings
 * from 12% to 100%.
 */
export function computeInboxHealthScore(metrics: HealthScoreMetrics): number {
  return computeInboxHealthBreakdown(metrics).score;
}

/**
 * Single source of truth for the user-management bonus inputs (unsubscribes & filter
 * rules created in-app). Reads the same localStorage keys the features actually write
 * to, so every Health Score surface (top bar widget, Inbox Health Score modal, etc.)
 * computes an identical bonus from identical data.
 */
export function getUserManagementCounts(): { unsubscribedCount: number; activeFiltersCount: number } {
  let unsubscribedCount = 0;
  let activeFiltersCount = 0;
  try {
    const storedUnsubs = localStorage.getItem('ais_unsub_log') || localStorage.getItem('unsubscribed_senders_v1');
    if (storedUnsubs) {
      const parsed = JSON.parse(storedUnsubs);
      if (Array.isArray(parsed)) unsubscribedCount = parsed.length;
    }
  } catch { }
  try {
    const storedRules = localStorage.getItem('inbox_created_rules_log_v1') || localStorage.getItem('ais_saved_rules_history');
    if (storedRules) {
      const parsed = JSON.parse(storedRules);
      if (Array.isArray(parsed)) activeFiltersCount = parsed.length;
    }
  } catch { }
  return { unsubscribedCount, activeFiltersCount };
}

/**
 * Canonical Gmail search queries backing each Health Score metric. Every surface that
 * computes the score must use these exact queries, or the same inbox will produce
 * different counts (and therefore different scores) in different places.
 */
export const HEALTH_SCORE_QUERIES = {
  unread: "is:unread in:inbox -in:chats",
  spamAndTrash: "in:spam OR in:trash",
  oldPromotions: "category:promotions older_than:6m -in:trash",
  largeFiles: "larger:5M -in:trash",
  oldMail: "older_than:1y -in:trash -in:spam",
} as const;

// -------------------------------------------------------------
// RFC 2369 / RFC 8058 List-Unsubscribe Header Parser
// -------------------------------------------------------------

export interface ParsedUnsubscribeHeader {
  httpUrl?: string;
  mailtoUri?: string;
  mailtoAddress?: string;
  mailtoSubject?: string;
  isOneClickPost: boolean;
}

/**
 * Robust List-Unsubscribe parser supporting angled brackets,
 * multiple URIs, and RFC 8058 one-click headers.
 */
export function parseListUnsubscribe(rawHeader: string = '', rawPostHeader: string = ''): ParsedUnsubscribeHeader {
  if (!rawHeader) return { isOneClickPost: false };

  // Match all <uri> patterns
  const uriMatches = rawHeader.match(/<([^>]+)>/g) || [];
  const uris = uriMatches.length > 0 
    ? uriMatches.map(m => m.slice(1, -1).trim()) 
    : rawHeader.split(',').map(s => s.trim().replace(/^<|>$/g, ''));

  let httpUrl: string | undefined;
  let mailtoUri: string | undefined;
  let mailtoAddress: string | undefined;
  let mailtoSubject: string | undefined;

  for (const uri of uris) {
    if (uri.startsWith('http://') || uri.startsWith('https://')) {
      if (!httpUrl) httpUrl = uri;
    } else if (uri.startsWith('mailto:')) {
      if (!mailtoUri) {
        mailtoUri = uri;
        try {
          const mailtoContent = uri.substring(7);
          const [addr, queryString] = mailtoContent.split('?');
          mailtoAddress = decodeURIComponent(addr);
          if (queryString) {
            const params = new URLSearchParams(queryString);
            mailtoSubject = params.get('subject') || undefined;
          }
        } catch {
          // Fallback simple mailto
          mailtoAddress = uri.substring(7);
        }
      }
    }
  }

  const isOneClickPost = (rawPostHeader || '').toLowerCase().includes('list-unsubscribe=one-click');

  return {
    httpUrl,
    mailtoUri,
    mailtoAddress,
    mailtoSubject,
    isOneClickPost
  };
}

// -------------------------------------------------------------
// Safe Gmail Search Query Normalizer
// -------------------------------------------------------------

/**
 * Validates and formats Gmail queries with proper quoting and operators
 */
export function sanitizeGmailSearchQuery(rawQuery: string): string {
  if (!rawQuery) return '';
  let clean = rawQuery.trim();

  // Fix unquoted label queries with spaces: label:My Folder -> label:"My Folder"
  clean = clean.replace(/label:([^\s"]+[\s]+[^\s"]+)/g, 'label:"$1"');

  // Strip trailing illegal Boolean operators (e.g. "from:foo.com OR")
  clean = clean.replace(/\s+(OR|AND)\s*$/i, '');

  return clean;
}
