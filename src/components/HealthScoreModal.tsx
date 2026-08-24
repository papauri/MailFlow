import React, { useState, useEffect } from 'react';
import { 
  X, ChevronDown, ChevronUp, Activity, Loader2, TrendingUp, AlertTriangle, 
  HardDrive, Trash2, MailOpen, ArrowRight, ShieldCheck, RefreshCw, Sparkles, CheckCircle2, ArrowLeft, Mail
} from 'lucide-react';
import { cn } from '../lib/utils';
import { 
  countEmails, markAllAsReadByQuery, emptyAllTrash, searchEmails, 
  batchDeleteEmails, batchTrashEmails, batchMarkAsRead, EmailData 
} from '../lib/gmail';
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
    unsubscribedCount: 0,
    activeFiltersCount: 0
  });
  
  const [activeTab, setActiveTab] = useState<'breakdown' | 'simulator'>('breakdown');
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{message: string, pts: number} | null>(null);
  
  // Simulation states
  const [simulatedSpamClean, setSimulatedSpamClean] = useState(false);
  const [simulatedPromoClean, setSimulatedPromoClean] = useState(false);
  const [simulatedUnreadClean, setSimulatedUnreadClean] = useState(false);

  // Inspect mode states
  const [inspectingView, setInspectingView] = useState<{ title: string; query: string; actionType: 'unread' | 'spam' | 'promo' | 'large', penalty: number } | null>(null);
  const [previewEmails, setPreviewEmails] = useState<EmailData[]>([]);
  const [selectedInspectIds, setSelectedInspectIds] = useState<Set<string>>(new Set());
  const [loadingPreview, setLoadingPreview] = useState(false);

  const fetchMetrics = async () => {
    setLoading(true);
    try {
      const [unread, spam, promo, large] = await Promise.all([
        countEmails("is:unread in:inbox -in:chats"),
        countEmails("in:spam OR in:trash"),
        countEmails("category:promotions older_than:6m -in:trash"),
        countEmails("larger:5M -in:trash")
      ]);
      setMetrics({
        unreadInbox: unread,
        spamAndTrash: spam,
        oldPromotions: promo,
        largeFiles: large,
        unsubscribedCount: parseInt(localStorage.getItem('unsub_count') || '0'),
        activeFiltersCount: parseInt(localStorage.getItem('rules_count') || '0')
      });
    } catch (e) {
      console.error(e);
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

  const liveScore = computeInboxHealthScore(metrics);
  
  const unreadPenalty = Math.min(25, (metrics.unreadInbox / 100) * 2.5);
  const spamPenalty = Math.min(20, (metrics.spamAndTrash / 50) * 2);
  const promoPenalty = Math.min(20, (metrics.oldPromotions / 100) * 2);
  const largePenalty = Math.min(15, (metrics.largeFiles / 10) * 3);
  
  const totalDeductions = Math.round(unreadPenalty + spamPenalty + promoPenalty + largePenalty);
  const managementBonus = Math.min(15, (metrics.unsubscribedCount * 1) + (metrics.activeFiltersCount * 2));
  const totalBonus = Math.round(managementBonus);

  const simMetrics = {
    ...metrics,
    spamAndTrash: simulatedSpamClean ? 0 : metrics.spamAndTrash,
    oldPromotions: simulatedPromoClean ? 0 : metrics.oldPromotions,
    unreadInbox: simulatedUnreadClean ? Math.min(5, metrics.unreadInbox) : metrics.unreadInbox
  };
  const simulatedScore = computeInboxHealthScore(simMetrics);

  const handleFix = async (type: 'unread' | 'spam' | 'promo' | 'large', currentPts: number, selectedIds?: string[]) => {
    setActiveAction(type);
    try {
      let ptsGained = Math.round(currentPts);
      let message = "";
      
      const isPartial = selectedIds && selectedIds.length > 0;

      if (type === 'unread') {
        if (isPartial) {
          await batchMarkAsRead(selectedIds);
          message = `${selectedIds.length} emails marked as read!`;
        } else {
          await markAllAsReadByQuery("is:unread in:inbox -in:chats");
          message = "Inbox zero achieved (unread)!";
        }
      } else if (type === 'spam') {
        if (isPartial) {
          await batchTrashEmails(selectedIds);
          message = `${selectedIds.length} junk emails removed!`;
        } else {
          await emptyAllTrash();
          message = "Spam and trash emptied!";
        }
      } else if (type === 'promo') {
        if (isPartial) {
          await batchTrashEmails(selectedIds);
          message = `${selectedIds.length} old promotions cleaned!`;
        } else {
          const pEmails = await searchEmails("category:promotions older_than:6m -in:trash", 500);
          const promoIds = pEmails.map(e => e.id);
          if (promoIds.length > 0) {
            await batchTrashEmails(promoIds);
          }
          message = "Old promotions cleaned!";
        }
      } else if (type === 'large') {
         if (isPartial) {
           await batchTrashEmails(selectedIds);
           message = `${selectedIds.length} large attachments removed!`;
         } else if (onApplyQuery) {
            onClose();
            onApplyQuery("larger:5M -in:trash");
            return;
         }
      }
      
      await fetchMetrics();
      setInspectingView(null);
      setCelebration({ message, pts: ptsGained });
      setTimeout(() => {
        setCelebration(null);
      }, 3500);
    } catch (error) {
      console.error(error);
    } finally {
      setActiveAction(null);
    }
  };

  const startInspect = async (title: string, query: string, actionType: 'unread' | 'spam' | 'promo' | 'large', penalty: number) => {
    setInspectingView({ title, query, actionType, penalty });
    setLoadingPreview(true);
    setPreviewEmails([]);
    setSelectedInspectIds(new Set());
    try {
      // Fetch up to 50 emails for a robust preview list
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
    }
    return computeInboxHealthScore(projectedMetrics);
  };

  const inspectProjectedScore = getInspectProjectedScore();

  const getScoreStatus = (s: number) => {
    if (s >= 80) return { text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', label: 'Great condition' };
    if (s >= 60) return { text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', label: 'Needs attention' };
    return { text: 'text-rose-600', bg: 'bg-rose-50', border: 'border-rose-200', label: 'Needs cleanup' };
  };

  const status = getScoreStatus(liveScore);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-150">
      <div 
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden my-auto relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Celebration Overlay */}
        {celebration && (
          <div className="absolute inset-0 z-50 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center animate-in fade-in zoom-in-95 duration-300">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8" />
            </div>
            <h3 className="text-xl font-bold text-slate-900 mb-2">{celebration.message}</h3>
            <p className="text-sm font-semibold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
              +{celebration.pts} Points Recovered
            </p>
          </div>
        )}

        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70 shrink-0">
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
            {!inspectingView && (
              <button
                onClick={fetchMetrics}
                disabled={loading}
                className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer"
              >
                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
           {inspectingView ? (
             <div className="flex flex-col h-full bg-white animate-in slide-in-from-right-4 duration-300">
                {/* Inspect Header */}
                <div className="px-6 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white shrink-0">
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
                           <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full truncate max-w-[150px] sm:max-w-none">{inspectingView.query}</span>
                        </h3>
                        {selectedInspectIds.size > 0 && (
                          <p className="text-xs font-semibold text-emerald-600 mt-0.5">
                            Projected Score: {inspectProjectedScore}% (+{inspectProjectedScore - liveScore} pts)
                          </p>
                        )}
                      </div>
                   </div>
                   <div className="flex items-center gap-2 self-end sm:self-center">
                      <button
                         onClick={() => handleFix(inspectingView.actionType, inspectingView.penalty, Array.from(selectedInspectIds))}
                         disabled={activeAction !== null}
                         className="text-xs font-bold px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50 whitespace-nowrap"
                      >
                         {activeAction === inspectingView.actionType ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                         {selectedInspectIds.size > 0 
                           ? `Fix ${selectedInspectIds.size} Selected` 
                           : `Fix All (+${Math.round(inspectingView.penalty)} pts)`}
                      </button>
                   </div>
                </div>
                
                {/* Email List Container - Like Dashboard */}
                <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-slate-50/30">
                  {loadingPreview ? (
                    <div className="flex flex-col items-center justify-center h-full min-h-[250px] text-slate-400">
                      <Loader2 className="w-8 h-8 animate-spin mb-4" />
                      <p className="text-sm font-medium">Fetching messages...</p>
                    </div>
                  ) : previewEmails.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full min-h-[250px] text-slate-400">
                      <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3" />
                      <p className="text-sm font-medium text-slate-600">No messages found here!</p>
                      <p className="text-xs text-slate-500 mt-1">This category is already clean.</p>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col p-0 sm:p-4 mx-auto w-full max-w-full">
                       <div className="bg-white border-y sm:border sm:border-slate-200 sm:rounded-xl sm:shadow-xs overflow-hidden">
                          <div className="px-3 sm:px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
                            <button 
                              onClick={toggleInspectSelectAll}
                              className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer", selectedInspectIds.size === previewEmails.length && previewEmails.length > 0 ? "bg-slate-800 border-slate-800 text-white" : "border-slate-300 bg-white text-transparent")}
                            >
                              <CheckCircle2 className="w-3 h-3" />
                            </button>
                            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Select All</span>
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
                                        <div className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0", isSelected ? "bg-slate-800 border-slate-800 text-white" : "border-slate-300 bg-white text-transparent")}>
                                          <CheckCircle2 className="w-3 h-3" />
                                        </div>
                                        <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 border border-slate-200 text-xs font-bold uppercase hidden sm:flex">
                                           {(email.sender.replace(/<.*>/, "").trim() || '?')[0]}
                                        </div>
                                        <span 
                                           className={cn("text-xs sm:text-sm truncate", isUnread ? "font-bold text-slate-900" : "font-medium text-slate-700")}
                                           title={email.sender}
                                        >
                                           {email.sender.replace(/<.*>/, "").trim() || email.sender}
                                        </span>
                                     </div>
                                     <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center justify-between gap-0.5 sm:gap-4 pl-9 sm:pl-0">
                                        <div className="truncate text-[11px] sm:text-sm min-w-0 flex-1">
                                           <span className={cn(isUnread ? "font-bold text-slate-800" : "font-medium text-slate-600")}>
                                              {email.subject || '(No Subject)'}
                                           </span>
                                           <span className="text-slate-400 font-normal truncate mx-1 hidden sm:inline">-</span>
                                           <span className="text-slate-400 font-normal truncate">
                                              {email.snippet}
                                           </span>
                                        </div>
                                        <div className="flex items-center gap-2 sm:gap-3 shrink-0 justify-start sm:justify-end mt-1 sm:mt-0">
                                           {(email.sizeEstimate || 0) > 1048576 && (
                                              <span className={cn(
                                                "text-[10px] font-semibold px-1.5 py-0.5 rounded shadow-xs border",
                                                (email.sizeEstimate || 0) > 5242880 ? "bg-red-50 text-red-700 border-red-200" : "bg-amber-50 text-amber-700 border-amber-200"
                                              )}>
                                                {((email.sizeEstimate || 0) / 1024 / 1024).toFixed(1)} MB
                                              </span>
                                           )}
                                           <span className={cn("text-[10px] sm:text-[11px] whitespace-nowrap", isUnread ? "font-bold text-slate-700" : "font-medium text-slate-500")}>
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
             <div className="h-full overflow-y-auto p-6 bg-slate-50/30 custom-scrollbar">
                <div className="mb-6 flex space-x-1 bg-slate-100 p-1 rounded-xl w-fit">
                  <button
                    onClick={() => setActiveTab('breakdown')}
                    className={cn(
                      "px-4 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer",
                      activeTab === 'breakdown' 
                        ? "bg-white text-slate-800 shadow-xs" 
                        : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"
                    )}
                  >
                    Score Breakdown
                  </button>
                  <button
                    onClick={() => setActiveTab('simulator')}
                    className={cn(
                      "px-4 py-2 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 cursor-pointer",
                      activeTab === 'simulator' 
                        ? "bg-white text-slate-800 shadow-xs" 
                        : "text-slate-500 hover:text-slate-700 hover:bg-slate-200/50"
                    )}
                  >
                    <TrendingUp className="w-3.5 h-3.5" />
                    Simulator
                  </button>
                </div>

                {activeTab === 'breakdown' && (
                  <div className="flex flex-col gap-6 lg:flex-row lg:items-start max-w-5xl mx-auto">
                    {/* Left Column: Big Score */}
                    <div className="w-full lg:w-1/3 space-y-3 shrink-0">
                      <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm text-center flex flex-col items-center justify-center aspect-square relative overflow-hidden">
                        <div className={cn("absolute inset-0 opacity-10", status.bg)}></div>
                        <span className="text-sm font-bold text-slate-500 uppercase tracking-widest mb-2 z-10">Inbox Score</span>
                        <div className={cn("text-7xl font-black mb-2 tracking-tighter z-10", status.text)}>
                          {liveScore}
                        </div>
                        <div className={cn("inline-flex items-center gap-1.5 px-3 py-1 rounded-full border z-10", status.bg, status.border, status.text)}>
                          {liveScore >= 80 ? <ShieldCheck className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
                          <span className="text-xs font-bold">{status.label}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3">
                        <div className="bg-rose-50/50 border border-rose-100 p-3.5 rounded-xl flex flex-col justify-between">
                          <span className="text-[11px] font-semibold text-rose-700">Deductions</span>
                          <div className="mt-1">
                            <span className="text-xl font-bold text-rose-600">-{totalDeductions}</span>
                            <span className="text-xs font-medium text-rose-500 ml-1">pts</span>
                          </div>
                          <span className="text-[11px] text-rose-600/80 mt-1">Unread & clutter</span>
                        </div>
                        <div className="bg-slate-50/70 border border-slate-200/70 p-3.5 rounded-xl flex flex-col justify-between">
                          <span className="text-[11px] font-semibold text-slate-700">Rule Bonus</span>
                          <div className="mt-1">
                            <span className="text-xl font-bold text-slate-600">+{totalBonus}</span>
                            <span className="text-xs font-medium text-slate-500 ml-1">pts</span>
                          </div>
                          <span className="text-[11px] text-slate-600/80 mt-1">Rules & unsubs</span>
                        </div>
                      </div>
                    </div>

                    {/* Right Column: Deductions */}
                    <div className="w-full lg:w-2/3 space-y-3">
                      <div className="flex items-center justify-between">
                        <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Points Breakdown & Fixes</h3>
                      </div>

                      <div className="space-y-2.5">
                        {/* Item 1: Unread */}
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
                              <p className="text-xs text-slate-500 mt-0.5">Unread emails sitting in your inbox</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 self-end sm:self-center">
                            <span className="text-sm font-bold text-rose-600 min-w-[55px] text-right">-{Math.round(unreadPenalty)} pts</span>
                            <div className="flex bg-slate-100 rounded-lg p-0.5 shadow-2xs">
                              <button
                                onClick={() => startInspect('Unread Emails', 'is:unread in:inbox -in:chats', 'unread', unreadPenalty)}
                                disabled={metrics.unreadInbox === 0}
                                className="text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                              >
                                Inspect
                              </button>
                              <button
                                onClick={() => handleFix('unread', unreadPenalty)}
                                disabled={metrics.unreadInbox === 0 || activeAction !== null}
                                className="text-xs font-bold px-3 py-1.5 rounded-md hover:bg-emerald-600 hover:text-white text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                              >
                                {activeAction === 'unread' ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null} Fix Now
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Item 2: Spam & Trash */}
                        <div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-red-50 border border-red-100 flex items-center justify-center text-red-600 shrink-0">
                              <Trash2 className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-bold text-slate-900">Spam & Trash</h4>
                                <span className="text-xs font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                                  {metrics.spamAndTrash} items
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5">Junk messages wasting cloud storage</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 self-end sm:self-center">
                            <span className="text-sm font-bold text-rose-600 min-w-[55px] text-right">-{Math.round(spamPenalty)} pts</span>
                            <div className="flex bg-slate-100 rounded-lg p-0.5 shadow-2xs">
                              <button
                                onClick={() => startInspect('Spam & Trash', 'in:spam OR in:trash', 'spam', spamPenalty)}
                                disabled={metrics.spamAndTrash === 0}
                                className="text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                              >
                                Inspect
                              </button>
                              <button
                                onClick={() => handleFix('spam', spamPenalty)}
                                disabled={metrics.spamAndTrash === 0 || activeAction !== null}
                                className="text-xs font-bold px-3 py-1.5 rounded-md hover:bg-red-600 hover:text-white text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                              >
                                {activeAction === 'spam' ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null} Fix Now
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Item 3: Promo */}
                        <div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-amber-50 border border-amber-100 flex items-center justify-center text-amber-600 shrink-0">
                              <AlertTriangle className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-bold text-slate-900">Old Promotions</h4>
                                <span className="text-xs font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                                  {metrics.oldPromotions} emails
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5">Marketing emails older than 6 months</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 self-end sm:self-center">
                            <span className="text-sm font-bold text-rose-600 min-w-[55px] text-right">-{Math.round(promoPenalty)} pts</span>
                            <div className="flex bg-slate-100 rounded-lg p-0.5 shadow-2xs">
                              <button
                                onClick={() => startInspect('Old Promotions', 'category:promotions older_than:6m -in:trash', 'promo', promoPenalty)}
                                disabled={metrics.oldPromotions === 0}
                                className="text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                              >
                                Inspect
                              </button>
                              <button
                                onClick={() => handleFix('promo', promoPenalty)}
                                disabled={metrics.oldPromotions === 0 || activeAction !== null}
                                className="text-xs font-bold px-3 py-1.5 rounded-md hover:bg-amber-600 hover:text-white text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                              >
                                {activeAction === 'promo' ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null} Fix Now
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* Item 4: Large Attachments */}
                        <div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 rounded-lg bg-orange-50 border border-orange-100 flex items-center justify-center text-orange-600 shrink-0">
                              <HardDrive className="w-4 h-4" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h4 className="text-sm font-bold text-slate-900">Large Attachments</h4>
                                <span className="text-xs font-semibold bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md">
                                  {metrics.largeFiles} files
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 mt-0.5">Files larger than 5MB taking up storage</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 self-end sm:self-center">
                            <span className="text-sm font-bold text-rose-600 min-w-[55px] text-right">-{Math.round(largePenalty)} pts</span>
                            <div className="flex bg-slate-100 rounded-lg p-0.5 shadow-2xs">
                              <button
                                onClick={() => startInspect('Large Attachments', 'larger:5M -in:trash', 'large', largePenalty)}
                                disabled={metrics.largeFiles === 0}
                                className="text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                              >
                                Inspect
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'simulator' && (
                  <div className="space-y-4 max-w-2xl mx-auto">
                    <div className="p-4 bg-gradient-to-r from-slate-900 to-slate-950 text-white rounded-xl flex items-center justify-between shadow-xs">
                      <div>
                        <span className="text-xs font-semibold text-slate-200 uppercase tracking-wider">Projected Score</span>
                        <div className="flex items-baseline gap-2.5 mt-1">
                          <span className="text-3xl font-semibold text-white">{simulatedScore}%</span>
                          <span className="text-xs font-bold text-emerald-400">
                            {simulatedScore > liveScore ? `+${simulatedScore - liveScore}% improvement` : 'Current Score'}
                          </span>
                        </div>
                      </div>
                      <div className="w-12 h-12 rounded-full border-2 border-slate-400/40 flex items-center justify-center bg-slate-900/50">
                        <TrendingUp className="w-5 h-5 text-slate-300" />
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
                            className="w-4 h-4 rounded border-slate-300 text-slate-600 focus:ring-slate-500"
                          />
                          <div>
                            <div className="text-xs font-bold text-slate-900">Empty Spam & Trash</div>
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
                            className="w-4 h-4 rounded border-slate-300 text-slate-600 focus:ring-slate-500"
                          />
                          <div>
                            <div className="text-xs font-bold text-slate-900">Clean old promotions</div>
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
                            className="w-4 h-4 rounded border-slate-300 text-slate-600 focus:ring-slate-500"
                          />
                          <div>
                            <div className="text-xs font-bold text-slate-900">Triage unread emails</div>
                          </div>
                        </div>
                        <span className="text-xs font-bold text-emerald-600">+{Math.round(unreadPenalty)} pts</span>
                      </label>
                    </div>
                  </div>
                )}
             </div>
           )}
        </div>

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
