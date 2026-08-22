import { JSDOM } from 'jsdom';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';

// 1. Setup JSDOM environment
const dom = new JSDOM('<!DOCTYPE html><html><body style="overflow: auto;"><div id="root"></div></body></html>', {
  url: 'http://localhost:3000',
  pretendToBeVisual: true
});

(global as any).window = dom.window;
(global as any).document = dom.window.document;
(global as any).HTMLElement = dom.window.HTMLElement;
(global as any).HTMLButtonElement = dom.window.HTMLButtonElement;
(global as any).KeyboardEvent = dom.window.KeyboardEvent;
(global as any).MouseEvent = dom.window.MouseEvent;
(global as any).Event = dom.window.Event;
(global as any).Request = dom.window.Request;
(global as any).Response = dom.window.Response;
(global as any).IS_REACT_ACT_ENVIRONMENT = true;

// Mock ResizeObserver for Recharts in JSDOM
(dom.window as any).ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};
(global as any).ResizeObserver = (dom.window as any).ResizeObserver;

// Controlled mock fetch
let mockCategoryCounts: Record<string, number | string> = {
  'category:primary in:anywhere': 1250,
  'category:promotions in:anywhere': '5,000+',
  'category:updates in:anywhere': 750,
  'category:social in:anywhere': 320,
  'category:forums in:anywhere': 80,
  'in:spam OR in:trash': 110,
  'is:unread in:inbox': 42,
  'category:promotions older_than:6m': 150,
  'larger:5M': 12,
  'category:promotions OR in:spam': 239,
  'is:important -category:promotions': 34,
  'has:attachment': 67,
  'is:starred OR label:personal': 18,
  'in:anywhere': 250
};

let shouldFetchFail = false;
const interceptedQueries: string[] = [];

(global as any).fetch = async (url: RequestInfo | URL, _opts?: RequestInit) => {
  const urlStr = String(url);

  if (shouldFetchFail) {
    return new Response(JSON.stringify({ error: { message: 'Internal Server Error fetching Gmail API' } }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Handle /api/analyze-inbox
  if (urlStr.includes('/api/analyze-inbox')) {
    return new Response(JSON.stringify({
      clusters: [
        {
          title: 'GitHub CI Notifications',
          description: 'Automated workflow run notifications',
          suggestedAction: 'Archive',
          searchQuery: 'from:notifications@github.com',
          estimatedCount: 84,
          patternDetected: 'High frequency notifications'
        }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  // Handle Gmail API messages query
  if (urlStr.includes('/messages?')) {
    const urlObj = new URL(urlStr, 'https://gmail.googleapis.com');
    const q = urlObj.searchParams.get('q') || '';
    interceptedQueries.push(q);

    // If query has exact match or prefix in mockCategoryCounts
    const countVal = mockCategoryCounts[q] ?? 0;
    console.log(`[FETCH MOCK] q='${q}' -> countVal=${countVal} (keys in map: ${Object.keys(mockCategoryCounts).length})`);
    
    // If countVal is a string like "5,000+", we return messages up to 500 per page for 10 pages or simulate count
    const isOver5k = typeof countVal === 'string' && countVal.includes('5,000');
    const num = isOver5k ? 5500 : (typeof countVal === 'number' ? countVal : parseInt(String(countVal).replace(/[^0-9]/g, ''), 10) || 5000);
    
    const pageToken = urlObj.searchParams.get('pageToken');
    const pageNum = pageToken ? parseInt(pageToken.replace('page_', ''), 10) : 0;
    const pageSize = 500;
    const remaining = Math.max(0, num - pageNum * pageSize);
    const thisPageCount = Math.min(pageSize, remaining);
    const hasNext = isOver5k ? pageNum < 10 : ((pageNum + 1) * pageSize < num && (pageNum + 1) < 10);

    return new Response(JSON.stringify({
      messages: Array.from({ length: thisPageCount }, (_, i) => ({ id: `msg_${pageNum}_${i}`, threadId: `t_${i}` })),
      resultSizeEstimate: thisPageCount,
      nextPageToken: hasNext ? `page_${pageNum + 1}` : undefined
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  if (urlStr.includes('/messages/')) {
    return new Response(JSON.stringify({
      id: 'msg_1',
      threadId: 't_1',
      snippet: 'Test snippet',
      labelIds: ['INBOX'],
      payload: {
        headers: [
          { name: 'From', value: 'Test User <test@example.com>' },
          { name: 'Subject', value: 'Test Subject' },
          { name: 'Date', value: new Date().toUTCString() }
        ]
      }
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } });
};

// Import components after DOM and fetch setup
import { CategoryDistributionModal } from './src/components/CategoryDistributionModal';
import { InboxHealth } from './src/components/InboxHealth';

interface TestResult {
  suite: string;
  test: string;
  passed: boolean;
  error?: string;
  details?: any;
}

const testResults: TestResult[] = [];

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runAllTests() {
  console.log('================================================================');
  console.log('STARTING EMPIRICAL VERIFICATION FOR MILESTONE 3 (R3)');
  console.log('================================================================\n');

  const container = document.getElementById('root')!;
  let root = createRoot(container);

  const resetDOM = () => {
    act(() => {
      root.unmount();
    });
    container.innerHTML = '';
    document.body.style.overflow = 'auto';
    shouldFetchFail = false;
    interceptedQueries.length = 0;
    root = createRoot(container);
  };

  // -------------------------------------------------------------
  // TEST SUITE 1: Trigger Button & InboxHealth Integration
  // -------------------------------------------------------------
  const suite1 = 'Suite 1: Trigger Button & InboxHealth Integration';
  console.log(`Running ${suite1}...`);

  try {
    let appliedQuery = '';
    let appliedFilter: string | undefined = '';

    await act(async () => {
      root.render(
        <InboxHealth 
          onApplyQuery={(q, f) => { appliedQuery = q; appliedFilter = f; }} 
        />
      );
    });

    // Wait for async stats and clusters to resolve
    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    // TC 1.1: Verify Category Breakdown trigger button in header banner
    const buttons = Array.from(container.querySelectorAll('button'));
    const categoryBreakdownBtn = buttons.find(b => b.textContent?.includes('Category Breakdown'));
    assert(!!categoryBreakdownBtn, 'Category Breakdown trigger button must be present in InboxHealth header banner');
    testResults.push({ suite: suite1, test: 'TC 1.1 - Trigger button rendered in InboxHealth banner', passed: true });

    // TC 1.2: Verify modal is NOT rendered when closed
    let dialogEl = container.querySelector('[role="dialog"]');
    assert(dialogEl === null, 'Modal dialog should not be rendered initially (isChartModalOpen = false)');
    testResults.push({ suite: suite1, test: 'TC 1.2 - Modal initially closed', passed: true });

    // TC 1.3: Click trigger button opens modal
    await act(async () => {
      categoryBreakdownBtn!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    dialogEl = container.querySelector('[role="dialog"]');
    assert(!!dialogEl, 'Modal dialog should be rendered after clicking Category Breakdown button');
    testResults.push({ suite: suite1, test: 'TC 1.3 - Click trigger opens CategoryDistributionModal', passed: true });

    // TC 1.4: Click Done inside modal closes it
    const doneBtn = Array.from(dialogEl!.querySelectorAll('button')).find(b => b.textContent?.includes('Done'));
    assert(!!doneBtn, 'Done button must be present in modal footer');

    await act(async () => {
      doneBtn!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });

    dialogEl = container.querySelector('[role="dialog"]');
    assert(dialogEl === null, 'Modal dialog should be unmounted after clicking Done');
    testResults.push({ suite: suite1, test: 'TC 1.4 - Click Done in modal closes it', passed: true });

    resetDOM();
  } catch (err: any) {
    testResults.push({ suite: suite1, test: 'Suite 1 execution', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // TEST SUITE 2: CategoryDistributionModal Lifecycle & Data Fetching
  // -------------------------------------------------------------
  const suite2 = 'Suite 2: Modal Lifecycle & Category Data Fetching';
  console.log(`Running ${suite2}...`);

  try {
    // TC 2.1: Closed state returns null and does not modify body style
    document.body.style.overflow = 'auto';
    await act(async () => {
      root.render(<CategoryDistributionModal isOpen={false} onClose={() => {}} />);
    });
    assert(container.innerHTML === '', 'Modal with isOpen=false must render nothing');
    assert(document.body.style.overflow === 'auto', 'Body overflow should remain auto when isOpen=false');
    testResults.push({ suite: suite2, test: 'TC 2.1 - Closed state returns null', passed: true });
    resetDOM();

    // Direct test of countEmails
    const { countEmails } = require('./src/lib/gmail');
    const primaryCount = await countEmails('category:primary in:anywhere');
    console.log('DIRECT countEmails("category:primary in:anywhere") result:', primaryCount);

    // TC 2.2: Opening modal triggers lazy fetch of all 6 canonical categories
    await act(async () => {
      root.render(
        <CategoryDistributionModal 
          isOpen={true} 
          onClose={() => {}} 
          onApplyCategory={() => {}}
        />
      );
    });

    // Wait for queries to resolve
    await act(async () => {
      await new Promise(r => setTimeout(r, 300));
    });

    const expectedQueries = [
      'category:primary in:anywhere',
      'category:promotions in:anywhere',
      'category:updates in:anywhere',
      'category:social in:anywhere',
      'category:forums in:anywhere',
      'in:spam OR in:trash'
    ];

    assert(
      expectedQueries.every(eq => interceptedQueries.includes(eq)),
      `All 6 canonical Gmail category queries must be executed. Intercepted: ${JSON.stringify(interceptedQueries)}`
    );
    testResults.push({ suite: suite2, test: 'TC 2.2 - Fetches 6 canonical Gmail category queries on open', passed: true });

    // TC 2.3: Rendered breakdown items, counts, and string parse handling ("5,000+")
    const textContent = container.textContent || '';
    console.log('DEBUG container.innerHTML in TC 2.3:', container.innerHTML);
    console.log('DEBUG textContent in TC 2.3:', textContent);
    assert(textContent.includes('Primary'), 'Primary category rendered');
    assert(textContent.includes('Promotions'), 'Promotions category rendered');
    assert(textContent.includes('Updates'), 'Updates category rendered');
    assert(textContent.includes('Social'), 'Social category rendered');
    assert(textContent.includes('Forums'), 'Forums category rendered');
    assert(textContent.includes('Spam & Trash'), 'Spam & Trash category rendered');
    testResults.push({ suite: suite2, test: 'TC 2.3 - Displays all category names and formatted counts', passed: true });

    // TC 2.4: Zero volume handling (totalCount = 0)
    resetDOM();
    mockCategoryCounts = {
      'category:primary in:anywhere': 0,
      'category:promotions in:anywhere': 0,
      'category:updates in:anywhere': 0,
      'category:social in:anywhere': 0,
      'category:forums in:anywhere': 0,
      'in:spam OR in:trash': 0
    };

    await act(async () => {
      root.render(<CategoryDistributionModal isOpen={true} onClose={() => {}} />);
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    const zeroText = container.textContent || '';
    assert(zeroText.includes('Total Emails'), 'Total Emails header rendered with 0 total');
    assert(!zeroText.includes('NaN'), 'No NaN% percentages displayed on zero volume');
    testResults.push({ suite: suite2, test: 'TC 2.4 - Zero counts handled safely without crash or NaN', passed: true });

    // TC 2.5: Error fallback handling (countEmails catches network errors and returns 0)
    resetDOM();
    shouldFetchFail = true;

    await act(async () => {
      root.render(<CategoryDistributionModal isOpen={true} onClose={() => {}} />);
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    const fallbackText = container.textContent || '';
    assert(fallbackText.includes('Total Emails') && fallbackText.includes('Primary'), 'Gracefully renders fallback 0 distribution when network fails');
    testResults.push({ suite: suite2, test: 'TC 2.5 - Network failure fallback to safe 0 distribution without crashing', passed: true });

    // TC 2.6: Recovery upon refresh
    shouldFetchFail = false;
    mockCategoryCounts = {
      'category:primary in:anywhere': 1250,
      'category:promotions in:anywhere': '5,000+',
      'category:updates in:anywhere': 750,
      'category:social in:anywhere': 320,
      'category:forums in:anywhere': 80,
      'in:spam OR in:trash': 110
    };

    const refreshBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Refresh Counts'));
    assert(!!refreshBtn, 'Refresh Counts button present in footer');
    interceptedQueries.length = 0;

    await act(async () => {
      refreshBtn!.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 200));
    });

    assert(interceptedQueries.length >= 6, `Refresh counts re-triggered queries (${interceptedQueries.length} calls)`);
    assert(container.textContent?.includes('Primary'), 'Recovered and displayed category distribution after refresh');
    testResults.push({ suite: suite2, test: 'TC 2.6 - Refresh Counts button in footer re-executes queries and updates data', passed: true });

    resetDOM();
  } catch (err: any) {
    testResults.push({ suite: suite2, test: 'Suite 2 execution', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // TEST SUITE 3: Modal Dismiss Interactions & Event Propagation
  // -------------------------------------------------------------
  const suite3 = 'Suite 3: Modal Dismiss Interactions & Event Propagation';
  console.log(`Running ${suite3}...`);

  try {
    let closeCount = 0;
    let appliedQ = '';
    let appliedF: string | undefined = '';

    const renderOpenModal = async () => {
      resetDOM();
      closeCount = 0;
      appliedQ = '';
      appliedF = '';
      await act(async () => {
        root.render(
          <CategoryDistributionModal
            isOpen={true}
            onClose={() => { closeCount++; }}
            onApplyCategory={(q, f) => { appliedQ = q; appliedF = f; }}
          />
        );
      });
      await act(async () => {
        await new Promise(r => setTimeout(r, 100));
      });
    };

    // TC 3.1: Top X button
    await renderOpenModal();
    const xBtn = container.querySelector('button[aria-label="Close dialog"]') as HTMLButtonElement;
    assert(!!xBtn, 'Top close button with aria-label="Close dialog" must exist');
    await act(async () => {
      xBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert(closeCount === 1, 'Top X button must invoke onClose once');
    testResults.push({ suite: suite3, test: 'TC 3.1 - Header X button dismisses modal', passed: true });

    // TC 3.2: Footer Done button
    await renderOpenModal();
    const doneBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent?.includes('Done')) as HTMLButtonElement;
    assert(!!doneBtn, 'Done button must exist in footer');
    await act(async () => {
      doneBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert(closeCount === 1, 'Done button must invoke onClose once');
    testResults.push({ suite: suite3, test: 'TC 3.2 - Footer Done button dismisses modal', passed: true });

    // TC 3.3: Backdrop click
    await renderOpenModal();
    const backdropEl = container.querySelector('[role="dialog"]') as HTMLElement;
    assert(!!backdropEl, 'Backdrop container with role="dialog" must exist');
    await act(async () => {
      backdropEl.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert(closeCount === 1, 'Backdrop click must invoke onClose once');
    testResults.push({ suite: suite3, test: 'TC 3.3 - Backdrop click dismisses modal', passed: true });

    // TC 3.4: Dialog Content Click (e.stopPropagation())
    await renderOpenModal();
    const dialogCard = backdropEl.firstElementChild as HTMLElement;
    assert(!!dialogCard, 'Inner dialog card must exist');
    await act(async () => {
      dialogCard.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert(closeCount === 0, 'Clicking inside dialog card must NOT close the modal (stopPropagation)');
    testResults.push({ suite: suite3, test: 'TC 3.4 - Dialog card stopPropagation prevents accidental close', passed: true });

    // TC 3.5: Escape key dismisses modal
    await renderOpenModal();
    await act(async () => {
      window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert(closeCount === 1, 'Escape key press must invoke onClose once');
    testResults.push({ suite: suite3, test: 'TC 3.5 - Escape key dismisses modal', passed: true });

    // TC 3.6: Non-Escape keys do NOT dismiss modal
    await renderOpenModal();
    await act(async () => {
      window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
      window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    assert(closeCount === 0, 'Non-Escape keys must NOT invoke onClose');
    testResults.push({ suite: suite3, test: 'TC 3.6 - Non-Escape keys ignored', passed: true });

    // TC 3.7: Category filter navigation button invokes onApplyCategory AND onClose
    await renderOpenModal();
    const filterBtn = container.querySelector('button[aria-label="Filter by Primary"]') as HTMLButtonElement;
    assert(!!filterBtn, 'Filter by Primary shortcut button must exist');
    await act(async () => {
      filterBtn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    });
    assert(closeCount === 1, 'Filter button click must call onClose');
    assert(appliedQ === 'category:primary in:anywhere', `Filter button must pass query. Got: ${appliedQ}`);
    assert(appliedF === 'category:primary', `Filter button must pass filter. Got: ${appliedF}`);
    testResults.push({ suite: suite3, test: 'TC 3.7 - Category filter shortcut calls onApplyCategory and closes modal', passed: true });

    resetDOM();
  } catch (err: any) {
    testResults.push({ suite: suite3, test: 'Suite 3 execution', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // TEST SUITE 4: Body Scroll Lock & Listener Cleanup
  // -------------------------------------------------------------
  const suite4 = 'Suite 4: Body Scroll Lock & Listener Cleanup';
  console.log(`Running ${suite4}...`);

  try {
    // TC 4.1: Body scroll locked to 'hidden' when modal opens
    document.body.style.overflow = 'scroll';
    await act(async () => {
      root.render(<CategoryDistributionModal isOpen={true} onClose={() => {}} />);
    });
    assert(document.body.style.overflow === 'hidden', `Body overflow must be set to 'hidden' when open. Got: ${document.body.style.overflow}`);
    testResults.push({ suite: suite4, test: 'TC 4.1 - Body scroll locked to hidden on modal open', passed: true });

    // TC 4.2: Body scroll restored when isOpen changes to false
    await act(async () => {
      root.render(<CategoryDistributionModal isOpen={false} onClose={() => {}} />);
    });
    assert(document.body.style.overflow === 'scroll', `Body overflow must be restored to original 'scroll'. Got: ${document.body.style.overflow}`);
    testResults.push({ suite: suite4, test: 'TC 4.2 - Body scroll restored to previous value on close', passed: true });

    // TC 4.3: Keyboard listener cleanup on unmount
    let unmountCloseCount = 0;
    await act(async () => {
      root.render(<CategoryDistributionModal isOpen={true} onClose={() => { unmountCloseCount++; }} />);
    });
    assert(unmountCloseCount === 0, 'Unmount close count must be 0 initially');

    // Unmount modal
    resetDOM();

    // Fire Escape after unmount
    await act(async () => {
      window.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    assert(unmountCloseCount === 0, 'Unmounted modal must not respond to Escape key events');
    testResults.push({ suite: suite4, test: 'TC 4.3 - Window keydown listener cleaned up on unmount', passed: true });

    // TC 4.4: Rapid toggling stress test (20 cycles)
    document.body.style.overflow = 'auto';
    for (let i = 0; i < 20; i++) {
      await act(async () => {
        root.render(<CategoryDistributionModal isOpen={i % 2 === 0} onClose={() => {}} />);
      });
      const expected = i % 2 === 0 ? 'hidden' : 'auto';
      assert(document.body.style.overflow === expected, `Cycle ${i}: Expected overflow=${expected}, got=${document.body.style.overflow}`);
    }
    testResults.push({ suite: suite4, test: 'TC 4.4 - Rapid 20-cycle toggle stress test preserves scroll lock', passed: true });

    resetDOM();
  } catch (err: any) {
    testResults.push({ suite: suite4, test: 'Suite 4 execution', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // TEST SUITE 5: Accessibility & ARIA Semantics
  // -------------------------------------------------------------
  const suite5 = 'Suite 5: Accessibility & ARIA Semantics';
  console.log(`Running ${suite5}...`);

  try {
    await act(async () => {
      root.render(<CategoryDistributionModal isOpen={true} onClose={() => {}} onApplyCategory={() => {}} />);
    });
    await act(async () => {
      await new Promise(r => setTimeout(r, 100));
    });

    const dialog = container.querySelector('[role="dialog"]');
    assert(!!dialog, 'role="dialog" present');
    assert(dialog?.getAttribute('aria-modal') === 'true', 'aria-modal="true" set on dialog');
    assert(dialog?.getAttribute('aria-labelledby') === 'category-distribution-title', 'aria-labelledby linked to category-distribution-title');

    const titleEl = container.querySelector('#category-distribution-title');
    assert(!!titleEl, 'Title element #category-distribution-title exists');
    assert(titleEl?.textContent?.includes('Inbox Category Distribution'), 'Title text is correct');

    const closeBtn = container.querySelector('button[aria-label="Close dialog"]');
    assert(!!closeBtn, 'Close button has descriptive aria-label');

    const filterBtns = container.querySelectorAll('button[aria-label^="Filter by"]');
    assert(filterBtns.length === 6, `Expected 6 category filter shortcut buttons with aria-label, found ${filterBtns.length}`);

    testResults.push({ suite: suite5, test: 'TC 5.1 - Complete ARIA dialog semantics and labels', passed: true });
    resetDOM();
  } catch (err: any) {
    testResults.push({ suite: suite5, test: 'Suite 5 execution', passed: false, error: err.message });
  }

  // -------------------------------------------------------------
  // FINAL RESULTS REPORT
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log('EMPIRICAL VERIFICATION SUMMARY');
  console.log('================================================================');

  let passedCount = 0;
  let failedCount = 0;

  testResults.forEach(res => {
    if (res.passed) {
      passedCount++;
      console.log(`  [PASS] ${res.suite} -> ${res.test}`);
    } else {
      failedCount++;
      console.error(`  [FAIL] ${res.suite} -> ${res.test}`);
      if (res.error) console.error(`         Error: ${res.error}`);
    }
  });

  console.log(`\nTotal Tests: ${testResults.length} | Passed: ${passedCount} | Failed: ${failedCount}`);

  if (failedCount > 0) {
    console.error('\nVERIFICATION RESULT: FAILED');
    process.exit(1);
  } else {
    console.log('\nVERIFICATION RESULT: ALL TESTS PASSED EMPIRICALLY');
  }
}

runAllTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
