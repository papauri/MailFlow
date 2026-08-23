import React, { useState, useEffect } from 'react';
import { 
  X, 
  Activity, 
  TrendingUp, 
  AlertTriangle, 
  HardDrive, 
  Trash2, 
  MailOpen, 
  ArrowRight, 
  ShieldCheck, 
  RefreshCw,
  Sparkles,
  CheckCircle2
} from 'lucide-react';
import { cn } from '../lib/utils';
import { countEmails } from '../lib/gmail';
import { computeInboxHealthScore, HealthScoreMetrics } from '../lib/emailUtils';

interface HealthScoreModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyQuery?: (query: string, filter?: string, sortOption?: "date" | "size" | "sender") => void;
  onOpenUnsubscribe?: () => void;
}

export function HealthScoreModal({ isOpen, onClose, onApplyQuery, onOpenUnsubscribe }: HealthScoreModalProps) {
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
  const [simulatedSpamClean, setSimulatedSpamClean] = useState(false);
  const [simulatedPromoClean, setSimulatedPromoClean] = useState(false);
  const [simulatedUnreadClean, setSimulatedUnreadClean] = useState(false);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const [unread, junk, promo, large, oldMail] = await Promise.all([
        countEmails("is:unread in:inbox").catch(() => 0),
        countEmails("in:spam OR in:trash").catch(() => 0),
        countEmails("category:promotions older_than:6m").catch(() => 0),
        countEmails("larger:5M -in:trash").catch(() => 0),
        countEmails("older_than:1y -in:trash").catch(() => 0)
      ]);

      const parseCount = (val: any) => typeof val === 'number' ? val : (parseInt(String(val).replace(/\D/g, '')) || 0);

      let unsubscribedCount = 0;
      let activeFiltersCount = 0;
      try {
        const storedUnsubs = localStorage.getItem('ais_unsub_log') || localStorage.getItem('unsubscribed_senders_v1');
        if (storedUnsubs) unsubscribedCount = JSON.parse(storedUnsubs).length;
        const storedRules = localStorage.getItem('inbox_created_rules_log_v1') || localStorage.getItem('ais_saved_rules_history');
        if (storedRules) activeFiltersCount = JSON.parse(storedRules).length;
      } catch { }

      setMetrics({
        unreadInbox: parseCount(unread),
        spamAndTrash: parseCount(junk),
        oldPromotions: parseCount(promo),
        largeFiles: parseCount(large),
        oldMail: parseCount(oldMail),
        unsubscribedCount,
        activeFiltersCount
      });
    } catch (e) {
      console.error("Failed to load health score metrics", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchMetrics();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Simple point calculations
  const unreadPenalty = Math.min(35, (Math.log(1 + metrics.unreadInbox) / Math.log(1 + 600)) * 35);
  const spamPenalty = Math.min(25, (Math.log(1 + metrics.spamAndTrash) / Math.log(1 + 400)) * 25);
  const promoPenalty = Math.min(20, (Math.log(1 + metrics.oldPromotions) / Math.log(1 + 500)) * 20);
  const bloatPenalty = Math.min(10, (metrics.largeFiles * 0.5) + (Math.min(500, metrics.oldMail) * 0.01));
  const managementBonus = Math.min(15, ((metrics.unsubscribedCount || 0) * 1.5) + ((metrics.activeFiltersCount || 0) * 2));

  const totalDeductions = Math.round(unreadPenalty + spamPenalty + promoPenalty + bloatPenalty);
  const totalBonus = Math.round(managementBonus);
  const liveScore = computeInboxHealthScore(metrics);

  // Compute simulated score
  const simMetrics: HealthScoreMetrics = {
    ...metrics,
    spamAndTrash: simulatedSpamClean ? 0 : metrics.spamAndTrash,
    oldPromotions: simulatedPromoClean ? 0 : metrics.oldPromotions,
    unreadInbox: simulatedUnreadClean ? Math.min(5, metrics.unreadInbox) : metrics.unreadInbox
  };
  const simulatedScore = computeInboxHealthScore(simMetrics);

  const getScoreStatus = (s: number) => {
    if (s >= 80) return { text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'Great condition' };
    if (s >= 60) return { text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', label: 'Needs attention' };
    return { text: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200', label: 'Needs cleanup' };
  };

  const status = getScoreStatus(liveScore);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden my-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-slate-900 text-white flex items-center justify-center shadow-xs">
              <Activity className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-900">Inbox Health Score</h2>
              <p className="text-xs text-slate-500">
                A simple breakdown of your score, deductions, and actions to improve it.
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={fetchMetrics}
              disabled={loading}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors"
              title="Refresh numbers"
            >
              <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-6 pt-2.5 border-b border-slate-200/80 bg-white flex items-center gap-4 text-xs font-semibold text-slate-600">
          <button
            onClick={() => setActiveTab('breakdown')}
            className={cn(
              "pb-2.5 border-b-2 transition-all flex items-center gap-1.5",
              activeTab === 'breakdown'
                ? "border-slate-900 text-slate-900 font-bold"
                : "border-transparent text-slate-500 hover:text-slate-800"
            )}
          >
            <Activity className="w-3.5 h-3.5" />
            Score Breakdown & Actions
          </button>

          <button
            onClick={() => setActiveTab('simulator')}
            className={cn(
              "pb-2.5 border-b-2 transition-all flex items-center gap-1.5",
              activeTab === 'simulator'
                ? "border-slate-900 text-slate-900 font-bold"
                : "border-transparent text-slate-500 hover:text-slate-800"
            )}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Score Simulator
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-500">
              <RefreshCw className="w-7 h-7 animate-spin text-slate-700" />
              <p className="text-sm font-medium">Checking your inbox status...</p>
            </div>
          ) : (
            <>
              {/* Aligned Top Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-slate-50 border border-slate-200 p-3.5 rounded-xl flex flex-col justify-between">
                  <span className="text-[11px] font-semibold text-slate-500">Starting Base</span>
                  <div className="mt-1">
                    <span className="text-xl font-bold text-slate-800">100</span>
                    <span className="text-xs font-medium text-slate-500 ml-1">pts</span>
                  </div>
                  <span className="text-[11px] text-slate-400 mt-1">Clean slate baseline</span>
                </div>

                <div className="bg-rose-50/70 border border-rose-200/70 p-3.5 rounded-xl flex flex-col justify-between">
                  <span className="text-[11px] font-semibold text-rose-700">Deductions</span>
                  <div className="mt-1">
                    <span className="text-xl font-bold text-rose-600">-{totalDeductions}</span>
                    <span className="text-xs font-medium text-rose-500 ml-1">pts</span>
                  </div>
                  <span className="text-[11px] text-rose-600/80 mt-1">Unread & clutter</span>
                </div>

                <div className="bg-indigo-50/70 border border-indigo-200/70 p-3.5 rounded-xl flex flex-col justify-between">
                  <span className="text-[11px] font-semibold text-indigo-700">Rule Bonus</span>
                  <div className="mt-1">
                    <span className="text-xl font-bold text-indigo-600">+{totalBonus}</span>
                    <span className="text-xs font-medium text-indigo-500 ml-1">pts</span>
                  </div>
                  <span className="text-[11px] text-indigo-600/80 mt-1">Rules & unsubs</span>
                </div>

                <div className="bg-slate-900 border border-slate-800 p-3.5 rounded-xl text-white flex flex-col justify-between shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-300">Total Score</span>
                  <div className="mt-1 flex items-baseline gap-1">
                    <span className="text-xl font-bold text-emerald-400">{liveScore}%</span>
                  </div>
                  <span className="text-[11px] text-slate-400 mt-1">{status.label}</span>
                </div>
              </div>

              {/* TAB 1: POINTS BREAKDOWN & ACTION CARDS */}
              {activeTab === 'breakdown' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                      Points Breakdown & 1-Click Fixes
                    </h3>
                    <span className="text-xs text-slate-400">Live mailbox data</span>
                  </div>

                  <div className="space-y-2.5">
                    {/* Item 1: Unread Inbox */}
                    <div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-rose-50 border border-rose-100 flex items-center justify-center text-rose-600 shrink-0">
                          <MailOpen className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900">Unread Emails</h4>
                            <span className="text-xs font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                              {metrics.unreadInbox.toLocaleString()} unread
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Unread emails sitting in your inbox
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-center">
                        <span className="text-sm font-bold text-rose-600 min-w-[55px] text-right">
                          -{Math.round(unreadPenalty)} pts
                        </span>

                        {onApplyQuery && (
                          <button
                            onClick={() => {
                              onClose();
                              onApplyQuery('is:unread', 'inbox');
                            }}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <span>Triage</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Item 2: Spam & Trash */}
                    <div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                          <Trash2 className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900">Spam & Trash</h4>
                            <span className="text-xs font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                              {metrics.spamAndTrash.toLocaleString()} items
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Junk and deleted messages waiting to be cleared
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-center">
                        <span className="text-sm font-bold text-amber-600 min-w-[55px] text-right">
                          -{Math.round(spamPenalty)} pts
                        </span>

                        {onApplyQuery && (
                          <button
                            onClick={() => {
                              onClose();
                              onApplyQuery('', 'spam+trash');
                            }}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <span>Empty Junk</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Item 3: Old Promotions */}
                    <div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 shrink-0">
                          <AlertTriangle className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900">Old Promotions</h4>
                            <span className="text-xs font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                              {metrics.oldPromotions.toLocaleString()} older than 6m
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Promotions and marketing emails older than 6 months
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-center">
                        <span className="text-sm font-bold text-slate-700 min-w-[55px] text-right">
                          -{Math.round(promoPenalty)} pts
                        </span>

                        {onApplyQuery && (
                          <button
                            onClick={() => {
                              onClose();
                              onApplyQuery('older_than:6m -in:trash', 'category:promotions');
                            }}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <span>Clean Ads</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Item 4: Large Files & Old Mail */}
                    <div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 shrink-0">
                          <HardDrive className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900">Large Attachments</h4>
                            <span className="text-xs font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                              {metrics.largeFiles} large files
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Files larger than 5MB taking up storage
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-center">
                        <span className="text-sm font-bold text-orange-600 min-w-[55px] text-right">
                          -{Math.round(bloatPenalty)} pts
                        </span>

                        {onApplyQuery && (
                          <button
                            onClick={() => {
                              onClose();
                              onApplyQuery('larger:5M', 'anywhere', 'size');
                            }}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <span>Inspect</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Item 5: Rules & Unsubscribe Bonus */}
                    <div className="p-3.5 bg-indigo-50/40 border border-indigo-100 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-indigo-100 border border-indigo-200 flex items-center justify-center text-indigo-700 shrink-0">
                          <ShieldCheck className="w-4 h-4" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-slate-900">Management Bonus</h4>
                            <span className="text-xs font-semibold bg-indigo-100/70 text-indigo-800 px-2 py-0.5 rounded-md">
                              {metrics.unsubscribedCount || 0} unsubs · {metrics.activeFiltersCount || 0} rules
                            </span>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            Bonus points earned from custom rules and unsubscribed senders
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 self-end sm:self-center">
                        <span className="text-sm font-bold text-indigo-600 min-w-[55px] text-right">
                          +{Math.round(managementBonus)} pts
                        </span>

                        {onOpenUnsubscribe && (
                          <button
                            onClick={() => {
                              onClose();
                              onOpenUnsubscribe();
                            }}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center gap-1 transition-colors shadow-2xs cursor-pointer"
                          >
                            <span>Subscriptions</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: SIMPLE RECOVERY SIMULATOR */}
              {activeTab === 'simulator' && (
                <div className="space-y-4">
                  <div className="p-4 bg-gradient-to-r from-slate-900 to-indigo-950 text-white rounded-xl flex items-center justify-between shadow-xs">
                    <div>
                      <span className="text-xs font-semibold text-indigo-200 uppercase tracking-wider">Projected Score</span>
                      <div className="flex items-baseline gap-2.5 mt-1">
                        <span className="text-3xl font-extrabold text-white">{simulatedScore}%</span>
                        <span className="text-xs font-bold text-emerald-400">
                          {simulatedScore > liveScore ? `+${simulatedScore - liveScore}% improvement` : 'Current Score'}
                        </span>
                      </div>
                    </div>

                    <div className="w-12 h-12 rounded-full border-2 border-indigo-400/40 flex items-center justify-center bg-indigo-900/50">
                      <TrendingUp className="w-5 h-5 text-indigo-300" />
                    </div>
                  </div>

                  <p className="text-xs text-slate-500">
                    Check the boxes below to see how quickly your score improves when performing these cleanups:
                  </p>

                  <div className="space-y-2.5">
                    <label className="flex items-center justify-between p-3.5 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors shadow-2xs">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={simulatedSpamClean}
                          onChange={(e) => setSimulatedSpamClean(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div>
                          <div className="text-xs font-bold text-slate-900">Empty Spam & Trash ({metrics.spamAndTrash} messages)</div>
                          <div className="text-[11px] text-slate-500">Clears all junk from your account</div>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-emerald-600">+{Math.round(spamPenalty)} pts</span>
                    </label>

                    <label className="flex items-center justify-between p-3.5 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors shadow-2xs">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={simulatedPromoClean}
                          onChange={(e) => setSimulatedPromoClean(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div>
                          <div className="text-xs font-bold text-slate-900">Clean old promotions ({metrics.oldPromotions} emails)</div>
                          <div className="text-[11px] text-slate-500">Removes old marketing emails over 6 months old</div>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-emerald-600">+{Math.round(promoPenalty)} pts</span>
                    </label>

                    <label className="flex items-center justify-between p-3.5 bg-white border border-slate-200 rounded-xl cursor-pointer hover:bg-slate-50 transition-colors shadow-2xs">
                      <div className="flex items-center gap-3">
                        <input
                          type="checkbox"
                          checked={simulatedUnreadClean}
                          onChange={(e) => setSimulatedUnreadClean(e.target.checked)}
                          className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                        />
                        <div>
                          <div className="text-xs font-bold text-slate-900">Triage unread emails ({metrics.unreadInbox} emails)</div>
                          <div className="text-[11px] text-slate-500">Marks backlog unread messages as read</div>
                        </div>
                      </div>
                      <span className="text-xs font-bold text-emerald-600">+{Math.round(unreadPenalty)} pts</span>
                    </label>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-100 bg-slate-50/70 flex items-center justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
