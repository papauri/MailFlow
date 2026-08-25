import { useEffect } from 'react';
import { backgroundScheduler } from './backgroundWorker';

/**
 * Fetches route chunks ahead of use.
 *
 * Splitting the bundle cut what loads before the inbox appears, but it moved that
 * cost to the first visit of each page: a spinner while its JavaScript downloads.
 * Pulling the chunks quietly once the app is idle keeps the small initial payload
 * and removes the wait, so navigation is instant either way.
 *
 * This is cheap and finite in a way the data warming is not — static assets served
 * from the same origin, cached by the browser, no Gmail quota involved and nothing
 * that can change under us. So it runs ahead of data warming in the queue, and in
 * likely-visit order: Inbox Health first, since that is where the app points people.
 */

const ROUTE_CHUNKS: { id: string; label: string; load: () => Promise<unknown> }[] = [
  { id: 'chunk:health', label: 'Preparing Inbox Health…', load: () => import('../components/InboxHealth') },
  { id: 'chunk:score', label: 'Preparing Health Score…', load: () => import('../components/HealthScoreModal') },
  { id: 'chunk:category', label: 'Preparing Category Breakdown…', load: () => import('../components/CategoryDistributionModal') },
  { id: 'chunk:senders', label: 'Preparing Sender Analytics…', load: () => import('../components/SenderAnalyticsPage') },
  { id: 'chunk:folders', label: 'Preparing Folder Optimizer…', load: () => import('../components/FolderOptimizer') },
  { id: 'chunk:rules', label: 'Preparing Sorting Rules…', load: () => import('../components/RuleSuggester') },
  { id: 'chunk:triage', label: 'Preparing Smart Organizer…', load: () => import('../components/SmartTriageModal') },
  { id: 'chunk:subs', label: 'Preparing Subscriptions…', load: () => import('../components/UnsubscribeManager') },
  { id: 'chunk:export', label: 'Preparing Export Center…', load: () => import('../components/ExportCenter') },
];

/** Give the first render and the initial inbox load a clear run first. */
const SETTLE_MS = 2500;

export function useRoutePrefetch(enabled: boolean = true) {
  useEffect(() => {
    if (!enabled) return;

    // Metered or slow connections: the point is to feel fast, not to spend someone's
    // data plan on screens they may never open.
    const conn = (navigator as any)?.connection;
    if (conn?.saveData) return;
    if (conn?.effectiveType && /2g/.test(conn.effectiveType)) return;

    const timer = setTimeout(() => {
      ROUTE_CHUNKS.forEach((chunk, index) => {
        backgroundScheduler.add({
          id: chunk.id,
          label: chunk.label,
          // Ahead of data warming (50+) but behind anything the user is watching.
          priority: 20 + index,
          step: async () => {
            // A failed chunk fetch is not worth retrying or surfacing: the route
            // still loads normally on navigation, just without the head start.
            await chunk.load().catch(() => undefined);
            return false;
          },
        });
      });
    }, SETTLE_MS);

    return () => {
      clearTimeout(timer);
      ROUTE_CHUNKS.forEach(chunk => backgroundScheduler.remove(chunk.id));
    };
  }, [enabled]);
}
