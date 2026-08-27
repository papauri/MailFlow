/**
 * Inbox Health — analytics, algorithms and query integrity.
 *
 * Everything Inbox Health shows is derived: a count, a size estimate, a score, a
 * ranked recommendation, a cluster verdict. None of that had a single assertion
 * behind it. The existing suites cover Recharts, pagination and mobile classes;
 * the models that decide what the numbers *mean* were untested, which is how a
 * unit mismatch in the size estimator and a self-contradicting Gmail query both
 * survived in the shipped product.
 *
 * These are all pure functions, so this suite makes no network calls and needs no
 * browser. It asserts the properties that have to hold for the displayed figures to
 * be trustworthy — not the wording, which is free to change.
 */

import {
  computeInboxHealthBreakdown,
  computeInboxHealthScore,
  HEALTH_SCORE_QUERIES,
  HEALTH_SCORE_SWEEP_QUERIES,
  ATTENTION_SHARE_OF_SCORE,
  healthBand,
  HEALTH_BAND_LABEL,
  applyMetricEvent,
  SCORE_METRIC_FIELDS,
  SCORE_BONUS_FIELDS,
  SWEEP_PROTECTION,
  PROTECTED_SWEEPS,
  INBOX_STAT_QUERIES,
  extractRootDomain,
  extractSenderDetails,
  parseListUnsubscribe,
  sanitizeGmailSearchQuery,
} from '../src/lib/emailUtils';
import { INBOX_HEALTH_QUERIES } from '../src/lib/inboxAnalytics';
import { buildSenderCohorts, recommendCleanups, analyseCleanup, computePareto } from '../src/lib/cleanupModel';
import { buildRoutingSuggestions, countDistinctSenders } from '../src/lib/foldingModel';
import { auditCategory, normalizeSubject, templateToQuery } from '../src/lib/categoryAudit';
import { buildRecommendations } from '../src/lib/recommendations';
import { messageToRow, MESSAGE_HEADERS } from '../src/lib/csvExport';
import { SEGMENT_QUERIES } from '../src/components/StorageBreakdownBar';
import * as fs from 'fs';
import { formatEmailDate } from '../src/lib/utils';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string, detail?: string) {
  if (condition) {
    passed++;
    console.log(`  PASS: ${label}`);
  } else {
    failed++;
    console.error(`  FAIL: ${label}${detail ? `\n        ${detail}` : ''}`);
  }
}

function section(name: string) {
  console.log(`\n[${name}]`);
}

const DAY = 86400000;
const MB = 1024 * 1024;
const NOW = new Date('2026-08-27T12:00:00Z');

/** A thread-shaped message, matching what `searchEmails` produces. */
function thread(over: Partial<any> = {}): any {
  return {
    id: over.id || `t${Math.random().toString(36).slice(2)}`,
    threadId: over.id || 't0',
    messageIds: over.messageIds || [`m-${over.id || 't0'}`],
    sender: 'Sender <a@example.com>',
    subject: 'Hello',
    snippet: '',
    date: new Date(NOW.getTime() - 30 * DAY),
    sizeEstimate: 50_000,
    labelIds: [],
    ...over,
  };
}

// ---------------------------------------------------------------------------
section('Gmail query integrity');
// ---------------------------------------------------------------------------
{
  const allQueries: [string, string][] = [
    ...Object.entries(HEALTH_SCORE_QUERIES),
    ...Object.entries(INBOX_STAT_QUERIES),
    ...Object.entries(INBOX_HEALTH_QUERIES),
  ];

  // Gmail binds implicit AND tighter than OR. Any query that mixes an OR with
  // another term and does not group the OR means something other than it reads.
  for (const [name, q] of allQueries) {
    if (!q.includes(' OR ')) continue;
    const grouped = /\(([^()]*\sOR\s[^()]*)\)/.test(q);
    const onlyOr = /^\S+\s+OR\s+\S+$/.test(q.trim());
    assert(grouped || onlyOr, `Query "${name}" groups its OR so the scope applies to both sides`, `got: ${q}`);
  }

  // The five scoring metrics must be one string, not two copies that can drift.
  assert(INBOX_HEALTH_QUERIES.unread === HEALTH_SCORE_QUERIES.unread,
    'Inbox Health unread count uses the canonical scoring query');
  assert(INBOX_HEALTH_QUERIES.oldMail === HEALTH_SCORE_QUERIES.oldMail,
    'Inbox Health old-mail count uses the canonical scoring query');
  assert(INBOX_HEALTH_QUERIES.spamAndTrash === HEALTH_SCORE_QUERIES.spamAndTrash,
    'Inbox Health spam & trash count uses the canonical scoring query');
  assert(INBOX_HEALTH_QUERIES.oldPromo === HEALTH_SCORE_QUERIES.oldPromotions,
    'Inbox Health promotions count uses the canonical scoring query');
  assert(INBOX_HEALTH_QUERIES.large === HEALTH_SCORE_QUERIES.largeFiles,
    'Inbox Health large-file count uses the canonical scoring query');

  assert(HEALTH_SCORE_QUERIES.unread.includes('-in:chats'),
    'Unread excludes chats, which are not inbox mail');
  assert(HEALTH_SCORE_QUERIES.oldMail.includes('-in:spam') && HEALTH_SCORE_QUERIES.oldMail.includes('-in:trash'),
    'Old mail excludes spam and trash, which spam & trash already counts');

  assert(sanitizeGmailSearchQuery('from:foo.com OR ') === 'from:foo.com',
    'Query sanitiser strips a dangling boolean operator');
  assert(sanitizeGmailSearchQuery('label:My Folder') === 'label:"My Folder"',
    'Query sanitiser quotes a label containing a space');
}

// ---------------------------------------------------------------------------
section('Optimistic metric events');
// ---------------------------------------------------------------------------
{
  const base = {
    unreadInbox: 500, spamAndTrash: 300, oldPromotions: 900, largeFiles: 10, oldMail: 2000,
    unsubscribedCount: 0, activeFiltersCount: 0,
  };

  // A dispatcher that already knows the post-action state wins outright.
  const direct = applyMetricEvent(base, { type: 'oldMail', metrics: { ...base, oldMail: 7 } });
  assert(direct?.oldMail === 7, 'A payload carrying full metrics is applied verbatim', String(direct?.oldMail));

  // Partial clears subtract; full clears zero.
  const partial = applyMetricEvent(base, { type: 'promo', count: 400, isPartial: true });
  assert(partial?.oldPromotions === 500, 'A partial clear subtracts the count', String(partial?.oldPromotions));
  const full = applyMetricEvent(base, { type: 'promo', count: 400, isPartial: false });
  assert(full?.oldPromotions === 0, 'A full clear zeroes the metric', String(full?.oldPromotions));
  const over = applyMetricEvent(base, { type: 'spam', count: 99999, isPartial: true });
  assert(over?.spamAndTrash === 0, 'Subtracting more than exists floors at zero', String(over?.spamAndTrash));

  // Every event the app dispatches has to move something, or a surface silently
  // ignores an action. These are the type strings actually broadcast today.
  for (const type of ['unread', 'spam', 'promo', 'large', 'oldMail']) {
    const out = applyMetricEvent(base, { type, count: 1, isPartial: true });
    assert(out !== null, `Event "${type}" moves a scoring metric`);
  }
  for (const type of ['unsub', 'rule']) {
    const out = applyMetricEvent(base, { type, count: 1, isPartial: true });
    assert(out !== null, `Event "${type}" moves a hygiene bonus`);
  }

  // The widget must not shift the score on a counter that is not a scoring input.
  assert(
    applyMetricEvent(base, { type: 'updatesAndSocial', count: 50, isPartial: true }) === null,
    'A non-scoring counter leaves the score alone'
  );
  assert(
    applyMetricEvent(base, { type: 'something-new', count: 5, isPartial: true }) === null,
    'An unrecognised event is ignored rather than applied to an arbitrary field'
  );

  // A no-op event must return null so React can bail out of the render.
  assert(
    applyMetricEvent({ ...base, oldPromotions: 0 }, { type: 'promo', count: 10, isPartial: true }) === null,
    'An event that changes nothing returns null instead of a new object'
  );

  // Purity: the reducer runs inside a React updater, which StrictMode invokes twice.
  const frozen = Object.freeze({ ...base });
  const once = applyMetricEvent(frozen, { type: 'unread', count: 100, isPartial: true });
  const twice = applyMetricEvent(frozen, { type: 'unread', count: 100, isPartial: true });
  assert(
    once?.unreadInbox === 400 && twice?.unreadInbox === 400 && frozen.unreadInbox === 500,
    'The reducer is pure: same input, same output, input untouched',
    `${once?.unreadInbox} / ${twice?.unreadInbox} / ${frozen.unreadInbox}`
  );

  // The bonus events add rather than replace, and default to one.
  const unsub = applyMetricEvent(base, { type: 'unsub' });
  assert(unsub?.unsubscribedCount === 1, 'An unsubscribe with no count increments by one', String(unsub?.unsubscribedCount));

  // Field maps must not overlap, or one event would move two inputs.
  const clutterKeys = Object.keys(SCORE_METRIC_FIELDS);
  const bonusKeys = Object.keys(SCORE_BONUS_FIELDS);
  assert(
    clutterKeys.every(k => !bonusKeys.includes(k)),
    'No event type is both a clutter metric and a bonus'
  );

  // Nothing to apply to yet: the first fetch has not landed.
  assert(
    applyMetricEvent(null, { type: 'unread', count: 5, isPartial: true }) === null,
    'An event arriving before the first fetch is a no-op, not a crash'
  );
}

// ---------------------------------------------------------------------------
section('Score presentation matches the model');
// ---------------------------------------------------------------------------
{
  // The Inbox Score page describes how the score is built. When the model changed
  // the page kept advertising the old fixed weights — "max -35 pts", "max -25 pts",
  // "max -20 pts" — for categories that no longer have a fixed maximum at all.
  // Nothing failed, because copy is not typechecked; the page simply explained a
  // scoring model the app had stopped using.
  const modalSource = fs.readFileSync('src/components/HealthScoreModal.tsx', 'utf-8');
  // Comments stripped: the point is what reaches the user, and the note explaining
  // why these phrases were removed necessarily quotes them.
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const modalCopy = stripComments(modalSource);
  const staleCaps = ['max -35 pts', 'max -25 pts', 'max -20 pts', 'storage bloat'];
  for (const phrase of staleCaps) {
    assert(!modalCopy.includes(phrase),
      `The score page no longer advertises "${phrase}"`);
  }
  assert(
    modalSource.includes('ATTENTION_SHARE_OF_SCORE'),
    'The score page derives its stated budgets from the model rather than restating them'
  );

  // Bands are defined once. Two copies is what let a score of 45 draw an amber ring
  // beside a panel headed "Action Required".
  const widgetSource = fs.readFileSync('src/components/HealthScoreWidget.tsx', 'utf-8');
  for (const [name, src] of [['score page', stripComments(modalSource)], ['navbar widget', stripComments(widgetSource)]] as const) {
    assert(src.includes('healthBand('),
      `The ${name} reads its band from the shared definition`);
    assert(!/s >= 85|displayScore < 40/.test(src),
      `The ${name} does not carry its own band thresholds`);
  }

  // The bands themselves: ordered, total, and labelled.
  assert(healthBand(100) === 'optimal' && healthBand(85) === 'optimal',
    'The top band starts at 85');
  assert(healthBand(84) === 'good' && healthBand(70) === 'good', 'Good spans 70-84');
  assert(healthBand(69) === 'attention' && healthBand(50) === 'attention', 'Attention spans 50-69');
  assert(healthBand(49) === 'critical' && healthBand(0) === 'critical', 'Critical is below 50');

  let ordered = true;
  const rank = { critical: 0, attention: 1, good: 2, optimal: 3 };
  for (let i = 0; i < 100; i++) {
    if (rank[healthBand(i)] > rank[healthBand(i + 1)]) ordered = false;
  }
  assert(ordered, 'Bands never go backwards as the score rises');
  assert(
    Object.keys(HEALTH_BAND_LABEL).length === 4
      && Object.values(HEALTH_BAND_LABEL).every(v => v.length > 0),
    'Every band has a label'
  );
}

// ---------------------------------------------------------------------------
section('Bulk sweep protection');
// ---------------------------------------------------------------------------
{
  // "Clean All" on Old Mail trashed every message over a year old, including
  // starred mail, mail flagged important, mail filed into the user's own folders,
  // and their own sent mail. The sweep query is now a different string from the
  // metric query, and these assertions are what keep the two from converging again.
  const guards = ['-is:starred', '-is:important', '-has:userlabels', '-in:sent', '-in:draft'];

  for (const g of guards) {
    assert(SWEEP_PROTECTION.includes(g),
      `Sweep protection excludes ${g}`, SWEEP_PROTECTION);
  }

  for (const key of PROTECTED_SWEEPS) {
    // Widened to string deliberately. The literal types make the inequality below
    // provable at compile time, which is the stronger guarantee — but the runtime
    // check is what still holds if either constant ever becomes computed.
    const sweep: string = HEALTH_SCORE_SWEEP_QUERIES[key];
    const metric: string = HEALTH_SCORE_QUERIES[key];
    assert(sweep !== metric,
      `Destructive sweep "${key}" does not reuse its metric query`, sweep);
    assert(sweep.startsWith(metric),
      `Sweep "${key}" narrows its metric rather than replacing it`, sweep);
    for (const g of guards) {
      assert(sweep.includes(g),
        `Sweep "${key}" will not touch ${g.slice(1)} mail`, sweep);
    }
  }

  // Marking read destroys nothing and spam/trash is already discarded, so neither
  // needs narrowing — and narrowing them would leave mail the card claims is gone.
  assert(HEALTH_SCORE_SWEEP_QUERIES.unread === HEALTH_SCORE_QUERIES.unread,
    'The non-destructive unread sweep is not narrowed');
  assert(HEALTH_SCORE_SWEEP_QUERIES.spamAndTrash === HEALTH_SCORE_QUERIES.spamAndTrash,
    'Emptying spam and trash is not narrowed');

  // Every destructive sweep still has to terminate: trashAllByQuery drains by
  // re-running its query, and a trashed message keeps matching one without this.
  for (const key of PROTECTED_SWEEPS) {
    const q = HEALTH_SCORE_SWEEP_QUERIES[key];
    assert(q.includes('-in:trash') || q.includes('in:trash'),
      `Sweep "${key}" is scoped against trash so its drain loop terminates`, q);
  }
}

// ---------------------------------------------------------------------------
section('Storage breakdown — segment exclusivity');
// ---------------------------------------------------------------------------
{
  // The bar sums these into one "cleanable" total and draws each as a share of it.
  // That is only meaningful if no message can match two of them, so exclusivity is a
  // correctness property of the component, not a stylistic preference.
  const order = ['junk', 'large', 'oldMail', 'promotions', 'updates'] as const;
  const q = (k: typeof order[number]) => SEGMENT_QUERIES[k];

  for (const k of order.slice(1)) {
    assert(q(k).includes('-in:trash') && q(k).includes('-in:spam'),
      `Segment "${k}" excludes the junk segment`, q(k));
  }
  for (const k of ['oldMail', 'promotions', 'updates'] as const) {
    assert(q(k).includes('smaller:5M'),
      `Segment "${k}" excludes the heavy-files segment`, q(k));
  }
  assert(q('promotions').includes('newer_than:1y') && q('updates').includes('newer_than:1y'),
    'The category segments exclude the old-mail segment by date');
  assert(q('large').includes('larger:5M') && !q('large').includes('smaller:5M'),
    'The heavy-files segment is bounded only by the junk segment above it');

  for (const k of order) {
    if (!q(k).includes(' OR ')) continue;
    assert(/\([^()]*\sOR\s[^()]*\)/.test(q(k)),
      `Segment "${k}" groups its OR`, q(k));
  }
}

// ---------------------------------------------------------------------------
section('Health score model');
// ---------------------------------------------------------------------------
{
  const clean = computeInboxHealthBreakdown({
    unreadInbox: 0, spamAndTrash: 0, oldPromotions: 0, largeFiles: 0, oldMail: 0,
  });
  assert(clean.score === 100, 'An empty inbox with no bonuses scores exactly 100', `got ${clean.score}`);

  const wrecked = computeInboxHealthBreakdown({
    unreadInbox: 999_999, spamAndTrash: 999_999, oldPromotions: 999_999,
    largeFiles: 999_999, oldMail: 999_999, mailboxTotal: 999_999, inboxTotal: 999_999,
  });
  assert(wrecked.score >= 0 && wrecked.score <= 100,
    'Score stays inside 0-100 at extreme inputs', `got ${wrecked.score}`);
  assert(wrecked.unreadPenalty <= 100 * ATTENTION_SHARE_OF_SCORE + 0.1,
    'Unread cannot deduct more than the attention budget', `got ${wrecked.unreadPenalty}`);

  // The breakdown is shown to the user as an itemised deduction list. If the parts
  // do not sum to the whole, the list is not an explanation of the score.
  const mixed = computeInboxHealthBreakdown({
    unreadInbox: 240, spamAndTrash: 90, oldPromotions: 410, largeFiles: 7, oldMail: 1200,
    unsubscribedCount: 2, activeFiltersCount: 1, mailboxTotal: 9000, inboxTotal: 700,
  });
  const partsSum = mixed.unreadPenalty + mixed.spamPenalty + mixed.promoPenalty + mixed.bloatPenalty;
  assert(Math.abs(partsSum - mixed.totalDeductions) < 0.15,
    'Itemised penalties sum to the reported total deduction',
    `parts ${partsSum.toFixed(2)} vs total ${mixed.totalDeductions}`);
  assert(Math.abs((mixed.largeFilesPenalty + mixed.oldMailPenalty) - mixed.bloatPenalty) < 0.15,
    'The two bloat sub-penalties sum back to the bloat penalty',
    `${mixed.largeFilesPenalty} + ${mixed.oldMailPenalty} vs ${mixed.bloatPenalty}`);
  assert(Math.abs((mixed.unsubBonus + mixed.filterBonus) - mixed.managementBonus) < 0.15,
    'The two hygiene bonuses sum back to the management bonus');

  // Monotonic: clearing clutter must never lower the score, or "+N pts" is a lie.
  let monotonic = true;
  for (let unread = 0; unread < 3000; unread += 137) {
    const a = computeInboxHealthScore({ unreadInbox: unread, spamAndTrash: 50, oldPromotions: 20, largeFiles: 2, oldMail: 100, mailboxTotal: 8000, inboxTotal: 3000 });
    const b = computeInboxHealthScore({ unreadInbox: unread + 137, spamAndTrash: 50, oldPromotions: 20, largeFiles: 2, oldMail: 100, mailboxTotal: 8000, inboxTotal: 3000 });
    if (b > a) monotonic = false;
  }
  assert(monotonic, 'Score never rises when unread volume rises, at any point on the curve');

  // The "+N pts" figures in Inbox Health are exactly this difference. The mailbox
  // size is required: without a denominator nothing can be scored, so the gain
  // would correctly be zero and the assertion would be testing the wrong thing.
  const base = {
    unreadInbox: 500, spamAndTrash: 300, oldPromotions: 200, largeFiles: 6, oldMail: 900,
    mailboxTotal: 12000, inboxTotal: 900,
  };
  const gain = computeInboxHealthScore({ ...base, spamAndTrash: 0 }) - computeInboxHealthScore(base);
  assert(gain > 0 && Number.isFinite(gain), 'Clearing a non-empty metric yields a positive, finite point gain');
}

// ---------------------------------------------------------------------------
section('Size-relative scoring');
// ---------------------------------------------------------------------------
{
  // A cluttered but ordinary account. Under fixed reference points every penalty
  // saturated at once and this scored 12 — the floor — so clearing three hundred
  // promotions moved nothing and the number looked broken.
  const real = {
    unreadInbox: 800, spamAndTrash: 600, oldPromotions: 3000,
    largeFiles: 12, oldMail: 4000, mailboxTotal: 42000, inboxTotal: 1800,
  };
  const breakdown = computeInboxHealthBreakdown(real);

  assert(breakdown.score > 12 && breakdown.score < 100,
    'A cluttered but ordinary mailbox scores inside the range, not pinned to the floor',
    `got ${breakdown.score}`);

  // Progress on either axis must always show. Walk each down and require the score
  // to rise, never stall — the practical failure of every capped model before this.
  const rises = (field: string, steps: number[]) => {
    let previous = -1;
    for (const v of steps) {
      const next = computeInboxHealthScore({ ...real, [field]: v });
      if (next <= previous) return false;
      previous = next;
    }
    return true;
  };
  assert(rises('oldPromotions', [3000, 2000, 1000, 0]),
    'Clearing promotions raises the score at every step');
  assert(rises('unreadInbox', [800, 600, 400, 200, 0]),
    'Reading the backlog raises the score at every step');
  assert(
    computeInboxHealthScore({ ...real, activeFiltersCount: 1 }) > computeInboxHealthScore(real),
    'Creating a single filter rule visibly moves the score'
  );

  // Scale invariance: clutter is a share, so identical proportions must score the
  // same whether the mailbox holds two thousand messages or two hundred thousand.
  const small = {
    unreadInbox: 90, spamAndTrash: 30, oldPromotions: 150,
    largeFiles: 6, oldMail: 200, mailboxTotal: 2000, inboxTotal: 180,
  };
  const large = {
    unreadInbox: 9000, spamAndTrash: 3000, oldPromotions: 15000,
    largeFiles: 600, oldMail: 20000, mailboxTotal: 200000, inboxTotal: 18000,
  };
  assert(
    Math.abs(computeInboxHealthScore(small) - computeInboxHealthScore(large)) <= 1,
    'Proportionally identical mailboxes score the same at 100x the size',
    `${computeInboxHealthScore(small)} vs ${computeInboxHealthScore(large)}`
  );

  // The same absolute backlog is worse in a small mailbox than a large one.
  assert(
    computeInboxHealthScore({ ...real, mailboxTotal: 6000 })
      < computeInboxHealthScore({ ...real, mailboxTotal: 400000 }),
    'The same clutter counts for more against a small mailbox than a large one'
  );

  // Both ends of the range are reachable and mean something real.
  for (const total of [500, 42000, 500000]) {
    const clean = computeInboxHealthScore({
      unreadInbox: 0, spamAndTrash: 0, oldPromotions: 0, largeFiles: 0, oldMail: 0,
      mailboxTotal: total, inboxTotal: Math.round(total / 20),
    });
    assert(clean === 100, `An empty mailbox of ${total} scores 100`, `got ${clean}`);
  }
  assert(
    computeInboxHealthScore({
      unreadInbox: 100, spamAndTrash: 100, oldPromotions: 0, largeFiles: 0, oldMail: 0,
      mailboxTotal: 100, inboxTotal: 100,
    }) === 0,
    'A mailbox that is entirely unread junk scores 0'
  );

  // A tiny mailbox must not be judged a disaster over a handful of messages.
  const tiny = computeInboxHealthScore({
    unreadInbox: 3, spamAndTrash: 2, oldPromotions: 1, largeFiles: 0, oldMail: 0,
    mailboxTotal: 400, inboxTotal: 60,
  });
  assert(tiny >= 85, 'A nearly-empty mailbox with a few stray messages stays healthy', `got ${tiny}`);

  // Monotonic in every input.
  let monotonic = true;
  for (const f of ['unreadInbox', 'spamAndTrash', 'oldPromotions', 'largeFiles', 'oldMail']) {
    for (const n of [0, 50, 500, 5000]) {
      if (computeInboxHealthScore({ ...real, [f]: n * 2 + 10 }) > computeInboxHealthScore({ ...real, [f]: n })) {
        monotonic = false;
      }
    }
  }
  assert(monotonic, 'More clutter never raises the score, for any single metric');

  // No denominator yet (first paint, or the profile call failed). The model must
  // stay in range rather than dividing by zero or inventing a substitute.
  const noSize = computeInboxHealthBreakdown({
    unreadInbox: 800, spamAndTrash: 600, oldPromotions: 3000, largeFiles: 12, oldMail: 4000,
  });
  assert(noSize.score >= 0 && noSize.score <= 100,
    'A score is still produced before the mailbox size is known', `got ${noSize.score}`);
  assert(noSize.totalDeductions === 0,
    'An unmeasured mailbox deducts nothing rather than guessing a reference',
    `got ${noSize.totalDeductions}`);

  // The breakdown is shown as an itemised list, so the parts must sum to the whole.
  const parts = breakdown.unreadPenalty + breakdown.spamPenalty + breakdown.promoPenalty + breakdown.bloatPenalty;
  assert(Math.abs(parts - breakdown.totalDeductions) < 0.15,
    'Itemised penalties sum to the reported total', `${parts.toFixed(2)} vs ${breakdown.totalDeductions}`);
  assert(
    Math.abs((breakdown.largeFilesPenalty + breakdown.oldMailPenalty) - breakdown.bloatPenalty) < 0.15,
    'The two bloat halves sum to the bloat penalty'
  );

  // Overlap guard: the four clutter queries can match the same message, so their
  // sum may exceed the mailbox. The deduction must stay inside its budget.
  const overlapping = computeInboxHealthBreakdown({
    unreadInbox: 0, spamAndTrash: 9000, oldPromotions: 9000,
    largeFiles: 9000, oldMail: 9000, mailboxTotal: 10000, inboxTotal: 100,
  });
  const storageBudget = 100 * (1 - ATTENTION_SHARE_OF_SCORE);
  assert(overlapping.totalDeductions <= storageBudget + 0.15,
    'Overlapping clutter categories cannot deduct more than the storage budget',
    `${overlapping.totalDeductions} vs ${storageBudget}`);
  assert(overlapping.score >= 0, 'Overlap can never drive the score below zero');

  // The model must contain no per-category tuning constants: a category is judged
  // only by how many messages it holds, so two categories holding the same number
  // of messages must cost the same.
  const swapA = computeInboxHealthScore({
    unreadInbox: 0, spamAndTrash: 500, oldPromotions: 0, largeFiles: 0, oldMail: 0,
    mailboxTotal: 20000, inboxTotal: 500,
  });
  const swapB = computeInboxHealthScore({
    unreadInbox: 0, spamAndTrash: 0, oldPromotions: 0, largeFiles: 0, oldMail: 500,
    mailboxTotal: 20000, inboxTotal: 500,
  });
  assert(swapA === swapB,
    'No category is secretly weighted above another — equal counts cost equally',
    `${swapA} vs ${swapB}`);
}

// ---------------------------------------------------------------------------
section('Sender parsing');
// ---------------------------------------------------------------------------
{
  assert(extractRootDomain('bounce-123.mail.service.co.uk') === 'service.co.uk',
    'ccTLD-aware root domain extraction handles a two-level suffix');
  assert(extractRootDomain('notifications.github.com') === 'github.com',
    'Root domain extraction collapses a subdomain');

  const d = extractSenderDetails('"Stripe Billing" <receipts@stripe.com>');
  assert(d.emailAddr === 'receipts@stripe.com', 'Address is parsed out of an angle-bracket From header');
  assert(d.rootDomain === 'stripe.com' && d.brand === 'Stripe', 'Known brand is resolved from the root domain');
  assert(extractSenderDetails('someone@gmail.com').isGenericFreemail,
    'Freemail addresses are flagged so they never become domain-wide rules');

  // Display names differ but the address does not — the model counts one sender.
  const sameSender = [
    thread({ id: 'a', sender: '"Stripe" <r@stripe.com>' }),
    thread({ id: 'b', sender: '"Stripe Billing" <r@stripe.com>' }),
    thread({ id: 'c', sender: 'r@stripe.com' }),
  ];
  assert(countDistinctSenders(sameSender) === 1,
    'One address under three display names counts as one sender',
    `got ${countDistinctSenders(sameSender)}`);

  const parsed = parseListUnsubscribe('<https://x.com/u?i=1>, <mailto:stop@x.com?subject=off>', 'List-Unsubscribe=One-Click');
  assert(parsed.httpUrl === 'https://x.com/u?i=1', 'List-Unsubscribe HTTP URI is parsed');
  assert(parsed.mailtoAddress === 'stop@x.com' && parsed.mailtoSubject === 'off',
    'List-Unsubscribe mailto address and subject are parsed');
  assert(parsed.isOneClickPost, 'RFC 8058 one-click is detected from the Post header');
}

// ---------------------------------------------------------------------------
section('Cleanup model — scope and safety');
// ---------------------------------------------------------------------------
{
  const bulk = Array.from({ length: 40 }, (_, i) => thread({
    id: `b${i}`,
    messageIds: [`mb${i}`],
    sender: 'Deals <news@shop.example>',
    date: new Date(NOW.getTime() - (10 + i) * DAY),
    labelIds: ['UNREAD'],
    listUnsubscribe: '<https://shop.example/u>',
    sizeEstimate: 80_000,
  }));

  const cohorts = buildSenderCohorts(bulk, NOW);
  assert(cohorts.length === 1 && cohorts[0].volume === 40, 'Cohort groups all mail from one address');

  const scope = { scopeQuery: 'category:promotions -in:trash -in:spam -in:sent' };
  const recs = recommendCleanups(cohorts, scope);
  assert(recs.length > 0, 'A high-volume unread bulk sender produces a recommendation');

  for (const r of recs) {
    // A card measured against one category must not act on the whole mailbox.
    assert(r.query.includes(scope.scopeQuery),
      `"${r.kind}" query stays inside the analysed category`, `got: ${r.query}`);
    // trashAllByQuery drains by re-running its query; without this it never empties.
    assert(r.query.includes('-in:trash'),
      `"${r.kind}" query excludes trash so the drain loop terminates`, `got: ${r.query}`);
    // batchTrash/batchModify are message endpoints.
    assert(r.actionIds.every(id => id.startsWith('mb')),
      `"${r.kind}" acts on message ids, not thread ids`, `got: ${r.actionIds.slice(0, 3).join(',')}`);
  }

  // Engagement protects a sender from every destructive suggestion.
  const engaged = bulk.map((e, i) => i < 5 ? { ...e, labelIds: ['STARRED'] } : e);
  const engagedRecs = recommendCleanups(buildSenderCohorts(engaged, NOW), scope);
  assert(engagedRecs.length === 0,
    'A sender with starred mail receives no destructive recommendation',
    `got ${engagedRecs.length}`);

  // Evidence must not assert "nothing starred" when something is starred. One
  // starred message in twelve is under the 2% protection floor only for large
  // cohorts, so use a cohort big enough to slip through and check the wording.
  const mostlyIgnored = Array.from({ length: 120 }, (_, i) => thread({
    id: `c${i}`, messageIds: [`mc${i}`],
    sender: 'Alerts <bot@svc.example>',
    date: new Date(NOW.getTime() - (5 + i) * DAY),
    labelIds: i === 0 ? ['STARRED'] : ['UNREAD'],
    listUnsubscribe: '<https://svc.example/u>',
  }));
  const slipped = recommendCleanups(buildSenderCohorts(mostlyIgnored, NOW), scope);
  for (const r of slipped) {
    const claimsNothing = r.evidence.some(e => /^Nothing starred/i.test(e));
    assert(!claimsNothing,
      'A cohort containing a starred message never claims "nothing starred"',
      r.evidence.join(' | '));
  }

  // Cadence over a sub-week window is not a weekly rate.
  const burst = Array.from({ length: 6 }, (_, i) => thread({
    id: `d${i}`, messageIds: [`md${i}`],
    sender: 'Burst <burst@svc.example>',
    date: new Date(NOW.getTime() - 2 * DAY + i * 1000),
  }));
  const burstCohort = buildSenderCohorts(burst, NOW)[0];
  assert(burstCohort.cadence === null,
    'No weekly rate is reported for mail seen within a single week',
    `got ${burstCohort.cadence}`);

  const spread = Array.from({ length: 30 }, (_, i) => thread({
    id: `e${i}`, messageIds: [`me${i}`],
    sender: 'Weekly <w@svc.example>',
    date: new Date(NOW.getTime() - i * 7 * DAY),
  }));
  const spreadCohort = buildSenderCohorts(spread, NOW)[0];
  assert(spreadCohort.cadence !== null && spreadCohort.cadence > 0.5 && spreadCohort.cadence < 2,
    'A once-a-week sender is reported at roughly once a week',
    `got ${spreadCohort.cadence}`);

  // Confidence and reclaimable totals must be well-formed for display.
  const analysis = analyseCleanup(bulk, NOW, scope);
  assert(analysis.recommendations.every(r => r.confidence > 0 && r.confidence <= 1),
    'Every confidence is a probability in (0, 1]');
  assert(analysis.reclaimableBytes <= analysis.totalBytes,
    'Reclaimable bytes never exceed the bytes actually observed');
  assert(analysis.recommendations.every((r, i, a) => i === 0 || a[i - 1].score >= r.score),
    'Recommendations are returned in descending score order');

  const pareto = computePareto(buildSenderCohorts([
    ...Array.from({ length: 80 }, (_, i) => thread({ id: `p${i}`, sender: 'a@x.example' })),
    ...Array.from({ length: 20 }, (_, i) => thread({ id: `q${i}`, sender: 'b@y.example' })),
  ], NOW));
  assert(pareto !== null && pareto.senderCount === 1 && pareto.coveredShare >= 0.8,
    'Pareto reports the smallest sender set covering 80% of volume',
    JSON.stringify(pareto));
}

// ---------------------------------------------------------------------------
section('Routing model');
// ---------------------------------------------------------------------------
{
  const labels = [{ id: 'Label_9', name: 'Receipts', type: 'user' }];

  // 18 of 20 already filed in Receipts: a strong, well-evidenced route.
  const filed = Array.from({ length: 20 }, (_, i) => thread({
    id: `r${i}`,
    messageIds: [`mr${i}`],
    sender: 'Receipts <billing@acme.example>',
    labelIds: i < 18 ? ['Label_9'] : [],
  }));

  const suggestions = buildRoutingSuggestions(filed, labels);
  const route = suggestions.find(s => s.kind === 'route_existing');
  assert(!!route, 'A consistently filed sender produces a route suggestion');

  if (route) {
    // P(label | sender), not P(sender | label). Smoothed, so just below 18/20.
    assert(route.purity > 0.7 && route.purity < 0.95,
      'Purity is a smoothed P(label | sender), not an unsmoothed ratio',
      `got ${route.purity}`);
    assert(route.filed === 18 && route.unfiled === 2,
      'Filed and unfiled counts match the sample', `${route.filed}/${route.unfiled}`);
    assert(route.actionIds.every(id => id.startsWith('mr')),
      'Backlog filing targets message ids, not thread ids',
      route.actionIds.join(','));
    assert(route.actionIds.length === 2,
      'Only the unfiled messages are queued for filing', `got ${route.actionIds.length}`);
    assert(route.confidence > 0 && route.confidence <= 0.98, 'Route confidence is bounded');
  }

  // Smoothing: 2-of-2 must not outrank 60-of-60.
  const tiny = buildRoutingSuggestions(
    Array.from({ length: 3 }, (_, i) => thread({ id: `s${i}`, messageIds: [`ms${i}`], sender: 'x@tiny.example', labelIds: ['Label_9'] })),
    labels
  ).find(s => s.kind === 'route_existing');
  const big = buildRoutingSuggestions(
    Array.from({ length: 60 }, (_, i) => thread({ id: `l${i}`, messageIds: [`ml${i}`], sender: 'x@big.example', labelIds: ['Label_9'] })),
    labels
  ).find(s => s.kind === 'route_existing');
  assert(!!tiny && !!big && big!.purity > tiny!.purity,
    'A 60-message sender outranks a 3-message one at identical raw consistency',
    `tiny ${tiny?.purity} vs big ${big?.purity}`);

  // A freemail sender must never become a domain-wide rule.
  const freemail = buildRoutingSuggestions(
    Array.from({ length: 10 }, (_, i) => thread({ id: `f${i}`, messageIds: [`mf${i}`], sender: 'friend@gmail.com' })),
    labels
  );
  assert(freemail.every(s => !s.isDomainRule || !s.query.includes('gmail.com')),
    'No rule is ever scoped to a public webmail domain');

  // Cold start: brand-map themes, with a deduped and grouped query.
  const coldStart = buildRoutingSuggestions([
    ...Array.from({ length: 5 }, (_, i) => thread({ id: `cs${i}`, messageIds: [`mcs${i}`], sender: 'a@stripe.com' })),
    ...Array.from({ length: 5 }, (_, i) => thread({ id: `ct${i}`, messageIds: [`mct${i}`], sender: 'b@stripe.com' })),
    ...Array.from({ length: 5 }, (_, i) => thread({ id: `cu${i}`, messageIds: [`mcu${i}`], sender: 'c@paypal.com' })),
  ], []);
  const theme = coldStart.find(s => s.senderKey.startsWith('theme:'));
  assert(!!theme, 'Recognised brands with no filing history produce a themed folder');
  if (theme) {
    const domainMentions = (theme.query.match(/stripe\.com/g) || []).length;
    assert(domainMentions === 1, 'A domain appears once in a theme query however many senders it has',
      `got ${domainMentions} in ${theme.query}`);
    assert(!theme.query.includes(' OR ') || /\(.*OR.*\)/.test(theme.query),
      'A multi-domain theme query groups its OR', theme.query);
    assert(theme.confidence <= 0.7,
      'Cold-start confidence stays below the learned path', `got ${theme.confidence}`);
  }
}

// ---------------------------------------------------------------------------
section('Category audit — template clustering');
// ---------------------------------------------------------------------------
{
  assert(normalizeSubject('Your code is 481920') === normalizeSubject('Your code is 773301'),
    'Two generated messages differing only in a number share one template');
  assert(normalizeSubject('Re: Order #A1B2C3D4 shipped') === normalizeSubject('Order #99887766 shipped'),
    'Reply prefixes and hex tokens normalise away');
  assert(normalizeSubject('確認コード 1234').length > 0,
    'A non-Latin subject survives normalisation instead of collapsing to nothing');

  const q = templateToQuery('your verification code is #', 'category:updates');
  assert(q.startsWith('category:updates ') && q.includes('subject:('),
    'A cluster query stays scoped to its category', q);
  assert(templateToQuery('# # #') === '',
    'A template with no distinctive words yields no query rather than a bad one');
  assert(templateToQuery('the #') === '',
    'A single short word is not treated as a distinctive phrase');

  const codes = Array.from({ length: 60 }, (_, i) => thread({
    id: `k${i}`,
    messageIds: [`mk${i}`],
    sender: `noreply@svc${i}.example`,
    subject: `Your login code is ${100000 + i}`,
    date: new Date(NOW.getTime() - (60 + i) * DAY),
    labelIds: ['UNREAD'],
  }));
  const audit = auditCategory(codes, NOW, { scopeQuery: 'category:updates' });
  const cluster = audit.clusters[0];
  assert(!!cluster && cluster.volume === 60,
    'Sixty one-time codes from sixty senders collapse into one decision',
    `clusters=${audit.clusters.length}`);
  if (cluster) {
    assert(cluster.senders === 60, 'The cluster reports the real number of distinct senders');
    assert(cluster.verdict === 'expired', 'Aged, templated, number-varying mail is judged expired');
    assert(cluster.actionIds.every(id => id.startsWith('mk')),
      'Cluster actions target message ids');
    assert(cluster.query.startsWith('category:updates'),
      'Cluster inspection stays inside the scanned category', cluster.query);
  }

  // Anything the user engaged with is kept, whatever its shape.
  const starred = codes.map((e, i) => i < 3 ? { ...e, labelIds: ['STARRED'] } : e);
  const keptAudit = auditCategory(starred, NOW, { scopeQuery: 'category:updates' });
  assert(keptAudit.clusters[0]?.verdict === 'keep',
    'A cluster containing starred mail is kept, not cleared');
  assert(keptAudit.clearableVolume === 0,
    'Nothing in a kept cluster is counted as clearable');

  // Recent mail is never proposed for clearing.
  const fresh = codes.map(e => ({ ...e, date: new Date(NOW.getTime() - 2 * DAY) }));
  const freshAudit = auditCategory(fresh, NOW, { scopeQuery: 'category:updates' });
  assert(freshAudit.clusters.every(c => c.verdict !== 'expired' && c.verdict !== 'disposable'),
    'Mail from the last two days is never judged disposable');

  assert(audit.clearableVolume + audit.keepVolume <= audit.totalAnalysed,
    'Clearable and kept volumes never exceed what was analysed');
}

// ---------------------------------------------------------------------------
section('Email row dates');
// ---------------------------------------------------------------------------
{
  // Rows rendered { month, day } only, so a message from March 2019 and one from
  // last March both read "Mar 4". In a mailbox whose whole purpose is sorting out
  // years of accumulated mail, the year is the thing the row most needed to say.
  const now = new Date();
  const thisYear = now.getFullYear();

  const old = formatEmailDate(new Date(2019, 2, 4, 9, 30));
  assert(old.includes('2019'), 'A message from a previous year shows its year', old);

  const older = formatEmailDate(new Date(2011, 10, 22));
  assert(older.includes('2011'), 'A very old message shows its year', older);

  // Recent mail stays compact — adding the year to every row would pad the column
  // for the mail people actually look at.
  const earlierThisYear = new Date(thisYear, 0, 15);
  if (earlierThisYear.getTime() < now.getTime()) {
    const s2 = formatEmailDate(earlierThisYear);
    assert(!s2.includes(String(thisYear)), 'A message from this year omits the year', s2);
    assert(s2.length > 0, 'A message from this year still renders a date', s2);
  }

  // Today collapses to a time, which is what separates this morning from this
  // afternoon — a date would be the same on every one of them.
  const todayStr = formatEmailDate(new Date(now.getTime() - 60 * 1000));
  assert(/\d/.test(todayStr) && !todayStr.includes(String(thisYear)),
    "Today's mail shows a time rather than a date", todayStr);

  // A future date is clock skew or a malformed header, not a prediction; it keeps
  // its year so it is visibly odd rather than silently reading as recent.
  const future = formatEmailDate(new Date(thisYear + 1, 5, 1));
  assert(future.includes(String(thisYear + 1)), 'A future-dated message shows its year', future);

  // Rows render whatever the header gave them, which is not always a date.
  for (const bad of [null, undefined, '', 'not a date', NaN]) {
    assert(formatEmailDate(bad as any) === '',
      `An unparseable date renders empty rather than "Invalid Date" (${String(bad)})`);
  }
  assert(formatEmailDate('2018-07-04T10:00:00Z').includes('2018'),
    'An ISO string is accepted, not just a Date');

  // No email row may go back to dropping the year.
  const rowFiles = [
    'src/components/Dashboard.tsx',
    'src/components/FilteredEmailPage.tsx',
    'src/components/LabelManagerModal.tsx',
  ];
  for (const f of rowFiles) {
    const src = fs.readFileSync(f, 'utf-8');
    assert(
      !src.includes("toLocaleDateString(undefined, { month: 'short', day: 'numeric' })"),
      `${f} formats row dates through the shared formatter`
    );
  }
}

// ---------------------------------------------------------------------------
section('Recommendations & export rows');
// ---------------------------------------------------------------------------
{
  const stats = {
    unread: 830, oldPromo: 1200, large: 14, spamAndTrash: 640,
    importantUnread: 22, updatesAndSocial: 900, withAttachments: 300, oldMail: 4100,
    mailboxTotal: 38000, inboxTotal: 2100,
  };
  const sizes = { oldPromo: 300 * MB, large: 900 * MB, spamAndTrash: 120 * MB, oldMail: 2000 * MB };
  const recs = buildRecommendations(stats, sizes, [{ email: 'a@x.example', name: 'X', count: 300 }]);

  assert(recs.length > 0, 'A cluttered inbox produces recommendations');
  assert(recs.every(r => Number.isFinite(r.pointsGain) && r.pointsGain >= 0),
    'Every points gain is a finite, non-negative number');
  assert(recs.every((r, i, a) => i === 0 || a[i - 1].pointsGain >= r.pointsGain),
    'Recommendations are ranked by points recovered');
  assert(new Set(recs.map(r => r.id)).size === recs.length,
    'No recommendation is emitted twice');
  assert(buildRecommendations(null, {}, []).length === 0,
    'No recommendations are invented before the stats have loaded');

  // The title must describe what the linked action does.
  const oldMailRec = recs.find(r => r.id === 'oldMail');
  assert(!!oldMailRec && !/archive/i.test(oldMailRec.title),
    'The old-mail recommendation is not titled "archive" when its action trashes',
    oldMailRec?.title);

  // Export rows: every header must have a column behind it.
  const row = messageToRow(
    { id: 'msg-1', threadId: 'thr-1', subject: 'Hi', snippet: 's', sizeEstimate: 2048, labelIds: ['UNREAD'], date: NOW },
    extractSenderDetails('A <a@b.example>')
  );
  assert(row.length === MESSAGE_HEADERS.length,
    'Every export row has exactly one cell per header',
    `${row.length} cells vs ${MESSAGE_HEADERS.length} headers`);
  assert(row[MESSAGE_HEADERS.indexOf('Thread ID')] === 'thr-1',
    'The Thread ID column contains the thread id, not the message id',
    String(row[MESSAGE_HEADERS.indexOf('Thread ID')]));
  assert(!MESSAGE_HEADERS.includes('Has Attachment'),
    'No column is exported that the underlying metadata cannot populate');
}

// ---------------------------------------------------------------------------
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
