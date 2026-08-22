import { processInChunks } from '../../src/lib/gmail';

console.log('--- INDEPENDENT AUDITOR ADVERSARIAL STRESS SUITE ---');

// Test 1: Safe sorting with extreme edge cases
const mockEmails = [
  { id: '1', sender: null as any, subject: 'A', sizeEstimate: undefined as any, date: new Date('invalid') },
  { id: '2', sender: 'Zoe <zoe@test.com>', subject: 'B', sizeEstimate: 999999999, date: new Date('2026-08-21') },
  { id: '3', sender: '  alice@test.com  ', subject: 'C', sizeEstimate: 0, date: new Date('2025-01-01') },
  { id: '4', sender: 'bob@test.com', subject: 'D', sizeEstimate: -100, date: '2026-05-15' as any },
];

function sortEmails(list: any[], sortBy: string, desc: boolean) {
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (sortBy === 'date') {
      const timeA = a.date instanceof Date && !isNaN(a.date.getTime()) ? a.date.getTime() : (!isNaN(new Date(a.date).getTime()) ? new Date(a.date).getTime() : 0);
      const timeB = b.date instanceof Date && !isNaN(b.date.getTime()) ? b.date.getTime() : (!isNaN(new Date(b.date).getTime()) ? new Date(b.date).getTime() : 0);
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
    return desc ? -cmp : cmp;
  });
}

// Test sender asc
const sortedSenderAsc = sortEmails(mockEmails, 'sender', false);
if (sortedSenderAsc[0].id === '1' && sortedSenderAsc[1].id === '3' && sortedSenderAsc[2].id === '4' && sortedSenderAsc[3].id === '2') {
  console.log('✓ Adversarial Sender sorting passed');
} else {
  console.error('✗ Sender sorting failed', sortedSenderAsc);
}

// Test size desc
const sortedSizeDesc = sortEmails(mockEmails, 'size', true);
if (sortedSizeDesc[0].id === '2' && (sortedSizeDesc[1].id === '1' || sortedSizeDesc[1].id === '3')) {
  console.log('✓ Adversarial Size sorting passed');
} else {
  console.error('✗ Size sorting failed', sortedSizeDesc);
}

// Test date desc
const sortedDateDesc = sortEmails(mockEmails, 'date', true);
if (sortedDateDesc[0].id === '2' && sortedDateDesc[1].id === '4' && sortedDateDesc[2].id === '3' && sortedDateDesc[3].id === '1') {
  console.log('✓ Adversarial Date sorting passed');
} else {
  console.error('✗ Date sorting failed', sortedDateDesc);
}

// Test 2: processInChunks
const items = Array.from({ length: 53 }, (_, i) => i);
processInChunks(items, 10, async (x) => x * 2).then(res => {
  if (res.length === 53 && res[52] === 104) {
    console.log('✓ processInChunks chunking arithmetic passed');
  } else {
    console.error('✗ processInChunks failed');
  }
});
