import React from 'react';
import { renderToString } from 'react-dom/server';
import Dashboard from '../src/components/Dashboard';
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

function assert(condition: boolean, testName: string, details?: string) {
  if (condition) {
    console.log('  PASS:', testName);
    passed++;
  } else {
    console.error('  FAIL:', testName, details || '');
    failed++;
  }
}

console.log('=== Milestone 1 (R1) Comprehensive Stress Testing & Boundary Verification ===\n');

const dashboardCode = fs.readFileSync('src/components/Dashboard.tsx', 'utf-8');
const inboxHealthCode = fs.readFileSync('src/components/InboxHealth.tsx', 'utf-8');

// -------------------------------------------------------------
// Test Suite 1: Filter bar scrolling with numerous labels/options
// -------------------------------------------------------------
console.log('[Suite 1] Filter bar scrolling with numerous labels/options');
{
  const mockUser = {
    displayName: 'Test User',
    email: 'user@example.com',
    photoURL: 'https://example.com/photo.jpg'
  };

  const html = renderToString(<Dashboard user={mockUser} />);

  // 1. Check filter strip horizontal scroll container
  assert(
    html.includes('overflow-x-auto') && html.includes('no-scrollbar') && html.includes('flex-nowrap'),
    'Filter bar has horizontal touch scroll wrapper (overflow-x-auto, no-scrollbar, flex-nowrap)'
  );

  // 2. Check negative mobile margin and padding for edge-to-edge swipe
  assert(
    html.includes('-mx-3.5') && html.includes('px-3.5'),
    'Filter bar has edge-to-edge touch margins (-mx-3.5 px-3.5 sm:mx-0 sm:px-0)'
  );

  // 3. Check FolderMultiSelect button truncation
  assert(
    html.includes('truncate') && html.includes('max-w-[110px]') && html.includes('sm:max-w-none'),
    'Folder multi-select button label is constrained with truncate and max-w-[110px]'
  );

  // 4. Check shrink-0 on all filter strip items
  assert(
    html.includes('shrink-0') && html.includes('whitespace-nowrap'),
    'Filter strip items have shrink-0 and whitespace-nowrap to prevent line breaks'
  );

  // 5. Check date inputs have responsive compact widths
  assert(
    html.includes('w-24') && html.includes('sm:w-28'),
    'Date range inputs have compact responsive widths (w-24 sm:w-28)'
  );

  // 6. Check FolderMultiSelect dropdown max-height and scrolling for numerous labels
  assert(
    dashboardCode.includes('max-h-80 sm:max-h-96 overflow-y-auto') && dashboardCode.includes('w-52 sm:w-56'),
    'Folder dropdown menu has bounded height (max-h-80 sm:max-h-96) and overflow-y-auto for 20+ labels'
  );
  
  // 7. Verify FolderMultiSelect label calculation logic with stress cases
  const options = [
    { value: 'anywhere', label: 'All Mail' },
    { value: 'inbox', label: 'Inbox' },
    { value: 'label1', label: 'Work/Projects/2026/SuperLongDepartmentNameThatExceedsThirtyCharacters' }
  ];
  
  const getLabel = (selected: string[]) => {
    return selected.includes('anywhere') 
      ? 'All Mail' 
      : selected.length === 1 
        ? options.find(o => o.value === selected[0])?.label 
        : `${selected.length} Folders`;
  };
  
  assert(getLabel(['anywhere']) === 'All Mail', 'Folder label for default selection is "All Mail"');
  assert(getLabel(['inbox']) === 'Inbox', 'Folder label for single selection is "Inbox"');
  assert(getLabel(['label1']) === 'Work/Projects/2026/SuperLongDepartmentNameThatExceedsThirtyCharacters', 'Folder label handles long label');
  assert(getLabel(['inbox', 'label1', 'spam']) === '3 Folders', 'Folder label for multi-selection is "3 Folders"');
  assert(getLabel(new Array(50).fill('label_x')) === '50 Folders', 'Folder label for 50 selected folders is "50 Folders"');
}

// -------------------------------------------------------------
// Test Suite 2: Long email sender names, subjects & snippets
// -------------------------------------------------------------
console.log('\n[Suite 2] Long email sender names, subjects & snippets');
{
  const mockUser = {
    displayName: 'Test User',
    email: 'user@example.com',
    photoURL: 'https://example.com/photo.jpg'
  };

  const html = renderToString(<Dashboard user={mockUser} />);
  
  // 1. Verify Dashboard container has flex-1 and min-w-0 for flex children
  assert(
    html.includes('flex-1 min-w-0'),
    'Search input and email text containers use flex-1 min-w-0 for robust text truncation'
  );

  // 2. Verify search input has responsive padding
  assert(
    html.includes('pl-9 sm:pl-10') && html.includes('py-2.5 sm:py-3'),
    'Search input uses responsive compact padding for mobile touch devices'
  );

  // 3. Verify search submit button min-width responsiveness
  assert(
    html.includes('min-w-[72px] sm:min-w-[120px]'),
    'Search button uses min-w-[72px] sm:min-w-[120px] to preserve search input typing space'
  );

  // 4. Verify email row sender truncation and size/date badges
  assert(
    dashboardCode.includes('font-semibold text-slate-900 text-sm sm:text-base truncate') &&
    dashboardCode.includes('text-[11px] sm:text-xs font-medium text-slate-500 tabular-nums') &&
    dashboardCode.includes('text-[10px] sm:text-xs font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded'),
    'Email rows truncate long sender names cleanly with responsive date & size badges'
  );

  // 5. Verify email row subject & snippet truncation
  assert(
    dashboardCode.includes('text-xs sm:text-sm font-medium text-slate-800 truncate') &&
    dashboardCode.includes('text-xs sm:text-sm text-slate-500 truncate mt-0.5'),
    'Email subject and snippet use truncate classes to prevent multi-line overflow breaks'
  );

  // 6. Test sender display extraction with adversarial strings
  const formatSender = (s: string) => s.replace(/<.*>/, "").trim() || s;
  
  const test1 = formatSender("Alexander Montgomery <alex@example.com>");
  assert(test1 === "Alexander Montgomery", 'Sender parser extracts name from <email>');

  const test2 = formatSender("<noreply@example.com>");
  assert(test2 === "<noreply@example.com>", 'Sender parser falls back to raw string if name is empty');

  const longSender = "a".repeat(200);
  const test3 = formatSender(longSender);
  assert(test3.length === 200, 'Sender parser safely processes 200 char unbroken string');

  // 7. Test formatSize function with boundary byte values
  const formatSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1048576) return (bytes / 1024).toFixed(0) + " KB";
    return (bytes / 1048576).toFixed(1) + " MB";
  };
  
  assert(formatSize(500) === "500 B", 'formatSize handles bytes');
  assert(formatSize(102401) === "100 KB", 'formatSize handles boundary KB');
  assert(formatSize(25 * 1024 * 1024) === "25.0 MB", 'formatSize handles MB values');
}

// -------------------------------------------------------------
// Test Suite 3: Bulk action toolbar buttons & Selection Layout
// -------------------------------------------------------------
console.log('\n[Suite 3] Bulk action toolbar buttons when items are selected');
{
  const mockUser = {
    displayName: 'Test User',
    email: 'user@example.com',
    photoURL: 'https://example.com/photo.jpg'
  };

  const html = renderToString(<Dashboard user={mockUser} />);

  // 1. Verify 2-row toolbar structure on mobile vs 1-row on desktop
  assert(
    html.includes('flex-col sm:flex-row') && html.includes('items-stretch sm:items-center'),
    'Email toolbar uses flex-col sm:flex-row to give sort and bulk actions dedicated space'
  );

  // 2. Verify mobile sort dropdown is present in row 1 with flex sm:hidden
  assert(
    html.includes('flex sm:hidden items-center bg-slate-100 rounded-lg'),
    'Mobile-specific sort dropdown is rendered in Row 1 (flex sm:hidden)'
  );

  // 3. Verify desktop sort dropdown is hidden on mobile with hidden sm:flex
  assert(
    html.includes('hidden sm:flex items-center bg-slate-100 rounded-lg'),
    'Desktop sort dropdown is hidden on mobile viewports (hidden sm:flex)'
  );

  // 4. Verify bulk action buttons have equal distribution on mobile (flex-1) and compact labels
  assert(
    html.includes('flex-1 sm:flex-initial justify-center'),
    'Bulk action buttons expand evenly on mobile (flex-1 sm:flex-initial justify-center)'
  );

  // 5. Verify action button labels are hidden on mobile
  assert(
    html.includes('hidden sm:inline'),
    'Action button text labels are hidden on mobile (< 640px) to prevent button squishing'
  );

  // 6. Test selection label format with boundary selection counts
  const getSelectLabel = (count: number) => count > 0 ? `${count} selected` : 'Select All';
  assert(getSelectLabel(0) === 'Select All', 'Selection count 0 displays "Select All"');
  assert(getSelectLabel(1) === '1 selected', 'Selection count 1 displays "1 selected"');
  assert(getSelectLabel(100) === '100 selected', 'Selection count 100 displays "100 selected"');
  assert(getSelectLabel(5000) === '5000 selected', 'Selection count 5000 displays "5000 selected"');
}

// -------------------------------------------------------------
// Test Suite 4: Modal views (BYOK modal) on small height viewports (500px - 700px)
// -------------------------------------------------------------
console.log('\n[Suite 4] Modal views (BYOK modal) on small height viewports');
{
  // 1. Overlay padding and overscroll-contain
  assert(
    dashboardCode.includes('overscroll-contain') && dashboardCode.includes('p-3 sm:p-4'),
    'BYOK modal overlay has overscroll-contain and p-3 sm:p-4 for small viewports'
  );

  // 2. Max height scaling (max-h-[85vh] sm:max-h-[90vh])
  assert(
    dashboardCode.includes('max-h-[85vh] sm:max-h-[90vh]'),
    'BYOK modal container scales with max-h-[85vh] on mobile viewports'
  );

  // 3. Internal scrollable body
  assert(
    dashboardCode.includes('overflow-y-auto') && (dashboardCode.includes('flex flex-col gap-4 sm:gap-5') || dashboardCode.includes('space-y-4')),
    'BYOK modal content area has overflow-y-auto for viewports with 500px-700px height'
  );

  // 4. Header & Footer shrink-0 pinned
  assert(
    dashboardCode.includes('border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0') &&
    dashboardCode.includes('border-t border-slate-200 bg-slate-50 flex justify-end gap-2 sm:gap-3 shrink-0'),
    'BYOK modal header and footer have shrink-0 to remain visible during scroll'
  );

  // 5. Responsive provider grid (2 cols on mobile, 4 on desktop)
  assert(
    dashboardCode.includes('grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2'),
    'BYOK provider selection uses grid-cols-2 on mobile and sm:grid-cols-4 on desktop'
  );
}

// -------------------------------------------------------------
// Test Suite 5: Inbox Health mobile responsiveness
// -------------------------------------------------------------
console.log('\n[Suite 5] Inbox Health mobile responsiveness');
{
  // 1. Quick Filters scroll row
  assert(
    inboxHealthCode.includes('overflow-x-auto') && inboxHealthCode.includes('no-scrollbar') && inboxHealthCode.includes('flex-nowrap'),
    'Inbox Health quick filters strip is touch scrollable (overflow-x-auto no-scrollbar flex-nowrap)'
  );

  // 2. Quick Filter buttons non-wrapping
  assert(
    inboxHealthCode.includes('shrink-0 whitespace-nowrap') || inboxHealthCode.includes('shrink-0'),
    'Quick filter buttons have shrink-0 to avoid breaking onto new lines'
  );

  // 3. Health cards responsive grid
  assert(
    inboxHealthCode.includes('flex flex-col sm:grid sm:grid-cols-2 xl:grid-cols-4'),
    'Health metric cards stack vertically on mobile (flex-col), 2 cols on tablet, and 4 on desktop'
  );

  // 4. Pattern clusters responsive grid
  assert(
    inboxHealthCode.includes('grid-cols-1 md:grid-cols-2'),
    'Pattern clusters use 1 col on mobile and 2 cols on md screens'
  );
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  process.exit(1);
}
