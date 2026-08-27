import React, { useState, useEffect, useMemo } from 'react';
import { useCachedResource, mutateCachedResource } from '../lib/useCachedResource';
import { buildRecommendations } from '../lib/recommendations';
import { formatBytes } from '../lib/csvExport';
import { PageHeader } from './PageHeader';
import {
  fetchInboxStats, fetchSenderClusters, inboxStatsKey, senderClustersKey, InboxStatsResult, InboxStats
} from '../lib/inboxAnalytics';
import { Loader2, HardDrive, Trash2, MailOpen, ShieldAlert, SlidersHorizontal, ArrowRight, Target, Filter, ShieldCheck, PieChart, Tag, AlertCircle, User, Clock, Bell, Layers, Download, Calculator, Activity, Sparkles, Folder, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../lib/utils';
import { SketchLoadingState } from "./SketchLoader";
import { StorageBreakdownBar } from './StorageBreakdownBar';
import { computeInboxHealthScore, getUserManagementCounts } from '../lib/emailUtils';

export function InboxHealth({ userEmail, onApplyQuery, aiSettings, userLabels, onRefresh, isAiWorking }: { userEmail?: string, onApplyQuery: (q: string, filter?: string, sortOption?: "date" | "size" | "sender", metadata?: any) => void, aiSettings?: any, userLabels?: any[], onRefresh?: () => void, isAiWorking?: boolean }) {
  // Data lives in the shared cache, so this component can unmount freely without
  // costing a full re-analysis on the way back in.
  const statsResource = useCachedResource(inboxStatsKey(userEmail), () => fetchInboxStats());
  const clustersResource = useCachedResource(senderClustersKey(userEmail), () => fetchSenderClusters(userEmail));

  const stats = statsResource.data?.stats ?? null;
  const sizes = statsResource.data?.sizes ?? {};
  const topSenders = clustersResource.data?.topSenders ?? [];
  const topDomains = clustersResource.data?.topDomains ?? [];
  const loading = statsResource.loading;
  const isLoadingEmails = clustersResource.loading;

  /** Bumped when the hygiene bonus changes, so the score memo recomputes. */
  const [bonusVersion, setBonusVersion] = useState(0);

  const openFilterPage = (
    query: string,
    title: string,
    badge: string,
    subtitle?: string,
    folder: string = 'anywhere',
    sortOption?: "date" | "size" | "sender",
    source: string = 'health'
  ) => {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('title', title);
    params.set('badge', badge);
    if (subtitle) params.set('sub', subtitle);
    if (folder) params.set('folder', folder);
    if (sortOption) params.set('sort', sortOption);
    params.set('source', source);
    window.location.hash = `#filter-view?${params.toString()}`;
  };


  // Patch the cached counts the instant an action lands so the UI never lags. The
  // shared cache also marks itself stale on these events and revalidates quietly in
  // the background, so these optimistic numbers get reconciled with Gmail shortly
  // after without ever showing a loader.
  useEffect(() => {
    const handleMetricsUpdated = (e: any) => {
      const { type, count, isPartial } = e.detail || {};

      // Which stat each event touches, in one place. Events naming anything else
      // (a new rule, a category with no matching counter) fall through untouched —
      // the cache is invalidated regardless, so the honest response to an event we
      // cannot map is to let the background revalidation supply the real number
      // rather than subtract it from whichever tile happens to be nearby.
      const FIELD: Record<string, keyof InboxStats> = {
        unread: 'unread',
        spam: 'spamAndTrash',
        promo: 'oldPromo',
        large: 'large',
        oldMail: 'oldMail',
        updatesAndSocial: 'updatesAndSocial',
      };
      const field = FIELD[type];
      if (!field) return;

      mutateCachedResource<InboxStatsResult>(inboxStatsKey(userEmail), (prev) => {
        if (!prev) return prev;
        const stats = { ...prev.stats };
        const applied = Number(count) || 0;
        stats[field] = isPartial ? Math.max(0, stats[field] - applied) : 0;
        return { ...prev, stats };
      });
    };

    /**
     * Unsubscribes and new filter rules move the score through the hygiene bonus,
     * which is read from localStorage rather than from `stats` — so the score memo
     * below, which depends on `stats`, had no reason to recompute and the card sat
     * on its old number. This state exists purely to give it one.
     */
    const handleBonusUpdate = () => setBonusVersion(v => v + 1);

    window.addEventListener('inbox_metrics_updated', handleMetricsUpdated);
    window.addEventListener('health-score-update', handleBonusUpdate);
    return () => {
      window.removeEventListener('inbox_metrics_updated', handleMetricsUpdated);
      window.removeEventListener('health-score-update', handleBonusUpdate);
    };
  }, [userEmail]);

  /**
   * The score itself, not a proxy for it.
   *
   * This card is titled "Inbox Score" and was showing the raw unread count, so an
   * inbox with 812 unread displayed "812" next to the word Score — a number that
   * looks like a score, reads like a score, and is off by an order of magnitude from
   * the one behind the card. Computed here from the same model and the same counts
   * the Inbox Score page uses, so the two always agree.
   */
  const healthScore = useMemo(() => {
    if (!stats) return null;
    const { unsubscribedCount, activeFiltersCount } = getUserManagementCounts();
    return computeInboxHealthScore({
      unreadInbox: stats.unread,
      spamAndTrash: stats.spamAndTrash,
      oldPromotions: stats.oldPromo,
      largeFiles: stats.large,
      oldMail: stats.oldMail,
      unsubscribedCount,
      activeFiltersCount,
      mailboxTotal: stats.mailboxTotal,
      inboxTotal: stats.inboxTotal,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stats, bonusVersion]);

  // Personalised, ranked next steps derived from this inbox's real numbers.
  const recommendations = useMemo(
    () => buildRecommendations(stats, sizes, topSenders),
    [stats, sizes, topSenders]
  );
  /**
   * A reclaimable figure that is actually true.
   *
   * This was the sum of every recommendation's bytes, and those sets overlap by
   * construction: a 9 MB attachment from two years ago is counted by "large
   * attachments" and again by "mail older than a year", and a stale promo older than
   * a year is counted twice as well. Summing them produced a headline number larger
   * than the storage that exists to reclaim, and no clean-up could ever match it.
   *
   * The exact size of the union is not knowable without more queries than this badge
   * is worth, but the largest single category is a floor that always holds — so the
   * claim is stated as a floor.
   */
  const leastReclaimable = useMemo(
    () => recommendations.reduce((max, r) => Math.max(max, r.bytesReclaimed), 0),
    [recommendations]
  );

  if (loading || isLoadingEmails) {
    return <SketchLoadingState scene="measuring" title="Sizing up your inbox" messages={["Scanning folders…", "Weighing storage…", "Finding the heavy stuff…", "Spotting subscriptions…"]} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inbox Health"
        subtitle="Where your storage and clutter actually are."
        icon={<Activity className="w-4 h-4" />}
        actions={
          <button
            onClick={() => { statsResource.refresh(); clustersResource.refresh(); }}
            disabled={statsResource.refreshing || clustersResource.refreshing}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh inbox analysis"
          >
            <Loader2 className={cn("w-4 h-4", (statsResource.refreshing || clustersResource.refreshing) ? "animate-spin" : "hidden")} />
            <Activity className={cn("w-4 h-4", (statsResource.refreshing || clustersResource.refreshing) && "hidden")} />
          </button>
        }
      />

      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs relative overflow-hidden mb-4 sm:mb-6">
        <div className="flex items-start gap-4 relative z-10">
          <div className="bg-slate-50 text-slate-700 border border-slate-200 p-2.5 rounded-xl shrink-0 hidden sm:block">
            <Sparkles className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-3 flex-wrap mb-1">
              <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                {recommendations.length > 0 ? 'Start here' : "You're all caught up"}
              </h3>
              {leastReclaimable > 0 && (
                <span className="text-[11px] font-semibold bg-slate-100 text-slate-800 px-2 py-0.5 rounded-md border border-slate-200">
                  at least {formatBytes(leastReclaimable)} reclaimable
                </span>
              )}
            </div>
            <p className="text-slate-600 text-xs sm:text-sm mb-4 leading-relaxed max-w-3xl">
              {recommendations.length > 0
                ? 'Ranked by what each one is actually worth to your inbox right now — highest impact first.'
                : 'No clutter worth acting on was found. Your inbox is in good shape.'}
            </p>

            {recommendations.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {recommendations.slice(0, 3).map((rec, i) => (
                  <button
                    key={rec.id}
                    onClick={() => { window.location.hash = rec.hash; }}
                    className="text-left bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-3.5 shadow-xs hover:shadow-sm transition-all cursor-pointer flex flex-col group"
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <div className={cn(
                        "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
                        rec.severity === 'high' ? "bg-rose-100 text-rose-700"
                          : rec.severity === 'medium' ? "bg-amber-100 text-amber-700"
                          : "bg-slate-100 text-slate-600"
                      )}>{i + 1}</div>
                      <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wide truncate">{rec.title}</h4>
                    </div>
                    <p className="text-[11px] text-slate-600 leading-relaxed mb-2.5 flex-1">{rec.detail}</p>
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-slate-100">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {rec.pointsGain > 0 && (
                          <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                            +{rec.pointsGain} pts
                          </span>
                        )}
                        {rec.bytesReclaimed > 0 && (
                          <span className="text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                            {formatBytes(rec.bytesReclaimed)}
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] font-semibold text-slate-700 group-hover:text-slate-900 flex items-center gap-1 shrink-0">
                        {rec.actionLabel}
                        <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div id="storage-breakdown" className="mb-4 sm:mb-6 rounded-2xl"><StorageBreakdownBar onApplyQuery={onApplyQuery} /></div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs transition-all overflow-hidden mb-4 sm:mb-6">
          <div className="p-4 sm:p-5 border-b border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">Inbox Health Modules</h3>
                </div>
                <p className="text-xs text-slate-500 hidden sm:block">Deep-dive into specific areas of your inbox to organize and automate.</p>
              </div>
            </div>
          </div>
          
          <div className="p-4 sm:p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <HealthCard 
                id="card-omni-clean"
                title="Smart Cleanup"
                count="Clean"
                desc="Group similar emails together to archive, delete, or file in bulk."
                actionText="Start Cleanup"
                onAction={() => { window.location.hash = '#omni-clean'; }}
              />
              <HealthCard 
                id="card-category-breakdown"
                title="Category Breakdown"
                count="Analyze"
                desc="See what takes up the most space and volume in your inbox."
                actionText="View Breakdown"
                onAction={() => { window.location.hash = '#category-distribution'; }}
              />
              <HealthCard 
                id="card-smart-automations"
                title="Smart Automations"
                count="Automate"
                desc="Organize frequent senders, clean up folders, and create rules."
                actionText="Open Automations"
                onAction={() => { window.location.hash = '#smart-automations'; }}
              />
              <HealthCard 
                id="card-manage-inbox"
                title="Manage Inbox"
                count="Manage"
                desc="Manage your newsletters, subscriptions, custom labels, and folders."
                actionText="Open Manager"
                onAction={() => { window.location.hash = '#manage-inbox'; }}
              />
              <HealthCard
                title="Inbox Score"
                count={healthScore === null ? '—' : `${healthScore}/100`}
                desc="How healthy your inbox is, from unread pressure, clutter and storage."
                actionText="Check Score"
                onAction={() => { window.location.hash = '#health-score'; }}
              />
              <HealthCard
                id="card-export"
                title="Export Center"
                count="Export"
                desc="Download senders, attachments, old mail, labels and more as CSV."
                actionText="Open Exports"
                onAction={() => { window.location.hash = '#export'; }}
              />
            </div>
          </div>
      </div>




      
      {/* Compact Sender Analytics Card */}
      {topSenders.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs transition-all overflow-hidden mb-4 sm:mb-6">
          <div className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                <Target className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900">Top Senders</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  You have <span className="font-semibold text-slate-700">{topSenders.length} frequent senders</span> and <span className="font-semibold text-slate-700">{topDomains.length} frequent domains</span>.
                </p>
              </div>
            </div>
            
            <button
              onClick={() => { window.location.hash = '#sender-analytics'; }}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer w-full sm:w-auto justify-center"
            >
              <span>View Senders</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden p-5 flex flex-col h-full hover:border-slate-300 transition-colors group">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl">
              <Folder className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Folder Organizer</h3>
          </div>
          <p className="text-sm text-slate-500 mb-6 flex-1">
            Automatically group senders, shopping receipts, and newsletters into neat categorized folders.
          </p>
          <button 
            onClick={() => { window.location.hash = '#folder-optimizer'; }}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
          >
            <span>Organize Folders</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden p-5 flex flex-col h-full hover:border-slate-300 transition-colors group">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl">
              <Filter className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Automatic Rules</h3>
          </div>
          <p className="text-sm text-slate-500 mb-6 flex-1">
            Create Gmail filters so incoming emails automatically sort themselves without manual work.
          </p>
          <button 
            onClick={() => { window.location.hash = '#rule-suggester'; }}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
          >
            <span>Create Rules</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>

    </div>
  );
}

function HealthCard({ id, title, count, desc, actionText, onAction }: any) {
  const displayCount = typeof count === 'string' ? count : (count || 0).toLocaleString();
  return (
    <button 
      id={id}
      onClick={onAction}
      className="bg-white rounded-xl border border-slate-200 hover:border-slate-800 p-4 flex flex-col gap-2 transition-all text-left group hover:shadow-xs items-start w-full relative overflow-hidden"
    >
      <div className="flex-1 flex flex-col min-w-0 pr-2 w-full">
        <h3 className="font-bold text-slate-900 text-sm truncate flex items-center gap-2">
          {title}
        </h3>
        <p className="text-xs text-slate-500 leading-snug line-clamp-2 mt-1">{desc}</p>
      </div>
      
      <div className="flex flex-col items-start pt-2 mt-auto shrink-0 w-full">
        <div className="flex items-baseline gap-2">
           <span className="text-xl font-bold text-slate-800 tracking-tight">{displayCount}</span>
        </div>
        <div className="flex items-center text-[11px] font-semibold text-slate-500 group-hover:text-slate-900 transition-colors mt-2">
          {actionText}
          <ArrowRight className="w-3.5 h-3.5 sm:group-hover:translate-x-1 transition-transform ml-1" />
        </div>
      </div>
    </button>
  );
}
