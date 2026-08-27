import React, { useState, useEffect, useRef, useMemo } from 'react';
import { countEmails, fetchMailboxSize } from '../lib/gmail';
import { cn } from '../lib/utils';
import { Activity } from 'lucide-react';
import {
  computeInboxHealthScore, getUserManagementCounts, applyMetricEvent,
  HEALTH_SCORE_QUERIES, HealthScoreMetrics,
} from '../lib/emailUtils';

/**
 * Cached metrics, not a cached score.
 *
 * The widget used to cache only the final number. That made the score appear
 * instantly on mount but left `metrics` null until five `countEmails` calls
 * resolved — and every optimistic update needs `metrics` to apply a delta to. In
 * that window, which is seconds on a large mailbox because the quota governor is
 * also serving Inbox Health's own eight counts, an action would fall through to a
 * full refetch instead of updating. Caching the inputs means the very first render
 * can already do the arithmetic.
 */
const METRICS_CACHE_KEY = 'ais_cached_health_metrics_v2';

function readCachedMetrics(): HealthScoreMetrics | null {
  try {
    const raw = sessionStorage.getItem(METRICS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    // Scoring is relative to mailbox size, so a cached entry without it would render
    // the fixed-reference fallback for a beat and then jump. Treat it as absent.
    if (!parsed.mailboxTotal) return null;
    return parsed as HealthScoreMetrics;
  } catch {
    return null;
  }
}

function writeCachedMetrics(metrics: HealthScoreMetrics) {
  try {
    sessionStorage.setItem(METRICS_CACHE_KEY, JSON.stringify(metrics));
  } catch { }
}

export function HealthScoreWidget({
  onApplyQuery,
  onOpenUnsubscribe,
  compact = false
}: {
  onApplyQuery?: (query: string, filter?: string, sortOption?: "date" | "size" | "sender") => void;
  onOpenUnsubscribe?: () => void;
  compact?: boolean;
}) {
  const [metrics, setMetrics] = useState<HealthScoreMetrics | null>(readCachedMetrics);
  const [loading, setLoading] = useState(metrics === null);
  const [recentGain, setRecentGain] = useState<number | null>(null);
  const [isPulsing, setIsPulsing] = useState(false);

  /**
   * The score is derived, never stored.
   *
   * It was separate state that every code path had to remember to keep in step with
   * `metrics`, and the sync happened inside the `setMetrics` updater. Deriving it
   * means an optimistic metric change and the number on screen cannot disagree, and
   * the updater has nothing left to do but return the next metrics.
   */
  const score = useMemo(
    () => (metrics ? computeInboxHealthScore(metrics) : null),
    [metrics]
  );

  // Persist whatever is currently on screen, so a remount starts from it.
  useEffect(() => {
    if (metrics) writeCachedMetrics(metrics);
  }, [metrics]);

  /**
   * The "+N" badge, driven by the rendered score rather than computed inside the
   * updater. Skips the first settled value so arriving at a score is not reported
   * as having gained it.
   */
  const prevScoreRef = useRef<number | null>(null);
  /**
   * Set whenever the next score change comes from a fetch rather than a user
   * action. A refetch can move the score for reasons the user did nothing about —
   * mail arriving, the cached value being stale from a previous session — and
   * celebrating that as a "+N" they just earned is a lie about their own progress.
   */
  const rebaseOnlyRef = useRef(false);

  useEffect(() => {
    if (score === null) return;
    const prev = prevScoreRef.current;
    prevScoreRef.current = score;

    if (rebaseOnlyRef.current) {
      rebaseOnlyRef.current = false;
      return;
    }
    if (prev === null || score <= prev) return;

    setRecentGain(score - prev);
    setIsPulsing(true);
    const timer = setTimeout(() => {
      setRecentGain(null);
      setIsPulsing(false);
    }, 3000);
    return () => clearTimeout(timer);
  }, [score]);

  useEffect(() => {
    let cancelled = false;

    async function calculateScore() {
      try {
        const [size, unread, junk, promo, large, oldMail] = await Promise.all([
          // One quota unit each, and they resolve well before the counts do.
          fetchMailboxSize().catch(() => ({ mailboxTotal: 0, inboxTotal: 0 })),
          countEmails(HEALTH_SCORE_QUERIES.unread).catch(() => 0),
          countEmails(HEALTH_SCORE_QUERIES.spamAndTrash).catch(() => 0),
          countEmails(HEALTH_SCORE_QUERIES.oldPromotions).catch(() => 0),
          countEmails(HEALTH_SCORE_QUERIES.largeFiles).catch(() => 0),
          countEmails(HEALTH_SCORE_QUERIES.oldMail).catch(() => 0)
        ]);
        if (cancelled) return;

        const parseCount = (val: any) => typeof val === 'number' ? val : (parseInt(String(val).replace(/\D/g, '')) || 0);
        const { unsubscribedCount, activeFiltersCount } = getUserManagementCounts();

        // Server truth landing is a re-baseline, not something the user just did.
        rebaseOnlyRef.current = true;
        setMetrics({
          unreadInbox: parseCount(unread),
          spamAndTrash: parseCount(junk),
          oldPromotions: parseCount(promo),
          largeFiles: parseCount(large),
          oldMail: parseCount(oldMail),
          unsubscribedCount,
          activeFiltersCount,
          mailboxTotal: size.mailboxTotal,
          inboxTotal: size.inboxTotal,
        });
      } catch (e) {
        console.error("Failed to calculate health score", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    calculateScore();

    /**
     * Optimistic update. The updater is pure — it returns the next metrics and
     * nothing else — so React re-invoking it under StrictMode changes no outcome.
     * Returning `prev` unchanged when the event moves nothing lets React bail out
     * of the render entirely.
     */
    const handleInboxMetricsUpdated = (e: any) => {
      const detail = e?.detail || {};
      setMetrics(prev => {
        const next = applyMetricEvent(prev, detail);
        if (!next) {
          // Nothing to apply yet because the first fetch has not landed. The fetch
          // already in flight will supply the real numbers.
          return prev;
        }
        return next;
      });
    };

    /**
     * Unsubscribes and new filter rules only move counters this reads straight out
     * of localStorage, so recompute the bonus in place. This used to trigger the
     * full five-query refetch, which is a multi-second round trip to learn a number
     * already sitting in localStorage — and the delay was visible in the navbar.
     */
    const handleBonusUpdate = () => {
      const { unsubscribedCount, activeFiltersCount } = getUserManagementCounts();
      setMetrics(prev => {
        if (!prev) return prev;
        if (prev.unsubscribedCount === unsubscribedCount && prev.activeFiltersCount === activeFiltersCount) {
          return prev;
        }
        return { ...prev, unsubscribedCount, activeFiltersCount };
      });
    };

    window.addEventListener('inbox_metrics_updated', handleInboxMetricsUpdated);
    window.addEventListener('health-score-update', handleBonusUpdate);

    return () => {
      cancelled = true;
      window.removeEventListener('inbox_metrics_updated', handleInboxMetricsUpdated);
      window.removeEventListener('health-score-update', handleBonusUpdate);
    };
  }, []);

  if (loading && score === null) {
    return (
      <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-slate-100 rounded-full animate-pulse shrink-0">
        <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 border-slate-300"></div>
        <div className="h-2.5 sm:h-3 w-8 sm:w-12 bg-slate-300 rounded"></div>
      </div>
    );
  }

  // Calculate circle dash array
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const displayScore = score ?? 0;
  const strokeDashoffset = circumference - (displayScore / 100) * circumference;

  let colorClass = "text-emerald-500";
  let borderHighlight = "border-slate-200";
  if (displayScore < 40) {
    colorClass = "text-rose-500";
  } else if (displayScore < 70) {
    colorClass = "text-amber-500";
  }

  if (isPulsing) {
    borderHighlight = "border-emerald-400 ring-2 ring-emerald-400/20 bg-emerald-50/50";
  }

  return (
    <button 
      type="button"
      onClick={() => { window.location.hash = '#health-score'; }}
      className={cn(
        "relative flex items-center gap-1.5 sm:gap-2.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-slate-50 hover:bg-slate-100/90 border rounded-full shadow-2xs transition-all duration-300 cursor-pointer text-left group shrink-0",
        borderHighlight
      )} 
      title="Click to view Inbox Health Score breakdown & instant recommendations"
    >
      <div className="relative w-5 h-5 sm:w-7 sm:h-7 flex items-center justify-center shrink-0">
        {/* Background circle */}
        <svg className="absolute inset-0 w-full h-full -rotate-90 transform" viewBox="0 0 24 24">
          <circle
            cx="12"
            cy="12"
            r={radius}
            stroke="currentColor"
            strokeWidth="3"
            fill="transparent"
            className="text-slate-200"
          />
          {/* Progress circle with smooth transition */}
          <circle
            cx="12"
            cy="12"
            r={radius}
            stroke="currentColor"
            strokeWidth="3"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className={cn("transition-all duration-700 ease-out", colorClass)}
            strokeLinecap="round"
          />
        </svg>
        <Activity className={cn("w-2.5 h-2.5 sm:w-3 sm:h-3 absolute z-10 group-hover:scale-110 transition-transform", colorClass)} />
      </div>
      <div className="flex flex-col">
        <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 group-hover:text-slate-700 uppercase tracking-wider leading-none mb-0.5 hidden xs:inline">Health</span>
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold text-slate-800 leading-none transition-all">{displayScore}%</span>
          {recentGain && (
            <span className="text-[10px] font-bold text-emerald-600 animate-bounce leading-none">
              +{recentGain}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
