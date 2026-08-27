// Must stay first: installs browser globals before any app module is evaluated.
import './helpers/browserEnv';

import React from 'react';
import { renderToString } from 'react-dom/server';
import * as fs from 'fs';
import * as path from 'path';
import { countEmails, processInChunks, EmailData, fetchGmailAPI } from '../src/lib/gmail';
import Dashboard from '../src/components/Dashboard';
import { InboxHealth } from '../src/components/InboxHealth';
import { CategoryDistributionModal, CATEGORY_CONFIG } from '../src/components/CategoryDistributionModal';
import LoginScreen from '../src/components/LoginScreen';
import App from '../src/App';
import * as recharts from 'recharts';

// Initialize mock environment
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
const violations: string[] = [];

function check(condition: boolean, testName: string, failureDetail?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [VIOLATION] ${testName} - ${failureDetail || 'Assertion failed'}`);
    failed++;
    violations.push(`${testName}: ${failureDetail || 'Assertion failed'}`);
  }
}

async function runForensicIntegrityAudit() {
  console.log('======================================================================');
  console.log('       FORENSIC INTEGRITY AUDIT — MILESTONE 4 (FINAL E2E)');
  console.log('======================================================================\n');

  const srcDir = path.resolve('src');
  const files = [
    'src/App.tsx',
    'src/main.tsx',
    'src/index.css',
    'src/components/Dashboard.tsx',
    'src/components/InboxHealth.tsx',
    'src/components/CategoryDistributionModal.tsx',
    'src/components/LoginScreen.tsx',
    'src/lib/gmail.ts',
    'src/lib/firebase.ts',
    'src/lib/utils.ts',
    'src/lib/routes.ts'
  ];

  const contents: Record<string, string> = {};
  files.forEach(f => {
    contents[f] = fs.readFileSync(f, 'utf-8');
  });

  // -------------------------------------------------------------
  // 1. FORENSIC CHECK 1: Hardcoded Test Results & Facade Detection
  // -------------------------------------------------------------
  console.log('[SECTION 1] Hardcoded Test Results & Facade Detection');

  // Check 1.1: No hardcoded return values in countEmails
  const gmailCode = contents['src/lib/gmail.ts'];
  check(
    !gmailCode.includes('return 42;') && !gmailCode.includes('return 100;') && !gmailCode.includes('return 3450;'),
    'gmail.ts countEmails does not contain hardcoded return numbers'
  );
  // The bound moved from 10 pages to COUNT_MAX_PAGES and the return type from a
  // "5,000+" string to a number. An audit that pins the old literals reports a
  // deliberate improvement as a violation, which is exactly the false signal this
  // suite exists to avoid — so it checks the loop is real and bounded, by name.
  check(
    gmailCode.includes('total += res.messages.length') &&
    gmailCode.includes('page < COUNT_MAX_PAGES') &&
    gmailCode.includes('resultSizeEstimate'),
    'gmail.ts countEmails implements a bounded pagination loop with an estimate fallback'
  );
  check(
    /export const COUNT_MAX_PAGES = \d+/.test(gmailCode),
    'The pagination bound is a named exported constant, not a magic number'
  );

  // Check 1.2: No facade functions or empty stubs in components
  const modalCode = contents['src/components/CategoryDistributionModal.tsx'];
  check(
    !modalCode.includes('return <div>Mock Chart</div>') && !modalCode.includes('return null; // TODO'),
    'CategoryDistributionModal is not a facade/stub'
  );

  // Check 1.3: Real Recharts elements used in CategoryDistributionModal
  check(
    modalCode.includes('<ResponsiveContainer') &&
    modalCode.includes('<PieChart') &&
    modalCode.includes('<Pie') &&
    modalCode.includes('<Cell') &&
    modalCode.includes('<Tooltip'),
    'CategoryDistributionModal renders authentic Recharts SVG components (ResponsiveContainer, PieChart, Pie, Cell, Tooltip)'
  );

  // -------------------------------------------------------------
  // 2. FORENSIC CHECK 2: Requirement 1 — Mobile Responsive Design (Tailwind CSS)
  // -------------------------------------------------------------
  console.log('\n[SECTION 2] Requirement 1 — Mobile Responsive Design (Tailwind CSS)');

  const dashCode = contents['src/components/Dashboard.tsx'];
  const inboxCode = contents['src/components/InboxHealth.tsx'];

  // Check 2.1: Dashboard header mobile adaptability
  check(
    /px-\d(\.\d)? sm:px-\d/.test(dashCode) && dashCode.includes('hidden sm:inline'),
    'Dashboard header scales its padding and hides non-essential labels on small viewports'
  );

  // Check 2.2: Search filter bar horizontal touch strip
  // The `-mx-3.5 px-3.5 sm:mx-0 sm:px-0` edge-to-edge spelling is gone; the strip
  // uses ordinary padding now. What has to remain true is that it scrolls sideways
  // without putting a scrollbar over the content.
  check(
    dashCode.includes('overflow-x-auto no-scrollbar'),
    'Search filter bar is a horizontally scrollable strip with no visible scrollbar'
  );

  // Check 2.3: Toolbar responsiveness & dual sort selectors
  // Sorting is one adaptive control now rather than two duplicated dropdowns hidden
  // at opposite breakpoints, so `flex sm:hidden` + `hidden sm:flex` no longer both
  // exist — the duplication they asserted was the thing that got removed.
  check(
    dashCode.includes('flex-col sm:flex-row') && dashCode.includes('sortBy'),
    'Email toolbar stacks on mobile and carries a sort control'
  );

  // Check 2.4: Email item rows truncate gracefully
  check(
    dashCode.includes('truncate') &&
    dashCode.includes('min-w-0') &&
    dashCode.includes('flex-1'),
    'Email list items prevent horizontal blowout using flex-1 min-w-0 and truncate classes'
  );

  // Check 2.5: BYOK modal viewport scaling
  check(
    dashCode.includes('max-h-[85vh] sm:max-h-[90vh]') &&
    dashCode.includes('overscroll-contain') &&
    dashCode.includes('grid-cols-2 sm:grid-cols-4'),
    'BYOK modal scales within 85vh on mobile and adjusts provider grid between 2 and 4 columns'
  );

  // Check 2.6: InboxHealth layout responsiveness
  // Inbox Health was rebuilt around routed cards; it has no quick-filter strip to
  // scroll, and its card ladder is spelled with grid-cols rather than flex-then-grid.
  check(
    /grid-cols-1 sm:grid-cols-2 lg:grid-cols-4/.test(inboxCode) &&
    /grid-cols-1 md:grid-cols-2/.test(inboxCode),
    'InboxHealth cards widen from one column through tablet to desktop'
  );

  // -------------------------------------------------------------
  // 3. FORENSIC CHECK 3: Requirement 2 — Pagination, Counts, and Sorting
  // -------------------------------------------------------------
  console.log('\n[SECTION 3] Requirement 2 — Pagination, Counts, and Sorting');

  // Check 3.1: nextPageToken extraction & Load More button
  check(
    dashCode.includes('setNextPageToken(results.nextPageToken || null)') &&
    dashCode.includes('const handleLoadMore = async () => {') &&
    dashCode.includes('{nextPageToken && ('),
    'Dashboard tracks nextPageToken from Gmail REST API and renders Load More button conditionally'
  );

  // Check 3.2: Message deduplication upon page appending
  check(
    dashCode.includes('const existingIds = new Set(prev.map(e => e.id));') &&
    dashCode.includes('const uniqueNew = validDetails.filter(e => !existingIds.has(e.id));') &&
    dashCode.includes('return [...prev, ...uniqueNew];'),
    'handleLoadMore deduplicates incoming email batches against existing loaded IDs'
  );

  // Check 3.3: Concurrent count calculation up to 5,000 cap
  check(
    dashCode.includes('countEmails(q)') &&
    dashCode.includes('setTotalCount(count)') &&
    dashCode.includes('searchIdRef.current === searchId'),
    'Dashboard triggers countEmails concurrently on search with searchIdRef race condition defense'
  );

  // Check 3.4: In-memory sorting on visible loaded emails
  check(
    dashCode.includes('const sortedEmails = useMemo(() => {') &&
    dashCode.includes('sortBy === "date"') &&
    dashCode.includes('sortBy === "size"') &&
    dashCode.includes('sortBy === "sender"'),
    'sortedEmails operates strictly on in-memory loaded emails with date, size, and sender comparators'
  );

  // Check 3.5: Null-safe comparators for edge cases
  const sampleData: EmailData[] = [
    { id: '1', threadId: 't1', snippet: '', date: new Date('2026-03-01'), sender: 'Bob <bob@test.com>', subject: 'S1', labelIds: [], sizeEstimate: 1000 },
    { id: '2', threadId: 't2', snippet: '', date: new Date('invalid'), sender: '', subject: 'S2', labelIds: [], sizeEstimate: undefined },
    { id: '3', threadId: 't3', snippet: '', date: new Date('2026-05-01'), sender: 'Alice <alice@test.com>', subject: 'S3', labelIds: [], sizeEstimate: 50000 },
  ];

  // Execute actual comparator logic from Dashboard.tsx
  const sortBySender = [...sampleData].sort((a, b) => {
    const senderA = (a.sender || '').toLowerCase().trim();
    const senderB = (b.sender || '').toLowerCase().trim();
    return senderA.localeCompare(senderB);
  });
  check(sortBySender[0].id === '2' && sortBySender[1].id === '3' && sortBySender[2].id === '1', 'Sender sort handles empty strings and names cleanly');

  const sortBySize = [...sampleData].sort((a, b) => (Number(b.sizeEstimate) || 0) - (Number(a.sizeEstimate) || 0));
  check(sortBySize[0].id === '3' && sortBySize[1].id === '1' && sortBySize[2].id === '2', 'Size sort handles undefined sizeEstimate cleanly');

  const sortByDate = [...sampleData].sort((a, b) => {
    const timeA = a.date instanceof Date && !isNaN(a.date.getTime()) ? a.date.getTime() : 0;
    const timeB = b.date instanceof Date && !isNaN(b.date.getTime()) ? b.date.getTime() : 0;
    return timeB - timeA;
  });
  check(sortByDate[0].id === '3' && sortByDate[1].id === '1' && sortByDate[2].id === '2', 'Date sort handles invalid Date objects cleanly');

  // -------------------------------------------------------------
  // 4. FORENSIC CHECK 4: Requirement 3 — Inbox Health Chart Modal (Recharts)
  // -------------------------------------------------------------
  console.log('\n[SECTION 4] Requirement 3 — Inbox Health Chart Modal (Recharts)');

  // Check 4.1: Trigger button in InboxHealth
  check(
    inboxCode.includes('Category Breakdown') &&
    inboxCode.includes("window.location.hash = '#category-distribution'"),
    'InboxHealth features a "Category Breakdown" trigger that routes to the page'
  );

  // Check 4.2: Modal component wiring
  // Category Breakdown became a routed page, so InboxHealth no longer holds a
  // permanently-closed instance of it. Mounting one and never opening it is dead
  // weight, so the audit now checks the opposite: that it is not mounted here, and
  // that the route it points at is actually served.
  check(
    !inboxCode.includes('<CategoryDistributionModal'),
    'InboxHealth does not mount a modal copy of the page it routes to'
  );
  check(
    contents['src/lib/routes.ts'].includes("'category-distribution'"),
    'The category-distribution route is registered'
  );

  // Check 4.3: Gmail category queries
  // Checked against the exported value. The old literals used `in:anywhere`, which
  // pulled trashed, junked and sent mail into a chart of the live mailbox — an audit
  // holding those strings in place was protecting the defect.
  const configuredIds = CATEGORY_CONFIG.map(c => c.id).sort();
  check(
    JSON.stringify(configuredIds) === JSON.stringify(['forums', 'primary', 'promotions', 'social', 'spam', 'updates']),
    'Modal configures all 6 standard Gmail category buckets',
    configuredIds.join(',')
  );
  check(
    CATEGORY_CONFIG.filter(c => c.id !== 'spam')
      .every(c => c.query.includes('-in:trash') && c.query.includes('-in:spam') && c.query.includes('-in:sent')),
    'Every live category excludes discarded and sent mail, so the slices are comparable'
  );

  // Check 4.4: Active slices, Tooltip, and Legends
  // The dimming factor was retuned from 0.6 to 0.4; pinning the literal made a
  // contrast tweak read as a missing feature.
  check(
    modalCode.includes('setActiveIndex(index)') &&
    modalCode.includes('setActiveIndex(null)') &&
    /opacity=\{activeIndex === null \|\| activeIndex === index \? 1 : [\d.]+\}/.test(modalCode),
    'Modal implements interactive slice highlighting on hover with activeIndex state'
  );

  check(
    modalCode.includes('<Tooltip') &&
    modalCode.includes('percent =') &&
    modalCode.includes('item.displayCount'),
    'Modal renders rich custom Tooltip displaying category count and exact percentage'
  );

  check(
    modalCode.includes('onApplyCategory(cat.query, cat.filter)') &&
    /grid-cols-1 (sm|md|lg):grid-cols-\d/.test(modalCode),
    'Modal renders a responsive legend whose entries filter straight to their category'
  );

  // Check 4.5: Escape key & Backdrop dismissal
  check(
    modalCode.includes("e.key === 'Escape'") &&
    modalCode.includes('onClick={onClose}') &&
    modalCode.includes('document.body.style.overflow ='),
    'Modal handles Escape key dismissal, backdrop clicks, and body scroll locking'
  );

  // -------------------------------------------------------------
  // 5. FORENSIC CHECK 5: SSR Component Render Integrity
  // -------------------------------------------------------------
  console.log('\n[SECTION 5] SSR Component Render Integrity');

  const mockUser = {
    displayName: 'Forensic Auditor',
    email: 'auditor@mailflow.app',
    photoURL: 'https://mailflow.app/avatar.png'
  };

  const dashboardHtml = renderToString(<Dashboard user={mockUser} />);
  check(dashboardHtml.length > 500 && dashboardHtml.includes('MailFlow'), 'Dashboard renders complete HTML via SSR');

  const loginHtml = renderToString(<LoginScreen onLogin={() => {}} />);
  check(loginHtml.includes('Continue with Google'), 'LoginScreen renders complete HTML via SSR');

  const openModalHtml = renderToString(<CategoryDistributionModal isOpen={true} onClose={() => {}} />);
  check(
    openModalHtml.includes('Category Breakdown') && openModalHtml.includes('Volume Distribution'),
    'CategoryDistributionModal renders its page HTML via SSR'
  );

  const closedModalHtml = renderToString(<CategoryDistributionModal isOpen={false} onClose={() => {}} />);
  check(closedModalHtml === '', 'CategoryDistributionModal returns empty string when closed');

  // -------------------------------------------------------------
  // SUMMARY & VERDICT
  // -------------------------------------------------------------
  console.log('\n======================================================================');
  console.log(`FORENSIC AUDIT COMPLETE: ${passed} PASS, ${failed} VIOLATIONS`);
  console.log('======================================================================\n');

  if (failed > 0) {
    console.error('INTEGRITY VIOLATIONS DETECTED:');
    violations.forEach(v => console.error(`  - ${v}`));
    process.exit(1);
  } else {
    console.log('>>> FORENSIC VERDICT: CLEAN <<<');
    process.exit(0);
  }
}

runForensicIntegrityAudit().catch(err => {
  console.error('Fatal audit failure:', err);
  process.exit(1);
});
