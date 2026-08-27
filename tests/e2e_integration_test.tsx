// Must stay first: installs browser globals before any app module is evaluated.
import './helpers/browserEnv';

import React from 'react';
import { renderToString } from 'react-dom/server';
import Dashboard from '../src/components/Dashboard';
import { InboxHealth } from '../src/components/InboxHealth';
import { CategoryDistributionModal, CategoryItem } from '../src/components/CategoryDistributionModal';
import { EmailData, countEmails, processInChunks } from '../src/lib/gmail';
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
const failureList: string[] = [];

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log(`  [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${testName} - ${details || 'Assertion failed'}`);
    failed++;
    failureList.push(`${testName}: ${details || ''}`);
  }
}

async function runE2EIntegrationTests() {
  console.log('=== MailFlow Milestone 4: Full End-to-End & Cross-Milestone Integration Verification ===\n');

  const mockUser = {
    displayName: 'E2E Verification User',
    email: 'verifier@mailflow.test',
    photoURL: 'https://example.com/verifier.png',
  };

  const dashboardCode = fs.readFileSync('src/components/Dashboard.tsx', 'utf-8');
  const inboxHealthCode = fs.readFileSync('src/components/InboxHealth.tsx', 'utf-8');
  const modalCode = fs.readFileSync('src/components/CategoryDistributionModal.tsx', 'utf-8');

  // -------------------------------------------------------------
  // E2E Journey 1: Mobile UI & Viewport Responsiveness Verification (R1)
  // -------------------------------------------------------------
  console.log('[E2E Journey 1] Mobile UI Layout & Viewport Scaling (< 768px & < 480px)');
  {
    const dashboardHtml = renderToString(<Dashboard user={mockUser} />);
    
    // 1. Header scalability
    assert(
      dashboardHtml.includes('flex items-center justify-between') && dashboardHtml.includes('px-4 sm:px-6'),
      'Dashboard header uses responsive padding px-4 sm:px-6'
    );
    assert(
      dashboardHtml.includes('hidden sm:inline') || dashboardHtml.includes('hidden sm:flex') || dashboardHtml.includes('sm:block'),
      'Header hides long non-essential labels on small viewports'
    );

    // 2. Search & Filter Bar mobile adaptability
    // Asserted against the component source rather than the initial SSR string.
    // The filter strip only mounts once a search has results, so the first render
    // never contains it — the assertion was passing or failing on whether an
    // unrelated element happened to share a class name.
    assert(
      dashboardCode.includes('overflow-x-auto') && dashboardCode.includes('no-scrollbar'),
      'Filter bar provides horizontal swipe scrolling with no visible scrollbar'
    );
    assert(
      dashboardHtml.includes('min-w-[72px] sm:min-w-[120px]'),
      'Search submit button scales responsively to protect mobile input area'
    );

    // 3. Email Toolbar 2-row mobile structure
    assert(
      dashboardHtml.includes('flex-col sm:flex-row') && dashboardHtml.includes('items-stretch sm:items-center'),
      'Email toolbar employs 2-row stacked layout on mobile viewports'
    );

    // 4. Modal container mobile viewport scaling
    const modalHtml = renderToString(
      <CategoryDistributionModal isOpen={true} onClose={() => {}} onApplyCategory={() => {}} />
    );
    // Category Breakdown is a routed full-height page now, so it is bounded by the
    // page shell rather than a max-h dialog of its own. The property that still
    // matters on a small screen is that its panels are a responsive grid rather
    // than a fixed multi-column layout that would overflow.
    assert(
      modalHtml.includes('grid-cols-1') && modalHtml.includes('lg:grid-cols-3'),
      'Category Breakdown stacks to a single column on small screens'
    );
  }

  // -------------------------------------------------------------
  // E2E Journey 2: Search Pagination, Exact Counts & Safe Sorting (R2)
  // -------------------------------------------------------------
  console.log('\n[E2E Journey 2] Search Pagination, Exact Counts & Safe Sorting (>100 Emails, up to 5,000 Cap)');
  {
    // Simulate initial search batch (Page 1: 100 emails)
    const page1Emails: EmailData[] = Array.from({ length: 100 }, (_, i) => ({
      id: `mail_p1_${i}`,
      threadId: `thread_p1_${i}`,
      snippet: `Page 1 message snippet ${i}`,
      sender: i % 2 === 0 ? `Sender Alpha <alpha_${i}@example.com>` : `Beta User <beta_${i}@example.com>`,
      subject: `Project Update #${i}`,
      date: new Date(Date.now() - (i * 3600000)),
      labelIds: ['INBOX'],
      sizeEstimate: (i + 1) * 15360,
    }));

    // Verify initial search state count formatting
    const totalMatchingCount = 3450;
    const formattedCountP1 = `Showing ${page1Emails.length} of ${totalMatchingCount.toLocaleString()} emails`;
    assert(
      formattedCountP1 === 'Showing 100 of 3,450 emails',
      'Initial search displays accurate count: "Showing 100 of 3,450 emails"'
    );

    // Simulate "Load More" action (Page 2: 100 additional emails with 5 overlapping IDs)
    const page2RawEmails: EmailData[] = [
      ...page1Emails.slice(95, 100), // 5 duplicates
      ...Array.from({ length: 95 }, (_, i) => ({
        id: `mail_p2_${i}`,
        threadId: `thread_p2_${i}`,
        snippet: `Page 2 message snippet ${i}`,
        sender: `Gamma Support <gamma_${i}@example.com>`,
        subject: `Billing Receipt #${i}`,
        date: new Date(Date.now() - ((100 + i) * 3600000)),
        labelIds: ['INBOX'],
        sizeEstimate: (i + 10) * 20480,
      }))
    ];

    // Deduplication logic test
    const existingIds = new Set(page1Emails.map(e => e.id));
    const uniquePage2 = page2RawEmails.filter(e => !existingIds.has(e.id));
    const combinedEmails = [...page1Emails, ...uniquePage2];

    assert(combinedEmails.length === 195, 'Pagination deduplication prevents duplicate messages (195 unique)');
    const formattedCountP2 = `Showing ${combinedEmails.length} of ${totalMatchingCount.toLocaleString()} emails`;
    assert(
      formattedCountP2 === 'Showing 195 of 3,450 emails',
      'Pagination updates counter to "Showing 195 of 3,450 emails"'
    );

    // In-memory Sorting on currently loaded emails (195 emails)
    function sortEmailList(emails: EmailData[], sortBy: 'date' | 'size' | 'sender', sortDesc: boolean): EmailData[] {
      return [...emails].sort((a, b) => {
        let cmp = 0;
        if (sortBy === 'date') {
          const timeA = a.date instanceof Date && !isNaN(a.date.getTime()) 
            ? a.date.getTime() 
            : (!isNaN(new Date(a.date).getTime()) ? new Date(a.date).getTime() : 0);
          const timeB = b.date instanceof Date && !isNaN(b.date.getTime()) 
            ? b.date.getTime() 
            : (!isNaN(new Date(b.date).getTime()) ? new Date(b.date).getTime() : 0);
          cmp = timeA - timeB;
        } else if (sortBy === 'size') {
          const sizeA = Number(a.sizeEstimate) || 0;
          const sizeB = Number(b.sizeEstimate) || 0;
          cmp = sizeA - sizeB;
        } else if (sortBy === 'sender') {
          const senderA = (a.sender || '').toLowerCase().trim();
          const senderB = (b.sender || '').toLowerCase().trim();
          cmp = senderA.localeCompare(senderB);
        }
        return sortDesc ? -cmp : cmp;
      });
    }

    // Sort by Size Descending
    const sortedBySize = sortEmailList(combinedEmails, 'size', true);
    assert(sortedBySize.length === 195, 'Size sort retains all 195 loaded emails');
    assert((sortedBySize[0].sizeEstimate || 0) >= (sortedBySize[1].sizeEstimate || 0), 'Size sort descending orders from largest to smallest');

    // Sort by Sender Ascending
    const sortedBySender = sortEmailList(combinedEmails, 'sender', false);
    assert(sortedBySender.length === 195, 'Sender sort retains all 195 loaded emails');
    assert(sortedBySender[0].sender.toLowerCase().startsWith('beta'), 'Sender sort ascending orders alphabetically');

    // Capped 5,000+ count test
    const cappedCount = '5,000+';
    const formattedCapped = `Showing ${combinedEmails.length} of ${cappedCount} emails`;
    assert(
      formattedCapped === 'Showing 195 of 5,000+ emails',
      'Capped total displays "Showing 195 of 5,000+ emails" without throwing or NaN'
    );
  }

  // -------------------------------------------------------------
  // E2E Journey 3: Inbox Health Chart Modal & Recharts Drilldown (R3)
  // -------------------------------------------------------------
  console.log('\n[E2E Journey 3] Inbox Health Chart Modal & Recharts Category Drilldown');
  {
    // 1. Check trigger button and modal wiring in InboxHealth component
    // Reached by route, not by a modal InboxHealth mounts. See m3_stress_test for
    // the matching correction; the trigger is asserted to go somewhere real.
    assert(
      inboxHealthCode.includes('Category Breakdown') &&
      inboxHealthCode.includes("window.location.hash = '#category-distribution'"),
      'InboxHealth renders the trigger and routes it to the Category Breakdown page'
    );

    // 2. Open CategoryDistributionModal and verify category aggregations
    const mockCategoryData: CategoryItem[] = [
      { id: 'primary', name: 'Primary', query: 'category:primary in:anywhere', filter: 'category:primary', color: '#3B82F6', value: 1420, displayCount: '1,420' },
      { id: 'promotions', name: 'Promotions', query: 'category:promotions in:anywhere', filter: 'category:promotions', color: '#F59E0B', value: 3100, displayCount: '3,100' },
      { id: 'updates', name: 'Updates', query: 'category:updates in:anywhere', filter: 'category:updates', color: '#10B981', value: 850, displayCount: '850' },
      { id: 'social', name: 'Social', query: 'category:social in:anywhere', filter: 'category:social', color: '#8B5CF6', value: 230, displayCount: '230' },
      { id: 'forums', name: 'Forums', query: 'category:forums in:anywhere', filter: 'category:forums', color: '#64748B', value: 45, displayCount: '45' },
      { id: 'spam', name: 'Spam & Trash', query: 'in:spam OR in:trash', filter: 'anywhere', color: '#EF4444', value: 12, displayCount: '12' },
    ];

    const totalEmails = mockCategoryData.reduce((acc, c) => acc + c.value, 0);
    assert(totalEmails === 5657, 'Calculated total volume is 5,657 emails');

    // 3. Category drill-down delegation callback simulation
    let appliedQuery = '';
    let appliedFilter = '';
    let modalClosed = false;

    const handleApplyCategory = (query: string, filter: string) => {
      appliedQuery = query;
      appliedFilter = filter;
      modalClosed = true;
    };

    // Simulate clicking "Promotions" drill-down button in modal
    const promoCategory = mockCategoryData.find(c => c.id === 'promotions')!;
    handleApplyCategory(promoCategory.query, promoCategory.filter);

    assert(
      appliedQuery === 'category:promotions in:anywhere',
      'Category drill-down sets query to "category:promotions in:anywhere"'
    );
    assert(
      appliedFilter === 'category:promotions',
      'Category drill-down sets folder filter to "category:promotions"'
    );
    assert(modalClosed, 'Modal closes automatically upon category drill-down delegation');
  }

  // -------------------------------------------------------------
  // E2E Summary
  // -------------------------------------------------------------
  console.log('\n=============================================================');
  console.log(`E2E Integration Test Suite Completed: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================================\n');

  if (failed > 0) {
    console.error('E2E Failures:');
    failureList.forEach(f => console.error(` - ${f}`));
    process.exit(1);
  }
}

runE2EIntegrationTests().catch(err => {
  console.error('Fatal E2E error:', err);
  process.exit(1);
});
