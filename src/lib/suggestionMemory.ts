/**
 * Feedback memory for suggestion ranking.
 *
 * Suggestions used to be stateless: dismiss one and an identical suggestion returns
 * on the next scan, forever. This records what the user accepted or rejected and
 * feeds it back as a prior, so the ranking adapts to the person using it.
 *
 * Deliberately keyed by the *pattern* (sender + intended destination), not by a
 * generated suggestion id, so the memory still applies after a rescan produces new
 * ids for the same underlying proposal.
 */

const STORAGE_KEY = 'mailflow_suggestion_memory_v1';
const MAX_ENTRIES = 500;

export type Decision = 'accepted' | 'dismissed';

interface MemoryEntry {
  accepted: number;
  dismissed: number;
  updated: number;
}

type MemoryMap = Record<string, MemoryEntry>;

function read(): MemoryMap {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function write(map: MemoryMap) {
  try {
    // Keep the store bounded — evict least recently updated first.
    const keys = Object.keys(map);
    if (keys.length > MAX_ENTRIES) {
      const sorted = keys.sort((a, b) => (map[a].updated || 0) - (map[b].updated || 0));
      for (const key of sorted.slice(0, keys.length - MAX_ENTRIES)) delete map[key];
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Storage unavailable (private mode, quota) — ranking simply stays unweighted.
  }
}

/** Stable key for a suggestion pattern, independent of any generated id. */
export function patternKey(kind: string, subject: string, destination?: string): string {
  return [kind, subject.toLowerCase().trim(), (destination || '').toLowerCase().trim()]
    .filter(Boolean)
    .join('|');
}

export function recordDecision(key: string, decision: Decision) {
  const map = read();
  const entry = map[key] || { accepted: 0, dismissed: 0, updated: 0 };
  if (decision === 'accepted') entry.accepted += 1;
  else entry.dismissed += 1;
  entry.updated = Date.now();
  map[key] = entry;
  write(map);
}

/**
 * Ranking multiplier for a pattern.
 *
 * Rejections damp hard and fast — being shown the same unwanted suggestion twice is
 * the complaint, so two dismissals push it near the bottom. Acceptances lift more
 * gently, because a pattern that worked once is encouraging but not proof.
 * Bounded on both sides so memory tunes the order without ever fabricating or
 * suppressing a finding outright.
 */
export function priorFor(key: string): number {
  const entry = read()[key];
  if (!entry) return 1;
  const lift = 1 + Math.min(0.5, entry.accepted * 0.25);
  const damp = Math.max(0.15, 1 - entry.dismissed * 0.45);
  return Math.max(0.15, Math.min(1.5, lift * damp));
}

/** True once a pattern has been rejected enough times to stop offering it. */
export function isSuppressed(key: string): boolean {
  const entry = read()[key];
  return !!entry && entry.dismissed >= 3 && entry.accepted === 0;
}

export function memoryStats(): { patterns: number; accepted: number; dismissed: number } {
  const map = read();
  const values = Object.values(map);
  return {
    patterns: values.length,
    accepted: values.reduce((s, e) => s + e.accepted, 0),
    dismissed: values.reduce((s, e) => s + e.dismissed, 0),
  };
}

export function clearMemory() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch { }
}
