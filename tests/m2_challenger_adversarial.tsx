// Must stay the first import: it installs the browser globals as a side effect,
// and firebase.ts caches its access token from sessionStorage at module scope.
import { stubGmail, messagePage } from './helpers/browserEnv';

import React from 'react';
import { renderToString } from 'react-dom/server';
import Dashboard from '../src/components/Dashboard';
import { EmailData, countEmails, processInChunks } from '../src/lib/gmail';
import * as fs from 'fs';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName} - ${details || ''}`);
    failed++;
    failures.push(`${testName}: ${details || ''}`);
  }
}

console.log('=== Milestone 2 (R2: Pagination, Counts, and Sorting) Adversarial Challenge Harness ===\n');

async function main() {

const dashboardCode = fs.readFileSync('src/components/Dashboard.tsx', 'utf-8');
const gmailCode = fs.readFileSync('src/lib/gmail.ts', 'utf-8');

// -------------------------------------------------------------
// Suite 1: Sorting Logic Implementation Verification in Source
// -------------------------------------------------------------
console.log('[Suite 1] Static Code Audit: Sorting Logic & Null-Safety');
{
  // Check useMemo wrapping sortedEmails
  assert(
    dashboardCode.includes('const sortedEmails = useMemo(() => {') &&
    dashboardCode.includes('[emails, sortBy, sortDesc]'),
    'sortedEmails is wrapped in useMemo with [emails, sortBy, sortDesc] dependencies'
  );

  // Check date comparator null-safety and NaN protection
  assert(
    dashboardCode.includes('a.date instanceof Date && !isNaN(a.date.getTime())') &&
    dashboardCode.includes('!isNaN(new Date(a.date).getTime())'),
    'Date comparator protects against invalid Date objects and unparseable date strings'
  );

  // Check size comparator null-safety
  assert(
    dashboardCode.includes('Number(a.sizeEstimate) || 0'),
    'Size comparator uses Number(a.sizeEstimate) || 0 for null/undefined/string safety'
  );

  // Check sender comparator null-safety and trimming/lowercasing
  assert(
    dashboardCode.includes("(a.sender || '').toLowerCase().trim()") &&
    dashboardCode.includes('.localeCompare('),
    'Sender comparator uses null fallback, lowercase trimming, and localeCompare'
  );
}

// -------------------------------------------------------------
// Suite 2: Pagination & Total Count Verification in Source
// -------------------------------------------------------------
console.log('\n[Suite 2] Static Code Audit: Pagination & Total Count');
{
  // countEmails, exercised rather than grepped.
  //
  // This previously asserted that gmail.ts contained the literal strings
  // `pages < 10` and `"5,000+"`. Both describe a contract the code has since
  // moved on from — the cap is COUNT_MAX_PAGES and the return type is a number —
  // and neither substring proved the pagination loop worked. These drive the real
  // function against a scripted transport instead.
  await (async () => {
    // A result set that fits in one page is counted exactly, in one request.
    const single = stubGmail(() => ({ body: messagePage(37) }));
    const exact = await countEmails('in:inbox');
    single.restore();
    assert(exact === 37, 'countEmails returns an exact count for a single-page result set', `got ${exact}`);
    assert(single.requests.length === 1, 'A single-page count costs exactly one request', `got ${single.requests.length}`);

    // Multi-page: it must follow nextPageToken and total every page.
    const pages = stubGmail((req) => {
      if (!req.pageToken) return { body: messagePage(500, 'p1') };
      if (req.pageToken === 'p1') return { body: messagePage(500, 'p2') };
      return { body: messagePage(120) };
    });
    const paged = await countEmails('in:anywhere');
    pages.restore();
    assert(paged === 1120, 'countEmails sums every page it walks', `got ${paged}`);
    assert(pages.requests.length === 3, 'countEmails stops as soon as a page has no nextPageToken', `got ${pages.requests.length}`);

    // Counting is unbounded by default now, so this exercises the opt-in probe: a
    // caller that passes maxPages gets a bounded walk with Gmail's estimate as a
    // floor. The stub never runs out of pages, which is exactly why it needs an
    // explicit bound — against a server that always claims another page, paging
    // forever is the correct behaviour, and this test used to rely on the ceiling
    // that no longer exists.
    const probePages = 4;
    const huge = stubGmail(() => ({ body: messagePage(500, 'more', 250_000) }));
    const bounded = await countEmails('in:anywhere', probePages);
    huge.restore();
    assert(huge.requests.length === probePages,
      `An explicit ${probePages}-page probe stops after ${probePages} requests`, `got ${huge.requests.length}`);
    assert(bounded >= probePages * 500,
      'A bounded probe never reports fewer messages than it counted', `got ${bounded}`);

    // A transport failure is absorbed, not propagated into the UI as a crash.
    const broken = stubGmail(() => ({ status: 500, body: { error: { message: 'boom' } } }));
    const failedCount = await countEmails('in:inbox');
    broken.restore();
    assert(failedCount === 0, 'countEmails degrades to 0 rather than throwing', `got ${failedCount}`);
  })();

  // Check encodeURIComponent on pageToken in countEmails
  assert(
    gmailCode.includes('pageToken=${encodeURIComponent(pageToken)}'),
    'countEmails properly URI encodes pageToken to prevent URL injection/malformation'
  );

  // Check searchIdRef race condition defense
  assert(
    dashboardCode.includes('searchIdRef = useRef(0)') &&
    dashboardCode.includes('if (searchIdRef.current !== searchId) return;'),
    'Dashboard employs searchIdRef to discard out-of-order responses from stale searches'
  );

  // Load More: the page cursor is encoded, and metadata is fetched in batches.
  //
  // The chunk size is a tuning constant, not a contract — asserting the literal 15
  // made a routine change look like a regression. What matters is that the cursor
  // is URI-encoded and that batching actually batches, so both are checked directly.
  assert(
    dashboardCode.includes('const handleLoadMore = async () => {') &&
    dashboardCode.includes('pageToken=${encodeURIComponent(currentToken)}'),
    'handleLoadMore pages with a URI-encoded pageToken'
  );

  await (async () => {
    const seen: number[] = [];
    let concurrent = 0;
    let peak = 0;
    const items = Array.from({ length: 47 }, (_, i) => i);
    const out = await processInChunks(items, 15, async (n: number) => {
      concurrent++;
      peak = Math.max(peak, concurrent);
      await Promise.resolve();
      seen.push(n);
      concurrent--;
      return n * 2;
    });
    assert(out.length === 47 && out[46] === 92,
      'processInChunks preserves order and length across an uneven final chunk',
      `len ${out.length}, last ${out[46]}`);
    assert(peak <= 15,
      'processInChunks never runs more than the chunk size at once', `peak ${peak}`);
  })();

  // Check deduplication when appending emails
  assert(
    dashboardCode.includes('existingIds = new Set(prev.map(e => e.id))') &&
    dashboardCode.includes('uniqueNew = validDetails.filter(e => !existingIds.has(e.id))'),
    'handleLoadMore deduplicates messages against existing IDs before appending'
  );
}

// -------------------------------------------------------------
// Suite 3: Header Count Formatting Matrix
// -------------------------------------------------------------
console.log('\n[Suite 3] Header Count Formatting Oracle Matrix');
{
  function getCountText(emailsLength: number, totalCount: number | string | null, isCounting: boolean, nextPageToken: string | null, selectedSize: number): string {
    if (selectedSize > 0) return `${selectedSize} selected`;
    if (emailsLength === 0) return `0 emails`;
    if (totalCount !== null) {
      if (typeof totalCount === 'number') {
        if (emailsLength < totalCount) {
          return `Showing ${emailsLength} of ${totalCount.toLocaleString()} emails`;
        } else {
          return `${emailsLength} emails`;
        }
      } else {
        return `Showing ${emailsLength} of ${totalCount} emails`;
      }
    }
    if (isCounting && nextPageToken) return `Showing ${emailsLength} emails...`;
    return `${emailsLength} emails`;
  }

  // 1. Zero emails
  assert(getCountText(0, null, false, null, 0) === '0 emails', '0 emails -> "0 emails"');
  assert(getCountText(0, 0, false, null, 0) === '0 emails', '0 loaded, totalCount=0 -> "0 emails"');

  // 2. Selected emails
  assert(getCountText(100, 500, false, 'tok', 5) === '5 selected', '5 selected -> "5 selected"');
  assert(getCountText(100, '5,000+', false, 'tok', 1) === '1 selected', '1 selected -> "1 selected"');

  // 3. Counting in progress with nextPageToken
  assert(getCountText(100, null, true, 'tok', 0) === 'Showing 100 emails...', 'isCounting with nextPageToken -> "Showing 100 emails..."');

  // 4. Exact count resolved > loaded
  assert(getCountText(100, 3450, false, 'tok', 0) === 'Showing 100 of 3,450 emails', '100 loaded of 3450 total -> "Showing 100 of 3,450 emails"');
  assert(getCountText(200, 3450, false, 'tok', 0) === 'Showing 200 of 3,450 emails', '200 loaded of 3450 total -> "Showing 200 of 3,450 emails"');

  // 5. Exact count resolved == loaded
  assert(getCountText(42, 42, false, null, 0) === '42 emails', '42 loaded of 42 total -> "42 emails"');

  // 6. Capped count 5,000+
  assert(getCountText(100, '5,000+', false, 'tok', 0) === 'Showing 100 of 5,000+ emails', '100 loaded of 5,000+ -> "Showing 100 of 5,000+ emails"');
  assert(getCountText(300, '5,000+', false, 'tok', 0) === 'Showing 300 of 5,000+ emails', '300 loaded of 5,000+ -> "Showing 300 of 5,000+ emails"');
}

// -------------------------------------------------------------
// Suite 4: Adversarial Email Item Formatting & Rendering
// -------------------------------------------------------------
console.log('\n[Suite 4] Adversarial Email Item Formatting & Rendering');
{
  const testCases: { sender: string; expectedDisplay: string }[] = [
    { sender: 'Google Security <no-reply@accounts.google.com>', expectedDisplay: 'Google Security' },
    { sender: 'Alice Cooper <alice@cooper.net>', expectedDisplay: 'Alice Cooper' },
    { sender: '<solo@domain.com>', expectedDisplay: '<solo@domain.com>' },
    { sender: 'plain_address@domain.com', expectedDisplay: 'plain_address@domain.com' },
    { sender: '', expectedDisplay: '' },
    { sender: '   ', expectedDisplay: '   ' },
    { sender: '🔥 Newsletter <news@domain.com>', expectedDisplay: '🔥 Newsletter' },
  ];

  for (const tc of testCases) {
    const displayed = tc.sender.replace(/<.*>/, "").trim() || tc.sender;
    assert(displayed === tc.expectedDisplay, `Sender display for "${tc.sender}" -> "${displayed}"`);
  }
}

// -------------------------------------------------------------
// Suite 5: Full Component SSR Render Validation
// -------------------------------------------------------------
console.log('\n[Suite 5] Full Component SSR Render Verification');
{
  const mockUser = {
    displayName: 'Adversarial Tester',
    email: 'tester@example.com',
    photoURL: 'https://example.com/avatar.png'
  };

  try {
    const html = renderToString(<Dashboard user={mockUser} />);
    assert(html.length > 500, 'Dashboard renders successfully via SSR without throwing');
    assert(html.includes('Date') && html.includes('Size') && html.includes('Sender'), 'Sort dropdown options (Date, Size, Sender) are rendered in markup');
    assert(html.includes('Toggle sort direction') || html.includes('rotate-180') || html.includes('Filter'), 'Sort direction toggle controls are present in markup');
    assert(html.includes('0 emails'), 'Initial empty state shows "0 emails"');
  } catch (err: any) {
    assert(false, 'Dashboard SSR render', `Threw error: ${err.message}`);
  }
}

// -------------------------------------------------------------
// Summary
// -------------------------------------------------------------
console.log('\n========================================');
console.log(`Milestone 2 Challenge Harness: ${passed} PASSED, ${failed} FAILED`);
console.log('========================================\n');

if (failed > 0) {
  console.error('FAILURES:');
  failures.forEach(f => console.error(`  - ${f}`));
  process.exit(1);
} else {
  console.log('ALL ADVERSARIAL CHALLENGE TESTS PASSED!');
  process.exit(0);
}
}

main().catch(err => {
  console.error('Fatal error in adversarial harness:', err);
  process.exit(1);
});
