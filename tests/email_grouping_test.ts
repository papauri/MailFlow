/**
 * Grouping and sort presentation.
 *
 * The case that drove this: filtering by a year and being unable to tell which
 * year anything was from. Rows omitted the year, and grouping banded mail by
 * relative age ("1 – 3 years old"), which spans several calendar years and hides
 * exactly the thing the filter was for.
 */
import './helpers/browserEnv';
import {
  chooseGrouping, groupEmails, sortForGrouping,
  sortDirectionLabel, sortDirectionHint,
} from '../src/lib/emailGrouping';

let passed = 0;
let failed = 0;
function assert(condition: boolean, label: string, detail?: string) {
  if (condition) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`); }
}

console.log('=== Email Grouping & Sort Presentation ===\n');

const mail = (iso: string, over: Partial<any> = {}) => ({
  id: `m-${iso}-${Math.random().toString(36).slice(2, 7)}`,
  date: new Date(iso),
  sizeEstimate: 1000,
  labelIds: [],
  ...over,
});

// ---------------------------------------------------------------------------
console.log('[Year grouping]');
{
  const sample = [
    mail('2024-03-04T10:00:00Z'), mail('2024-11-20T10:00:00Z'),
    mail('2022-01-09T10:00:00Z'),
    mail('2019-07-15T10:00:00Z'), mail('2019-08-15T10:00:00Z'), mail('2019-09-15T10:00:00Z'),
  ];

  const desc = groupEmails(sample, 'year', true);
  assert(desc.map(g => g.title).join(',') === '2024,2022,2019',
    'Newest-first sorting orders year groups newest first', desc.map(g => g.title).join(','));

  const asc = groupEmails(sample, 'year', false);
  assert(asc.map(g => g.title).join(',') === '2019,2022,2024',
    'Oldest-first sorting orders year groups oldest first', asc.map(g => g.title).join(','));

  assert(desc.find(g => g.title === '2019')!.emails.length === 3,
    'Every message lands in its own calendar year');
  assert(desc.reduce((n, g) => n + g.emails.length, 0) === sample.length,
    'Grouping loses no messages');
  assert(desc.every(g => g.bytes === g.emails.length * 1000),
    'Each group totals the bytes of its own members');

  // A year boundary is the whole point: 31 Dec and 1 Jan must separate, even
  // though they are a day apart and an age band would put them together.
  const boundary = groupEmails(
    [mail('2023-12-31T23:00:00Z'), mail('2024-01-01T01:00:00Z')], 'year', true
  );
  assert(boundary.length === 2, 'Messages either side of new year are separated',
    boundary.map(g => g.title).join(','));

  // Undated mail must not vanish or claim a year it does not have.
  const withBad = groupEmails([mail('2024-05-05T10:00:00Z'), { id: 'x', date: 'nonsense' }], 'year', true);
  const unknown = withBad.find(g => g.title === 'Date unknown');
  assert(!!unknown && unknown.emails.length === 1,
    'Undated mail gets its own group rather than being dropped');
  assert(withBad[withBad.length - 1].title === 'Date unknown',
    'Undated mail sorts last', withBad.map(g => g.title).join(','));
  const withBadAsc = groupEmails([mail('2024-05-05T10:00:00Z'), { id: 'x', date: 'nonsense' }], 'year', false);
  assert(withBadAsc[withBadAsc.length - 1].title === 'Date unknown',
    'Undated mail sorts last in ascending order too', withBadAsc.map(g => g.title).join(','));
}

// ---------------------------------------------------------------------------
console.log('\n[Choosing the grouping dimension]');
{
  for (const q of ['older_than:1y -in:trash', 'newer_than:6m', 'after:2023/01/01', 'before:2020/06/30']) {
    assert(chooseGrouping({ query: q }) === 'year',
      `A time-scoped query groups by year: ${q}`, chooseGrouping({ query: q }));
  }
  assert(chooseGrouping({ query: 'larger:5M' }) === 'size', 'Storage work still groups by size');
  assert(chooseGrouping({ query: '', sortBy: 'size' }) === 'size', 'A size sort still groups by size');
  assert(chooseGrouping({ folder: 'spam+trash' }) === 'folder', 'Spam and Trash stay separated');
  assert(chooseGrouping({ query: 'from:someone@example.com' }) === 'category',
    'An ordinary query still groups by category');

  // Precedence: a storage sweep scoped to old mail is storage work, and its size
  // banding must win over the date operator in the query.
  assert(chooseGrouping({ query: 'older_than:1y -in:trash smaller:5M', sortBy: 'size' }) === 'size',
    'A size-sorted sweep of old mail groups by size, not year');

  const intent = sortForGrouping('year');
  assert(!!intent && intent.sortBy === 'date' && intent.sortDesc === false,
    'Year grouping arrives oldest-first, which is the cleanup direction',
    JSON.stringify(intent));
}

// ---------------------------------------------------------------------------
console.log('\n[Sort direction is legible]');
{
  // "Desc" is accurate and says nothing — descending what? For the year filters
  // this was reported against, the useful words are Newest and Oldest.
  assert(sortDirectionLabel('date', true) === 'Newest', 'Date descending reads "Newest"');
  assert(sortDirectionLabel('date', false) === 'Oldest', 'Date ascending reads "Oldest"');
  assert(sortDirectionLabel('size', true) === 'Largest', 'Size descending reads "Largest"');
  assert(sortDirectionLabel('size', false) === 'Smallest', 'Size ascending reads "Smallest"');
  assert(sortDirectionLabel('sender', true).includes('Z'), 'Sender descending shows Z first');
  assert(sortDirectionLabel('sender', false).startsWith('A'), 'Sender ascending shows A first');

  for (const field of ['date', 'size', 'sender'] as const) {
    for (const desc of [true, false]) {
      const hint = sortDirectionHint(field, desc);
      assert(hint.includes(sortDirectionLabel(field, desc)),
        `The ${field}/${desc ? 'desc' : 'asc'} hint states the current direction`, hint);
      assert(hint.toLowerCase().includes(sortDirectionLabel(field, !desc).toLowerCase()),
        `The ${field}/${desc ? 'desc' : 'asc'} hint states what clicking does`, hint);
    }
  }

  assert(
    sortDirectionLabel('date', true) !== sortDirectionLabel('date', false),
    'The two directions never read the same'
  );
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
