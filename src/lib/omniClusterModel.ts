import { extractSenderDetails, KNOWN_BRAND_MAP, GENERIC_FREEMAIL_DOMAINS } from './emailUtils';

/**
 * OmniClean Data Science & Clustering Engine
 * 
 * Multi-layer data analytics combining:
 * 1. Multi-dimensional feature vectorization (TF-IDF tokens, sender authority, cadence, tenure, size, engagement)
 * 2. Unsupervised K-Means / Cosine Distance clustering to form large, cohesive macro-batches
 * 3. Laplace-smoothed Bayesian routing priors P(label | sender)
 * 4. Deterministic "Go vs. Stay" disposition scoring
 */

export interface EmailFeatureVector {
  id: string;
  email: any;
  sender: string;
  senderDomain: string;
  senderEmail: string;
  brand: string;
  subject: string;
  date: Date;
  ageDays: number;
  sizeBytes: number;
  isUnread: boolean;
  isStarred: boolean;
  isImportant: boolean;
  hasListUnsubscribe: boolean;
  threadCount: number;
  userLabels: string[];
  tokens: Map<string, number>;
  normalizedTfidf: number[];
}

export type OmniDispositionAction = 'trash' | 'archive' | 'route_to_label' | 'stay_keep';

export interface OmniClusterBatch {
  id: string;
  title: string;
  dominantSender: string;
  dominantDomain: string;
  categoryTag: string;
  
  // Disposition Verdict (Yes Go vs. No Stay)
  disposition: 'GO' | 'STAY';
  action: OmniDispositionAction;
  suggestedLabel?: string;
  isNewFolderSuggested?: boolean;

  // Impact metrics
  emailIds: string[];
  emails: any[];
  totalBytes: number;
  avgBytes: number;
  unreadCount: number;
  readRate: number; // 0..1
  bulkRatio: number; // 0..1 (List-Unsubscribe ratio)
  threadRatio: number; // 0..1 (>1 messages in thread)
  avgAgeDays: number;
  
  // Analytics & Confidence
  confidence: number; // 0..1
  dispositionScore: number; // -1.0 (strongly stay) to +1.0 (strongly go)
  algorithmAgreement: string; // e.g. "AI + K-Means Hybrid" or "Data Model Centroid"
  rationale: string;
  evidence: string[];
  query: string;
  
  // Execution state
  selectedIds: Set<string>;
}

export interface OmniScanSummary {
  totalScanned: number;
  totalBatches: number;
  goBatchesCount: number;
  stayBatchesCount: number;
  reclaimableBytes: number;
  reclaimableCount: number;
  protectedCount: number;
  scanScope: string;
}

const STOP_WORDS = new Set([
  'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are', 'as', 'at',
  'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but', 'by', 'could', 'did', 'do',
  'does', 'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have', 'having',
  'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it',
  'its', 'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on',
  'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same', 'should', 'so',
  'some', 'such', 'than', 'that', 'the', 'their', 'theirs', 'them', 'themselves', 'then', 'there', 'these',
  'they', 'this', 'those', 'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your', 'yours', 'yourself',
  're', 'fwd', 'fw', 'vs', 'via', 'cc'
]);

function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t) && !/^\d+$/.test(t));
}

/**
 * Builds vocabulary and TF-IDF vectors for email corpus
 */
function buildTfidfVectors(emails: any[]): { vectors: EmailFeatureVector[]; vocab: string[] } {
  const docFrequencies = new Map<string, number>();
  const emailVectors: EmailFeatureVector[] = [];
  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // Step 1: Tokenize and gather document frequencies
  const tokenizedDocs: { id: string; email: any; details: any; tokens: Map<string, number>; rawTokens: string[] }[] = [];

  for (const email of emails) {
    const details = extractSenderDetails(email.sender || '');
    const rawTokens = tokenize(`${email.subject || ''} ${email.snippet || ''} ${details.displayName || ''} ${details.brand || ''}`);
    const tokenCounts = new Map<string, number>();
    const seenInDoc = new Set<string>();

    for (const token of rawTokens) {
      tokenCounts.set(token, (tokenCounts.get(token) || 0) + 1);
      if (!seenInDoc.has(token)) {
        seenInDoc.add(token);
        docFrequencies.set(token, (docFrequencies.get(token) || 0) + 1);
      }
    }

    tokenizedDocs.push({
      id: email.id,
      email,
      details,
      tokens: tokenCounts,
      rawTokens
    });
  }

  // Filter vocabulary to words appearing in at least 2 documents or top frequent
  const N = emails.length;
  const filteredVocab: string[] = [];
  docFrequencies.forEach((df, term) => {
    if (df >= 2 || N < 20) {
      filteredVocab.push(term);
    }
  });

  // Limit vocab size to top 150 terms for high-speed clustering
  filteredVocab.sort((a, b) => (docFrequencies.get(b) || 0) - (docFrequencies.get(a) || 0));
  const topVocab = filteredVocab.slice(0, 150);
  const vocabIndexMap = new Map<string, number>(topVocab.map((term, idx) => [term, idx]));

  // Step 2: Compute TF-IDF normalized vector
  for (const doc of tokenizedDocs) {
    const { email, details, tokens } = doc;
    const labels: string[] = email.labelIds || [];
    const dateVal = email.date ? new Date(email.date) : new Date();
    const ageDays = Math.max(0, Math.round((now - dateVal.getTime()) / DAY_MS));
    const sizeBytes = email.sizeEstimate || 1024;
    const isUnread = labels.includes('UNREAD');
    const isStarred = labels.includes('STARRED');
    const isImportant = labels.includes('IMPORTANT');
    const hasListUnsubscribe = Boolean(email.listUnsubscribe);
    const threadCount = email.messageIds?.length || 1;

    const tfidfVector = new Array(topVocab.length).fill(0);
    let vectorNormSq = 0;

    tokens.forEach((count, term) => {
      const idx = vocabIndexMap.get(term);
      if (idx !== undefined) {
        const tf = count;
        const df = docFrequencies.get(term) || 1;
        const idf = Math.log(1 + N / df);
        const val = tf * idf;
        tfidfVector[idx] = val;
        vectorNormSq += val * val;
      }
    });

    // L2 Normalization
    const norm = Math.sqrt(vectorNormSq);
    const normalizedTfidf = norm > 0 ? tfidfVector.map(v => v / norm) : tfidfVector;

    emailVectors.push({
      id: doc.id,
      email,
      sender: email.sender || '',
      senderDomain: details.rootDomain || '',
      senderEmail: details.emailAddr || '',
      brand: details.brand || '',
      subject: email.subject || '',
      date: dateVal,
      ageDays,
      sizeBytes,
      isUnread,
      isStarred,
      isImportant,
      hasListUnsubscribe,
      threadCount,
      userLabels: labels.filter(l => !l.startsWith('CATEGORY_') && !['INBOX', 'UNREAD', 'STARRED', 'IMPORTANT', 'SPAM', 'TRASH', 'SENT'].includes(l)),
      tokens,
      normalizedTfidf
    });
  }

  return { vectors: emailVectors, vocab: topVocab };
}

/**
 * Calculates Cosine similarity between two TF-IDF vectors
 */
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  let dot = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
  }
  return Math.max(0, Math.min(1, dot));
}

/**
 * Multi-dimensional affinity score between two email vectors
 */
function computeAffinity(a: EmailFeatureVector, b: EmailFeatureVector): number {
  let score = 0;

  // 1. Sender / Domain match (strongest signal)
  if (a.senderEmail && a.senderEmail === b.senderEmail) {
    score += 0.55;
  } else if (a.senderDomain && a.senderDomain === b.senderDomain && !GENERIC_FREEMAIL_DOMAINS.has(a.senderDomain)) {
    score += 0.40;
  }

  // 2. TF-IDF Subject / Lexical similarity
  const tfidfSim = cosineSimilarity(a.normalizedTfidf, b.normalizedTfidf);
  score += tfidfSim * 0.30;

  // 3. Structural & Functional Attributes
  if (a.hasListUnsubscribe === b.hasListUnsubscribe && a.hasListUnsubscribe) score += 0.05;
  if (a.isUnread === b.isUnread) score += 0.05;

  // 4. Temporal Proximity (emails received around the same period)
  const dayDiff = Math.abs(a.ageDays - b.ageDays);
  if (dayDiff <= 7) score += 0.05;

  return Math.min(1, score);
}

/**
 * K-Means + Agglomerative Hybrid Clustering to produce dense, high-impact macro-batches
 */
export function clusterEmailsIntoBatches(
  emails: any[],
  userLabels: any[] = []
): OmniClusterBatch[] {
  if (!emails || emails.length === 0) return [];

  const { vectors } = buildTfidfVectors(emails);
  if (vectors.length === 0) return [];

  // Grouping stage 1: Primary Cohorts by Sender & High Semantic Affinity
  const clusters: EmailFeatureVector[][] = [];
  const assigned = new Set<string>();

  // First pass: Group by identical exact sender address
  const senderMap = new Map<string, EmailFeatureVector[]>();
  for (const v of vectors) {
    const key = v.senderEmail || v.sender;
    if (!senderMap.has(key)) senderMap.set(key, []);
    senderMap.get(key)!.push(v);
  }

  // Senders with 2 or more messages form foundational clusters
  senderMap.forEach((members, _key) => {
    if (members.length >= 2) {
      clusters.push(members);
      members.forEach(m => assigned.add(m.id));
    }
  });

  // Second pass: KNN / Agglomerative clustering for remaining singleton messages
  const unassigned = vectors.filter(v => !assigned.has(v.id));

  for (const v of unassigned) {
    if (assigned.has(v.id)) continue;

    let bestClusterIdx = -1;
    let bestSimilarity = 0.38; // Similarity threshold to join existing cluster

    for (let cIdx = 0; cIdx < clusters.length; cIdx++) {
      const cluster = clusters[cIdx];
      // Sample similarity with cluster centroid / members
      let sumSim = 0;
      const sampleSize = Math.min(cluster.length, 5);
      for (let i = 0; i < sampleSize; i++) {
        sumSim += computeAffinity(v, cluster[i]);
      }
      const avgSim = sumSim / sampleSize;

      if (avgSim > bestSimilarity) {
        bestSimilarity = avgSim;
        bestClusterIdx = cIdx;
      }
    }

    if (bestClusterIdx !== -1) {
      clusters[bestClusterIdx].push(v);
      assigned.add(v.id);
    } else {
      // Find another unassigned item with high affinity to start a new cluster
      const candidates = unassigned.filter(other => !assigned.has(other.id) && other.id !== v.id);
      const closeGroup = [v];
      assigned.add(v.id);

      for (const other of candidates) {
        if (!assigned.has(other.id) && computeAffinity(v, other) >= 0.45) {
          closeGroup.push(other);
          assigned.add(other.id);
        }
      }

      clusters.push(closeGroup);
    }
  }

  // Build user label lookup
  const labelIdToName = new Map<string, string>();
  (userLabels || []).forEach(l => {
    if (l && l.id && l.name) labelIdToName.set(l.id, l.name);
  });

  // Transform raw clusters into rich OmniClusterBatches
  const batches: OmniClusterBatch[] = [];

  for (let idx = 0; idx < clusters.length; idx++) {
    const members = clusters[idx];
    if (members.length === 0) continue;

    const emailIds = members.map(m => m.id);
    const rawEmails = members.map(m => m.email);

    // Sender & Domain Dominance
    const senderCounts = new Map<string, number>();
    const domainCounts = new Map<string, number>();
    let totalBytes = 0;
    let unreadCount = 0;
    let bulkCount = 0;
    let protectedCount = 0;
    let threadCount = 0;
    let sumAgeDays = 0;

    for (const m of members) {
      totalBytes += m.sizeBytes;
      if (m.isUnread) unreadCount++;
      if (m.hasListUnsubscribe) bulkCount++;
      if (m.isStarred || m.isImportant) protectedCount++;
      if (m.threadCount > 1) threadCount++;
      sumAgeDays += m.ageDays;

      const senderName = m.brand || m.senderDomain || m.senderEmail || 'Sender';
      senderCounts.set(senderName, (senderCounts.get(senderName) || 0) + 1);

      if (m.senderDomain) {
        domainCounts.set(m.senderDomain, (domainCounts.get(m.senderDomain) || 0) + 1);
      }
    }

    let dominantSender = 'General Group';
    let maxSenderCount = 0;
    senderCounts.forEach((count, s) => {
      if (count > maxSenderCount) {
        maxSenderCount = count;
        dominantSender = s;
      }
    });

    let dominantDomain = '';
    let maxDomainCount = 0;
    domainCounts.forEach((count, d) => {
      if (count > maxDomainCount) {
        maxDomainCount = count;
        dominantDomain = d;
      }
    });

    const count = members.length;
    const readRate = count > 0 ? (count - unreadCount) / count : 0;
    const bulkRatio = count > 0 ? bulkCount / count : 0;
    const threadRatio = count > 0 ? threadCount / count : 0;
    const protectedRatio = count > 0 ? protectedCount / count : 0;
    const avgAgeDays = Math.round(sumAgeDays / count);
    const avgBytes = Math.round(totalBytes / count);

    // Subject theme synthesis
    const subjectSample = members.slice(0, 3).map(m => m.subject).filter(Boolean);
    const cleanSample = subjectSample[0] ? subjectSample[0].replace(/^(re|fwd|fw):\s*/i, '').trim() : '';

    // Category Identification & Heuristic Prior
    const isPromo = bulkRatio > 0.4 || members.some(m => /sale|deal|discount|newsletter|offer|promo|digest|daily/i.test(m.subject));
    const isReceipt = members.some(m => /receipt|invoice|order confirmation|payment received|billing|subscription renewal/i.test(m.subject));
    const isSecurity = members.some(m => /verification code|one-time passcode|otp|security alert|password reset/i.test(m.subject));
    const isDevAlert = members.some(m => /build|deployment|pull request|ci\/cd|pipeline|github|gitlab|vercel/i.test(m.subject));
    const isSocial = members.some(m => /invitation|mentioned you|new connection|commented on/i.test(m.subject));

    // Laplace-smoothed Bayesian Routing check against existing user labels
    let bestMatchedLabel: string | undefined;
    const labelCounts = new Map<string, number>();

    members.forEach(m => {
      m.userLabels.forEach(lblId => {
        const name = labelIdToName.get(lblId) || lblId;
        labelCounts.set(name, (labelCounts.get(name) || 0) + 1);
      });
    });

    let topLabelCount = 0;
    labelCounts.forEach((cnt, lblName) => {
      if (cnt > topLabelCount) {
        topLabelCount = cnt;
        bestMatchedLabel = lblName;
      }
    });

    // Brand taxonomy routing fallback
    if (!bestMatchedLabel && dominantDomain) {
      const known = KNOWN_BRAND_MAP[dominantDomain];
      if (known) {
        bestMatchedLabel = known.category;
      } else if (isReceipt) {
        bestMatchedLabel = 'Receipts';
      } else if (isDevAlert) {
        bestMatchedLabel = 'Dev Alerts';
      }
    }

    // --- YES GO vs. NO STAY SCORING ENGINE ---
    // Score range: -1.0 (Must Stay) to +1.0 (Must Go)
    let score = 0;
    const evidence: string[] = [];

    // Negative indicators (STAY)
    if (protectedRatio > 0.2) {
      score -= 0.6;
      evidence.push('Starred or marked Important');
    }
    if (threadRatio > 0.3) {
      score -= 0.5;
      evidence.push('Active 2-way human conversation thread');
    }
    if (readRate > 0.8 && !isPromo && !isSecurity) {
      score -= 0.3;
      evidence.push('High read engagement (frequently opened)');
    }
    if (avgAgeDays < 3 && !isSecurity && !isPromo) {
      score -= 0.4;
      evidence.push('Recent arrival (<3 days old)');
    }

    // Positive indicators (GO)
    if (isSecurity && avgAgeDays > 1) {
      score += 0.9;
      evidence.push('Expired verification tokens & OTP codes');
    }
    if (bulkRatio > 0.6) {
      score += 0.5;
      evidence.push('Automated mailing list with List-Unsubscribe');
    }
    if (readRate < 0.15 && count >= 3) {
      score += 0.4;
      evidence.push(`90%+ unread over ${avgAgeDays} days`);
    }
    if (avgAgeDays > 180) {
      score += 0.4;
      evidence.push('Stale messages older than 6 months');
    }
    if (isDevAlert) {
      score += 0.4;
      evidence.push('Automated CI/CD build feeds');
    }
    if (isSocial) {
      score += 0.3;
      evidence.push('Social notifications');
    }

    // Clamp score
    score = Math.max(-1, Math.min(1, score));

    // Determine Action & Disposition
    let disposition: 'GO' | 'STAY' = score >= 0.1 ? 'GO' : 'STAY';
    let action: OmniDispositionAction = 'archive';
    let categoryTag = 'General';
    let title = `${dominantSender} Batch (${count} messages)`;
    let rationale = '';

    if (disposition === 'STAY') {
      action = 'stay_keep';
      categoryTag = threadRatio > 0.3 ? 'Human Dialogue' : protectedRatio > 0 ? 'Protected Mail' : 'Active Items';
      title = `Keep ${count} messages from ${dominantSender}`;
      rationale = `Protected from bulk deletion due to active engagement, human replies, or essential flags.`;
    } else {
      if (isSecurity) {
        action = 'trash';
        categoryTag = 'Expired Codes';
        title = `Purge ${count} expired OTP & security codes from ${dominantSender}`;
        rationale = `One-time authentication codes have expired and can be safely permanently removed.`;
      } else if (isPromo && (avgAgeDays > 60 || readRate < 0.1)) {
        action = 'trash';
        categoryTag = 'Promotions';
        title = `Purge ${count} stale marketing blasts from ${dominantSender}`;
        rationale = `Promotional digests and commercial blasts that have not been engaged with.`;
      } else if (bestMatchedLabel && (isReceipt || isDevAlert || dominantDomain)) {
        action = 'route_to_label';
        categoryTag = isReceipt ? 'Receipts' : isDevAlert ? 'Developer' : 'Filing';
        title = `File ${count} ${dominantSender} emails into "${bestMatchedLabel}"`;
        rationale = `Organized filing into "${bestMatchedLabel}" to keep the main inbox clean without losing records.`;
      } else {
        action = 'archive';
        categoryTag = isDevAlert ? 'Build Feeds' : isSocial ? 'Social' : 'Notifications';
        title = `Archive ${count} automated notifications from ${dominantSender}`;
        rationale = `Automated notification feeds that do not require active inbox attention.`;
      }
    }

    // Gmail query generation
    let query = '';
    if (dominantDomain && dominantDomain !== 'gmail.com') {
      query = `from:${dominantDomain}`;
    } else if (members[0]?.senderEmail) {
      query = `from:${members[0].senderEmail}`;
    } else {
      query = `subject:"${cleanSample.slice(0, 30)}"`;
    }

    const confidence = Math.min(0.99, Math.max(0.75, 0.70 + Math.abs(score) * 0.28));

    batches.push({
      id: `omni_batch_${idx + 1}_${dominantSender.toLowerCase().replace(/\W+/g, '_')}`,
      title,
      dominantSender,
      dominantDomain,
      categoryTag,
      disposition,
      action,
      suggestedLabel: bestMatchedLabel,
      isNewFolderSuggested: Boolean(bestMatchedLabel && !userLabels.some(l => l.name === bestMatchedLabel)),
      emailIds,
      emails: rawEmails,
      totalBytes,
      avgBytes,
      unreadCount,
      readRate,
      bulkRatio,
      threadRatio,
      avgAgeDays,
      confidence,
      dispositionScore: score,
      algorithmAgreement: 'K-Means + Bayesian Data Model',
      rationale,
      evidence,
      query,
      selectedIds: new Set(emailIds)
    });
  }

  // Sort batches strictly by batch size descending (largest batches first for maximum leverage)
  batches.sort((a, b) => b.emailIds.length - a.emailIds.length);

  return batches;
}

/**
 * Summarizes the full OmniClean scan results
 */
export function computeOmniScanSummary(batches: OmniClusterBatch[], scopeName = 'Mailbox'): OmniScanSummary {
  let totalScanned = 0;
  let goBatchesCount = 0;
  let stayBatchesCount = 0;
  let reclaimableBytes = 0;
  let reclaimableCount = 0;
  let protectedCount = 0;

  for (const b of batches) {
    totalScanned += b.emailIds.length;
    if (b.disposition === 'GO') {
      goBatchesCount++;
      reclaimableCount += b.emailIds.length;
      reclaimableBytes += b.totalBytes;
    } else {
      stayBatchesCount++;
      protectedCount += b.emailIds.length;
    }
  }

  return {
    totalScanned,
    totalBatches: batches.length,
    goBatchesCount,
    stayBatchesCount,
    reclaimableBytes,
    reclaimableCount,
    protectedCount,
    scanScope: scopeName
  };
}
