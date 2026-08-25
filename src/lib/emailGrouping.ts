/**
 * Grouping model for message lists.
 *
 * Two jobs. First, a long undifferentiated list of mail is hard to act on, so rows
 * are gathered under collapsible headers the user can select or collapse as a unit.
 *
 * Second — and this is what makes it more than cosmetic — the grouping *dimension*
 * follows the task the page was opened for. A storage cleanup page should band by
 * size, because that is the axis the decision turns on. A spam-and-trash page should
 * separate Spam from Trash, because emptying one is not the same act as emptying the
 * other. Grouping everything by Gmail category regardless would bury exactly the
 * distinction the user came to make.
 */

export type GroupingStrategy = 'category' | 'folder' | 'size' | 'age' | 'none';

export interface EmailGroup {
  id: string;
  title: string;
  /** Icon hint resolved by the view layer, so this module stays free of JSX. */
  icon: 'inbox' | 'updates' | 'promotions' | 'social' | 'forums' | 'spam' | 'trash' | 'archive' | 'size' | 'clock';
  emails: any[];
  /** Summed sizeEstimate, shown where storage is the point of the page. */
  bytes: number;
}

const CATEGORY_ORDER: { id: string; title: string; label: string; icon: EmailGroup['icon'] }[] = [
  { id: 'primary', title: 'Primary Inbox', label: 'CATEGORY_PERSONAL', icon: 'inbox' },
  { id: 'updates', title: 'Updates', label: 'CATEGORY_UPDATES', icon: 'updates' },
  { id: 'promotions', title: 'Promotions', label: 'CATEGORY_PROMOTIONS', icon: 'promotions' },
  { id: 'social', title: 'Social', label: 'CATEGORY_SOCIAL', icon: 'social' },
  { id: 'forums', title: 'Forums', label: 'CATEGORY_FORUMS', icon: 'forums' },
];

const SIZE_BANDS: { id: string; title: string; min: number }[] = [
  { id: 'huge', title: 'Over 25 MB', min: 25 * 1024 * 1024 },
  { id: 'large', title: '10 – 25 MB', min: 10 * 1024 * 1024 },
  { id: 'medium', title: '5 – 10 MB', min: 5 * 1024 * 1024 },
  { id: 'small', title: '1 – 5 MB', min: 1024 * 1024 },
  { id: 'tiny', title: 'Under 1 MB', min: 0 },
];

const AGE_BANDS: { id: string; title: string; minDays: number }[] = [
  { id: 'ancient', title: 'Older than 3 years', minDays: 1095 },
  { id: 'old', title: '1 – 3 years old', minDays: 365 },
  { id: 'recent', title: '6 – 12 months old', minDays: 180 },
  { id: 'fresh', title: 'Last 6 months', minDays: 0 },
];

function bytesOf(email: any): number {
  return email?.sizeEstimate || 0;
}

function ageDays(email: any, now: number): number {
  const d = email?.date instanceof Date ? email.date : new Date(email?.date);
  const t = d.getTime();
  if (isNaN(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 86400000));
}

/**
 * Picks the dimension that matches what the page is for.
 *
 * Explicit user choice always wins; this only decides the default when a page is
 * opened for a particular job.
 */
export function chooseGrouping(context: {
  query?: string;
  folder?: string;
  action?: string;
  sortBy?: string;
}): GroupingStrategy {
  const query = (context.query || '').toLowerCase();
  const folder = (context.folder || '').toLowerCase();

  // Spam and Trash are different decisions — never merge them into one pile.
  if (folder === 'spam+trash' || (query.includes('in:spam') && query.includes('in:trash'))) {
    return 'folder';
  }

  // Storage work: the size band is the decision axis.
  if (context.sortBy === 'size' || query.includes('larger:') || query.includes('has:attachment')) {
    return 'size';
  }

  // Age-based sweeps read best oldest-first in bands.
  if (query.includes('older_than:')) {
    return 'age';
  }

  return 'category';
}

/** Sort that matches the grouping, so the ordering reinforces the same decision. */
export function sortForGrouping(strategy: GroupingStrategy): { sortBy: 'date' | 'size' | 'sender'; sortDesc: boolean } | null {
  if (strategy === 'size') return { sortBy: 'size', sortDesc: true };
  if (strategy === 'age') return { sortBy: 'date', sortDesc: false }; // oldest first
  return null;
}

export function groupEmails(
  emails: any[],
  strategy: GroupingStrategy,
  now: number = Date.now()
): EmailGroup[] {
  if (strategy === 'none' || emails.length === 0) {
    return [{ id: 'all', title: 'All messages', icon: 'inbox', emails, bytes: emails.reduce((s, e) => s + bytesOf(e), 0) }];
  }

  const buckets = new Map<string, EmailGroup>();
  const push = (key: string, title: string, icon: EmailGroup['icon'], email: any) => {
    let g = buckets.get(key);
    if (!g) {
      g = { id: key, title, icon, emails: [], bytes: 0 };
      buckets.set(key, g);
    }
    g.emails.push(email);
    g.bytes += bytesOf(email);
  };

  for (const email of emails) {
    const labels: string[] = email.labelIds || [];

    if (strategy === 'folder') {
      // A message can carry both in edge cases; Trash is the more specific state.
      if (labels.includes('TRASH')) push('trash', 'Trash', 'trash', email);
      else if (labels.includes('SPAM')) push('spam', 'Spam', 'spam', email);
      else if (labels.includes('INBOX')) push('inbox', 'Inbox', 'inbox', email);
      else push('archive', 'Archived', 'archive', email);
      continue;
    }

    if (strategy === 'size') {
      const b = bytesOf(email);
      const band = SIZE_BANDS.find(x => b >= x.min) || SIZE_BANDS[SIZE_BANDS.length - 1];
      push(band.id, band.title, 'size', email);
      continue;
    }

    if (strategy === 'age') {
      const days = ageDays(email, now);
      const band = AGE_BANDS.find(x => days >= x.minDays) || AGE_BANDS[AGE_BANDS.length - 1];
      push(band.id, band.title, 'clock', email);
      continue;
    }

    // category
    const match = CATEGORY_ORDER.find(c => labels.includes(c.label));
    if (match) {
      push(match.id, match.title, match.icon, email);
    } else if (labels.includes('TRASH')) {
      push('trash', 'Trash', 'trash', email);
    } else if (labels.includes('SPAM')) {
      push('spam', 'Spam', 'spam', email);
    } else {
      // Gmail omits CATEGORY_PERSONAL on plenty of ordinary mail, so anything
      // without a category label belongs in Primary rather than an "Other" bin.
      push('primary', 'Primary Inbox', 'inbox', email);
    }
  }

  const order: Record<string, number> = {};
  if (strategy === 'category') {
    CATEGORY_ORDER.forEach((c, i) => { order[c.id] = i; });
    order['spam'] = 90; order['trash'] = 91;
  } else if (strategy === 'folder') {
    order['inbox'] = 0; order['archive'] = 1; order['spam'] = 2; order['trash'] = 3;
  } else if (strategy === 'size') {
    SIZE_BANDS.forEach((b, i) => { order[b.id] = i; });
  } else if (strategy === 'age') {
    AGE_BANDS.forEach((b, i) => { order[b.id] = i; });
  }

  return Array.from(buckets.values()).sort(
    (a, b) => (order[a.id] ?? 50) - (order[b.id] ?? 50)
  );
}

const GROUPING_PREF_KEY = 'mailflow_group_messages_v1';

/** Grouping is on by default; the preference persists across sessions. */
export function readGroupingPref(): boolean {
  try {
    const raw = localStorage.getItem(GROUPING_PREF_KEY);
    return raw === null ? true : raw === 'true';
  } catch {
    return true;
  }
}

export function writeGroupingPref(enabled: boolean) {
  try {
    localStorage.setItem(GROUPING_PREF_KEY, String(enabled));
  } catch { }
}
