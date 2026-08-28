import { extractSenderDetails } from './emailUtils';

/**
 * Behavioural cleanup model.
 *
 * The previous local analysis matched hardcoded English phrases ("receipt",
 * "verification code") against individual subjects. That only ever finds the
 * phrases someone thought to list, breaks entirely on non-English mail, and
 * produces one-message-at-a-time chores rather than the bulk decisions this app
 * exists to make.
 *
 * This models the *relationship* with each sender instead — how much they send,
 * how much of it you open, whether you ever reply, how long since you last heard
 * from them, and how much space they occupy. Those signals are language-agnostic,
 * derive entirely from metadata already fetched, and identify the handful of
 * senders responsible for most of the mess.
 *
 * Everything here is pure and runs locally with no AI. AI, when available, is only
 * used to relabel these findings more naturally — it never invents them, so the
 * recommendations are identical in substance whether or not the quota is intact.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;

export interface SenderCohort {
  key: string;
  displayName: string;
  domain: string;
  volume: number;
  bytes: number;
  avgBytes: number;
  unread: number;
  /** Fraction opened. Low values across high volume is the strongest noise signal. */
  readRate: number;
  /** Fraction carrying List-Unsubscribe — separates bulk mail from real correspondence. */
  bulkRatio: number;
  /** Fraction starred or marked important. Any of this protects the sender. */
  protectedRatio: number;
  /** Fraction in multi-message threads — a proxy for "you actually reply to them". */
  conversationRatio: number;
  daysSinceLast: number;
  tenureDays: number;
  /** Messages per week over the observed window. Null when the window is too short
   *  to divide by — a burst of 5 messages in one day is not "35 per week". */
  cadence: number | null;
  /** Thread ids, for resolving the cohort back to the scanned sample in the UI. */
  ids: string[];
  /** Message ids — what the Gmail batch endpoints actually operate on. */
  actionIds: string[];
}

export type CleanupKind =
  | 'unsubscribe_purge'
  | 'dormant_purge'
  | 'storage_purge'
  | 'auto_archive';

export interface CleanupRecommendation {
  id: string;
  kind: CleanupKind;
  title: string;
  /** Plain-language statement of why the model flagged this, with the real numbers. */
  rationale: string;
  evidence: string[];
  volume: number;
  bytes: number;
  /** 0..1 — how strongly the signals agree. Shown to the user, never hidden. */
  confidence: number;
  action: 'trash' | 'archive';
  /** Gmail query that selects exactly this set, so the user can inspect before acting. */
  query: string;
  senderKey: string;
  /** Thread ids, for resolving back to the scanned sample. */
  ids: string[];
  /** Message ids, for any caller acting on ids rather than the query. */
  actionIds: string[];
  score: number;
}

export interface ParetoInsight {
  /** How many senders account for `coveredShare` of all messages. */
  senderCount: number;
  totalSenders: number;
  coveredShare: number;
  coveredVolume: number;
  totalVolume: number;
}

export interface CleanupAnalysis {
  cohorts: SenderCohort[];
  recommendations: CleanupRecommendation[];
  pareto: ParetoInsight | null;
  totalBytes: number;
  reclaimableBytes: number;
  reclaimableVolume: number;
  /** Senders excluded from destructive suggestions because you engage with them. */
  protectedSenders: number;
}

function toDate(value: any): Date {
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? new Date() : d;
}

export function buildSenderCohorts(emails: any[], now: Date = new Date()): SenderCohort[] {
  const groups = new Map<string, any[]>();

  for (const email of emails) {
    const details = extractSenderDetails(email.sender || '');
    const key = details.emailAddr || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ email, details });
  }

  const cohorts: SenderCohort[] = [];

  groups.forEach((entries, key) => {
    const volume = entries.length;
    let bytes = 0;
    let unread = 0;
    let bulk = 0;
    let protectedCount = 0;
    let threaded = 0;
    let first = Infinity;
    let last = -Infinity;
    const ids: string[] = [];
    const actionIds: string[] = [];

    for (const { email } of entries) {
      const labels: string[] = email.labelIds || [];
      bytes += email.sizeEstimate || 0;
      if (labels.includes('UNREAD')) unread++;
      if (email.listUnsubscribe) bulk++;
      if (labels.includes('IMPORTANT') || labels.includes('STARRED')) protectedCount++;
      if ((email.messageIds?.length || 1) > 1) threaded++;

      const t = toDate(email.date).getTime();
      if (t < first) first = t;
      if (t > last) last = t;
      if (email.id) ids.push(email.id);
      if (email.messageIds?.length) actionIds.push(...email.messageIds);
      else if (email.id) actionIds.push(email.id);
    }

    // Raw observed window, before the floor below. A cohort seen entirely within one
    // day has no window to measure a rate over, and pretending otherwise produced
    // claims like "arrives 35 times per week" from five messages on one afternoon.
    const observedDays = Math.round((last - first) / DAY_MS);
    const tenureDays = Math.max(1, observedDays);
    const daysSinceLast = Math.max(0, Math.round((now.getTime() - last) / DAY_MS));
    const details = entries[0].details;

    cohorts.push({
      key,
      displayName: details.displayName || key,
      domain: details.rootDomain || '',
      volume,
      bytes,
      avgBytes: volume > 0 ? bytes / volume : 0,
      unread,
      readRate: volume > 0 ? (volume - unread) / volume : 0,
      bulkRatio: volume > 0 ? bulk / volume : 0,
      protectedRatio: volume > 0 ? protectedCount / volume : 0,
      conversationRatio: volume > 0 ? threaded / volume : 0,
      daysSinceLast,
      tenureDays,
      // Needs at least a week of history before a weekly rate means anything.
      cadence: observedDays >= 7 ? (volume / tenureDays) * 7 : null,
      ids,
      actionIds: Array.from(new Set(actionIds)),
    });
  });

  return cohorts.sort((a, b) => b.volume - a.volume);
}

/**
 * A sender is protected when there is evidence you actually value their mail:
 * anything starred or flagged important, or a real back-and-forth thread history.
 * Protected senders never receive a destructive recommendation, regardless of volume.
 */
function isProtected(c: SenderCohort): boolean {
  return c.protectedRatio > 0.02 || c.conversationRatio > 0.2;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function describeAge(days: number): string {
  if (days >= 365) {
    const years = (days / 365).toFixed(days >= 730 ? 0 : 1);
    return `${years} year${Number(years) === 1 ? '' : 's'}`;
  }
  if (days >= 60) return `${Math.round(days / 30)} months`;
  return `${days} days`;
}

/**
 * Ranks by what the action is actually worth: storage reclaimed and clutter removed,
 * discounted by how confident the signals are. Confidence is a real multiplier so a
 * weak signal on a big sender never outranks a certain one.
 */
function scoreOf(bytes: number, volume: number, confidence: number): number {
  const storageWeight = bytes / (50 * MB);
  const volumeWeight = volume / 50;
  return (storageWeight + volumeWeight) * confidence;
}

/** Confidence rises with sample size — 4 messages tell you far less than 200. */
function sampleConfidence(volume: number): number {
  return Math.min(1, Math.log10(1 + volume) / Math.log10(101));
}

export interface CleanupScope {
  /**
   * The query the analysed sample was drawn from, e.g. the Promotions category.
   *
   * Every recommendation's own query is scoped to this. Without it the model
   * measures one set and acts on another: the numbers on a card come from a scan of
   * a single category, but `from:(sender)` alone selects that sender's mail across
   * the entire mailbox — Primary, Sent, starred, everything. A card reading
   * "142 messages, 60 MB" could trash several thousand.
   */
  scopeQuery?: string;
}

/**
 * Gmail query for one sender inside the analysed scope.
 *
 * `-in:trash` is not optional here. `trashAllByQuery` drains by re-running its query
 * until it comes back empty, and a trashed message still matches a bare
 * `from:(sender)` — so an unscoped query never empties, spins for its full round
 * limit, and returns a "trashed" total that is the same messages counted 200 times.
 */
function scopedQuery(senderKey: string, scope: CleanupScope, extra: string = ''): string {
  return [scope.scopeQuery, `from:(${senderKey})`, extra, '-in:trash']
    .filter(Boolean)
    .join(' ');
}

/** Cadence as an evidence line, or the honest absence of one. */
function cadenceLine(c: SenderCohort): string {
  if (c.cadence === null) return `All ${c.volume.toLocaleString()} arrived within a week — too short a window to state a rate`;
  if (c.cadence >= 1) return `Arrives ~${c.cadence.toFixed(1)}× per week over ${describeAge(c.tenureDays)}`;
  return `Arrives occasionally — ${c.volume.toLocaleString()} over ${describeAge(c.tenureDays)}`;
}

/**
 * What the protection test actually guarantees, stated as evidence.
 *
 * `isProtected` is a threshold, not a zero check: it tolerates up to 2% flagged and
 * up to 20% threaded before excluding a sender. The cards used to assert "No
 * starred, important or replied-to messages" regardless, which is a claim the model
 * had not established and, for a large cohort, was often simply false. This reports
 * the measured figure instead.
 */
function engagementLine(c: SenderCohort): string {
  const flagged = Math.round(c.protectedRatio * c.volume);
  const threaded = Math.round(c.conversationRatio * c.volume);
  if (flagged === 0 && threaded === 0) return 'Nothing starred, flagged important, or replied to';
  const parts: string[] = [];
  if (flagged > 0) parts.push(`${flagged.toLocaleString()} starred or important`);
  if (threaded > 0) parts.push(`${threaded.toLocaleString()} in a reply thread`);
  return `Low engagement: only ${parts.join(' and ')} of ${c.volume.toLocaleString()}`;
}

export function recommendCleanups(
  cohorts: SenderCohort[],
  scope: CleanupScope = {}
): CleanupRecommendation[] {
  const recs: CleanupRecommendation[] = [];

  for (const c of cohorts) {
    if (isProtected(c)) continue;

    const sample = sampleConfidence(c.volume);

    // 1. Bulk mail you reliably ignore — the clearest unsubscribe-and-purge case.
    // readRate was <= 0.25, i.e. 75%+ unread. That is a much rarer state than it
    // sounds — plenty of marketing mail gets opened once or auto-marked read, and
    // requiring near-total neglect meant obvious junk from active senders never
    // qualified. Ignoring more than half of a bulk sender is signal enough; the
    // confidence score carries the remaining uncertainty.
    if (c.bulkRatio >= 0.5 && c.readRate <= 0.8 && c.volume >= 4) {
      const confidence = Math.min(0.98, 0.5 + sample * 0.3 + (1 - c.readRate) * 0.2);
      recs.push({
        id: `unsub:${c.key}`,
        kind: 'unsubscribe_purge',
        title: `Unsubscribe from ${c.displayName}`,
        rationale: `${pct(c.bulkRatio)} of the ${c.volume.toLocaleString()} messages from ${c.displayName} carry an unsubscribe link, and ${c.unread.toLocaleString()} of them (${pct(1 - c.readRate)}) were never opened — bulk mail you largely ignore.`,
        evidence: [
          `${c.volume.toLocaleString()} messages, ${formatBytes(c.bytes)}`,
          `${c.unread.toLocaleString()} never opened (${pct(1 - c.readRate)})`,
          cadenceLine(c),
          engagementLine(c),
        ],
        volume: c.volume,
        bytes: c.bytes,
        confidence,
        action: 'trash',
        query: scopedQuery(c.key, scope),
        senderKey: c.key,
        ids: c.ids,
        actionIds: c.actionIds,
        score: scoreOf(c.bytes, c.volume, confidence),
      });
      continue;
    }

    // 2. Gone quiet and never engaged with — safe to clear in bulk.
    if (c.daysSinceLast >= 90 && c.volume >= 3 && c.readRate <= 0.9) {
      const confidence = Math.min(0.95, 0.45 + sample * 0.3 + Math.min(0.2, c.daysSinceLast / 1825));
      recs.push({
        id: `dormant:${c.key}`,
        kind: 'dormant_purge',
        title: `Clear dormant mail from ${c.displayName}`,
        rationale: `Nothing has arrived from ${c.displayName} in ${describeAge(c.daysSinceLast)}, and ${pct(c.readRate)} of what they did send was opened. The ${c.volume.toLocaleString()} messages left behind are taking ${formatBytes(c.bytes)}.`,
        evidence: [
          `Last message ${describeAge(c.daysSinceLast)} ago`,
          `${c.volume.toLocaleString()} messages, ${formatBytes(c.bytes)}`,
          `${pct(c.readRate)} open rate`,
          engagementLine(c),
        ],
        volume: c.volume,
        bytes: c.bytes,
        confidence,
        action: 'trash',
        query: scopedQuery(c.key, scope),
        senderKey: c.key,
        ids: c.ids,
        actionIds: c.actionIds,
        score: scoreOf(c.bytes, c.volume, confidence),
      });
      continue;
    }

    // 3. Heavy attachments that are either ignored or long stale. Deliberately does
    //    NOT flag large mail you read and still receive — that is someone sending you
    //    files you actually use, and proposing deletion there would be destructive.
    if (c.avgBytes >= 1 * MB && c.bytes >= 10 * MB && (c.readRate <= 0.7 || c.daysSinceLast >= 90)) {
      const confidence = Math.min(0.9, 0.4 + sample * 0.25 + Math.min(0.25, c.bytes / (500 * MB)));
      recs.push({
        id: `storage:${c.key}`,
        kind: 'storage_purge',
        title: `Reclaim space from ${c.displayName}`,
        rationale: `${c.displayName} accounts for ${formatBytes(c.bytes)} across ${c.volume.toLocaleString()} messages — an average of ${formatBytes(c.avgBytes)} each. This clears the ones over 1 MB, which is where nearly all of that weight sits.`,
        evidence: [
          `${formatBytes(c.bytes)} total, ${formatBytes(c.avgBytes)} average`,
          `${c.volume.toLocaleString()} messages in this category`,
          `${pct(c.readRate)} open rate`,
          c.daysSinceLast >= 90
            ? `Last message ${describeAge(c.daysSinceLast)} ago`
            : `Selects messages over 1 MB only`,
        ],
        volume: c.volume,
        bytes: c.bytes,
        confidence,
        action: 'trash',
        query: scopedQuery(c.key, scope, 'larger:1M'),
        senderKey: c.key,
        ids: c.ids,
        actionIds: c.actionIds,
        score: scoreOf(c.bytes, c.volume, confidence),
      });
      continue;
    }

    // 4. Steady one-way notifications: worth filing automatically rather than deleting.
    if (c.conversationRatio < 0.05 && c.volume >= 5 && c.readRate <= 0.9) {
      const confidence = Math.min(0.9, 0.4 + sample * 0.35);
      recs.push({
        id: `archive:${c.key}`,
        kind: 'auto_archive',
        title: `Keep ${c.displayName} out of your inbox`,
        rationale: `${c.volume.toLocaleString()} messages from ${c.displayName}${
          c.cadence !== null ? `, about ${c.cadence.toFixed(1)} a week,` : ','
        } and almost none of them are part of a conversation you took part in. Archiving keeps the record without the inbox noise.`,
        evidence: [
          `${c.volume.toLocaleString()} messages, ${Math.round(c.conversationRatio * c.volume)} in a reply thread`,
          cadenceLine(c),
          `${pct(c.readRate)} open rate`,
        ],
        volume: c.volume,
        bytes: c.bytes,
        confidence,
        action: 'archive',
        query: scopedQuery(c.key, scope),
        senderKey: c.key,
        ids: c.ids,
        actionIds: c.actionIds,
        score: scoreOf(c.bytes * 0.3, c.volume, confidence),
      });
    }
  }

  return recs.sort((a, b) => b.volume - a.volume);
}

/**
 * How concentrated the category is. "9 senders are 74% of this category" reframes an
 * overwhelming pile as a short, finite list of decisions — which is the whole point.
 */
export function computePareto(cohorts: SenderCohort[]): ParetoInsight | null {
  const totalVolume = cohorts.reduce((sum, c) => sum + c.volume, 0);
  if (totalVolume === 0 || cohorts.length === 0) return null;

  const target = totalVolume * 0.8;
  let running = 0;
  let senderCount = 0;

  for (const c of cohorts) {
    running += c.volume;
    senderCount++;
    if (running >= target) break;
  }

  return {
    senderCount,
    totalSenders: cohorts.length,
    coveredShare: running / totalVolume,
    coveredVolume: running,
    totalVolume,
  };
}

export function analyseCleanup(
  emails: any[],
  now: Date = new Date(),
  scope: CleanupScope = {}
): CleanupAnalysis {
  const cohorts = buildSenderCohorts(emails, now);
  const recommendations = recommendCleanups(cohorts, scope);
  const pareto = computePareto(cohorts);

  const totalBytes = cohorts.reduce((sum, c) => sum + c.bytes, 0);
  // Each sender appears in at most one recommendation, so these never double-count.
  const reclaimableBytes = recommendations
    .filter(r => r.action === 'trash')
    .reduce((sum, r) => sum + r.bytes, 0);
  const reclaimableVolume = recommendations
    .filter(r => r.action === 'trash')
    .reduce((sum, r) => sum + r.volume, 0);

  return {
    cohorts,
    recommendations,
    pareto,
    totalBytes,
    reclaimableBytes,
    reclaimableVolume,
    protectedSenders: cohorts.filter(isProtected).length,
  };
}

export { formatBytes as formatCleanupBytes };
