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
    largeFiles: 999_999, oldMail: 999_999,
  });
  assert(wrecked.score >= 12 && wrecked.score <= 100,
    'Score stays inside its stated 12–100 range at extreme inputs', `got ${wrecked.score}`);
  assert(wrecked.unreadPenalty <= 35 && wrecked.spamPenalty <= 25
    && wrecked.promoPenalty <= 20 && wrecked.bloatPenalty <= 10,
    'Every penalty respects the cap the UI advertises for it');

  // The breakdown is shown to the user as an itemised deduction list. If the parts
  // do not sum to the whole, the list is not an explanation of the score.
  const mixed = computeInboxHealthBreakdown({
    unreadInbox: 240, spamAndTrash: 90, oldPromotions: 410, largeFiles: 7, oldMail: 1200,
    unsubscribedCount: 2, activeFiltersCount: 1,
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
    const a = computeInboxHealthScore({ unreadInbox: unread, spamAndTrash: 50, oldPromotions: 20, largeFiles: 2, oldMail: 100 });
    const b = computeInboxHealthScore({ unreadInbox: unread + 137, spamAndTrash: 50, oldPromotions: 20, largeFiles: 2, oldMail: 100 });
    if (b > a) monotonic = false;
  }
  assert(monotonic, 'Score never rises when unread volume rises, at any point on the curve');

  // The "+N pts" figures in Inbox Health are exactly this difference.
  const base = { unreadInbox: 500, spamAndTrash: 300, oldPromotions: 200, largeFiles: 6, oldMail: 900 };
  const gain = computeInboxHealthScore({ ...base, spamAndTrash: 0 }) - computeInboxHealthScore(base);
  assert(gain > 0 && Number.isFinite(gain), 'Clearing a non-empty metric yields a positive, finite point gain');
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
section('Recommendations & export rows');
// ---------------------------------------------------------------------------
{
  const stats = {
    unread: 830, oldPromo: 1200, large: 14, spamAndTrash: 640,
    importantUnread: 22, updatesAndSocial: 900, withAttachments: 300, oldMail: 4100,
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
