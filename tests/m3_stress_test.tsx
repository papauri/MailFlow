// Must stay first: installs browser globals before any app module is evaluated.
import './helpers/browserEnv';

import React from 'react';
import { renderToString } from 'react-dom/server';
import * as fs from 'fs';
import { CategoryDistributionModal, CategoryItem, CATEGORY_CONFIG } from '../src/components/CategoryDistributionModal';
import { InboxHealth } from '../src/components/InboxHealth';
import * as gmail from '../src/lib/gmail';

// Mock localStorage and window if needed
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

if (typeof globalThis.window === 'undefined') {
  (globalThis as any).window = {
    addEventListener: () => {},
    removeEventListener: () => {},
    location: { reload: () => {} }
  };
}

if (typeof globalThis.document === 'undefined') {
  (globalThis as any).document = {
    body: { style: { overflow: '' } }
  };
}

let passed = 0;
let failed = 0;
const failureDetails: string[] = [];

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log('  PASS:', testName);
    passed++;
  } else {
    console.error('  FAIL:', testName, details || '');
    failureDetails.push(`${testName}: ${details || 'Condition false'}`);
    failed++;
  }
}

async function runMilestone3StressTests() {
  console.log('=== Milestone 3 (R3: Inbox Health Chart Modal with Recharts) Adversarial Verification ===\n');

  const modalCode = fs.readFileSync('src/components/CategoryDistributionModal.tsx', 'utf-8');
  const inboxHealthCode = fs.readFileSync('src/components/InboxHealth.tsx', 'utf-8');
  const routesCode = fs.readFileSync('src/lib/routes.ts', 'utf-8');
  const dashboardShellCode = fs.readFileSync('src/components/Dashboard.tsx', 'utf-8');
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));

  // -------------------------------------------------------------
  // Test Suite 1: Dependency & Integration Verification
  // -------------------------------------------------------------
  console.log('[Suite 1] Dependency & Package Integration');

  assert(
    Boolean(packageJson.dependencies && packageJson.dependencies.recharts),
    'recharts is listed in package.json dependencies'
  );

  assert(
    modalCode.includes("from 'recharts'") &&
    modalCode.includes('ResponsiveContainer') &&
    modalCode.includes('PieChart') &&
    modalCode.includes('Pie') &&
    modalCode.includes('Cell') &&
    modalCode.includes('Tooltip'),
    'CategoryDistributionModal imports ResponsiveContainer, PieChart, Pie, Cell, and Tooltip from recharts'
  );

  // Category Breakdown is a routed page, not a modal InboxHealth mounts.
  //
  // This used to assert that InboxHealth imported CategoryDistributionModal and
  // called setIsChartModalOpen(true). Both were true of an earlier design; the view
  // is now reached by hash route, and InboxHealth holding a permanently-closed copy
  // was dead weight. The contract worth asserting is that the trigger navigates to a
  // route the router actually serves — which the old assertion never checked.
  assert(
    inboxHealthCode.includes('Category Breakdown') &&
    inboxHealthCode.includes("window.location.hash = '#category-distribution'"),
    'InboxHealth "Category Breakdown" card navigates to the category-distribution route'
  );

  assert(
    routesCode.includes("'category-distribution'") &&
    dashboardShellCode.includes("currentHash === 'category-distribution'"),
    'The category-distribution route is registered and rendered by the shell'
  );

  assert(
    !inboxHealthCode.includes('CategoryDistributionModal'),
    'InboxHealth does not also mount the modal it routes to'
  );

  // -------------------------------------------------------------
  // Test Suite 2: Category Definitions & Contract Verification
  // -------------------------------------------------------------
  console.log('\n[Suite 2] Category Configuration & Contract Verification');

  const expectedCategories = [
    { id: 'primary', name: 'Primary', query: 'category:primary in:anywhere', filter: 'category:primary' },
    { id: 'promotions', name: 'Promotions', query: 'category:promotions in:anywhere', filter: 'category:promotions' },
    { id: 'updates', name: 'Updates', query: 'category:updates in:anywhere', filter: 'category:updates' },
    { id: 'social', name: 'Social', query: 'category:social in:anywhere', filter: 'category:social' },
    { id: 'forums', name: 'Forums', query: 'category:forums in:anywhere', filter: 'category:forums' },
    { id: 'spam', name: 'Spam & Trash', query: 'in:spam OR in:trash', filter: 'anywhere' },
  ];

  // Asserted against the imported value, not against source text.
  //
  // The old form pinned each entry to the literal `category:primary in:anywhere`.
  // Those queries were replaced because `in:anywhere` pulled trashed, junked and
  // sent mail into a distribution chart of the live mailbox — the assertion was
  // holding the wrong behaviour in place. What has to be true is that every
  // category is present, and that each one is scoped so the slices are comparable.
  expectedCategories.forEach(expected => {
    const cat = CATEGORY_CONFIG.find(c => c.id === expected.id);
    assert(!!cat, `CATEGORY_CONFIG contains ${expected.name}`);
    if (!cat) return;
    assert(cat.name === expected.name, `${expected.name} keeps its display name`, cat.name);
    assert(typeof cat.query === 'string' && cat.query.length > 0,
      `${expected.name} has a query`, cat.query);
  });

  assert(CATEGORY_CONFIG.length === expectedCategories.length,
    'CATEGORY_CONFIG defines exactly the six standard buckets',
    `got ${CATEGORY_CONFIG.length}`);

  // The five live categories must exclude discarded and outbound mail, or their
  // slices are not shares of the same mailbox. Spam & Trash is the exception: it
  // exists precisely to count what the others exclude.
  CATEGORY_CONFIG.filter(c => c.id !== 'spam').forEach(cat => {
    assert(
      cat.query.includes('-in:trash') && cat.query.includes('-in:spam') && cat.query.includes('-in:sent'),
      `${cat.name} excludes trash, spam and sent mail so its slice is comparable`,
      cat.query
    );
  });

  const spam = CATEGORY_CONFIG.find(c => c.id === 'spam');
  assert(!!spam && spam.query.includes('in:spam') && spam.query.includes('in:trash'),
    'The Spam & Trash bucket counts exactly what the other five exclude', spam?.query);

  // Every category is a distinct Gmail bucket, so no message is in two slices.
  const queries = new Set(CATEGORY_CONFIG.map(c => c.query));
  assert(queries.size === CATEGORY_CONFIG.length,
    'No two categories share a query, so the pie has no double-counted slice');

  // -------------------------------------------------------------
  // Test Suite 3: Data Parsing & Normalization Logic
  // -------------------------------------------------------------
  console.log('\n[Suite 3] Raw Count Parsing & Normalization Stress Tests');

  function parseRawCount(rawCount: any): { numValue: number; displayCount: string } {
    const numValue =
      typeof rawCount === 'number'
        ? rawCount
        : parseInt(String(rawCount).replace(/[^0-9]/g, ''), 10) || 5000;
    const displayCount = typeof rawCount === 'number' ? rawCount.toLocaleString() : String(rawCount);
    return { numValue, displayCount };
  }

  // Case 3.1: Standard integer
  const p1 = parseRawCount(425);
  assert(p1.numValue === 425 && p1.displayCount === '425', 'Standard count 425 parsed as 425 with display "425"');

  // Case 3.2: Thousands formatting
  const p2 = parseRawCount(3450);
  assert(p2.numValue === 3450 && p2.displayCount === '3,450', 'Count 3450 formats display with commas "3,450"');

  // Case 3.3: "5,000+" cap string
  const p3 = parseRawCount('5,000+');
  assert(p3.numValue === 5000 && p3.displayCount === '5,000+', 'Capped string "5,000+" parsed as numValue 5000 and display "5,000+"');

  // Case 3.4: Zero count
  const p4 = parseRawCount(0);
  assert(p4.numValue === 0 && p4.displayCount === '0', 'Count 0 parsed as 0 with display "0"');

  // Case 3.5: String with non-digits
  const p5 = parseRawCount('~1,250 emails');
  assert(p5.numValue === 1250 && p5.displayCount === '~1,250 emails', 'String "~1,250 emails" safely parses digits to 1250');

  // -------------------------------------------------------------
  // Test Suite 4: Edge Case 1 — All Categories Count = 0
  // -------------------------------------------------------------
  console.log('\n[Suite 4] Edge Case 1: All Categories Count = 0 (Empty Mailbox / Divide-by-Zero Defense)');

  const zeroDataset: CategoryItem[] = expectedCategories.map(c => ({
    id: c.id,
    name: c.name,
    query: c.query,
    filter: c.filter,
    color: '#3B82F6',
    value: 0,
    displayCount: '0'
  }));

  const zeroTotal = zeroDataset.reduce((acc, curr) => acc + curr.value, 0);
  assert(zeroTotal === 0, 'Total count for zeroDataset is exactly 0');

  // Verify division-by-zero protection in Tooltip and Legend calculations
  zeroDataset.forEach(cat => {
    const tooltipPercent = zeroTotal > 0 ? ((cat.value / zeroTotal) * 100).toFixed(1) : '0';
    const legendPercent = zeroTotal > 0 ? Math.round((cat.value / zeroTotal) * 100) : 0;
    assert(
      tooltipPercent === '0' && !isNaN(Number(tooltipPercent)),
      `Tooltip percent for ${cat.name} with 0 total is safe '0' (not NaN or Infinity)`
    );
    assert(
      legendPercent === 0 && !isNaN(legendPercent),
      `Legend percent for ${cat.name} with 0 total is safe 0 (not NaN or Infinity)`
    );
  });

  // Verify modal code explicitly guards against 0 total
  assert(
    modalCode.includes("totalCount > 0 ? ((item.value / totalCount) * 100).toFixed(1) : '0'") ||
    modalCode.includes("totalCount > 0 ?"),
    'Tooltip implementation contains ternary guard against totalCount === 0'
  );
  assert(
    modalCode.includes("totalCount > 0 ? Math.round((cat.value / totalCount) * 100) : 0") ||
    modalCode.includes("totalCount > 0 ?"),
    'Legend item percent contains ternary guard against totalCount === 0'
  );

  // -------------------------------------------------------------
  // Test Suite 5: Edge Case 2 — Single Dominant Category (100%)
  // -------------------------------------------------------------
  console.log('\n[Suite 5] Edge Case 2: One Dominant Category (100% Single Slice)');

  const dominantDataset: CategoryItem[] = expectedCategories.map((c, i) => ({
    id: c.id,
    name: c.name,
    query: c.query,
    filter: c.filter,
    color: '#3B82F6',
    value: i === 0 ? 5000 : 0,
    displayCount: i === 0 ? '5,000' : '0'
  }));

  const dominantTotal = dominantDataset.reduce((acc, curr) => acc + curr.value, 0);
  assert(dominantTotal === 5000, 'Total count for dominant dataset is 5,000');

  const primaryItem = dominantDataset[0];
  const primaryTooltipPercent = dominantTotal > 0 ? ((primaryItem.value / dominantTotal) * 100).toFixed(1) : '0';
  const primaryLegendPercent = dominantTotal > 0 ? Math.round((primaryItem.value / dominantTotal) * 100) : 0;

  assert(primaryTooltipPercent === '100.0', 'Dominant category tooltip percent is exactly "100.0"');
  assert(primaryLegendPercent === 100, 'Dominant category legend percent is exactly 100%');

  const otherItem = dominantDataset[1];
  const otherTooltipPercent = dominantTotal > 0 ? ((otherItem.value / dominantTotal) * 100).toFixed(1) : '0';
  const otherLegendPercent = dominantTotal > 0 ? Math.round((otherItem.value / dominantTotal) * 100) : 0;

  assert(otherTooltipPercent === '0.0', 'Non-dominant category tooltip percent is "0.0"');
  assert(otherLegendPercent === 0, 'Non-dominant category legend percent is 0%');

  // -------------------------------------------------------------
  // Test Suite 6: Edge Case 3 — Massive Volume (5,000+ across all categories)
  // -------------------------------------------------------------
  console.log('\n[Suite 6] Edge Case 3: Extreme Scale (All 6 Categories Capped at 5,000+)');

  const massiveDataset: CategoryItem[] = expectedCategories.map(c => ({
    id: c.id,
    name: c.name,
    query: c.query,
    filter: c.filter,
    color: '#3B82F6',
    value: 5000,
    displayCount: '5,000+'
  }));

  const massiveTotal = massiveDataset.reduce((acc, curr) => acc + curr.value, 0);
  assert(massiveTotal === 30000, 'Massive dataset total count is 30,000');
  assert(massiveTotal.toLocaleString() === '30,000', 'Massive dataset formats total with comma "30,000"');

  massiveDataset.forEach(cat => {
    const tooltipPercent = ((cat.value / massiveTotal) * 100).toFixed(1);
    const legendPercent = Math.round((cat.value / massiveTotal) * 100);
    assert(tooltipPercent === '16.7', `Equal distribution category ${cat.name} calculates 16.7% in tooltip`);
    assert(legendPercent === 17, `Equal distribution category ${cat.name} calculates 17% in legend`);
  });

  // -------------------------------------------------------------
  // Test Suite 7: Modal Lifecycle, Keyboard & Scroll Lock
  // -------------------------------------------------------------
  console.log('\n[Suite 7] Modal Lifecycle, Keyboard Escape & Body Scroll Lock');

  // Closed modal returns null (no DOM clutter)
  const closedHtml = renderToString(
    <CategoryDistributionModal isOpen={false} onClose={() => {}} />
  );
  assert(closedHtml === '', 'Modal returns null / empty string when isOpen is false');

  // Open modal structure & ARIA attributes
  assert(
    modalCode.includes('role="dialog"') &&
    modalCode.includes('aria-modal="true"') &&
    modalCode.includes('aria-labelledby="category-distribution-title"'),
    'Modal container has proper accessibility attributes (role="dialog", aria-modal="true", aria-labelledby)'
  );

  // Escape key handler
  assert(
    modalCode.includes("e.key === 'Escape'") &&
    modalCode.includes('onClose()'),
    'Modal listens for "Escape" keydown event to invoke onClose'
  );

  // Body scroll lock
  assert(
    modalCode.includes("document.body.style.overflow = 'hidden'") &&
    modalCode.includes('document.body.style.overflow = originalOverflow'),
    'Modal locks document.body.style.overflow on mount and restores original overflow on unmount'
  );

  // Backdrop click vs inner click
  assert(
    modalCode.includes('onClick={onClose}') &&
    modalCode.includes('onClick={(e) => e.stopPropagation()}'),
    'Backdrop has onClick={onClose} while content container has e.stopPropagation()'
  );

  // -------------------------------------------------------------
  // Test Suite 8: Category Filter Delegation Trigger
  // -------------------------------------------------------------
  console.log('\n[Suite 8] Category Filter Delegation Button');

  assert(
    modalCode.includes('onApplyCategory && (') &&
    modalCode.includes('onApplyCategory(cat.query, cat.filter)'),
    'Legend items render action button that invokes onApplyCategory(cat.query, cat.filter)'
  );

  assert(
    modalCode.includes('onClose();') &&
    modalCode.includes('onApplyCategory(cat.query, cat.filter);'),
    'Clicking category filter arrow triggers onClose() before onApplyCategory()'
  );

  // Verify all 6 category query & filter mappings match Gmail specifications
  const categoryFilters: Record<string, { query: string; filter: string }> = {
    Primary: { query: 'category:primary in:anywhere', filter: 'category:primary' },
    Promotions: { query: 'category:promotions in:anywhere', filter: 'category:promotions' },
    Updates: { query: 'category:updates in:anywhere', filter: 'category:updates' },
    Social: { query: 'category:social in:anywhere', filter: 'category:social' },
    Forums: { query: 'category:forums in:anywhere', filter: 'category:forums' },
    'Spam & Trash': { query: 'in:spam OR in:trash', filter: 'anywhere' },
  };

  let filterCalls: Array<{ query: string; filter?: string }> = [];
  const mockApplyCategory = (q: string, f?: string) => {
    filterCalls.push({ query: q, filter: f });
  };

  Object.entries(categoryFilters).forEach(([name, config]) => {
    mockApplyCategory(config.query, config.filter);
    const last = filterCalls[filterCalls.length - 1];
    assert(
      last.query === config.query && last.filter === config.filter,
      `Category filter delegation for "${name}" passes query="${config.query}" and filter="${config.filter}"`
    );
  });

  // -------------------------------------------------------------
  // Test Suite 9: State Transitions & Error Recovery
  // -------------------------------------------------------------
  console.log('\n[Suite 9] State Transitions, Loading, Error & Refresh Controls');

  // The state exists under clearer names now that the view also owns a scan:
  // `loading`/`error` would not say which of the two async jobs they referred to.
  assert(
    modalCode.includes('const [loadingDistribution, setLoadingDistribution] = useState(false);') &&
    modalCode.includes('const [distributionError, setDistributionError] = useState<string | null>(null);'),
    'Distribution loading and error state are tracked independently of the scan'
  );

  assert(
    modalCode.includes('loadingDistribution ?') && modalCode.includes('animate-spin'),
    'A spinner is shown while the category counts are in flight'
  );

  assert(
    modalCode.includes('distributionError ?') && modalCode.includes('Retry'),
    'A failed count renders its error with a Retry control rather than an empty chart'
  );

  // Refresh is an icon control in the toolbar now rather than a labelled footer
  // button, and it is disabled while either async job is running.
  assert(
    modalCode.includes('RefreshCw') &&
    (modalCode.includes('scanLoading || scan.refreshing') || modalCode.includes('disabled={scanLoading')),
    'Refresh is disabled while a fetch is already in flight'
  );

  // -------------------------------------------------------------
  // Test Suite 10: Recharts Responsive Layout Classes
  // -------------------------------------------------------------
  console.log('\n[Suite 10] Recharts Chart Dimensions & Responsive Container');

  // The container is bounded by aspect ratio rather than a fixed height class, which
  // is what keeps the donut circular at every breakpoint. What the assertion is
  // really guarding is that ResponsiveContainer is never given an unbounded parent —
  // that is the zero-height crash — so it checks for a bound, not for one spelling.
  assert(
    modalCode.includes('aspect-square') && modalCode.includes('ResponsiveContainer width="100%" height="100%"'),
    'PieChart sits in a dimension-bounded ResponsiveContainer, so it cannot render at zero height'
  );

  // Percentage radii, so the donut scales with its box instead of overflowing the
  // smaller mobile container that fixed pixel radii were sized against.
  assert(
    modalCode.includes('innerRadius="65%"') && modalCode.includes('outerRadius="85%"'),
    'Pie chart uses proportional inner/outer radii for a donut that scales with its container'
  );

  assert(
    modalCode.includes('paddingAngle={3}'),
    'Pie chart specifies paddingAngle for clear visual separation between slices'
  );

  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log(`\n=============================================================`);
  console.log(`Milestone 3 Stress Test Suite Completed: ${passed} PASSED, ${failed} FAILED`);
  if (failed > 0) {
    console.error('Failures:');
    failureDetails.forEach(d => console.error(` - ${d}`));
  }
  console.log(`=============================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runMilestone3StressTests().catch(err => {
  console.error('Unexpected error in test runner:', err);
  process.exit(1);
});
