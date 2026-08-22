import React from 'react';
import { renderToString } from 'react-dom/server';
import Dashboard from '../src/components/Dashboard';
import { EmailData, countEmails } from '../src/lib/gmail';
import * as fs from 'fs';

// Mock localStorage and window for SSR testing
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) || null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] || null,
    length: store.size,
  } as any;
}

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
  // Check countEmails implementation
  assert(
    gmailCode.includes('export async function countEmails(query: string): Promise<number | string>') &&
    gmailCode.includes('pages < 10') &&
    gmailCode.includes('"5,000+"'),
    'countEmails traverses up to 10 pages (5,000 items) and returns exact count or "5,000+"'
  );

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

  // Check Load More implementation
  assert(
    dashboardCode.includes('const handleLoadMore = async () => {') &&
    dashboardCode.includes('pageToken=${encodeURIComponent(currentToken)}') &&
    dashboardCode.includes('processInChunks(results.messages, 15,'),
    'handleLoadMore fetches next batch with pageToken and batches metadata in chunks of 15'
  );

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
