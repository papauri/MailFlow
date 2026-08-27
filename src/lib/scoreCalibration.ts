import { countEmails, fetchMailboxSize } from './gmail';
import {
  HEALTH_SCORE_QUERIES,
  FULL_PENALTY_SHARE,
  computeInboxHealthBreakdown,
  getUserManagementCounts,
  HealthScoreMetrics,
} from './emailUtils';

/**
 * Measures this mailbox so the score's thresholds can be set from evidence.
 *
 * The five `FULL_PENALTY_SHARE` values decide how much clutter earns a full
 * penalty. They were chosen by judgement, not measurement — a reasonable starting
 * point, but nothing in the codebase justified them, and a scoring model tuned
 * against nobody's real mailbox is exactly the kind of invented number this app is
 * not supposed to show people.
 *
 * This reports what the mailbox actually contains, what share of it each kind of
 * clutter occupies, and what the current thresholds make of that. Comparing the
 * "actual" column against the "threshold" column is what tells you whether a
 * threshold is set anywhere near reality.
 *
 * Costs one counting pass per metric plus two units for the size, which is the same
 * work the Inbox Score page already does on open.
 */

export interface MetricMeasurement {
  id: keyof typeof FULL_PENALTY_SHARE;
  label: string;
  /** Real number of messages matching this metric's canonical query. */
  count: number;
  /** The denominator this metric is judged against, and which one it is. */
  denominator: number;
  denominatorName: 'mailbox' | 'inbox';
  /** count / denominator. The figure the threshold is compared against. */
  actualShare: number;
  /** The configured full-penalty share for this metric. */
  thresholdShare: number;
  /** Points currently deducted, and the most this metric can deduct. */
  penalty: number;
  maxPenalty: number;
}

export interface CalibrationReport {
  measuredAt: string;
  mailboxTotal: number;
  inboxTotal: number;
  metrics: MetricMeasurement[];
  score: number;
  totalDeductions: number;
  managementBonus: number;
}

const MAX_PENALTY = {
  unread: 35,
  spamAndTrash: 25,
  oldPromotions: 20,
  largeFiles: 6,
  oldMail: 4,
} as const;

export async function measureMailbox(): Promise<CalibrationReport> {
  const [size, unread, spamAndTrash, oldPromotions, largeFiles, oldMail] = await Promise.all([
    fetchMailboxSize(),
    countEmails(HEALTH_SCORE_QUERIES.unread),
    countEmails(HEALTH_SCORE_QUERIES.spamAndTrash),
    countEmails(HEALTH_SCORE_QUERIES.oldPromotions),
    countEmails(HEALTH_SCORE_QUERIES.largeFiles),
    countEmails(HEALTH_SCORE_QUERIES.oldMail),
  ]);

  const { unsubscribedCount, activeFiltersCount } = getUserManagementCounts();
  const metricsInput: HealthScoreMetrics = {
    unreadInbox: unread,
    spamAndTrash,
    oldPromotions,
    largeFiles,
    oldMail,
    unsubscribedCount,
    activeFiltersCount,
    mailboxTotal: size.mailboxTotal,
    inboxTotal: size.inboxTotal,
  };
  const breakdown = computeInboxHealthBreakdown(metricsInput);

  // Unread is judged against the inbox; everything else against the whole mailbox.
  const inboxDenominator = size.inboxTotal || size.mailboxTotal;

  const share = (count: number, denominator: number) =>
    denominator > 0 ? count / denominator : 0;

  const metrics: MetricMeasurement[] = [
    {
      id: 'unread', label: 'Unread in inbox',
      count: unread, denominator: inboxDenominator, denominatorName: 'inbox',
      actualShare: share(unread, inboxDenominator),
      thresholdShare: FULL_PENALTY_SHARE.unread,
      penalty: breakdown.unreadPenalty, maxPenalty: MAX_PENALTY.unread,
    },
    {
      id: 'spamAndTrash', label: 'Spam & trash',
      count: spamAndTrash, denominator: size.mailboxTotal, denominatorName: 'mailbox',
      actualShare: share(spamAndTrash, size.mailboxTotal),
      thresholdShare: FULL_PENALTY_SHARE.spamAndTrash,
      penalty: breakdown.spamPenalty, maxPenalty: MAX_PENALTY.spamAndTrash,
    },
    {
      id: 'oldPromotions', label: 'Stale promotions (>6m)',
      count: oldPromotions, denominator: size.mailboxTotal, denominatorName: 'mailbox',
      actualShare: share(oldPromotions, size.mailboxTotal),
      thresholdShare: FULL_PENALTY_SHARE.oldPromotions,
      penalty: breakdown.promoPenalty, maxPenalty: MAX_PENALTY.oldPromotions,
    },
    {
      id: 'largeFiles', label: 'Large files (>5MB)',
      count: largeFiles, denominator: size.mailboxTotal, denominatorName: 'mailbox',
      actualShare: share(largeFiles, size.mailboxTotal),
      thresholdShare: FULL_PENALTY_SHARE.largeFiles,
      penalty: breakdown.largeFilesPenalty, maxPenalty: MAX_PENALTY.largeFiles,
    },
    {
      id: 'oldMail', label: 'Old mail (>1y)',
      count: oldMail, denominator: size.mailboxTotal, denominatorName: 'mailbox',
      actualShare: share(oldMail, size.mailboxTotal),
      thresholdShare: FULL_PENALTY_SHARE.oldMail,
      penalty: breakdown.oldMailPenalty, maxPenalty: MAX_PENALTY.oldMail,
    },
  ];

  return {
    measuredAt: new Date().toISOString(),
    mailboxTotal: size.mailboxTotal,
    inboxTotal: size.inboxTotal,
    metrics,
    score: breakdown.score,
    totalDeductions: breakdown.totalDeductions,
    managementBonus: breakdown.managementBonus,
  };
}

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const num = (n: number) => n.toLocaleString();

/**
 * Plain-text report, formatted to be pasted somewhere and read.
 *
 * Deliberately shows the threshold beside the measured share for each metric, and
 * flags the two states that mean a threshold is set wrong: a metric already past
 * its full-penalty point has no room left to reward cleanup, and one far below it
 * is being ignored no matter how much of it there is.
 */
export function formatCalibrationReport(r: CalibrationReport): string {
  const lines: string[] = [];
  lines.push('INBOX HEALTH — MEASURED CALIBRATION');
  lines.push(`Measured ${r.measuredAt}`);
  lines.push('');
  lines.push(`Mailbox total   ${num(r.mailboxTotal)} messages`);
  lines.push(`Inbox total     ${num(r.inboxTotal)} messages`);
  lines.push('');
  lines.push('METRIC                    COUNT        ACTUAL   THRESHOLD   PENALTY   VERDICT');

  for (const m of r.metrics) {
    const ratio = m.thresholdShare > 0 ? m.actualShare / m.thresholdShare : 0;
    const verdict =
      ratio >= 1 ? 'AT/OVER CAP — no room to improve'
        : ratio >= 0.5 ? 'in range'
          : ratio >= 0.1 ? 'low — threshold may be too lenient'
            : 'barely registers — threshold likely too high';
    lines.push(
      `${m.label.padEnd(24)} ${num(m.count).padStart(8)} ${pct(m.actualShare).padStart(12)} ` +
      `${pct(m.thresholdShare).padStart(11)} ${`${m.penalty}/${m.maxPenalty}`.padStart(9)}   ${verdict}`
    );
  }

  lines.push('');
  lines.push(`Total deductions  -${r.totalDeductions}`);
  lines.push(`Management bonus  +${r.managementBonus}`);
  lines.push(`SCORE             ${r.score} / 100`);
  lines.push('');
  lines.push('ACTUAL is what this mailbox contains. THRESHOLD is where the penalty is');
  lines.push('~fully earned. If ACTUAL sits far below THRESHOLD the metric is being');
  lines.push('under-weighted; if it is at or over, the metric has stopped responding.');
  return lines.join('\n');
}
