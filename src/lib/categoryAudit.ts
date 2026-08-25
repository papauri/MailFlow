import { extractSenderDetails } from './emailUtils';

/**
 * Category audit: what is unneeded, what must go, what needs attention.
 *
 * The sender model answers "who is filling my inbox". It cannot answer "what is all
 * this?", because the most disposable mail in a category is rarely from one sender —
 * a thousand one-time login codes come from a thousand different services, so every
 * sender cohort looks small and nothing is ever flagged.
 *
 * This clusters by the *shape of the message* instead. Subjects are reduced to a
 * template by replacing the parts that vary — numbers, hex tokens, URLs — with a
 * placeholder. "Your code is 481920" and "Your code is 773301" collapse to the same
 * template, so a thousand of them become one decision instead of a thousand rows.
 *
 * Deliberately no keyword list. Templating is structural, so it works on any
 * language and finds patterns nobody thought to enumerate; a keyword table only ever
 * finds the words someone already guessed. Classification then comes from behaviour
 * — how old, how templated, whether anything was ever starred or replied to.
 */

const DAY_MS = 86400000;

export type ClusterVerdict = 'expired' | 'disposable' | 'review' | 'keep';

export interface TemplateCluster {
  id: string;
  /** Human-facing example, taken from a real message in the cluster. */
  sampleSubject: string;
  template: string;
  volume: number;
  senders: number;
  bytes: number;
  unread: number;
  readRate: number;
  medianAgeDays: number;
  /** True when the varying part is a number — the signature of generated mail. */
  hasVariableToken: boolean;
  protectedCount: number;
  threadedCount: number;
  verdict: ClusterVerdict;
  reason: string;
  confidence: number;
  ids: string[];
  /** Message-level ids, which is what the Gmail batch endpoints operate on. */
  actionIds: string[];
  score: number;
}

export interface AttentionItem {
  id: string;
  sender: string;
  subject: string;
  ageDays: number;
  reason: string;
  urgency: 'high' | 'medium';
}

export interface CategoryAudit {
  clusters: TemplateCluster[];
  attention: AttentionItem[];
  totalAnalysed: number;
  /** Messages in clusters judged expired or disposable. */
  clearableVolume: number;
  clearableBytes: number;
  keepVolume: number;
}

/**
 * Reduces a subject to its template.
 *
 * Unicode-aware character classes so non-Latin subjects normalise rather than being
 * stripped to nothing, which would collapse every foreign-language message into one
 * meaningless bucket.
 */
export function normalizeSubject(subject: string): string {
  return (subject || '')
    .toLowerCase()
    .replace(/^(re|fwd|fw)\s*:\s*/gi, '')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[a-f0-9]{6,}/gi, '#')      // ids, hashes, tracking tokens
    .replace(/\d[\d.,:/-]*/g, '#')       // numbers, dates, amounts
    .replace(/[^\p{L}\p{N}#\s]+/gu, ' ') // punctuation, emoji, symbols
    .replace(/#+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function describeAge(days: number): string {
  if (days >= 365) return `${Math.round(days / 365)} year${days >= 730 ? 's' : ''}`;
  if (days >= 60) return `${Math.round(days / 30)} months`;
  if (days >= 14) return `${Math.round(days / 7)} weeks`;
  return `${days} days`;
}

export interface AuditOptions {
  /** Smallest cluster worth presenting as a single decision. */
  minClusterSize?: number;
  /** Messages newer than this are never proposed for clearing. */
  minAgeDays?: number;
}

export function auditCategory(
  emails: any[],
  now: Date = new Date(),
  options: AuditOptions = {}
): CategoryAudit {
  const { minClusterSize = 5, minAgeDays = 14 } = options;
  const nowMs = now.getTime();

  const buckets = new Map<string, any[]>();
  for (const email of emails) {
    const template = normalizeSubject(email.subject || '');
    // A subject that normalises to almost nothing carries no signal to cluster on.
    if (template.replace(/[#\s]/g, '').length < 3) continue;
    if (!buckets.has(template)) buckets.set(template, []);
    buckets.get(template)!.push(email);
  }

  const clusters: TemplateCluster[] = [];

  buckets.forEach((items, template) => {
    if (items.length < minClusterSize) return;

    const ages = items.map(e => {
      const d = e.date instanceof Date ? e.date : new Date(e.date);
      const t = d.getTime();
      return isNaN(t) ? 0 : Math.max(0, Math.floor((nowMs - t) / DAY_MS));
    });

    const senders = new Set(items.map(e => extractSenderDetails(e.sender || '').emailAddr));
    const unread = items.filter(e => (e.labelIds || []).includes('UNREAD')).length;
    const protectedCount = items.filter(e => {
      const l = e.labelIds || [];
      return l.includes('STARRED') || l.includes('IMPORTANT');
    }).length;
    const threadedCount = items.filter(e => (e.messageIds?.length || 1) > 1).length;
    const bytes = items.reduce((sum, e) => sum + (e.sizeEstimate || 0), 0);
    const medianAgeDays = median(ages);
    const readRate = items.length > 0 ? (items.length - unread) / items.length : 0;
    const hasVariableToken = template.includes('#');

    let verdict: ClusterVerdict;
    let reason: string;
    let confidence: number;

    if (protectedCount > 0 || threadedCount / items.length > 0.2) {
      // Anything starred, flagged, or actually replied to is off the table.
      verdict = 'keep';
      reason = `You have starred, flagged or replied to messages in this group — it is being kept.`;
      confidence = 0.9;
    } else if (hasVariableToken && medianAgeDays >= 30 && senders.size >= 1) {
      // Generated mail whose varying part is a number: codes, receipts, alerts.
      // Once it is a month old that number refers to something long finished.
      verdict = 'expired';
      reason = `${items.length.toLocaleString()} auto-generated messages sharing one template, median age ${describeAge(medianAgeDays)}. The part that changes is just a number, so these carry nothing you can still use.`;
      confidence = Math.min(0.95, 0.6 + Math.min(0.25, items.length / 400) + Math.min(0.1, medianAgeDays / 3650));
    } else if (medianAgeDays >= minAgeDays && readRate < 0.5 && items.length >= minClusterSize * 2) {
      verdict = 'disposable';
      reason = `${items.length.toLocaleString()} near-identical messages, ${Math.round((1 - readRate) * 100)}% never opened, median age ${describeAge(medianAgeDays)}.`;
      confidence = Math.min(0.9, 0.5 + Math.min(0.3, items.length / 300));
    } else if (medianAgeDays < minAgeDays) {
      verdict = 'review';
      reason = `${items.length.toLocaleString()} similar messages, but recent — worth a look before clearing.`;
      confidence = 0.5;
    } else {
      verdict = 'review';
      reason = `${items.length.toLocaleString()} similar messages you mostly read. Check before clearing.`;
      confidence = 0.45;
    }

    const sample = items.find(e => e.subject)?.subject || template;

    clusters.push({
      id: `tpl:${template.slice(0, 60)}`,
      sampleSubject: sample,
      template,
      volume: items.length,
      senders: senders.size,
      bytes,
      unread,
      readRate,
      medianAgeDays,
      hasVariableToken,
      protectedCount,
      threadedCount,
      verdict,
      reason,
      confidence,
      ids: items.map(e => e.id).filter(Boolean),
      actionIds: items.flatMap(e => (e.messageIds?.length ? e.messageIds : [e.id])).filter(Boolean),
      // Clearable clusters lead; among those, the biggest decision first.
      score: (verdict === 'expired' ? 3 : verdict === 'disposable' ? 2 : verdict === 'review' ? 1 : 0)
        * Math.log10(1 + items.length) * confidence,
    });
  });

  clusters.sort((a, b) => b.score - a.score);

  // --- What needs attention -------------------------------------------------
  // Behavioural, not phrase matching: unread, recent, from someone whose mail this
  // user actually opens, and not bulk. That finds a real message awaiting a reply
  // without needing to guess at the words "action required".
  const senderStats = new Map<string, { total: number; read: number }>();
  for (const email of emails) {
    const key = extractSenderDetails(email.sender || '').emailAddr;
    const entry = senderStats.get(key) || { total: 0, read: 0 };
    entry.total += 1;
    if (!(email.labelIds || []).includes('UNREAD')) entry.read += 1;
    senderStats.set(key, entry);
  }

  const attention: AttentionItem[] = [];
  for (const email of emails) {
    const labels: string[] = email.labelIds || [];
    if (!labels.includes('UNREAD')) continue;

    const d = email.date instanceof Date ? email.date : new Date(email.date);
    const ageDays = Math.max(0, Math.floor((nowMs - d.getTime()) / DAY_MS));
    if (isNaN(ageDays) || ageDays > 30) continue;

    const key = extractSenderDetails(email.sender || '').emailAddr;
    const stats = senderStats.get(key);
    const engagement = stats && stats.total > 0 ? stats.read / stats.total : 0;
    const isBulk = !!email.listUnsubscribe;
    const isFlagged = labels.includes('IMPORTANT') || labels.includes('STARRED');
    const isThreaded = (email.messageIds?.length || 1) > 1;

    let reason = '';
    let urgency: 'high' | 'medium' = 'medium';

    if (isFlagged) {
      reason = 'Flagged as important and still unread.';
      urgency = 'high';
    } else if (isThreaded && !isBulk) {
      reason = 'Part of a conversation you are in, still unread.';
      urgency = 'high';
    } else if (!isBulk && engagement >= 0.6 && (stats?.total || 0) >= 2) {
      reason = `You normally read mail from this sender — this one is still unopened.`;
      urgency = 'medium';
    } else {
      continue;
    }

    attention.push({
      id: email.id,
      sender: email.sender,
      subject: email.subject || '(No Subject)',
      ageDays,
      reason,
      urgency,
    });
  }

  attention.sort((a, b) =>
    (a.urgency === b.urgency ? a.ageDays - b.ageDays : a.urgency === 'high' ? -1 : 1)
  );

  const clearable = clusters.filter(c => c.verdict === 'expired' || c.verdict === 'disposable');

  return {
    clusters,
    attention: attention.slice(0, 12),
    totalAnalysed: emails.length,
    clearableVolume: clearable.reduce((s, c) => s + c.volume, 0),
    clearableBytes: clearable.reduce((s, c) => s + c.bytes, 0),
    keepVolume: clusters.filter(c => c.verdict === 'keep').reduce((s, c) => s + c.volume, 0),
  };
}
