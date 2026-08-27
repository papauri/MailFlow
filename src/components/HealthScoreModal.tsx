import React, { useState, useEffect, useMemo } from 'react';
import {
  X, Activity, Loader2, TrendingUp, AlertTriangle,
  HardDrive, Trash2, MailOpen, ShieldCheck, RefreshCw, Sparkles, ArrowLeft,
  Sliders, UserX, Filter, RotateCcw, Clock
} from 'lucide-react';
import { cn } from '../lib/utils';
import {
  countEmails, markAllAsReadByQuery, emptyAllTrash, trashAllByQuery, fetchMailboxComposition
} from '../lib/gmail';
import {
  computeInboxHealthScore,
  computeInboxHealthBreakdown,
  getUserManagementCounts,
  HEALTH_SCORE_QUERIES,
  HEALTH_SCORE_SWEEP_QUERIES,
  ATTENTION_SHARE_OF_SCORE,
  healthBand,
  HEALTH_BAND_LABEL,
  HealthScoreMetrics,
  HealthScoreBreakdown
} from '../lib/emailUtils';

type FixableMetric = 'unread' | 'spam' | 'promo' | 'large' | 'oldMail';

const FIX_PROGRESS_LABELS: Record<FixableMetric, string> = {
  unread: 'Marking messages as read',
  spam: 'Emptying spam & trash',
  promo: 'Clearing stale promotions',
  large: 'Moving large attachments to trash',
  oldMail: 'Clearing mail older than a year',
};

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
    activeFiltersCount: 0,
    mailboxTotal: 0,
    inboxTotal: 0
  });
  
  /**
   * How many messages each destructive sweep would actually move.
   *
   * Distinct from `metrics`, which counts everything the score penalises. The sweep
   * skips starred, important, filed and sent mail, so these are always <= the metric
   * and the gap is what the card reports as protected.
   */
  const [sweepable, setSweepable] = useState<{ promo: number; large: number; oldMail: number } | null>(null);

  const [activeTab, setActiveTab] = useState<'breakdown' | 'simulator'>('breakdown');
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{message: string, pts: number} | null>(null);
  const [fixProgress, setFixProgress] = useState<{ label: string; current: number; total: number } | null>(null);
  
  // Granular simulation controls
  const [simUnread, setSimUnread] = useState<number>(0);
  const [simSpam, setSimSpam] = useState<number>(0);
  const [simPromo, setSimPromo] = useState<number>(0);
  const [simLarge, setSimLarge] = useState<number>(0);
  const [simExtraUnsubs, setSimExtraUnsubs] = useState<number>(0);
  const [simExtraRules, setSimExtraRules] = useState<number>(0);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const [size, unread, spam, promo, large, old, promoSweep, largeSweep, oldSweep] = await Promise.all([
        fetchMailboxComposition().catch(() => ({ mailboxTotal: 0, inboxTotal: 0 })),
        countEmails(HEALTH_SCORE_QUERIES.unread),
        countEmails(HEALTH_SCORE_QUERIES.spamAndTrash),
        countEmails(HEALTH_SCORE_QUERIES.oldPromotions),
        countEmails(HEALTH_SCORE_QUERIES.largeFiles),
        countEmails(HEALTH_SCORE_QUERIES.oldMail),
        countEmails(HEALTH_SCORE_SWEEP_QUERIES.oldPromotions),
        countEmails(HEALTH_SCORE_SWEEP_QUERIES.largeFiles),
        countEmails(HEALTH_SCORE_SWEEP_QUERIES.oldMail)
      ]);
      setSweepable({ promo: promoSweep, large: largeSweep, oldMail: oldSweep });
      const { unsubscribedCount, activeFiltersCount } = getUserManagementCounts();
      const fetchedMetrics: HealthScoreMetrics = {
        unreadInbox: unread,
        spamAndTrash: spam,
        oldPromotions: promo,
        largeFiles: large,
        oldMail: old,
        unsubscribedCount,
        activeFiltersCount,
        ...size
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
      const [size, unread, spam, promo, large, old, promoSweep, largeSweep, oldSweep] = await Promise.all([
        fetchMailboxComposition().catch(() => ({ mailboxTotal: 0, inboxTotal: 0 })),
        countEmails(HEALTH_SCORE_QUERIES.unread),
        countEmails(HEALTH_SCORE_QUERIES.spamAndTrash),
        countEmails(HEALTH_SCORE_QUERIES.oldPromotions),
        countEmails(HEALTH_SCORE_QUERIES.largeFiles),
        countEmails(HEALTH_SCORE_QUERIES.oldMail),
        countEmails(HEALTH_SCORE_SWEEP_QUERIES.oldPromotions),
        countEmails(HEALTH_SCORE_SWEEP_QUERIES.largeFiles),
        countEmails(HEALTH_SCORE_SWEEP_QUERIES.oldMail)
      ]);
      setSweepable({ promo: promoSweep, large: largeSweep, oldMail: oldSweep });
      const { unsubscribedCount, activeFiltersCount } = getUserManagementCounts();
      setMetrics(prev => ({
        ...prev,
        unreadInbox: unread,
        spamAndTrash: spam,
        oldPromotions: promo,
        largeFiles: large,
        oldMail: old,
        unsubscribedCount,
        activeFiltersCount,
        ...size
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

  /**
   * The budgets, read from the model rather than restated.
   *
   * These were written into the row descriptions as "max -35 pts", "max -25 pts"
   * and "max -20 pts" — the fixed per-category weights of an earlier model. Those
   * weights no longer exist: unread has the attention budget to itself, and the
   * four clutter categories share the remainder in proportion to how many messages
   * each holds. Hardcoding them here is what let the page describe a scoring model
   * the app had stopped using.
   */
  const attentionMax = Math.round(100 * ATTENTION_SHARE_OF_SCORE);
  const storageMax = 100 - attentionMax;
  const pctOf = (count: number, population?: number) =>
    population && population > 0 ? `${Math.round((Math.min(count, population) / population) * 100)}%` : null;

  // Simulator Breakdown
  const simMetrics: HealthScoreMetrics = useMemo(() => {
    return {
      unreadInbox: simUnread,
      spamAndTrash: simSpam,
      oldPromotions: simPromo,
      largeFiles: simLarge,
      oldMail: metrics.oldMail,
      unsubscribedCount: (metrics.unsubscribedCount || 0) + simExtraUnsubs,
      activeFiltersCount: (metrics.activeFiltersCount || 0) + simExtraRules,
      // The simulator must score against the same mailbox as the live breakdown, or
      // its "what if" number is computed from a different model than the one beside it.
      mailboxTotal: metrics.mailboxTotal,
      inboxTotal: metrics.inboxTotal
    };
  }, [simUnread, simSpam, simPromo, simLarge, metrics.oldMail, metrics.unsubscribedCount, metrics.activeFiltersCount, metrics.mailboxTotal, metrics.inboxTotal, simExtraUnsubs, simExtraRules]);

  const simBreakdown: HealthScoreBreakdown = useMemo(() => {
    return computeInboxHealthBreakdown(simMetrics);
  }, [simMetrics]);

  const simulatedScore = simBreakdown.score;
  const scoreDiff = simulatedScore - liveScore;

  /** What a sweep will really move, and what it will leave behind. */
  const sweepPlan = (type: FixableMetric): { moves: number; kept: number } => {
    if (type === 'unread') return { moves: metrics.unreadInbox, kept: 0 };
    if (type === 'spam') return { moves: metrics.spamAndTrash, kept: 0 };
    const total =
      type === 'promo' ? metrics.oldPromotions :
      type === 'large' ? metrics.largeFiles :
      (metrics.oldMail || 0);
    const moves =
      type === 'promo' ? (sweepable?.promo ?? total) :
      type === 'large' ? (sweepable?.large ?? total) :
      (sweepable?.oldMail ?? total);
    return { moves, kept: Math.max(0, total - moves) };
  };

  const handleFix = async (type: FixableMetric, _currentPts?: number) => {
    setActiveAction(type);

    // Denominator for the progress bar: what the sweep will really move, which for
    // the three protected sweeps is the sweepable subset and not the metric.
    const { moves: expectedTotal, kept: protectedRemainder } = sweepPlan(type);

    setFixProgress({ label: FIX_PROGRESS_LABELS[type], current: 0, total: expectedTotal });
    const report = (done: number) =>
      setFixProgress({ label: FIX_PROGRESS_LABELS[type], current: done, total: expectedTotal });

    let processed = 0;
    try {
      let message = "";
      const keptNote = protectedRemainder > 0
        ? ` ${protectedRemainder.toLocaleString()} protected message${protectedRemainder === 1 ? '' : 's'} kept.`
        : '';

      if (type === 'unread') {
        processed = await markAllAsReadByQuery(HEALTH_SCORE_SWEEP_QUERIES.unread, report);
        message = "Inbox zero achieved (unread)!";
      } else if (type === 'spam') {
        processed = await emptyAllTrash(HEALTH_SCORE_SWEEP_QUERIES.spamAndTrash, report);
        message = "Spam and trash emptied!";
      } else if (type === 'promo') {
        processed = await trashAllByQuery(HEALTH_SCORE_SWEEP_QUERIES.oldPromotions, report);
        message = `${processed.toLocaleString()} old promotions cleaned.${keptNote}`;
      } else if (type === 'large') {
        processed = await trashAllByQuery(HEALTH_SCORE_SWEEP_QUERIES.largeFiles, report);
        message = `${processed.toLocaleString()} large attachments moved to trash.${keptNote}`;
      } else if (type === 'oldMail') {
        processed = await trashAllByQuery(HEALTH_SCORE_SWEEP_QUERIES.oldMail, report);
        message = `${processed.toLocaleString()} messages older than a year cleaned.${keptNote}`;
      }

      // Report what the sweep actually processed, falling back to the expected
      // total for the helpers that don't return a count.
      const countToSubtract = processed || expectedTotal;

      // Derive points gained from the real before/after score rather than assuming
      // the full category penalty, so the number shown is what was actually earned.
      // A protected sweep does not zero its metric — the protected mail is still
      // there and still counts, so claiming zero would overstate the score until the
      // next silent reconcile took the points back again.
      const nextMetrics: HealthScoreMetrics = { ...metrics };
      if (type === 'unread') nextMetrics.unreadInbox = 0;
      else if (type === 'spam') nextMetrics.spamAndTrash = 0;
      else if (type === 'promo') nextMetrics.oldPromotions = protectedRemainder;
      else if (type === 'large') nextMetrics.largeFiles = protectedRemainder;
      else if (type === 'oldMail') nextMetrics.oldMail = protectedRemainder;

      const ptsGained = computeInboxHealthScore(nextMetrics) - computeInboxHealthScore(metrics);

      setMetrics(nextMetrics);
      setSweepable(prev => {
        if (!prev) return prev;
        if (type === 'promo') return { ...prev, promo: 0 };
        if (type === 'large') return { ...prev, large: 0 };
        if (type === 'oldMail') return { ...prev, oldMail: 0 };
        return prev;
      });
      setSimUnread(nextMetrics.unreadInbox);
      setSimSpam(nextMetrics.spamAndTrash);
      setSimPromo(nextMetrics.oldPromotions);
      setSimLarge(nextMetrics.largeFiles);

      setCelebration({ message, pts: ptsGained });
      setTimeout(() => setCelebration(null), 3500);

      // Broadcast instant sync event for other views (InboxHealth, Dashboard, etc.).
      // `isPartial` is true whenever protected mail survived, so listeners subtract
      // what moved rather than zeroing a category that is not empty.
      window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
        detail: { type, count: countToSubtract, isPartial: protectedRemainder > 0, metrics: nextMetrics }
      }));

      // Background silent reconcile after 4 seconds once Gmail index catches up
      setTimeout(() => {
        fetchMetricsSilent();
      }, 4000);
    } catch (error) {
      console.error(error);
    } finally {
      setActiveAction(null);
      setFixProgress(null);
    }
  };

  // Bands come from the scoring module, so the navbar ring and this panel can never
  // disagree about the same number.
  const BAND_BADGE: Record<string, string> = {
    optimal: 'bg-slate-100 text-slate-800 border-slate-200',
    good: 'bg-slate-100 text-slate-800 border-slate-200',
    attention: 'bg-amber-50 text-amber-800 border-amber-200',
    critical: 'bg-rose-50 text-rose-800 border-rose-200',
  };
  const getScoreStatus = (s: number) => {
    const band = healthBand(s);
    return {
      text: 'text-slate-900', bg: 'bg-slate-50', border: 'border-slate-200',
      label: HEALTH_BAND_LABEL[band], badge: BAND_BADGE[band],
    };
  };

  const status = getScoreStatus(liveScore);
  const simStatus = getScoreStatus(simulatedScore);

  /**
   * Inspect opens a real filtered page rather than an inline panel, so the user gets
   * breadcrumbs, a named Back button, their own history entry, and the full set of
   * bulk actions. `action` tells that page which operation this task calls for.
   */
  const openInspectPage = (
    title: string,
    query: string,
    subtitle: string,
    action: 'markRead' | 'trash' | 'deleteForever'
  ) => {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('title', title);
    params.set('badge', 'Score Breakdown');
    params.set('sub', subtitle);
    params.set('source', isPage ? 'health-score' : 'health');
    params.set('action', action);
    window.location.hash = `#filter-view?${params.toString()}`;
  };

  /**
   * One config drives every remediation row, so each is laid out identically instead
   * of six hand-written blocks that drifted apart in button width and label length.
   */
  const remediationRows: {
    id: FixableMetric;
    icon: React.ReactNode;
    title: string;
    badge: string;
    desc: string;
    penalty: number;
    count: number;
    query: string;
    subtitle: string;
    actionLabel: string;
    inspectAction: 'markRead' | 'trash' | 'deleteForever';
    /** What the action button will really move, and what it will leave behind. */
    plan: { moves: number; kept: number };
    /** The query the action runs, which for a protected sweep is not `query`. */
    sweepQuery: string;
  }[] = [
    {
      id: 'unread',
      icon: <MailOpen className="w-4 h-4" />,
      title: 'Unread Inbox Messages',
      badge: `${metrics.unreadInbox.toLocaleString()} unread`,
      desc: `Unopened mail in your inbox${pctOf(metrics.unreadInbox, metrics.inboxTotal) ? ` — ${pctOf(metrics.unreadInbox, metrics.inboxTotal)} of it` : ''}. Costs up to ${attentionMax} pts.`,
      penalty: liveBreakdown.unreadPenalty,
      count: metrics.unreadInbox,
      query: HEALTH_SCORE_QUERIES.unread,
      subtitle: 'Unread messages sitting in your inbox',
      actionLabel: 'Mark Read',
      inspectAction: 'markRead',
      plan: sweepPlan('unread'),
      sweepQuery: HEALTH_SCORE_SWEEP_QUERIES.unread,
    },
    {
      id: 'spam',
      icon: <Trash2 className="w-4 h-4" />,
      title: 'Spam & Trash Items',
      badge: `${metrics.spamAndTrash.toLocaleString()} items`,
      desc: `Already-discarded mail still using your quota. Shares a ${storageMax}-pt clutter budget with the three below, by message count.`,
      penalty: liveBreakdown.spamPenalty,
      count: metrics.spamAndTrash,
      query: HEALTH_SCORE_QUERIES.spamAndTrash,
      subtitle: 'Messages already in spam or trash',
      actionLabel: 'Empty All',
      inspectAction: 'deleteForever',
      plan: sweepPlan('spam'),
      sweepQuery: HEALTH_SCORE_SWEEP_QUERIES.spamAndTrash,
    },
    {
      id: 'promo',
      icon: <AlertTriangle className="w-4 h-4" />,
      title: 'Stale Promotions (>6 Months)',
      badge: `${metrics.oldPromotions.toLocaleString()} emails`,
      desc: `Marketing mail past six months. Shares the same ${storageMax}-pt clutter budget.`,
      penalty: liveBreakdown.promoPenalty,
      count: metrics.oldPromotions,
      query: HEALTH_SCORE_QUERIES.oldPromotions,
      subtitle: 'Marketing mail older than six months',
      actionLabel: 'Clean All',
      inspectAction: 'trash',
      plan: sweepPlan('promo'),
      sweepQuery: HEALTH_SCORE_SWEEP_QUERIES.oldPromotions,
    },
    {
      id: 'large',
      icon: <HardDrive className="w-4 h-4" />,
      title: 'Large Attachments (>5MB)',
      badge: `${metrics.largeFiles.toLocaleString()} files`,
      desc: `Attachments over 5MB. Shares the same ${storageMax}-pt clutter budget.`,
      penalty: liveBreakdown.largeFilesPenalty,
      count: metrics.largeFiles,
      query: HEALTH_SCORE_QUERIES.largeFiles,
      subtitle: 'Messages carrying attachments over 5MB',
      actionLabel: 'Clean All',
      inspectAction: 'trash',
      plan: sweepPlan('large'),
      sweepQuery: HEALTH_SCORE_SWEEP_QUERIES.largeFiles,
    },
    {
      id: 'oldMail',
      icon: <Clock className="w-4 h-4" />,
      title: 'Old Mail (>1 Year)',
      badge: `${(metrics.oldMail || 0).toLocaleString()} emails`,
      desc: `Mail older than a year. Shares the same ${storageMax}-pt clutter budget.`,
      penalty: liveBreakdown.oldMailPenalty,
      count: metrics.oldMail || 0,
      query: HEALTH_SCORE_QUERIES.oldMail,
      subtitle: 'Messages older than one year',
      actionLabel: 'Clean All',
      inspectAction: 'trash',
      plan: sweepPlan('oldMail'),
      sweepQuery: HEALTH_SCORE_SWEEP_QUERIES.oldMail,
    },
  ];

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
        <button
          onClick={fetchMetrics}
          disabled={loading}
          className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
          title="Refresh score"
        >
          <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
        </button>
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
                    Measured against this mailbox, not a fixed target: {attentionMax}% of the
                    score is how much of your inbox is unread, {storageMax}% is how much of your
                    mailbox is clearable, and automation rules earn points back.
                  </p>
                  {metrics.mailboxTotal > 0 && (
                    <p className="text-[11px] text-slate-400 mt-2 leading-relaxed border-t border-slate-100 pt-2.5 w-full">
                      {metrics.mailboxTotal.toLocaleString()} messages
                      {metrics.inboxTotal > 0 && <> · {metrics.inboxTotal.toLocaleString()} in the inbox</>}
                    </p>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white border border-slate-200 p-3.5 rounded-xl flex flex-col justify-between shadow-2xs">
                    <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">Deductions</span>
                    <div className="mt-1">
                      <span className="text-2xl font-bold text-slate-900">-{liveBreakdown.totalDeductions}</span>
                      <span className="text-xs font-normal text-slate-400 ml-1">pts</span>
                    </div>
                    <span className="text-[11px] text-slate-500 mt-1">
                      Clutter &amp; unread{pctOf(liveBreakdown.totalDeductions, 100) ? ` — ${Math.round(liveBreakdown.totalDeductions)}% of the score` : ''}
                    </span>
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

                {/* Sweeps now run to completion, so show real progress rather than
                    leaving the user guessing during a multi-thousand message clear. */}
                {fixProgress && (
                  <div className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-2xs mb-2.5">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-600 shrink-0" />
                        <span className="text-xs font-semibold text-slate-800 truncate">{fixProgress.label}</span>
                      </div>
                      <span className="text-xs font-medium text-slate-600 tabular-nums shrink-0">
                        {fixProgress.current.toLocaleString()}
                        {fixProgress.total > 0 && ` / ${fixProgress.total.toLocaleString()}`}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-800 rounded-full transition-all duration-300"
                        style={{
                          width: fixProgress.total > 0
                            ? `${Math.min(100, Math.round((fixProgress.current / fixProgress.total) * 100))}%`
                            : '100%'
                        }}
                      />
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1.5">
                      Working through every matching message — this can take a while on a large backlog.
                    </p>
                  </div>
                )}

                <div className="space-y-2.5">
                  {remediationRows.map(row => (
                    <div
                      key={row.id}
                      className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl shadow-2xs transition-colors flex flex-col sm:flex-row sm:items-center gap-3"
                    >
                      <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                          {row.icon}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h4 className="text-sm font-semibold text-slate-900">{row.title}</h4>
                            <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200 whitespace-nowrap">
                              {row.badge}
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{row.desc}</p>
                          {row.plan.kept > 0 && (
                            <p className="text-[11px] text-emerald-700 mt-1 leading-relaxed flex items-center gap-1">
                              <ShieldCheck className="w-3 h-3 shrink-0" />
                              <span>
                                Clears {row.plan.moves.toLocaleString()} — keeps {row.plan.kept.toLocaleString()} starred,
                                important, filed or sent
                              </span>
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row sm:items-center justify-between sm:justify-end gap-2 sm:gap-3 shrink-0 w-full sm:w-auto">
                        <span className="text-sm font-bold text-slate-800 w-[64px] text-right tabular-nums shrink-0">
                          -{row.penalty} pts
                        </span>
                        <div className="flex items-stretch gap-0.5 bg-slate-100 rounded-lg p-0.5 border border-slate-200 w-full sm:w-[184px] shrink-0">
                          <button
                            onClick={() => openInspectPage(
                              row.title,
                              row.sweepQuery,
                              row.plan.kept > 0
                                ? `${row.subtitle} — excludes ${row.plan.kept.toLocaleString()} protected`
                                : row.subtitle,
                              row.inspectAction
                            )}
                            disabled={row.plan.moves === 0}
                            className="flex-1 text-xs font-medium px-2 py-1.5 rounded-md hover:bg-white text-slate-700 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
                          >
                            Inspect
                          </button>
                          <button
                            onClick={() => handleFix(row.id, row.penalty)}
                            disabled={row.plan.moves === 0 || activeAction !== null}
                            className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex items-center justify-center gap-1"
                          >
                            {activeAction === row.id && <Loader2 className="w-3 h-3 animate-spin" />}
                            {row.actionLabel}
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Positive Bonus row — same shell so it lines up with the rest */}
                  <div className="p-3.5 bg-white border border-slate-200 rounded-xl shadow-2xs flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        <ShieldCheck className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-semibold text-slate-900">Automations & Unsubscribe Bonus</h4>
                          <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200 whitespace-nowrap">
                            +{liveBreakdown.totalBonus} pts
                          </span>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                          {metrics.unsubscribedCount || 0} unsubscriptions (+{liveBreakdown.unsubBonus} pts) &bull; {metrics.activeFiltersCount || 0} filter rules (+{liveBreakdown.filterBonus} pts)
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row sm:items-center justify-between sm:justify-end gap-2 sm:gap-3 shrink-0 w-full sm:w-auto">
                      <span className="text-sm font-bold text-slate-800 w-[64px] text-right tabular-nums shrink-0">
                        +{liveBreakdown.totalBonus} pts
                      </span>
                      <div className="flex items-stretch gap-0.5 bg-slate-100 rounded-lg p-0.5 border border-slate-200 w-full sm:w-[184px] shrink-0">
                        <button
                          onClick={() => { window.location.hash = '#subscriptions'; }}
                          className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-all cursor-pointer whitespace-nowrap"
                        >
                          Manage Subs
                        </button>
                      </div>
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
                      onClick={() => openInspectPage('Large Attachments', HEALTH_SCORE_SWEEP_QUERIES.largeFiles, 'Messages carrying attachments over 5MB, excluding starred, important, filed and sent', 'trash')}
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
