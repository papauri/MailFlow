import { computeInboxHealthScore, HealthScoreMetrics, getUserManagementCounts } from './emailUtils';
import { InboxStats } from './inboxAnalytics';

/**
 * Turns the raw inbox numbers into a ranked, personal "do this next" list.
 *
 * The old onboarding card gave everyone the same three generic steps regardless of
 * what their inbox actually looked like. These recommendations are derived from the
 * user's real counts and are ranked by what each one is genuinely worth — health
 * points recovered, with storage reclaimed as the tie-breaker — so the top item is
 * always the highest-leverage thing available to that specific person.
 */

export interface Recommendation {
  id: string;
  title: string;
  detail: string;
  /** Health points this action would recover, computed from the real scoring model. */
  pointsGain: number;
  /** Bytes this action would free, when known. */
  bytesReclaimed: number;
  actionLabel: string;
  /** Where the action sends the user. */
  hash: string;
  severity: 'high' | 'medium' | 'low';
}

function metricsFrom(stats: InboxStats): HealthScoreMetrics {
  const { unsubscribedCount, activeFiltersCount } = getUserManagementCounts();
  return {
    unreadInbox: stats.unread || 0,
    spamAndTrash: stats.spamAndTrash || 0,
    oldPromotions: stats.oldPromo || 0,
    largeFiles: stats.large || 0,
    oldMail: stats.oldMail || 0,
    unsubscribedCount,
    activeFiltersCount,
    // Without these the ranking is computed against a different scoring model than
    // the one the Inbox Score page shows, and the "+N pts" on each card is wrong.
    mailboxTotal: stats.mailboxTotal || 0,
    inboxTotal: stats.inboxTotal || 0,
  };
}

/** Points recovered by driving one metric to zero, per the real scoring model. */
function gainFromClearing(base: HealthScoreMetrics, key: keyof HealthScoreMetrics): number {
  const cleared = { ...base, [key]: 0 };
  return Math.max(0, computeInboxHealthScore(cleared) - computeInboxHealthScore(base));
}

export function buildRecommendations(
  stats: InboxStats | null,
  sizes: Record<string, number>,
  topSenders: { email: string; name: string; count: number }[]
): Recommendation[] {
  if (!stats) return [];

  const base = metricsFrom(stats);
  const recs: Recommendation[] = [];

  if ((stats.spamAndTrash || 0) > 0) {
    recs.push({
      id: 'spam',
      title: 'Empty spam & trash',
      detail: `${stats.spamAndTrash.toLocaleString()} messages are sitting in spam and trash, still using your storage quota.`,
      pointsGain: gainFromClearing(base, 'spamAndTrash'),
      bytesReclaimed: sizes.spamAndTrash || 0,
      actionLabel: 'Clear them',
      hash: '#health-score',
      severity: 'high',
    });
  }

  if ((stats.large || 0) > 0) {
    recs.push({
      id: 'large',
      title: 'Remove large attachments',
      detail: `${stats.large.toLocaleString()} messages carry attachments over 5MB — usually the fastest way to reclaim space.`,
      pointsGain: gainFromClearing(base, 'largeFiles'),
      bytesReclaimed: sizes.large || 0,
      actionLabel: 'Review files',
      hash: '#health-score',
      severity: 'high',
    });
  }

  if ((stats.oldPromo || 0) > 0) {
    recs.push({
      id: 'promo',
      title: 'Clear stale promotions',
      detail: `${stats.oldPromo.toLocaleString()} marketing emails are older than six months and almost certainly expired.`,
      pointsGain: gainFromClearing(base, 'oldPromotions'),
      bytesReclaimed: sizes.oldPromo || 0,
      actionLabel: 'Clean up',
      hash: '#health-score',
      severity: 'medium',
    });
  }

  if ((stats.unread || 0) > 20) {
    recs.push({
      id: 'unread',
      title: 'Triage your unread backlog',
      detail: `${stats.unread.toLocaleString()} unread messages in your inbox${stats.importantUnread ? `, ${stats.importantUnread.toLocaleString()} of them marked important` : ''}.`,
      pointsGain: gainFromClearing(base, 'unreadInbox'),
      bytesReclaimed: 0,
      actionLabel: 'Start triage',
      hash: '#smart-triage',
      severity: (stats.unread || 0) > 200 ? 'high' : 'medium',
    });
  }

  if ((stats.oldMail || 0) > 0) {
    recs.push({
      id: 'oldMail',
      // Titled for what the linked action does. The Inbox Score page's "Clean All"
      // for this metric moves the mail to Trash; calling the recommendation
      // "Archive" set the user up to click a button that does something else.
      title: 'Clear mail older than a year',
      detail: `${stats.oldMail.toLocaleString()} messages haven't been touched in over a year.`,
      pointsGain: gainFromClearing(base, 'oldMail'),
      bytesReclaimed: sizes.oldMail || 0,
      actionLabel: 'Review old mail',
      hash: '#health-score',
      severity: 'low',
    });
  }

  // A single sender dominating the inbox is the clearest unsubscribe candidate.
  const dominant = topSenders[0];
  if (dominant && dominant.count >= 25) {
    recs.push({
      id: 'sender',
      title: `Deal with ${dominant.name || dominant.email}`,
      detail: `They've sent you ${dominant.count.toLocaleString()} messages. Unsubscribing or filing them automatically stops the noise at the source.`,
      pointsGain: 0,
      bytesReclaimed: 0,
      actionLabel: 'See senders',
      hash: '#sender-analytics',
      severity: 'medium',
    });
  }

  const { activeFiltersCount } = getUserManagementCounts();
  if (activeFiltersCount === 0) {
    // Derived from the scoring model like every other row, rather than asserted.
    // A hardcoded figure here is a claim about the model that nothing keeps true if
    // the filter bonus is ever retuned.
    const withOneRule = computeInboxHealthScore({ ...base, activeFiltersCount: 1 });
    recs.push({
      id: 'rules',
      title: 'Set up your first automation',
      detail: 'You have no filter rules yet. Rules keep the inbox clean on their own, and each one earns back health points.',
      pointsGain: Math.max(0, withOneRule - computeInboxHealthScore(base)),
      bytesReclaimed: 0,
      actionLabel: 'Suggest rules',
      hash: '#rule-suggester',
      severity: 'medium',
    });
  }

  // Rank by what the action is actually worth to this inbox.
  return recs.sort((a, b) => {
    if (b.pointsGain !== a.pointsGain) return b.pointsGain - a.pointsGain;
    return b.bytesReclaimed - a.bytesReclaimed;
  });
}
