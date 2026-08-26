/**
 * Gmail quota governor verification.
 *
 * Gmail meters a user at 250 quota units per second. Overruns used to surface as hard
 * errors mid-way through bulk actions, so the governor's job is not "usually stay
 * under" — it is to make the ceiling a property of the system. These tests assert the
 * three things that has to mean:
 *
 *   1. Under the traffic the app really produces — parallel counts, chunked thread
 *      reads and metadata batches all at once — no one-second window exceeds 250
 *      units, and the sustained rate lands on the configured target.
 *   2. A congestion refusal is waited out rather than failed. Gmail reports these as
 *      403 with a `rateLimitExceeded` body far more often than 429, which the old
 *      client treated as fatal.
 *   3. A genuine authorisation 403 is *not* retried, because it never succeeds.
 */

import { quotaFetch, quotaState, inferCost } from '../src/lib/gmailQuota.ts';

const GMAIL_CEILING = 250;
const API = 'https://gmail.googleapis.com/gmail/v1/users/me';

let failures = 0;
function check(label: string, condition: boolean, detail: string = '') {
  if (condition) {
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures++;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function fakeResponse(status: number, body: string, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headers[k.toLowerCase()] ?? null },
    text: async () => body,
    json: async () => JSON.parse(body || '{}'),
    clone() { return this; },
  } as any;
}

// ---------------------------------------------------------------------------
// 1. Pricing
// ---------------------------------------------------------------------------

function testPricing() {
  console.log('\nPricing (quota units per Gmail usage limits)');
  check('threads.get is 10', inferCost('/threads/abc?format=metadata') === 10);
  check('messages.list is 5', inferCost('/messages?q=is:unread') === 5);
  check('batchModify is 50', inferCost('/messages/batchModify', 'POST') === 50);
  check('batchDelete is 50', inferCost('/messages/batchDelete', 'POST') === 50);
  check('labels.list is 1', inferCost('/labels') === 1);
  check('labels.create is 5', inferCost('/labels', 'POST') === 5);
  check('filters.create is 5', inferCost('/settings/filters', 'POST') === 5);
  // A fully qualified URL must price the same as the path, or quotaFetch's fallback
  // charges the default for every absolute call.
  check(
    'absolute URLs price identically',
    inferCost(`${API}/threads/abc`) === inferCost('/threads/abc'),
    `${inferCost(`${API}/threads/abc`)} vs ${inferCost('/threads/abc')}`
  );
}

// ---------------------------------------------------------------------------
// 2. Rate ceiling under realistic concurrent load
// ---------------------------------------------------------------------------

async function testRateCeiling() {
  console.log('\nRate ceiling under concurrent load');

  const spends: { at: number; cost: number }[] = [];
  const start = Date.now();

  (globalThis as any).fetch = async (_url: string, init: any) => {
    spends.push({ at: Date.now(), cost: Number(init?.headers?.['x-cost']) });
    await new Promise(r => setTimeout(r, 30)); // simulated network latency
    return fakeResponse(200, '{}');
  };

  const spend = (cost: number, label: string) =>
    quotaFetch(`${API}/${label}`, { headers: { 'x-cost': String(cost) } }, { cost, label });

  await Promise.all([
    // Inbox Health: eight counts in a Promise.all, each paging five times.
    ...Array.from({ length: 8 }, () => (async () => {
      for (let p = 0; p < 5; p++) await spend(5, 'messages');
    })()),
    // A routing sample: 200 thread reads, ten at a time.
    (async () => {
      for (let i = 0; i < 20; i++) {
        await Promise.all(Array.from({ length: 10 }, () => spend(10, 'threads')));
      }
    })(),
    // Metadata batches: 15 sub-requests each.
    (async () => {
      for (let i = 0; i < 12; i++) await spend(15 * 5, 'batch');
    })(),
  ]);

  // Peak spend across every sliding one-second window.
  let peak = 0;
  for (const s of spends) {
    const window = spends
      .filter(o => o.at > s.at - 1000 && o.at <= s.at)
      .reduce((a, b) => a + b.cost, 0);
    peak = Math.max(peak, window);
  }

  const total = spends.reduce((a, b) => a + b.cost, 0);
  const elapsed = (Date.now() - start) / 1000;
  const average = total / elapsed;

  check(
    'no one-second window exceeds Gmail\'s ceiling',
    peak <= GMAIL_CEILING,
    `peak ${peak} u/s, ceiling ${GMAIL_CEILING}`
  );
  check(
    'sustained rate holds the 150 u/s target',
    average > 120 && average < 165,
    `${average.toFixed(1)} u/s over ${elapsed.toFixed(1)}s (${spends.length} requests, ${total} units)`
  );
  check('every request was issued', spends.length === 252, `${spends.length} of 252`);
}

// ---------------------------------------------------------------------------
// 3. Throttle handling
// ---------------------------------------------------------------------------

async function testThrottleHandling() {
  console.log('\nThrottle handling');

  let calls = 0;
  const times: number[] = [];

  (globalThis as any).fetch = async (url: string) => {
    calls++;
    times.push(Date.now());
    // Gmail reports congestion as 403 with a rateLimitExceeded reason far more often
    // than it does 429. The old client threw on this instead of waiting.
    if (url.includes('congested') && calls < 3) {
      return fakeResponse(
        403,
        JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }], message: 'Rate Limit Exceeded' } }),
        { 'retry-after': '1' }
      );
    }
    if (url.includes('noscope')) {
      return fakeResponse(403, JSON.stringify({ error: { message: 'Request had insufficient authentication scopes.' } }));
    }
    return fakeResponse(200, '{"ok":true}');
  };

  const rateBefore = quotaState().rate;
  const congested = await quotaFetch(`${API}/congested`, {}, { cost: 5 });
  const rateAfterThrottle = quotaState().rate;

  check('403 rateLimitExceeded is retried to success', congested.status === 200, `${calls} attempts`);
  check(
    'Retry-After is honoured',
    times.length >= 3 && times[1] - times[0] >= 950 && times[2] - times[1] >= 950,
    `gaps ${times.slice(1).map((t, i) => `${t - times[i]}ms`).join(', ')}`
  );
  check(
    'a throttle slows the whole app, not just the caller',
    rateAfterThrottle < rateBefore,
    `${rateBefore} → ${rateAfterThrottle} u/s`
  );

  const beforeScopeTest = calls;
  const noscope = await quotaFetch(`${API}/noscope`, {}, { cost: 5 });
  const scopeAttempts = calls - beforeScopeTest;

  check('403 insufficient scopes is returned, not retried', noscope.status === 403);
  check('…on the first attempt', scopeAttempts === 1, `${scopeAttempts} attempt(s)`);

  // Additive recovery after a clean spell.
  await new Promise(r => setTimeout(r, 9000));
  await quotaFetch(`${API}/labels`, {}, { cost: 1 });
  check(
    'rate recovers once requests stop being refused',
    quotaState().rate > rateAfterThrottle,
    `${rateAfterThrottle} → ${quotaState().rate} u/s`
  );
}

async function main() {
  console.log('======================================================================');
  console.log('             GMAIL QUOTA GOVERNOR VERIFICATION                        ');
  console.log('======================================================================');

  testPricing();
  await testRateCeiling();
  await testThrottleHandling();

  console.log('\n======================================================================');
  if (failures === 0) {
    console.log('✅ ALL QUOTA GOVERNOR CHECKS PASSED');
    process.exit(0);
  } else {
    console.error(`❌ ${failures} QUOTA GOVERNOR CHECK(S) FAILED`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal error in quota governor test:', err);
  process.exit(1);
});
