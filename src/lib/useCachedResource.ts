import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Stale-while-revalidate cache for expensive Gmail-derived data.
 *
 * Everything in MailFlow is fetched live from the Gmail API with no HTTP caching,
 * so re-entering a view used to mean paying for the whole analysis again (Inbox
 * Health alone costs ~30 requests). Components stay cheap to unmount — which keeps
 * their lifecycle honest — while their data survives navigation here.
 *
 * Reads are served instantly from cache; any inbox mutation marks entries stale so
 * the next render revalidates quietly in the background instead of blocking on a
 * loader.
 */

type Entry = {
  data: any;
  error: any;
  stale: boolean;
  inFlight: Promise<any> | null;
};

const cache = new Map<string, Entry>();
const subscribers = new Map<string, Set<() => void>>();

function notify(key: string) {
  subscribers.get(key)?.forEach(fn => fn());
}

function getEntry(key: string): Entry {
  let entry = cache.get(key);
  if (!entry) {
    entry = { data: null, error: null, stale: true, inFlight: null };
    cache.set(key, entry);
  }
  return entry;
}

/** Marks every cached resource stale so mounted views revalidate in the background. */
export function invalidateInboxCache() {
  cache.forEach(entry => { entry.stale = true; });
  subscribers.forEach((_subs, key) => notify(key));
}

/** Drops everything — used on sign-out so the next user never sees stale data. */
export function clearInboxCache() {
  cache.clear();
  subscribers.forEach((_subs, key) => notify(key));
}

// Any mutation anywhere in the app invalidates the derived views. Coalesced so a
// bulk action firing many events triggers a single revalidation pass.
if (typeof window !== 'undefined') {
  let pending: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener('inbox_metrics_updated', () => {
    if (pending) clearTimeout(pending);
    pending = setTimeout(() => {
      pending = null;
      invalidateInboxCache();
    }, 400);
  });
}

export interface CachedResource<T> {
  data: T | null;
  /** No data to show yet — safe to render a blocking loader. */
  loading: boolean;
  /** Data is on screen and being refreshed behind it — never block on this. */
  refreshing: boolean;
  error: any;
  refresh: () => void;
}

export function useCachedResource<T>(key: string | null, fetcher: () => Promise<T>): CachedResource<T> {
  const [, forceRender] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const revalidate = useCallback(() => {
    if (!key) return;
    const entry = getEntry(key);
    if (entry.inFlight) return; // dedupe concurrent mounts of the same resource

    entry.inFlight = fetcherRef.current()
      .then(data => {
        const current = getEntry(key);
        current.data = data;
        current.error = null;
        current.stale = false;
      })
      .catch(error => {
        const current = getEntry(key);
        current.error = error;
        current.stale = false;
      })
      .finally(() => {
        const current = getEntry(key);
        current.inFlight = null;
        notify(key);
      });

    notify(key);
  }, [key]);

  useEffect(() => {
    if (!key) return;
    const rerender = () => forceRender(n => n + 1);
    if (!subscribers.has(key)) subscribers.set(key, new Set());
    subscribers.get(key)!.add(rerender);

    const entry = getEntry(key);
    if (entry.data === null || entry.stale) revalidate();

    return () => {
      const subs = subscribers.get(key);
      subs?.delete(rerender);
      if (subs && subs.size === 0) subscribers.delete(key);
    };
  }, [key, revalidate]);

  const entry = key ? cache.get(key) : undefined;
  const hasData = entry?.data != null;

  return {
    data: (entry?.data ?? null) as T | null,
    loading: !hasData && !entry?.error,
    refreshing: hasData && !!entry?.inFlight,
    error: entry?.error ?? null,
    refresh: revalidate,
  };
}

/** True when the key holds usable, non-stale data. */
export function isCacheWarm(key: string): boolean {
  const entry = cache.get(key);
  return !!entry && entry.data != null && !entry.stale;
}

/**
 * Fills a cache entry ahead of the view that needs it.
 *
 * Returns false without fetching when the data is already warm, or when a mounted
 * view has a request in flight for the same key — background warming must never
 * duplicate work the user is already waiting on, since both would spend the same
 * quota to produce the same answer.
 */
export async function warmCachedResource<T>(
  key: string,
  fetcher: () => Promise<T>
): Promise<boolean> {
  const entry = getEntry(key);
  if (entry.data != null && !entry.stale) return false;
  if (entry.inFlight) return false;

  const request = fetcher()
    .then(data => {
      const current = getEntry(key);
      current.data = data;
      current.error = null;
      current.stale = false;
    })
    .catch(error => {
      const current = getEntry(key);
      current.error = error;
      current.stale = false;
    })
    .finally(() => {
      const current = getEntry(key);
      current.inFlight = null;
      notify(key);
    });

  entry.inFlight = request;
  await request;
  return true;
}

/**
 * Writes straight into the cache so an optimistic local update survives navigation
 * (e.g. trimming a sender's count right after trashing their mail).
 */
export function mutateCachedResource<T>(key: string, updater: (current: T | null) => T | null) {
  const entry = getEntry(key);
  entry.data = updater(entry.data as T | null);
  notify(key);
}
