/**
 * Optional wording layer over locally-computed findings.
 *
 * The local models decide *what* to recommend and how to rank it. This only asks a
 * model to say it better. That split is deliberate: the recommendations must be
 * identical whether or not a key is configured or a quota is intact, so nothing here
 * may add, drop or reorder a finding — it maps wording onto ids that already exist,
 * and any failure silently keeps the local text.
 *
 * Only aggregate statistics leave the browser. Subjects, snippets and bodies never do.
 */

export interface EnrichableFinding {
  id: string;
  kind: string;
  /** Who or what the finding is about, e.g. a sender display name. */
  subject: string;
  /** Where it would go, for routing suggestions. */
  destination?: string;
  /** Pre-formatted aggregate stats — never message content. */
  stats: string;
}

export interface EnrichedText {
  title?: string;
  rationale?: string;
  folderName?: string;
}

/** Cheap client-side gate so we don't call the endpoint with no key configured. */
export function canAttemptEnrichment(aiSettings: any): boolean {
  if (!aiSettings) return false;
  if (sessionStorage.getItem('ai_quota_ok') === 'false') return false;
  return Boolean(aiSettings.apiKey || aiSettings.provider);
}

export async function enrichSuggestions(
  findings: EnrichableFinding[],
  aiSettings: any,
  timeoutMs: number = 12000
): Promise<Map<string, EnrichedText>> {
  const empty = new Map<string, EnrichedText>();
  if (!findings.length || !canAttemptEnrichment(aiSettings)) return empty;

  // Never let a slow model hold up a view that already has everything it needs.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch('/api/enrich-suggestions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ findings, settings: aiSettings }),
      signal: controller.signal,
    });

    if (res.status === 429) {
      // Remember the quota is spent so later views skip the round trip entirely.
      try { sessionStorage.setItem('ai_quota_ok', 'false'); } catch { }
      return empty;
    }
    if (!res.ok) return empty;

    const data = await res.json();
    if (!data || !Array.isArray(data.items)) return empty;

    const map = new Map<string, EnrichedText>();
    for (const item of data.items) {
      if (!item?.id) continue;
      map.set(String(item.id), {
        title: item.title || undefined,
        rationale: item.rationale || undefined,
        folderName: item.folderName || undefined,
      });
    }
    return map;
  } catch {
    // Aborted, offline, or malformed — the local wording stands.
    return empty;
  } finally {
    clearTimeout(timer);
  }
}
