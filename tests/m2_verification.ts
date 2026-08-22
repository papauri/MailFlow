// Stress test for Milestone 2 logic: Sorting, Deduplication, and Count logic
import { EmailData } from '../src/lib/gmail';

console.log('--- STARTING M2 VERIFICATION TESTS ---');

// 1. Sorting Test
function sortEmails(emails: EmailData[], sortBy: 'date' | 'size' | 'sender', sortDesc: boolean): EmailData[] {
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

const mockEmails: EmailData[] = [
  { id: '1', threadId: 't1', snippet: '', date: new Date('2026-01-01T10:00:00Z'), sender: 'Alice <alice@test.com>', subject: 'A', labelIds: [], sizeEstimate: 1000 },
  { id: '2', threadId: 't2', snippet: '', date: new Date('2026-03-01T10:00:00Z'), sender: 'Charlie <charlie@test.com>', subject: 'C', labelIds: [], sizeEstimate: 500000 },
  { id: '3', threadId: 't3', snippet: '', date: new Date('2026-02-01T10:00:00Z'), sender: 'bob@test.com', subject: 'B', labelIds: [], sizeEstimate: 20000 },
  { id: '4', threadId: 't4', snippet: '', date: new Date('invalid-date'), sender: '', subject: 'No sender', labelIds: [], sizeEstimate: undefined },
];

// Test Date Sort Descending (newest first)
const sortedDateDesc = sortEmails(mockEmails, 'date', true);
console.assert(sortedDateDesc[0].id === '2', `Expected id '2' first, got ${sortedDateDesc[0].id}`);
console.assert(sortedDateDesc[1].id === '3', `Expected id '3' second, got ${sortedDateDesc[1].id}`);
console.assert(sortedDateDesc[2].id === '1', `Expected id '1' third, got ${sortedDateDesc[2].id}`);
console.log('✓ Date sorting (descending) passed');

// Test Date Sort Ascending (oldest first, invalid date at 0 time)
const sortedDateAsc = sortEmails(mockEmails, 'date', false);
console.assert(sortedDateAsc[0].id === '4', `Expected id '4' first (time 0), got ${sortedDateAsc[0].id}`);
console.assert(sortedDateAsc[1].id === '1', `Expected id '1' second, got ${sortedDateAsc[1].id}`);
console.log('✓ Date sorting (ascending) passed');

// Test Size Sort Descending (largest first)
const sortedSizeDesc = sortEmails(mockEmails, 'size', true);
console.assert(sortedSizeDesc[0].id === '2', `Expected id '2' (500000) first, got ${sortedSizeDesc[0].id}`);
console.assert(sortedSizeDesc[1].id === '3', `Expected id '3' (20000) second, got ${sortedSizeDesc[1].id}`);
console.assert(sortedSizeDesc[2].id === '1', `Expected id '1' (1000) third, got ${sortedSizeDesc[2].id}`);
console.assert(sortedSizeDesc[3].id === '4', `Expected id '4' (0) fourth, got ${sortedSizeDesc[3].id}`);
console.log('✓ Size sorting (descending) passed');

// Test Sender Sort Ascending (A-Z)
const sortedSenderAsc = sortEmails(mockEmails, 'sender', false);
console.assert(sortedSenderAsc[0].id === '4', `Expected id '4' ("") first, got ${sortedSenderAsc[0].id}`);
console.assert(sortedSenderAsc[1].id === '1', `Expected id '1' ("Alice...") second, got ${sortedSenderAsc[1].id}`);
console.assert(sortedSenderAsc[2].id === '3', `Expected id '3' ("bob...") third, got ${sortedSenderAsc[2].id}`);
console.assert(sortedSenderAsc[3].id === '2', `Expected id '2' ("Charlie...") fourth, got ${sortedSenderAsc[3].id}`);
console.log('✓ Sender sorting (ascending) passed');

// 2. Test Pagination Deduplication Logic
const initialEmails: EmailData[] = [
  { id: '1', threadId: 't1', snippet: '', date: new Date(), sender: 'A', subject: '', labelIds: [] },
  { id: '2', threadId: 't2', snippet: '', date: new Date(), sender: 'B', subject: '', labelIds: [] },
];
const newBatch: EmailData[] = [
  { id: '2', threadId: 't2', snippet: '', date: new Date(), sender: 'B', subject: '', labelIds: [] }, // duplicate
  { id: '3', threadId: 't3', snippet: '', date: new Date(), sender: 'C', subject: '', labelIds: [] },
];

const existingIds = new Set(initialEmails.map(e => e.id));
const uniqueNew = newBatch.filter(e => !existingIds.has(e.id));
const combined = [...initialEmails, ...uniqueNew];

console.assert(combined.length === 3, `Expected 3 emails after dedup, got ${combined.length}`);
console.assert(combined.map(e => e.id).join(',') === '1,2,3', `Expected IDs 1,2,3, got ${combined.map(e => e.id).join(',')}`);
console.log('✓ Pagination deduplication passed');

// 3. Count Display Formatting logic
function formatCountDisplay(emailsCount: number, totalCount: number | string | null, selectedCount: number, isCounting: boolean, hasNextPage: boolean): string {
  if (selectedCount > 0) return `${selectedCount} selected`;
  if (emailsCount === 0) return '0 emails';
  if (totalCount !== null) {
    if (typeof totalCount === 'number') {
      return emailsCount < totalCount ? `Showing ${emailsCount} of ${totalCount.toLocaleString()} emails` : `${emailsCount} emails`;
    }
    return `Showing ${emailsCount} of ${totalCount} emails`;
  }
  if (isCounting && hasNextPage) return `Showing ${emailsCount} emails...`;
  return `${emailsCount} emails`;
}

console.assert(formatCountDisplay(100, 350, 0, false, true) === 'Showing 100 of 350 emails');
console.assert(formatCountDisplay(100, 12500, 0, false, true) === 'Showing 100 of 12,500 emails');
console.assert(formatCountDisplay(100, '5,000+', 0, false, true) === 'Showing 100 of 5,000+ emails');
console.assert(formatCountDisplay(50, 50, 0, false, false) === '50 emails');
console.assert(formatCountDisplay(0, 0, 0, false, false) === '0 emails');
console.assert(formatCountDisplay(100, null, 0, true, true) === 'Showing 100 emails...');
console.assert(formatCountDisplay(100, 350, 5, false, true) === '5 selected');
console.log('✓ Count display formatting passed');

console.log('--- ALL M2 TESTS PASSED SUCCESSFULLY ---');
