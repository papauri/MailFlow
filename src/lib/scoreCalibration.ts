import { countEmails, fetchMailboxComposition } from './gmail';
import {
  HEALTH_SCORE_QUERIES,
  ATTENTION_SHARE_OF_SCORE,
  computeInboxHealthBreakdown,
  getUserManagementCounts,
  HealthScoreMetrics,
} from './emailUtils';

/**
 * Shows the score's working.
 *
 * Nothing in the model is a chosen threshold any more, so there is nothing here to
 * check a guess against. What this does instead is expose the measurements the
 * score is built from — each metric, the population it was divided by, the share
 * that produced, and the weight that population earned — so the number can be
 * audited rather than trusted.
 */

export interface MetricMeasurement {
  label: string;
  /** Real number of messages matching this metric's canonical query. */
  count: number;
  /** The measured population it is judged against, and what that population is. */
  population: number;
  populationLabel: string;
  /** count / population. Bounded [0,1] by construction. */
  share: number;
  /** Points this metric is currently costing. */
  penalty: number;
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

export async function measureMailbox(): Promise<CalibrationReport> {
  const [composition, unread, spamAndTrash, oldPromotions, largeFiles, oldMail] = await Promise.all([
    fetchMailboxComposition(),
    countEmails(HEALTH_SCORE_QUERIES.unread),
    countEmails(HEALTH_SCORE_QUERIES.spamAndTrash),
    countEmails(HEALTH_SCORE_QUERIES.oldPromotions),
    countEmails(HEALTH_SCORE_QUERIES.largeFiles),
    countEmails(HEALTH_SCORE_QUERIES.oldMail),
  ]);

  const { unsubscribedCount, activeFiltersCount } = getUserManagementCounts();
  const input: HealthScoreMetrics = {
    unreadInbox: unread,
    spamAndTrash,
    oldPromotions,
    largeFiles,
    oldMail,
    unsubscribedCount,
    activeFiltersCount,
    ...composition,
  };
  const b = computeInboxHealthBreakdown(input);

  const share = (count: number, population: number) =>
    population > 0 ? Math.min(1, count / population) : 0;

  const metrics: MetricMeasurement[] = [
    {
      label: 'Unread in inbox', count: unread,
      population: composition.inboxTotal, populationLabel: 'inbox',
      share: share(unread, composition.inboxTotal), penalty: b.unreadPenalty,
    },
    {
      label: 'Spam & trash', count: spamAndTrash,
      population: composition.mailboxTotal, populationLabel: 'whole mailbox',
      share: share(spamAndTrash, composition.mailboxTotal), penalty: b.spamPenalty,
    },
    {
      label: 'Stale promotions', count: oldPromotions,
      population: composition.mailboxTotal, populationLabel: 'whole mailbox',
      share: share(oldPromotions, composition.mailboxTotal), penalty: b.promoPenalty,
    },
    {
      label: 'Large files (>5MB)', count: largeFiles,
      population: composition.mailboxTotal, populationLabel: 'whole mailbox',
      share: share(largeFiles, composition.mailboxTotal), penalty: b.largeFilesPenalty,
    },
    {
      label: 'Old mail (>1y)', count: oldMail,
      population: composition.mailboxTotal, populationLabel: 'whole mailbox',
      share: share(oldMail, composition.mailboxTotal), penalty: b.oldMailPenalty,
    },
  ];

  return {
    measuredAt: new Date().toISOString(),
    ...composition,
    metrics,
    score: b.score,
    totalDeductions: b.totalDeductions,
    managementBonus: b.managementBonus,
  };
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const num = (n: number) => n.toLocaleString();

/** Plain-text report, formatted to be pasted somewhere and read. */
export function formatCalibrationReport(r: CalibrationReport): string {
  const L: string[] = [];
  L.push('INBOX HEALTH — MEASURED');
  L.push(`Measured ${r.measuredAt}`);
  L.push('');
  L.push('POPULATIONS READ FROM THIS MAILBOX');
  L.push(`  Whole mailbox   ${num(r.mailboxTotal)}`);
  L.push(`  Inbox           ${num(r.inboxTotal)}`);
  L.push('');
  L.push('METRIC              COUNT   OF POPULATION            SHARE   COSTS');
  for (const m of r.metrics) {
    const of = m.population > 0 ? `${num(m.population)} ${m.populationLabel}` : 'not measured';
    L.push(
      `${m.label.padEnd(19)} ${num(m.count).padStart(6)}   ${of.padEnd(24)} ` +
      `${pct(m.share).padStart(6)}   ${m.penalty.toFixed(1).padStart(5)}`
    );
  }
  L.push('');
  L.push(`Total deductions  -${r.totalDeductions}`);
  L.push(`Management bonus  +${r.managementBonus}`);
  L.push(`SCORE             ${r.score} / 100`);
  L.push('');
  L.push(`Attention (unread) is ${Math.round(ATTENTION_SHARE_OF_SCORE * 100)}% of the score. The other`);
  L.push(`${Math.round((1 - ATTENTION_SHARE_OF_SCORE) * 100)}% is the share of the mailbox that is clearable,`);
  L.push('with every clutter message counting the same. No thresholds, no per-category');
  L.push('weights — SHARE is simply the count divided by its population.');
  return L.join('\n');
}
