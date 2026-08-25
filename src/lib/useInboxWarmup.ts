import { useEffect, useState } from 'react';
import { backgroundScheduler } from './backgroundWorker';
import { warmCachedResource, isCacheWarm } from './useCachedResource';
import {
  fetchInboxStats, fetchSenderClusters, fetchRoutingSample,
  inboxStatsKey, senderClustersKey, routingSampleKey,
} from './inboxAnalytics';

/**
 * Warms the expensive analyses so their pages open instantly.
 *
 * Inbox Health costs roughly thirty Gmail requests, sender clusters a search plus a
 * count per sender, routing two searches. Paid on demand that is a visible wait
 * every time; paid quietly beforehand it is invisible.
 *
 * The tension is that this spends the user's quota on pages they may never open, so
 * the gating is deliberate:
 *
 *  - Starts only after a settling delay, so it never competes with the first paint
 *    or the initial inbox load.
 *  - Runs behind anything user-visible. The scheduler orders by priority and these
 *    sit well below the category deepening pass, which is work someone is watching.
 *  - Skips a resource that is already warm, or that a mounted view is currently
 *    fetching — warming must never duplicate a request the user is waiting on.
 *  - Cheapest first, so if the tab is closed early the least is wasted.
 *  - Inherits the scheduler's rules: one at a time, paused while hidden, abandoned
 *    after repeated failure.
 */

const SETTLE_MS = 6000;

export function useInboxWarmup(userEmail?: string, enabled: boolean = true) {
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    const timer = setTimeout(() => setSettled(true), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [enabled]);

  useEffect(() => {
    if (!settled || !enabled) return;

    // Ordered cheapest to most expensive: two searches, then a search plus per-sender
    // counts, then the full Health analysis.
    const jobs: { id: string; label: string; priority: number; run: () => Promise<unknown> }[] = [
      {
        id: 'warm:routing',
        label: 'Preparing folder suggestions…',
        priority: 50,
        run: () => warmCachedResource(routingSampleKey(userEmail), () => fetchRoutingSample()),
      },
      {
        id: 'warm:clusters',
        label: 'Preparing sender analytics…',
        priority: 60,
        run: () => warmCachedResource(senderClustersKey(userEmail), () => fetchSenderClusters(userEmail)),
      },
      {
        id: 'warm:stats',
        label: 'Preparing Inbox Health…',
        priority: 70,
        run: () => warmCachedResource(inboxStatsKey(userEmail), () => fetchInboxStats()),
      },
    ];

    const keyFor: Record<string, string> = {
      'warm:routing': routingSampleKey(userEmail),
      'warm:clusters': senderClustersKey(userEmail),
      'warm:stats': inboxStatsKey(userEmail),
    };

    for (const job of jobs) {
      backgroundScheduler.add({
        id: job.id,
        label: job.label,
        priority: job.priority,
        step: async (signal) => {
          // Re-check at run time, not queue time: the user may have opened the page
          // themselves during the wait, in which case there is nothing left to do.
          if (signal.aborted || isCacheWarm(keyFor[job.id])) return false;
          await job.run();
          return false; // single-shot
        },
      });
    }

    return () => { jobs.forEach(job => backgroundScheduler.remove(job.id)); };
  }, [settled, enabled, userEmail]);
}
