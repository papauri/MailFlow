import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, ChevronDown, ChevronUp, Activity, Loader2, TrendingUp, AlertTriangle, 
  HardDrive, Trash2, MailOpen, ArrowRight, ShieldCheck, RefreshCw, Sparkles, CheckCircle2, ArrowLeft, Mail,
  Sliders, UserX, Filter, RotateCcw, Zap, ExternalLink, Clock
} from 'lucide-react';
import { cn } from '../lib/utils';
import { 
  countEmails, markAllAsReadByQuery, emptyAllTrash, searchEmails, 
  batchDeleteEmails, batchTrashEmails, batchMarkAsRead, EmailData 
} from '../lib/gmail';
import {
  computeInboxHealthScore,
  computeInboxHealthBreakdown,
  getUserManagementCounts,
  HEALTH_SCORE_QUERIES,
  HealthScoreMetrics,
  HealthScoreBreakdown
} from '../lib/emailUtils';

type FixableMetric = 'unread' | 'spam' | 'promo' | 'large' | 'oldMail';

interface HealthScoreModalProps {
  isOpen?: boolean;
  onClose: () => void;
  onApplyQuery?: (query: string, filter?: string, sortOption?: "date" | "size" | "sender") => void;
  onOpenUnsubscribe?: () => void;
  isPage?: boolean;
}

export function HealthScoreModal({ 
  isOpen = true, 
  onClose, 
  onApplyQuery, 
  onOpenUnsubscribe,
  isPage = false 
}: HealthScoreModalProps) {
  const [loading, setLoading] = useState(true);
  const [metrics, setMetrics] = useState<HealthScoreMetrics>({
    unreadInbox: 0,
    spamAndTrash: 0,
    oldPromotions: 0,
    largeFiles: 0,
    oldMail: 0,
    unsubscribedCount: 0,
    activeFiltersCount: 0
  });
  
  const [activeTab, setActiveTab] = useState<'breakdown' | 'simulator'>('breakdown');
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{message: string, pts: number} | null>(null);
  
  // Granular simulation controls
  const [simUnread, setSimUnread] = useState<number>(0);
  const [simSpam, setSimSpam] = useState<number>(0);
  const [simPromo, setSimPromo] = useState<number>(0);
  const [simLarge, setSimLarge] = useState<number>(0);
  const [simExtraUnsubs, setSimExtraUnsubs] = useState<number>(0);
  const [simExtraRules, setSimExtraRules] = useState<number>(0);

  // Inspect mode states
  const [inspectingView, setInspectingView] = useState<{ title: string; query: string; actionType: FixableMetric, penalty: number } | null>(null);
  const [previewEmails, setPreviewEmails] = useState<EmailData[]>([]);
  const [selectedInspectIds, setSelectedInspectIds] = useState<Set<string>>(new Set());
  const [loadingPreview, setLoadingPreview] = useState(false);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const [unread, spam, promo, large, old] = await Promise.all([
        countEmails(HEALTH_SCORE_QUERIES.unread),
        countEmails(HEALTH_SCORE_QUERIES.spamAndTrash),
        countEmails(HEALTH_SCORE_QUERIES.oldPromotions),
        countEmails(HEALTH_SCORE_QUERIES.largeFiles),
        countEmails(HEALTH_SCORE_QUERIES.oldMail)
      ]);
      const { unsubscribedCount, activeFiltersCount } = getUserManagementCounts();
      const fetchedMetrics: HealthScoreMetrics = {
        unreadInbox: unread,
        spamAndTrash: spam,
        oldPromotions: promo,
        largeFiles: large,
        oldMail: old,
        unsubscribedCount,
        activeFiltersCount
      };
      setMetrics(fetchedMetrics);
      // Reset simulator targets to live metrics
      setSimUnread(fetchedMetrics.unreadInbox);
      setSimSpam(fetchedMetrics.spamAndTrash);
      setSimPromo(fetchedMetrics.oldPromotions);
      setSimLarge(fetchedMetrics.largeFiles);
      setSimExtraUnsubs(0);
      setSimExtraRules(0);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const fetchMetricsSilent = async () => {
    try {
      const [unread, spam, promo, large, old] = await Promise.all([
        countEmails(HEALTH_SCORE_QUERIES.unread),
        countEmails(HEALTH_SCORE_QUERIES.spamAndTrash),
        countEmails(HEALTH_SCORE_QUERIES.oldPromotions),
        countEmails(HEALTH_SCORE_QUERIES.largeFiles),
        countEmails(HEALTH_SCORE_QUERIES.oldMail)
      ]);
      const { unsubscribedCount, activeFiltersCount } = getUserManagementCounts();
      setMetrics(prev => ({
        ...prev,
        unreadInbox: unread,
        spamAndTrash: spam,
        oldPromotions: promo,
        largeFiles: large,
        oldMail: old,
        unsubscribedCount,
        activeFiltersCount
      }));
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMetrics();
    }
  }, [isOpen]);

  // Synchronize initial simulator targets once metrics load
  const resetSimulation = () => {
    setSimUnread(metrics.unreadInbox);
    setSimSpam(metrics.spamAndTrash);
    setSimPromo(metrics.oldPromotions);
    setSimLarge(metrics.largeFiles);
    setSimExtraUnsubs(0);
    setSimExtraRules(0);
  };

  const applyPreset = (preset: 'inboxZero' | 'storageClean' | 'automationMaster') => {
    if (preset === 'inboxZero') {
      setSimUnread(0);
      setSimSpam(0);
      setSimPromo(0);
      setSimLarge(metrics.largeFiles);
      setSimExtraUnsubs(0);
      setSimExtraRules(0);
    } else if (preset === 'storageClean') {
      setSimSpam(0);
      setSimLarge(0);
      setSimPromo(0);
      setSimUnread(metrics.unreadInbox);
      setSimExtraUnsubs(0);
      setSimExtraRules(0);
    } else if (preset === 'automationMaster') {
      setSimUnread(0);
      setSimSpam(0);
      setSimPromo(0);
      setSimLarge(0);
      setSimExtraUnsubs(5);
      setSimExtraRules(3);
    }
  };

  const liveBreakdown: HealthScoreBreakdown = useMemo(() => {
    return computeInboxHealthBreakdown(metrics);
  }, [metrics]);

  const liveScore = liveBreakdown.score;

  // Simulator Breakdown
  const simMetrics: HealthScoreMetrics = useMemo(() => {
    return {
      unreadInbox: simUnread,
      spamAndTrash: simSpam,
      oldPromotions: simPromo,
      largeFiles: simLarge,
      oldMail: metrics.oldMail,
      unsubscribedCount: (metrics.unsubscribedCount || 0) + simExtraUnsubs,
      activeFiltersCount: (metrics.activeFiltersCount || 0) + simExtraRules
    };
  }, [simUnread, simSpam, simPromo, simLarge, metrics.oldMail, metrics.unsubscribedCount, metrics.activeFiltersCount, simExtraUnsubs, simExtraRules]);

  const simBreakdown: HealthScoreBreakdown = useMemo(() => {
    return computeInboxHealthBreakdown(simMetrics);
  }, [simMetrics]);

  const simulatedScore = simBreakdown.score;
  const scoreDiff = simulatedScore - liveScore;

  const handleFix = async (type: FixableMetric, _currentPts?: number, selectedIds?: string[]) => {
    setActiveAction(type);
    try {
      let message = "";
      
      const isPartial = Boolean(selectedIds && selectedIds.length > 0);

      // Resolve message IDs for selected items if inspecting
      const selectedEmails = previewEmails.filter(e => selectedIds && selectedIds.includes(e.id));
      const extractedMessageIds = selectedEmails.flatMap(e => (e.messageIds && e.messageIds.length > 0 ? e.messageIds : [e.id]));
      const targetIds = extractedMessageIds.length > 0 ? extractedMessageIds : (selectedIds || []);

      if (type === 'unread') {
        if (isPartial) {
          await batchMarkAsRead(targetIds);
          message = `${selectedIds!.length} emails marked as read!`;
        } else {
          await markAllAsReadByQuery(HEALTH_SCORE_QUERIES.unread);
          message = "Inbox zero achieved (unread)!";
        }
      } else if (type === 'spam') {
        if (isPartial) {
          await batchDeleteEmails(targetIds);
          message = `${selectedIds!.length} spam & trash items removed!`;
        } else {
          await emptyAllTrash(HEALTH_SCORE_QUERIES.spamAndTrash);
          message = "Spam and trash emptied!";
        }
      } else if (type === 'promo') {
        if (isPartial) {
          await batchTrashEmails(targetIds);
          message = `${selectedIds!.length} old promotions cleaned!`;
        } else {
          const pEmails = await searchEmails(HEALTH_SCORE_QUERIES.oldPromotions, 500);
          const promoIds = pEmails.flatMap(e => (e.messageIds && e.messageIds.length > 0 ? e.messageIds : [e.id]));
          if (promoIds.length > 0) {
            await batchTrashEmails(promoIds);
          }
          message = "Old promotions cleaned!";
        }
      } else if (type === 'large') {
         if (isPartial) {
           await batchTrashEmails(targetIds);
           message = `${selectedIds!.length} large attachments removed!`;
         } else if (inspectingView && previewEmails.length > 0) {
           const largeIds = previewEmails.flatMap(e => (e.messageIds && e.messageIds.length > 0 ? e.messageIds : [e.id]));
           if (largeIds.length > 0) {
             await batchTrashEmails(largeIds);
           }
           message = `${previewEmails.length} large attachments removed!`;
         } else if (onApplyQuery) {
            onClose();
            onApplyQuery("larger:5M -in:trash");
            return;
         }
      } else if (type === 'oldMail') {
        if (isPartial) {
          await batchTrashEmails(targetIds);
          message = `${selectedIds!.length} old messages archived to trash!`;
        } else {
          // Bounded to one page like the promotions sweep — clearing a decade of mail
          // in one unbounded pass would hammer the API and can't be undone in bulk.
          const oldEmails = await searchEmails(HEALTH_SCORE_QUERIES.oldMail, 500);
          const oldIds = oldEmails.flatMap(e => (e.messageIds && e.messageIds.length > 0 ? e.messageIds : [e.id]));
          if (oldIds.length > 0) {
            await batchTrashEmails(oldIds);
          }
          message = `${oldEmails.length} messages older than a year cleaned!`;
        }
      }
      
      const countToSubtract = isPartial
        ? selectedIds!.length
        : (inspectingView && previewEmails.length > 0 ? previewEmails.length : (
            type === 'unread' ? metrics.unreadInbox :
            type === 'spam' ? metrics.spamAndTrash :
            type === 'promo' ? metrics.oldPromotions :
            type === 'oldMail' ? (metrics.oldMail || 0) :
            metrics.largeFiles
          ));

      // INSTANT OPTIMISTIC SCORE REFRESH:
      // Compute the actual next metrics and derive points gained from the real score
      // delta — never assume the full category penalty, since a partial fix (only
      // some selected emails) only clears part of it.
      const nextMetrics: HealthScoreMetrics = { ...metrics };
      if (type === 'unread') {
        nextMetrics.unreadInbox = isPartial ? Math.max(0, metrics.unreadInbox - countToSubtract) : 0;
      } else if (type === 'spam') {
        nextMetrics.spamAndTrash = isPartial ? Math.max(0, metrics.spamAndTrash - countToSubtract) : 0;
      } else if (type === 'promo') {
        nextMetrics.oldPromotions = isPartial ? Math.max(0, metrics.oldPromotions - countToSubtract) : 0;
      } else if (type === 'large') {
        nextMetrics.largeFiles = isPartial ? Math.max(0, metrics.largeFiles - countToSubtract) : 0;
      } else if (type === 'oldMail') {
        nextMetrics.oldMail = isPartial ? Math.max(0, (metrics.oldMail || 0) - countToSubtract) : 0;
      }

      const ptsGained = computeInboxHealthScore(nextMetrics) - computeInboxHealthScore(metrics);

      setMetrics(nextMetrics);
      setSimUnread(nextMetrics.unreadInbox);
      setSimSpam(nextMetrics.spamAndTrash);
      setSimPromo(nextMetrics.oldPromotions);
      setSimLarge(nextMetrics.largeFiles);

      const updatedMetricsState = nextMetrics;

      // Update inspected emails view state
      if (isPartial) {
        setPreviewEmails(prev => prev.filter(e => !selectedIds!.includes(e.id)));
        setSelectedInspectIds(new Set());
      } else {
        setPreviewEmails([]);
        setSelectedInspectIds(new Set());
        setInspectingView(null);
      }

      setCelebration({ message, pts: ptsGained });
      setTimeout(() => {
        setCelebration(null);
      }, 3500);

      // Broadcast instant sync event for other views (InboxHealth, Dashboard, etc.)
      window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
        detail: { 
          type, 
          count: countToSubtract, 
          isPartial,
          metrics: updatedMetricsState 
        }
      }));

      // Background silent reconcile after 4 seconds once Gmail index catches up
      setTimeout(() => {
        fetchMetricsSilent();
      }, 4000);
    } catch (error) {
      console.error(error);
    } finally {
      setActiveAction(null);
    }
  };

  const startInspect = async (title: string, query: string, actionType: FixableMetric, penalty: number) => {
    setInspectingView({ title, query, actionType, penalty });
    setLoadingPreview(true);
    setPreviewEmails([]);
    setSelectedInspectIds(new Set());
    try {
      const emails = await searchEmails(query, 50);
      setPreviewEmails(emails);
    } catch(e) {
      console.error(e);
    } finally {
      setLoadingPreview(false);
    }
  };

  const toggleInspectSelect = (id: string) => {
    setSelectedInspectIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleInspectSelectAll = () => {
    if (selectedInspectIds.size === previewEmails.length) {
      setSelectedInspectIds(new Set());
    } else {
      setSelectedInspectIds(new Set(previewEmails.map(e => e.id)));
    }
  };

  const getInspectProjectedScore = () => {
    if (!inspectingView || selectedInspectIds.size === 0) return liveScore;
    const projectedMetrics = { ...metrics };
    if (inspectingView.actionType === 'unread') {
      projectedMetrics.unreadInbox = Math.max(0, metrics.unreadInbox - selectedInspectIds.size);
    } else if (inspectingView.actionType === 'spam') {
      projectedMetrics.spamAndTrash = Math.max(0, metrics.spamAndTrash - selectedInspectIds.size);
    } else if (inspectingView.actionType === 'promo') {
      projectedMetrics.oldPromotions = Math.max(0, metrics.oldPromotions - selectedInspectIds.size);
    } else if (inspectingView.actionType === 'large') {
      projectedMetrics.largeFiles = Math.max(0, metrics.largeFiles - selectedInspectIds.size);
    } else if (inspectingView.actionType === 'oldMail') {
      projectedMetrics.oldMail = Math.max(0, (metrics.oldMail || 0) - selectedInspectIds.size);
    }
    return computeInboxHealthScore(projectedMetrics);
  };

  const inspectProjectedScore = getInspectProjectedScore();

  const getScoreStatus = (s: number) => {
    if (s >= 85) return { text: 'text-slate-900', bg: 'bg-slate-50', border: 'border-slate-200', label: 'Optimal', badge: 'bg-slate-100 text-slate-800 border-slate-200' };
    if (s >= 70) return { text: 'text-slate-900', bg: 'bg-slate-50', border: 'border-slate-200', label: 'Good', badge: 'bg-slate-100 text-slate-800 border-slate-200' };
    if (s >= 50) return { text: 'text-slate-900', bg: 'bg-slate-50', border: 'border-slate-200', label: 'Needs Attention', badge: 'bg-amber-50 text-amber-800 border-amber-200' };
    return { text: 'text-slate-900', bg: 'bg-slate-50', border: 'border-slate-200', label: 'Action Required', badge: 'bg-rose-50 text-rose-800 border-rose-200' };
  };

  const status = getScoreStatus(liveScore);
  const simStatus = getScoreStatus(simulatedScore);

  if (!isPage && !isOpen) return null;

  const headerElement = (
    <div className={cn(
      "flex flex-col sm:flex-row sm:items-center justify-between bg-white shrink-0 gap-4",
      isPage ? "p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs mb-4" : "px-5 py-4 border-b border-slate-200"
    )}>
      <div className="flex items-center gap-3">
        {isPage && (
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold transition-colors cursor-pointer shrink-0"
            title="Back to Inbox Health"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Inbox Health</span>
          </button>
        )}
        <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs shrink-0">
          <Activity className="w-5 h-5 text-slate-100" />
        </div>
        <div>
          <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">Inbox Health & Simulator</h2>
          <p className="text-xs text-slate-500">
            Real-time health index, deduction metrics, and interactive score simulation.
          </p>
        </div>
      </div>
      
      <div className="flex items-center gap-2">
        {!inspectingView && (
          <button
            onClick={fetchMetrics}
            disabled={loading}
            className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
            title="Refresh score"
          >
            <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
          </button>
        )}
        {!isPage && (
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );

  const mainBodyContent = (
    <div className={cn(
      "bg-white flex flex-col relative",
      isPage ? "rounded-2xl border border-slate-200 shadow-2xs min-h-[600px] overflow-hidden" : "flex-1 min-h-0 overflow-hidden"
    )}>
      {inspectingView ? (
        <div className="flex flex-col h-full bg-white animate-in slide-in-from-right-4 duration-200">
          {/* Inspect Header */}
          <div className="px-6 py-3.5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white shrink-0">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setInspectingView(null)}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer shrink-0"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  Inspecting: {inspectingView.title}
                  <span className="text-[10px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md truncate max-w-[150px] sm:max-w-none">{inspectingView.query}</span>
                </h3>
                {selectedInspectIds.size > 0 && (
                  <p className="text-xs font-medium text-emerald-700 mt-0.5">
                    Projected Score: {inspectProjectedScore}% (+{inspectProjectedScore - liveScore} pts)
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center">
              <button
                onClick={() => {
                  const params = new URLSearchParams();
                  params.set('q', inspectingView.query);
                  params.set('title', inspectingView.title);
                  params.set('badge', 'Score Breakdown');
                  params.set('sub', `Inspecting ${inspectingView.title} (deduction of -${Math.round(inspectingView.penalty)} pts)`);
                  params.set('source', isPage ? 'health-score' : 'health');
                  window.location.hash = `#filter-view?${params.toString()}`;
                }}
                className="text-xs font-medium px-3 py-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer"
                title="Inspect in dedicated full-page view"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Open Full Page</span>
              </button>
              <button
                onClick={() => handleFix(inspectingView.actionType, inspectingView.penalty, Array.from(selectedInspectIds))}
                disabled={activeAction !== null}
                className="text-xs font-semibold px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-50 whitespace-nowrap"
              >
                {activeAction === inspectingView.actionType ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                {selectedInspectIds.size > 0 
                  ? `Fix ${selectedInspectIds.size} Selected` 
                  : `Fix All (+${Math.round(inspectingView.penalty)} pts)`}
              </button>
            </div>
          </div>
          
          {/* Email List Container */}
          <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-slate-50/30">
            {loadingPreview ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[250px] text-slate-400">
                <Loader2 className="w-7 h-7 animate-spin mb-3 text-slate-500" />
                <p className="text-sm font-medium text-slate-600">Fetching messages...</p>
              </div>
            ) : previewEmails.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full min-h-[250px] text-slate-400">
                <CheckCircle2 className="w-9 h-9 text-slate-400 mb-2.5" />
                <p className="text-sm font-medium text-slate-700">No messages found here</p>
                <p className="text-xs text-slate-500 mt-0.5">This category is already clean.</p>
              </div>
            ) : (
              <div className="flex-1 flex flex-col p-0 sm:p-4 mx-auto w-full max-w-full">
                <div className="bg-white border-y sm:border sm:border-slate-200 sm:rounded-xl sm:shadow-2xs overflow-hidden">
                  <div className="px-3 sm:px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
                    <button 
                      onClick={toggleInspectSelectAll}
                      className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer", selectedInspectIds.size === previewEmails.length && previewEmails.length > 0 ? "bg-slate-900 border-slate-900 text-white" : "border-slate-300 bg-white text-transparent")}
                    >
                      <CheckCircle2 className="w-3 h-3" />
                    </button>
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Select All ({previewEmails.length})</span>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {previewEmails.map((email) => {
                      const isUnread = email.labelIds?.includes('UNREAD');
                      const isSelected = selectedInspectIds.has(email.id);
                      return (
                        <li 
                          key={email.id} 
                          onClick={() => toggleInspectSelect(email.id)}
                          className={cn("px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-slate-50 transition-colors group flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 border-b border-slate-100 last:border-b-0 cursor-pointer", isSelected && "bg-slate-50/80")}
                        >
                          <div className="flex items-center gap-2.5 sm:gap-3 sm:w-1/3 shrink-0 min-w-0">
                            <div className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0", isSelected ? "bg-slate-900 border-slate-900 text-white" : "border-slate-300 bg-white text-transparent")}>
                              <CheckCircle2 className="w-3 h-3" />
                            </div>
                            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 border border-slate-200 text-xs font-semibold uppercase hidden sm:flex">
                              {(email.sender.replace(/<.*>/, "").trim() || '?')[0]}
                            </div>
                            <span 
                              className={cn("text-xs sm:text-sm truncate", isUnread ? "font-semibold text-slate-900" : "font-normal text-slate-700")}
                              title={email.sender}
                            >
                              {email.sender.replace(/<.*>/, "").trim() || email.sender}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center justify-between gap-0.5 sm:gap-4 pl-9 sm:pl-0">
                            <div className="truncate text-[11px] sm:text-sm min-w-0 flex-1">
                              <span className={cn(isUnread ? "font-semibold text-slate-900" : "font-normal text-slate-700")}>
                                {email.subject || '(No Subject)'}
                              </span>
                              <span className="text-slate-400 font-normal truncate mx-1 hidden sm:inline">-</span>
                              <span className="text-slate-400 font-normal truncate">
                                {email.snippet}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 sm:gap-3 shrink-0 justify-start sm:justify-end mt-1 sm:mt-0">
                              {(email.sizeEstimate || 0) > 1048576 && (
                                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                                  {((email.sizeEstimate || 0) / 1024 / 1024).toFixed(1)} MB
                                </span>
                              )}
                              <span className={cn("text-[10px] sm:text-[11px] whitespace-nowrap", isUnread ? "font-semibold text-slate-700" : "font-normal text-slate-500")}>
                                {(email.date instanceof Date && !isNaN(email.date.getTime()) ? email.date : new Date(email.date)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                              </span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="h-full overflow-y-auto p-4 sm:p-6 bg-slate-50/40 custom-scrollbar">
          {/* Tab Switcher */}
          <div className="mb-5 flex items-center justify-between flex-wrap gap-3">
            <div className="flex space-x-1 bg-slate-200/60 p-1 rounded-xl w-fit">
              <button
                onClick={() => setActiveTab('breakdown')}
                className={cn(
                  "px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5",
                  activeTab === 'breakdown' 
                    ? "bg-white text-slate-900 shadow-2xs" 
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                <Activity className="w-3.5 h-3.5 text-slate-500" />
                Score Breakdown
              </button>
              <button
                onClick={() => setActiveTab('simulator')}
                className={cn(
                  "px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer",
                  activeTab === 'simulator' 
                    ? "bg-white text-slate-900 shadow-2xs" 
                    : "text-slate-600 hover:text-slate-900"
                )}
              >
                <TrendingUp className="w-3.5 h-3.5 text-slate-500" />
                Simulator
                {scoreDiff > 0 && (
                  <span className="text-[10px] bg-slate-100 text-slate-800 font-semibold px-1.5 py-0.2 rounded-md border border-slate-200">
                    +{scoreDiff}
                  </span>
                )}
              </button>
            </div>

            {activeTab === 'simulator' && (
              <div className="flex items-center gap-2">
                <button
                  onClick={resetSimulation}
                  className="text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors shadow-2xs cursor-pointer"
                  title="Reset simulator to current live data"
                >
                  <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                  Reset to Baseline
                </button>
              </div>
            )}
          </div>

          {activeTab === 'breakdown' && (
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start max-w-5xl mx-auto">
              {/* Left Column: Metric Summary */}
              <div className="w-full lg:w-1/3 space-y-3 shrink-0">
                <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-2xs text-center flex flex-col items-center justify-center">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Health Score</span>
                  <div className="text-6xl font-extrabold my-2 text-slate-900 tracking-tight">
                    {liveScore}
                    <span className="text-xl font-medium text-slate-400 ml-1">/100</span>
                  </div>
                  <div className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-xs font-medium mt-1", status.badge)}>
                    <ShieldCheck className="w-3.5 h-3.5" />
                    <span>{status.label}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-3.5 leading-relaxed">
                    Evaluated against inbox volume, junk accumulation, stale promotions, large attachments, and active automation rules.
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white border border-slate-200 p-3.5 rounded-xl flex flex-col justify-between shadow-2xs">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Deductions</span>
                    <div className="mt-1">
                      <span className="text-2xl font-bold text-slate-900">-{liveBreakdown.totalDeductions}</span>
                      <span className="text-xs font-normal text-slate-400 ml-1">pts</span>
                    </div>
                    <span className="text-[11px] text-slate-500 mt-1">Clutter & unread</span>
                  </div>
                  <div className="bg-white border border-slate-200 p-3.5 rounded-xl flex flex-col justify-between shadow-2xs">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Hygiene Bonus</span>
                    <div className="mt-1">
                      <span className="text-2xl font-bold text-slate-900">+{liveBreakdown.totalBonus}</span>
                      <span className="text-xs font-normal text-slate-400 ml-1">pts</span>
                    </div>
                    <span className="text-[11px] text-slate-500 mt-1">Rules & unsubs</span>
                  </div>
                </div>
              </div>

              {/* Right Column: Breakdown & Actions */}
              <div className="w-full lg:w-2/3 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Breakdown & Remediation</h3>
                </div>

                <div className="space-y-2.5">
                  {/* Item 1: Unread */}
                  <div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <MailOpen className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-slate-900">Unread Inbox Messages</h4>
                          <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                            {metrics.unreadInbox.toLocaleString()} unread
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">Unopened emails in inbox (max -35 pts)</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 self-end sm:self-center">
                      <span className="text-sm font-bold text-slate-800 min-w-[60px] text-right">-{liveBreakdown.unreadPenalty} pts</span>
                      <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                        <button
                          onClick={() => startInspect('Unread Emails', 'is:unread in:inbox -in:chats', 'unread', liveBreakdown.unreadPenalty)}
                          disabled={metrics.unreadInbox === 0}
                          className="text-xs font-medium px-3 py-1.5 rounded-md hover:bg-white text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                        >
                          Inspect
                        </button>
                        <button
                          onClick={() => handleFix('unread', liveBreakdown.unreadPenalty)}
                          disabled={metrics.unreadInbox === 0 || activeAction !== null}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {activeAction === 'unread' ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null} Mark Read
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Item 2: Spam & Trash */}
                  <div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-slate-900">Spam & Trash Items</h4>
                          <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                            {metrics.spamAndTrash.toLocaleString()} items
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">Junk messages consuming storage (max -25 pts)</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 self-end sm:self-center">
                      <span className="text-sm font-bold text-slate-800 min-w-[60px] text-right">-{liveBreakdown.spamPenalty} pts</span>
                      <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                        <button
                          onClick={() => startInspect('Spam & Trash', 'in:spam OR in:trash', 'spam', liveBreakdown.spamPenalty)}
                          disabled={metrics.spamAndTrash === 0}
                          className="text-xs font-medium px-3 py-1.5 rounded-md hover:bg-white text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                        >
                          Inspect
                        </button>
                        <button
                          onClick={() => handleFix('spam', liveBreakdown.spamPenalty)}
                          disabled={metrics.spamAndTrash === 0 || activeAction !== null}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {activeAction === 'spam' ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null} Empty All
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Item 3: Promo */}
                  <div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-slate-900">Stale Promotions (&gt;6 Months)</h4>
                          <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                            {metrics.oldPromotions.toLocaleString()} emails
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">Expired marketing emails and newsletters (max -20 pts)</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 self-end sm:self-center">
                      <span className="text-sm font-bold text-slate-800 min-w-[60px] text-right">-{liveBreakdown.promoPenalty} pts</span>
                      <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                        <button
                          onClick={() => startInspect('Old Promotions', 'category:promotions older_than:6m -in:trash', 'promo', liveBreakdown.promoPenalty)}
                          disabled={metrics.oldPromotions === 0}
                          className="text-xs font-medium px-3 py-1.5 rounded-md hover:bg-white text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                        >
                          Inspect
                        </button>
                        <button
                          onClick={() => handleFix('promo', liveBreakdown.promoPenalty)}
                          disabled={metrics.oldPromotions === 0 || activeAction !== null}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {activeAction === 'promo' ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null} Clean All
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Item 4: Large Attachments */}
                  <div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <HardDrive className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-slate-900">Large Attachments (&gt;5MB)</h4>
                          <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                            {metrics.largeFiles.toLocaleString()} files
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">Heavy files taking up storage quota (storage bloat, max -10 pts combined)</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 self-end sm:self-center">
                      <span className="text-sm font-bold text-slate-800 min-w-[60px] text-right">-{liveBreakdown.largeFilesPenalty} pts</span>
                      <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                        <button
                          onClick={() => startInspect('Large Attachments', HEALTH_SCORE_QUERIES.largeFiles, 'large', liveBreakdown.largeFilesPenalty)}
                          disabled={metrics.largeFiles === 0}
                          className="text-xs font-medium px-3 py-1.5 rounded-md hover:bg-white text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                        >
                          Inspect Files
                        </button>
                        <button
                          onClick={() => handleFix('large', liveBreakdown.largeFilesPenalty)}
                          disabled={metrics.largeFiles === 0 || activeAction !== null}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {activeAction === 'large' ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null} Clean All
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Item 5: Old Mail */}
                  <div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <Clock className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-slate-900">Old Mail (&gt;1 Year)</h4>
                          <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                            {(metrics.oldMail || 0).toLocaleString()} emails
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">Messages you haven't needed in over a year (storage bloat)</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 self-end sm:self-center">
                      <span className="text-sm font-bold text-slate-800 min-w-[60px] text-right">-{liveBreakdown.oldMailPenalty} pts</span>
                      <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                        <button
                          onClick={() => startInspect('Old Mail', HEALTH_SCORE_QUERIES.oldMail, 'oldMail', liveBreakdown.oldMailPenalty)}
                          disabled={(metrics.oldMail || 0) === 0}
                          className="text-xs font-medium px-3 py-1.5 rounded-md hover:bg-white text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                        >
                          Inspect
                        </button>
                        <button
                          onClick={() => handleFix('oldMail', liveBreakdown.oldMailPenalty)}
                          disabled={(metrics.oldMail || 0) === 0 || activeAction !== null}
                          className="text-xs font-semibold px-3 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50"
                        >
                          {activeAction === 'oldMail' ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null} Clean All
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Positive Bonus Breakdown Card */}
                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-semibold text-slate-900">Automations & Unsubscribe Bonus</h4>
                          <span className="text-xs font-semibold bg-slate-100 text-slate-800 px-2 py-0.5 rounded-md border border-slate-200">
                            +{liveBreakdown.totalBonus} pts
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {metrics.unsubscribedCount || 0} newsletter unsubscriptions (+{liveBreakdown.unsubBonus} pts) • {metrics.activeFiltersCount || 0} active filter rules (+{liveBreakdown.filterBonus} pts)
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                        onClick={() => { window.location.hash = '#subscriptions'; }}
                        className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 transition-colors cursor-pointer"
                      >
                        Manage Subscriptions
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'simulator' && (
            <div className="flex flex-col gap-5 max-w-5xl mx-auto">
              {/* Simulator Comparison Summary Header */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-2xs flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                    <TrendingUp className="w-6 h-6 text-slate-700" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Projected Score</span>
                      <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-full border", simStatus.badge)}>
                        {simStatus.label}
                      </span>
                    </div>
                    <div className="flex items-baseline gap-2.5 mt-1">
                      <span className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight">{simulatedScore}</span>
                      <span className="text-sm font-medium text-slate-400">/ 100</span>
                      {scoreDiff > 0 ? (
                        <span className="text-xs font-semibold text-slate-900 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-md">
                          +{scoreDiff} pts from current
                        </span>
                      ) : scoreDiff < 0 ? (
                        <span className="text-xs font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-md">
                          {scoreDiff} pts
                        </span>
                      ) : (
                        <span className="text-xs font-normal text-slate-400">Current baseline</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Score comparison progress gauge */}
                <div className="flex flex-col gap-1.5 min-w-[220px] md:w-72 bg-slate-50 p-3.5 rounded-xl border border-slate-200/80">
                  <div className="flex justify-between text-xs font-medium text-slate-600">
                    <span>Baseline: <strong className="text-slate-900 font-semibold">{liveScore}</strong></span>
                    <span>Simulated: <strong className="text-slate-900 font-semibold">{simulatedScore}</strong></span>
                  </div>
                  <div className="w-full h-2 bg-slate-200 rounded-full overflow-hidden flex relative">
                    <div 
                      className="h-full bg-slate-700 transition-all duration-200"
                      style={{ width: `${liveScore}%` }}
                    />
                    {simulatedScore > liveScore && (
                      <div 
                        className="h-full bg-slate-400 transition-all duration-200"
                        style={{ width: `${simulatedScore - liveScore}%` }}
                      />
                    )}
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>Deductions: -{simBreakdown.totalDeductions}</span>
                    <span>Bonus: +{simBreakdown.totalBonus}</span>
                  </div>
                </div>
              </div>

              {/* Goal Presets */}
              <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-slate-500 shrink-0" />
                  <span className="text-xs font-semibold text-slate-700 uppercase tracking-wider">Quick Presets:</span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    onClick={() => applyPreset('inboxZero')}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                  >
                    Inbox Zero Target (0 Unread)
                  </button>
                  <button
                    onClick={() => applyPreset('storageClean')}
                    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 transition-colors cursor-pointer"
                  >
                    Storage Reclamation
                  </button>
                  <button
                    onClick={() => applyPreset('automationMaster')}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white transition-colors cursor-pointer"
                  >
                    Optimal Automation (100 Pts)
                  </button>
                </div>
              </div>

              {/* Granular Sliders */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {/* Simulator Card 1: Unread */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <MailOpen className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-slate-900">Unread Inbox Messages</h4>
                        <span className="text-[11px] text-slate-500">Live count: {metrics.unreadInbox.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-slate-900">{simUnread.toLocaleString()} unread</span>
                      <span className="block text-[10px] font-medium text-slate-500">-{simBreakdown.unreadPenalty} pts</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <input 
                      type="range"
                      min={0}
                      max={Math.max(10, metrics.unreadInbox)}
                      value={simUnread}
                      onChange={(e) => setSimUnread(parseInt(e.target.value))}
                      className="w-full accent-slate-800 cursor-pointer h-1.5 bg-slate-100 rounded-lg"
                    />
                    <div className="flex justify-between text-[10px] font-medium text-slate-400">
                      <span>0 (Inbox Zero)</span>
                      <span>Target: {simUnread}</span>
                      <span>Current: {metrics.unreadInbox}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <button
                      onClick={() => setSimUnread(0)}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer underline-offset-2 hover:underline"
                    >
                      Simulate 0 Unread (+{Math.round(liveBreakdown.unreadPenalty)} pts)
                    </button>
                    <button
                      onClick={() => handleFix('unread', liveBreakdown.unreadPenalty)}
                      disabled={metrics.unreadInbox === 0 || activeAction !== null}
                      className="text-xs font-medium px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Mark Read
                    </button>
                  </div>
                </div>

                {/* Simulator Card 2: Spam & Trash */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <Trash2 className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-slate-900">Spam & Trash Junk</h4>
                        <span className="text-[11px] text-slate-500">Live count: {metrics.spamAndTrash.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-slate-900">{simSpam.toLocaleString()} items</span>
                      <span className="block text-[10px] font-medium text-slate-500">-{simBreakdown.spamPenalty} pts</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <input 
                      type="range"
                      min={0}
                      max={Math.max(10, metrics.spamAndTrash)}
                      value={simSpam}
                      onChange={(e) => setSimSpam(parseInt(e.target.value))}
                      className="w-full accent-slate-800 cursor-pointer h-1.5 bg-slate-100 rounded-lg"
                    />
                    <div className="flex justify-between text-[10px] font-medium text-slate-400">
                      <span>0 (Empty)</span>
                      <span>Target: {simSpam}</span>
                      <span>Current: {metrics.spamAndTrash}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <button
                      onClick={() => setSimSpam(0)}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer underline-offset-2 hover:underline"
                    >
                      Simulate Empty (+{Math.round(liveBreakdown.spamPenalty)} pts)
                    </button>
                    <button
                      onClick={() => handleFix('spam', liveBreakdown.spamPenalty)}
                      disabled={metrics.spamAndTrash === 0 || activeAction !== null}
                      className="text-xs font-medium px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Empty Now
                    </button>
                  </div>
                </div>

                {/* Simulator Card 3: Promotions */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <AlertTriangle className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-slate-900">Stale Promotions (&gt;6 Months)</h4>
                        <span className="text-[11px] text-slate-500">Live count: {metrics.oldPromotions.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-slate-900">{simPromo.toLocaleString()} emails</span>
                      <span className="block text-[10px] font-medium text-slate-500">-{simBreakdown.promoPenalty} pts</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <input 
                      type="range"
                      min={0}
                      max={Math.max(10, metrics.oldPromotions)}
                      value={simPromo}
                      onChange={(e) => setSimPromo(parseInt(e.target.value))}
                      className="w-full accent-slate-800 cursor-pointer h-1.5 bg-slate-100 rounded-lg"
                    />
                    <div className="flex justify-between text-[10px] font-medium text-slate-400">
                      <span>0 (Purged)</span>
                      <span>Target: {simPromo}</span>
                      <span>Current: {metrics.oldPromotions}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <button
                      onClick={() => setSimPromo(0)}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer underline-offset-2 hover:underline"
                    >
                      Simulate Purge (+{Math.round(liveBreakdown.promoPenalty)} pts)
                    </button>
                    <button
                      onClick={() => handleFix('promo', liveBreakdown.promoPenalty)}
                      disabled={metrics.oldPromotions === 0 || activeAction !== null}
                      className="text-xs font-medium px-3 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-white transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Clean All
                    </button>
                  </div>
                </div>

                {/* Simulator Card 4: Large Attachments */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <HardDrive className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-slate-900">Large Attachments (&gt;5MB)</h4>
                        <span className="text-[11px] text-slate-500">Live count: {metrics.largeFiles.toLocaleString()}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-slate-900">{simLarge.toLocaleString()} files</span>
                      <span className="block text-[10px] font-medium text-slate-500">-{simBreakdown.bloatPenalty} pts</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <input 
                      type="range"
                      min={0}
                      max={Math.max(10, metrics.largeFiles)}
                      value={simLarge}
                      onChange={(e) => setSimLarge(parseInt(e.target.value))}
                      className="w-full accent-slate-800 cursor-pointer h-1.5 bg-slate-100 rounded-lg"
                    />
                    <div className="flex justify-between text-[10px] font-medium text-slate-400">
                      <span>0 (Clean)</span>
                      <span>Target: {simLarge}</span>
                      <span>Current: {metrics.largeFiles}</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <button
                      onClick={() => setSimLarge(0)}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer underline-offset-2 hover:underline"
                    >
                      Simulate Clean (+{Math.round(liveBreakdown.bloatPenalty)} pts)
                    </button>
                    <button
                      onClick={() => startInspect('Large Attachments', 'larger:5M -in:trash', 'large', liveBreakdown.bloatPenalty)}
                      disabled={metrics.largeFiles === 0}
                      className="text-xs font-medium px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Inspect Files
                    </button>
                  </div>
                </div>

                {/* Simulator Card 5: Unsubscribe Hygiene */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <UserX className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-slate-900">Unsubscribe from Senders</h4>
                        <span className="text-[11px] text-slate-500">Current unsubs: {metrics.unsubscribedCount || 0}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-slate-900">+{simExtraUnsubs} simulated</span>
                      <span className="block text-[10px] font-medium text-slate-500">+{simBreakdown.unsubBonus} pts</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <input 
                      type="range"
                      min={0}
                      max={10}
                      value={simExtraUnsubs}
                      onChange={(e) => setSimExtraUnsubs(parseInt(e.target.value))}
                      className="w-full accent-slate-800 cursor-pointer h-1.5 bg-slate-100 rounded-lg"
                    />
                    <div className="flex justify-between text-[10px] font-medium text-slate-400">
                      <span>+0 unsubs</span>
                      <span>+5 unsubs</span>
                      <span>+10 unsubs (Max +8 pts)</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <button
                      onClick={() => setSimExtraUnsubs(6)}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer underline-offset-2 hover:underline"
                    >
                      Simulate 6 Unsubs (+8 pts)
                    </button>
                    <button
                      onClick={() => { window.location.hash = '#subscriptions'; }}
                      className="text-xs font-medium px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 transition-colors cursor-pointer"
                    >
                      Open Manager
                    </button>
                  </div>
                </div>

                {/* Simulator Card 6: Rules & Automation */}
                <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-2xs flex flex-col justify-between gap-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <Filter className="w-4 h-4" />
                      </div>
                      <div>
                        <h4 className="text-xs font-semibold text-slate-900">Gmail Filter Automation Rules</h4>
                        <span className="text-[11px] text-slate-500">Current rules: {metrics.activeFiltersCount || 0}</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className="text-xs font-bold text-slate-900">+{simExtraRules} simulated</span>
                      <span className="block text-[10px] font-medium text-slate-500">+{simBreakdown.filterBonus} pts</span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <input 
                      type="range"
                      min={0}
                      max={5}
                      value={simExtraRules}
                      onChange={(e) => setSimExtraRules(parseInt(e.target.value))}
                      className="w-full accent-slate-800 cursor-pointer h-1.5 bg-slate-100 rounded-lg"
                    />
                    <div className="flex justify-between text-[10px] font-medium text-slate-400">
                      <span>+0 rules</span>
                      <span>+3 rules</span>
                      <span>+5 rules (Max +7 pts)</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                    <button
                      onClick={() => setSimExtraRules(4)}
                      className="text-[11px] font-medium text-slate-600 hover:text-slate-900 cursor-pointer underline-offset-2 hover:underline"
                    >
                      Simulate 4 Rules (+7 pts)
                    </button>
                    <button
                      onClick={() => { window.location.hash = '#folder-optimizer'; }}
                      className="text-xs font-medium px-3 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 border border-slate-200 transition-colors cursor-pointer"
                    >
                      Rule Optimizer
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  if (isPage) {
    return (
      <div className="w-full max-w-5xl mx-auto flex flex-col animate-in fade-in duration-150">
        {headerElement}
        {mainBodyContent}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl h-[88vh] flex flex-col overflow-hidden my-auto relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Celebration Overlay */}
        {celebration && (
          <div className="absolute inset-0 z-50 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">{celebration.message}</h3>
            <p className={cn(
              "text-sm font-semibold px-3 py-1 rounded-full border",
              celebration.pts > 0
                ? "text-emerald-600 bg-emerald-50 border-emerald-200"
                : "text-slate-600 bg-slate-50 border-slate-200"
            )}>
              {celebration.pts > 0
                ? `+${celebration.pts} Points Recovered`
                : "Cleaned up — score already at its best for this category"}
            </p>
          </div>
        )}

        {headerElement}
        {mainBodyContent}

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-white flex items-center justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-medium shadow-xs transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
