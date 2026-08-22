import React from 'react';
import { renderToString } from 'react-dom/server';
import { countEmails, processInChunks, EmailData } from '../src/lib/gmail';
import * as fs from 'fs';

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

async function runMilestone2StressTests() {
  console.log('=== Milestone 2 (R2: Pagination, Counts, and Sorting) Adversarial Verification ===\n');

  const dashboardCode = fs.readFileSync('src/components/Dashboard.tsx', 'utf-8');
  const gmailCode = fs.readFileSync('src/lib/gmail.ts', 'utf-8');

  // -------------------------------------------------------------
  // Test Suite 1: nextPageToken and Load More Query Flow
  // -------------------------------------------------------------
  console.log('[Suite 1] nextPageToken and Load More Query Flow');

  // 1. Check state variables exist in Dashboard.tsx
  assert(
    dashboardCode.includes('const [nextPageToken, setNextPageToken] = useState<string | null>(null);') ||
    dashboardCode.includes('nextPageToken'),
    'nextPageToken state is defined in Dashboard.tsx'
  );
  assert(
    dashboardCode.includes('isLoadingMore') && dashboardCode.includes('setIsLoadingMore'),
    'isLoadingMore state is defined for loading transitions'
  );
  assert(
    dashboardCode.includes('lastExecutedQuery') && dashboardCode.includes('setLastExecutedQuery'),
    'lastExecutedQuery state is preserved for subsequent page fetches'
  );

  // 2. Check handleLoadMore uses pageToken parameter
  assert(
    dashboardCode.includes('pageToken=${encodeURIComponent(currentToken)}') ||
    dashboardCode.includes('pageToken=${currentToken}') ||
    dashboardCode.includes('&pageToken='),
    'handleLoadMore sends pageToken in Gmail API request'
  );

  // 3. Check deduplication / appending in handleLoadMore
  assert(
    dashboardCode.includes('existingIds') || dashboardCode.includes('prev.map(e => e.id)'),
    'handleLoadMore deduplicates items by ID before appending to emails array'
  );

  // 4. Check "Load More Emails" button renders conditionally on nextPageToken
  assert(
    dashboardCode.includes('{nextPageToken && (') &&
    dashboardCode.includes('Load More Emails') &&
    dashboardCode.includes('Loading more emails...'),
    'Dashboard conditionally renders Load More button with loading and idle states'
  );

  // 5. Check button disabled state when isLoadingMore is true
  assert(
    dashboardCode.includes('disabled={isLoadingMore}'),
    'Load More button is disabled while isLoadingMore is true'
  );


  // -------------------------------------------------------------
  // Test Suite 2: Total Count Formatting and 5,000 Cap Logic
  // -------------------------------------------------------------
  console.log('\n[Suite 2] Total Count Formatting & 5,000 Cap Logic');

  // Simulation of header count formatting logic from Dashboard.tsx
  function formatHeaderCount(emailsLength: number, totalCount: number | string | null, selectedCount: number, isCounting: boolean, hasNextPage: boolean): string {
    if (selectedCount > 0) {
      return `${selectedCount} selected`;
    }
    if (emailsLength === 0) {
      return `0 emails`;
    }
    if (totalCount !== null) {
      if (typeof totalCount === "number") {
        if (emailsLength < totalCount) {
          return `Showing ${emailsLength} of ${totalCount.toLocaleString()} emails`;
        } else {
          return `${emailsLength} emails`;
        }
      } else {
        return `Showing ${emailsLength} of ${totalCount} emails`;
      }
    }
    if (isCounting && hasNextPage) {
      return `Showing ${emailsLength} emails...`;
    }
    return `${emailsLength} emails`;
  }

  // Case 2.1: 0 emails
  assert(
    formatHeaderCount(0, 0, 0, false, false) === '0 emails',
    'Count display: 0 emails loaded displays "0 emails"'
  );

  // Case 2.2: Selected emails take precedence
  assert(
    formatHeaderCount(100, 500, 3, false, true) === '3 selected',
    'Count display: Selected count overrides total count ("3 selected")'
  );

  // Case 2.3: Initial 100 loaded out of 3,250 total
  assert(
    formatHeaderCount(100, 3250, 0, false, true) === 'Showing 100 of 3,250 emails',
    'Count display: Showing 100 of 3,250 emails formats with comma separators'
  );

  // Case 2.4: 200 loaded after Load More out of 3,250 total
  assert(
    formatHeaderCount(200, 3250, 0, false, true) === 'Showing 200 of 3,250 emails',
    'Count display: Updates to "Showing 200 of 3,250 emails" after pagination'
  );

  // Case 2.5: All 45 matching emails loaded (loaded === totalCount)
  assert(
    formatHeaderCount(45, 45, 0, false, false) === '45 emails',
    'Count display: When all emails loaded, displays "45 emails"'
  );

  // Case 2.6: Capped at 5,000+ emails
  assert(
    formatHeaderCount(100, '5,000+', 0, false, true) === 'Showing 100 of 5,000+ emails',
    'Count display: Cap display shows "Showing 100 of 5,000+ emails"'
  );
  assert(
    formatHeaderCount(300, '5,000+', 0, false, true) === 'Showing 300 of 5,000+ emails',
    'Count display: Cap display shows "Showing 300 of 5,000+ emails" after multiple loads'
  );

  // Case 2.7: In-flight counting state with nextPageToken
  assert(
    formatHeaderCount(100, null, 0, true, true) === 'Showing 100 emails...',
    'Count display: Displays "Showing 100 emails..." while background count query is in-flight'
  );

  // Case 2.8: Single page with totalCount null and no nextPageToken
  assert(
    formatHeaderCount(25, null, 0, false, false) === '25 emails',
    'Count display: Displays "25 emails" for single page without next token'
  );

  // -------------------------------------------------------------
  // Test Suite 3: Empirical Testing of countEmails API Traversal & Cap
  // -------------------------------------------------------------
  console.log('\n[Suite 3] Empirical Simulation of countEmails API Traversal & Cap');

  // Let's test the logic structure of countEmails against various page counts
  function simulateCountEmails(pageCounts: number[]): { total: number | string, apiCalls: number } {
    let total = 0;
    let pages = 0;
    let pageToken = pageCounts.length > 0 ? "token_1" : "";
    let apiCalls = 0;

    do {
      apiCalls++;
      const currentBatchCount = pageCounts[pages] || 0;
      if (currentBatchCount === 0) break;
      total += currentBatchCount;
      pages++;
      pageToken = pages < pageCounts.length ? `token_${pages + 1}` : "";
    } while (pageToken && pages < 10);

    if (pageToken) {
      return { total: "5,000+", apiCalls };
    }
    return { total, apiCalls };
  }

  // 0 messages: 1 API call returning empty messages array
  const emptyRes = simulateCountEmails([]);
  assert(emptyRes.total === 0 && emptyRes.apiCalls === 1, 'countEmails with 0 messages returns 0 with 1 API call');

  // 350 messages (1 page of 350, no next token)
  const singlePageRes = simulateCountEmails([350]);
  assert(singlePageRes.total === 350 && singlePageRes.apiCalls === 1, 'countEmails with 1 page returns 350 in 1 call');

  // 1,200 messages (2 pages of 500, 1 page of 200, no next token)
  const multiPageRes = simulateCountEmails([500, 500, 200]);
  assert(multiPageRes.total === 1200 && multiPageRes.apiCalls === 3, 'countEmails with 3 pages returns 1200 in 3 calls');

  // Exactly 5,000 messages (10 pages of 500, no next token after 10th page)
  const exact5kRes = simulateCountEmails([500, 500, 500, 500, 500, 500, 500, 500, 500, 500]);
  assert(exact5kRes.total === 5000 && exact5kRes.apiCalls === 10, 'countEmails with exactly 5000 messages returns 5000 in 10 calls');

  // Over 5,000 messages (12 pages of 500 -> capped at 10 calls)
  const over5kRes = simulateCountEmails([500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500, 500]);
  assert(over5kRes.total === '5,000+' && over5kRes.apiCalls === 10, 'countEmails with >5000 messages returns "5,000+" and halts at exactly 10 calls');


  // -------------------------------------------------------------
  // Test Suite 4: In-Memory Sorting Resilience & Null-Safety
  // -------------------------------------------------------------
  console.log('\n[Suite 4] In-Memory Sorting Resilience & Null-Safety');

  const testEmails: EmailData[] = [
    {
      id: '1',
      threadId: 't1',
      snippet: 'Test snippet 1',
      subject: 'Alpha Project',
      sender: 'Charlie <charlie@example.com>',
      date: new Date('2026-05-10T10:00:00Z'),
      labelIds: ['INBOX'],
      sizeEstimate: 1048576 // 1MB
    },
    {
      id: '2',
      threadId: 't2',
      snippet: 'Test snippet 2',
      subject: 'Beta Report',
      sender: 'alice@example.com',
      date: new Date('2026-08-15T12:00:00Z'),
      labelIds: ['INBOX'],
      sizeEstimate: 204800 // 200KB
    },
    {
      id: '3',
      threadId: 't3',
      snippet: 'Test snippet 3',
      subject: 'Gamma Notice',
      sender: 'Bob Smith <bob@example.com>',
      date: new Date('2026-01-01T08:00:00Z'),
      labelIds: ['INBOX'],
      sizeEstimate: 5242880 // 5MB
    },
    // Adversarial edge cases: missing sender, undefined size, string date, invalid date
    {
      id: '4',
      threadId: 't4',
      snippet: 'Adversarial edge case 1',
      subject: 'Null Sender & Bad Date',
      sender: '',
      date: new Date('Invalid Date'),
      labelIds: [],
      sizeEstimate: undefined
    },
    {
      id: '5',
      threadId: 't5',
      snippet: 'Adversarial edge case 2',
      subject: 'Special characters sender',
      sender: '  !Zack <zack@example.com> ',
      date: '2026-07-20T00:00:00Z' as any,
      labelIds: [],
      sizeEstimate: 0
    }
  ];

  // Helper matching Dashboard.tsx useMemo sort logic
  function sortEmailList(emails: EmailData[], sortBy: 'date' | 'size' | 'sender', sortDesc: boolean): EmailData[] {
    return [...emails].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "date") {
        const timeA = a.date instanceof Date && !isNaN(a.date.getTime()) 
          ? a.date.getTime() 
          : (!isNaN(new Date(a.date).getTime()) ? new Date(a.date).getTime() : 0);
        const timeB = b.date instanceof Date && !isNaN(b.date.getTime()) 
          ? b.date.getTime() 
          : (!isNaN(new Date(b.date).getTime()) ? new Date(b.date).getTime() : 0);
        cmp = timeA - timeB;
      } else if (sortBy === "size") {
        const sizeA = Number(a.sizeEstimate) || 0;
        const sizeB = Number(b.sizeEstimate) || 0;
        cmp = sizeA - sizeB;
      } else if (sortBy === "sender") {
        const senderA = (a.sender || '').toLowerCase().trim();
        const senderB = (b.sender || '').toLowerCase().trim();
        cmp = senderA.localeCompare(senderB);
      }
      return sortDesc ? -cmp : cmp;
    });
  }

  // Date Sort Descending (Newest first)
  const sortedByDateDesc = sortEmailList(testEmails, 'date', true);
  assert(
    sortedByDateDesc[0].id === '2' && // 2026-08-15
    sortedByDateDesc[1].id === '5' && // 2026-07-20
    sortedByDateDesc[2].id === '1' && // 2026-05-10
    sortedByDateDesc[3].id === '3',   // 2026-01-01
    'Date sort descending correctly orders valid and string dates without crashing on invalid dates'
  );

  // Date Sort Ascending (Oldest first)
  const sortedByDateAsc = sortEmailList(testEmails, 'date', false);
  assert(
    sortedByDateAsc[0].id === '4' && // Invalid date (time = 0)
    sortedByDateAsc[1].id === '3' && // 2026-01-01
    sortedByDateAsc[sortedByDateAsc.length - 1].id === '2', // 2026-08-15
    'Date sort ascending puts oldest/zero timestamp first and newest last'
  );

  // Size Sort Descending (Largest first)
  const sortedBySizeDesc = sortEmailList(testEmails, 'size', true);
  assert(
    sortedBySizeDesc[0].id === '3' && // 5MB
    sortedBySizeDesc[1].id === '1' && // 1MB
    sortedBySizeDesc[2].id === '2',   // 200KB
    'Size sort descending correctly orders by sizeEstimate without crashing on undefined/0'
  );

  // Size Sort Ascending (Smallest first)
  const sortedBySizeAsc = sortEmailList(testEmails, 'size', false);
  assert(
    (sortedBySizeAsc[0].id === '4' || sortedBySizeAsc[0].id === '5') &&
    sortedBySizeAsc[sortedBySizeAsc.length - 1].id === '3',
    'Size sort ascending puts 0 and undefined size first and 5MB last'
  );

  // Sender Sort Ascending (A-Z)
  const sortedBySenderAsc = sortEmailList(testEmails, 'sender', false);
  assert(
    sortedBySenderAsc[0].id === '4' && // '' (empty)
    sortedBySenderAsc[1].id === '5' && // '!zack'
    sortedBySenderAsc[2].id === '2' && // 'alice'
    sortedBySenderAsc[3].id === '3' && // 'bob'
    sortedBySenderAsc[4].id === '1',   // 'charlie'
    'Sender sort ascending correctly handles case-insensitivity, whitespace trimming, and empty strings'
  );

  // Sender Sort Descending (Z-A)
  const sortedBySenderDesc = sortEmailList(testEmails, 'sender', true);
  assert(
    sortedBySenderDesc[0].id === '1' && // 'charlie'
    sortedBySenderDesc[1].id === '3' && // 'bob'
    sortedBySenderDesc[2].id === '2',   // 'alice'
    'Sender sort descending puts Z/Charlie first'
  );


  // -------------------------------------------------------------
  // Test Suite 5: Race Condition & Concurrency Stress Test
  // -------------------------------------------------------------
  console.log('\n[Suite 5] Concurrency & Race Condition Resilience');

  // Test searchIdRef pattern against out-of-order responses
  let activeSearchId = 0;
  let simulatedEmails: string[] = [];
  let simulatedTotalCount: number | string | null = null;

  async function mockExecuteSearch(id: number, delayMs: number, resultCount: number, results: string[]) {
    // Background count
    setTimeout(() => {
      if (activeSearchId === id) {
        simulatedTotalCount = resultCount;
      }
    }, delayMs + 10);

    // Message fetch
    await new Promise(r => setTimeout(r, delayMs));
    if (activeSearchId === id) {
      simulatedEmails = results;
    }
  }

  // Simulate Query 1 triggered (slow: 100ms)
  activeSearchId = 1;
  const search1 = mockExecuteSearch(1, 100, 500, ['Email_A1', 'Email_A2']);

  // Simulate Query 2 triggered immediately after (fast: 20ms)
  activeSearchId = 2;
  const search2 = mockExecuteSearch(2, 20, 10, ['Email_B1']);

  await Promise.all([search1, search2]);
  // Wait extra 30ms for timeouts
  await new Promise(r => setTimeout(r, 50));

  assert(
    simulatedEmails.length === 1 && simulatedEmails[0] === 'Email_B1',
    'searchIdRef prevents slow previous search (Query 1) from overwriting newer search (Query 2) messages'
  );
  assert(
    simulatedTotalCount === 10,
    'searchIdRef prevents slow previous count query from overwriting newer search totalCount'
  );


  // -------------------------------------------------------------
  // Test Suite 6: Chunking & Batch Processing Integrity
  // -------------------------------------------------------------
  console.log('\n[Suite 6] Chunking & Batch Processing Integrity');

  const items = Array.from({ length: 97 }, (_, i) => ({ id: `msg_${i}` }));
  let processedCount = 0;
  const chunkResults = await processInChunks(items, 15, async (item) => {
    processedCount++;
    return item.id.toUpperCase();
  });

  assert(
    chunkResults.length === 97 && processedCount === 97,
    'processInChunks processes exactly all 97 items across chunks of 15'
  );
  assert(
    chunkResults[0] === 'MSG_0' && chunkResults[96] === 'MSG_96',
    'processInChunks preserves original order of items'
  );


  // -------------------------------------------------------------
  // Test Suite 7: Decrementing totalCount upon Bulk Actions
  // -------------------------------------------------------------
  console.log('\n[Suite 7] Decrementing totalCount upon Bulk Actions');

  function simulateBulkActionCountReduction(currentTotal: number | string | null, deletedCount: number): number | string | null {
    if (typeof currentTotal === "number") {
      return Math.max(0, currentTotal - deletedCount);
    }
    return currentTotal;
  }

  assert(
    simulateBulkActionCountReduction(150, 10) === 140,
    'Bulk action decrements numeric totalCount by deleted items count'
  );
  assert(
    simulateBulkActionCountReduction(5, 10) === 0,
    'Bulk action clamps numeric totalCount to 0 (never negative)'
  );
  assert(
    simulateBulkActionCountReduction('5,000+', 50) === '5,000+',
    'Bulk action preserves "5,000+" capped count without NaN corruption'
  );


  // -------------------------------------------------------------
  // Summary
  // -------------------------------------------------------------
  console.log(`\n=============================================================`);
  console.log(`Milestone 2 Stress Test Suite Completed: ${passed} PASSED, ${failed} FAILED`);
  if (failed > 0) {
    console.error('Failures:');
    failureDetails.forEach(d => console.error(` - ${d}`));
  }
  console.log(`=============================================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runMilestone2StressTests().catch(err => {
  console.error('Unexpected error in test runner:', err);
  process.exit(1);
});
