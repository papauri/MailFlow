/**
 * Every one-click filter in the app, defined once.
 *
 * These previously lived in two places — four in the Quick Filters dropdown and six
 * in a separate presets bar — with different query hygiene and no shared shape.
 *
 * Two of the old presets ("Receipts & Billing", "Shipping & Delivery") matched
 * English words in subject lines, which finds nothing for anyone whose mail is not
 * in English and misses any wording the author did not think of. They are replaced
 * with metadata equivalents that answer the same underlying question — what is old
 * and bulky, what did I never open — using signals Gmail itself indexes.
 *
 * The one remaining sender-based preset (Dev & CI) matches on domains rather than
 * words, which is language-independent and stays.
 */

export type PresetGroup = 'Triage' | 'Storage' | 'Clutter';

export interface CleanupPreset {
  id: string;
  name: string;
  emoji: string;
  group: PresetGroup;
  /** Full Gmail query. Everything lives here so nothing depends on folder state. */
  query: string;
  folderFilters?: string[];
  sortBy?: 'date' | 'size' | 'sender';
  sortDesc?: boolean;
  badge?: string;
  description: string;
  isCustom?: boolean;
}

/**
 * Shared exclusions. Sent mail and drafts are things the user wrote, and spam/trash
 * are already staged for deletion — none of them belong in a cleanup sweep, and
 * several of the old queries forgot one or more of these.
 */
const LIVE = '-in:trash -in:spam';
const LIVE_STRICT = '-in:trash -in:spam -in:sent -is:draft';

export const DEFAULT_PRESETS: CleanupPreset[] = [
  // --- Triage -------------------------------------------------------------
  {
    id: 'important_unread',
    name: 'Important Unread',
    emoji: '⚡',
    group: 'Triage',
    query: `is:unread is:important -category:promotions ${LIVE}`,
    sortBy: 'date',
    sortDesc: true,
    description: 'Unread mail Gmail flagged as important',
  },
  {
    id: 'unread_inbox',
    name: 'Unread Inbox',
    emoji: '📥',
    group: 'Triage',
    query: 'is:unread in:inbox -in:chats',
    sortBy: 'date',
    sortDesc: true,
    description: 'Everything still unread in your inbox',
  },
  {
    id: 'never_opened',
    name: 'Never Opened (>3m)',
    emoji: '👁️',
    group: 'Triage',
    badge: '>3m',
    // Replaces the old subject-keyword "Shipping & Delivery" preset. Mail you never
    // opened and is now months old is the strongest language-independent signal
    // that you were never going to read it.
    query: `is:unread older_than:3m ${LIVE_STRICT}`,
    sortBy: 'date',
    sortDesc: false,
    description: 'Old mail you never opened — safe to clear in bulk',
  },

  // --- Storage ------------------------------------------------------------
  {
    id: 'heavy_files',
    name: 'Heavy Files (>10MB)',
    emoji: '📎',
    group: 'Storage',
    badge: '>10MB',
    query: `larger:10M ${LIVE}`,
    sortBy: 'size',
    sortDesc: true,
    description: 'Largest messages first — the fastest way to reclaim space',
  },
  {
    id: 'old_attachments',
    name: 'Old Attachments (>1y)',
    emoji: '🗂️',
    group: 'Storage',
    badge: '>1y',
    // Replaces the old subject-keyword "Receipts & Billing" preset: year-old
    // attachments are the storage that receipts hunting was really aiming at.
    query: `has:attachment older_than:1y ${LIVE_STRICT}`,
    sortBy: 'size',
    sortDesc: true,
    description: 'Attachments over a year old, biggest first',
  },
  {
    id: 'old_mail',
    name: 'Older Than 1 Year',
    emoji: '🕰️',
    group: 'Storage',
    badge: '>1y',
    query: `older_than:1y ${LIVE_STRICT}`,
    sortBy: 'size',
    sortDesc: true,
    description: 'Anything you have not touched in over a year',
  },

  // --- Clutter ------------------------------------------------------------
  {
    id: 'stale_promos',
    name: 'Stale Promotions',
    emoji: '🛍️',
    group: 'Clutter',
    badge: '>6m',
    query: `category:promotions older_than:6m ${LIVE}`,
    sortBy: 'date',
    sortDesc: false,
    description: 'Marketing mail older than six months',
  },
  {
    id: 'social_updates',
    name: 'Social & Updates',
    emoji: '🔔',
    group: 'Clutter',
    badge: '>3m',
    query: `(category:social OR category:updates) older_than:3m ${LIVE}`,
    sortBy: 'date',
    sortDesc: false,
    description: 'Notification noise older than three months',
  },
  {
    id: 'dev_alerts',
    name: 'Dev & CI Alerts',
    emoji: '💻',
    group: 'Clutter',
    badge: '>14d',
    query: `from:(github.com OR gitlab.com OR bitbucket.org OR vercel.com OR netlify.com OR circleci.com) older_than:14d ${LIVE}`,
    sortBy: 'date',
    sortDesc: false,
    description: 'Automated build and repository notifications',
  },
  {
    id: 'spam_trash',
    name: 'Spam & Trash',
    emoji: '🗑️',
    group: 'Clutter',
    query: 'in:spam OR in:trash',
    folderFilters: ['spam', 'trash'],
    sortBy: 'size',
    sortDesc: true,
    description: 'Already staged for deletion — still using your quota',
  },
];

export const PRESET_GROUPS: PresetGroup[] = ['Triage', 'Storage', 'Clutter'];

const CUSTOM_PRESETS_KEY = 'ais_cleanup_custom_presets';

export function readCustomPresets(): CleanupPreset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    // Older saved presets predate `group`; file them under Clutter so they still show.
    return parsed.map((p: any) => ({
      ...p,
      group: (p.group as PresetGroup) || 'Clutter',
      isCustom: true,
    }));
  } catch {
    return [];
  }
}

export function writeCustomPresets(presets: CleanupPreset[]) {
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets));
  } catch { }
}

export function allPresets(): CleanupPreset[] {
  return [...readCustomPresets(), ...DEFAULT_PRESETS];
}
