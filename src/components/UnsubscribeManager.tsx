import { TypingLoader } from "./TypingLoader";
import React, { useState, useEffect } from 'react';
import { MailMinus, ShieldCheck, Search, Loader2, Skull, X, Undo2, CheckCircle2, Trash2, Filter, Tag, Archive, Sparkles, ArrowLeft } from 'lucide-react';
import { searchEmails, batchTrashEmails, batchArchiveEmails, batchModifyEmails } from '../lib/gmail';
import { cn } from '../lib/utils';
import { useActionCompletion } from '../lib/useActionCompletion';
import { WalkthroughTip } from "./WalkthroughTip";
import { extractSenderDetails, parseListUnsubscribe } from '../lib/emailUtils';

export function UnsubscribeManager({ 
  isOpen = true, 
  onClose, 
  onApplyQuery, 
  aiSettings,
  isPage = false
}: { 
  isOpen?: boolean; 
  onClose: () => void; 
  onApplyQuery: (q: string, filter?: string, sortOption?: "date" | "size" | "sender") => void; 
  aiSettings?: any;
  isPage?: boolean;
}) {
  const [activeTab, setActiveTab] = useState<'active' | 'unsubscribed' | 'ghost_blocked'>('active');
  const [activeSubTab, setActiveSubTab] = useState<'easy_unsub' | 'block'>('easy_unsub');
  const [loading, setLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [actionLog, setActionLog] = useState<any[]>([]);
  // Rows confirm what happened before leaving, matching every other actioned list
  // in the app. Previously they vanished the instant they were clicked and the only
  // feedback was a toast, so it was never clear which row had actually been dealt with.
  const completion = useActionCompletion();
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<any[] | null>(null);
  const [purgeToast, setPurgeToast] = useState<{ message: string; undoItem?: any } | null>(null);

  const [recommendationFilter, setRecommendationFilter] = useState<string>('all');
  const [selectedLogs, setSelectedLogs] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedLogs(new Set());
  }, [activeTab]);

  const handleDeleteLogs = () => {
    const remainingLogs = actionLog.filter(log => !selectedLogs.has(log.id));
    saveActionLog(remainingLogs);
    setSelectedLogs(new Set());
  };

  useEffect(() => {
    try {
      const stored = localStorage.getItem('ais_unsub_log');
      if (stored) {
        setActionLog(JSON.parse(stored));
      }
    } catch (e) { }
  }, []);

  const saveActionLog = (newLog: any[]) => {
    setActionLog(newLog);
    localStorage.setItem('ais_unsub_log', JSON.stringify(newLog));
    window.dispatchEvent(new Event('health-score-update'));
    window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
      detail: { type: 'unsub', count: 1, isPartial: true }
    }));
  };

  useEffect(() => {
    if (!isOpen) return;
    async function loadSubs() {
      setLoading(true);
      try {
        const emails = await searchEmails("category:promotions OR category:updates OR unsubscribe OR label:unread", 300);
        
        const senders = new Map();
        emails.forEach(email => {
          const details = extractSenderDetails(email.sender);
          const emailAddr = details.emailAddr;
          const name = details.displayName;
          
          if (!senders.has(emailAddr)) {
            senders.set(emailAddr, {
              email: emailAddr,
              name,
              brand: details.brand,
              count: 0,
              listUnsubscribe: email.listUnsubscribe,
              exampleSubject: email.subject
            });
          }
          senders.get(emailAddr).count++;
          
          if (!senders.get(emailAddr).listUnsubscribe && email.listUnsubscribe) {
            senders.get(emailAddr).listUnsubscribe = email.listUnsubscribe;
          }
        });
        
        const logEmails = new Set(actionLog.map(a => a.email));
        
        const subsArray = Array.from(senders.values())
          .filter(s => s.count >= 1 && !logEmails.has(s.email)) 
          .sort((a, b) => b.count - a.count);
          
        setSubscriptions(subsArray);
      } catch (e) {
        console.error("Error loading subscriptions", e);
      } finally {
        setLoading(false);
      }
    }
    loadSubs();
  }, [isOpen, actionLog.length]);

  const launchUnsubscribeLink = (sub: any) => {
    if (sub.listUnsubscribe) {
      const parsed = parseListUnsubscribe(sub.listUnsubscribe);
      if (parsed.httpUrl) {
        window.open(parsed.httpUrl, '_blank');
      } else if (parsed.mailtoUri) {
        window.open(parsed.mailtoUri, '_self');
      }
    }
  };

  // 1. Unsubscribe Only (Keeps historical copies)
  const handleUnsubscribeOnly = async (sub: any) => {
    setProcessing(prev => new Set(prev).add(sub.email));
    try {
      launchUnsubscribeLink(sub);
      
      const newLogItem = {
        id: Date.now().toString(),
        type: 'unsubscribe',
        action: 'keep',
        email: sub.email,
        name: sub.name,
        timestamp: Date.now(),
        trashedIds: []
      };
      saveActionLog([newLogItem, ...actionLog]);
      completion.complete(sub.email, 'Unsubscribed');
      setPurgeToast({ message: `Unsubscribed from ${sub.name}. Existing emails were kept.` });
      setTimeout(() => setPurgeToast(null), 5000);
    } catch (e) {
      console.error(e);
    } finally {
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(sub.email);
        return next;
      });
    }
  };

  // 2. Unsubscribe & Purge All (Trashes/Archives historical copies)
  const handleUnsubscribeAndPurge = async (sub: any, actionType: 'trash' | 'archive' = 'trash') => {
    setProcessing(prev => new Set(prev).add(sub.email));
    try {
      launchUnsubscribeLink(sub);
      
      const existing = await searchEmails(`from:${sub.email}`, 150);
      let affectedIds: string[] = [];
      if (existing.length > 0) {
        affectedIds = existing.flatMap(e => e.messageIds || [e.id]);
        if (actionType === 'trash') {
          await batchTrashEmails(affectedIds);
        } else {
          await batchArchiveEmails(affectedIds);
        }
      }
      
      const newLogItem = {
        id: Date.now().toString(),
        type: 'unsubscribe',
        action: actionType,
        email: sub.email,
        name: sub.name,
        timestamp: Date.now(),
        trashedIds: affectedIds
      };
      saveActionLog([newLogItem, ...actionLog]);
      completion.complete(sub.email, 'Unsubscribed & cleared');
      setPurgeToast({
        message: `Unsubscribed & ${actionType === 'trash' ? 'trashed' : 'archived'} ${affectedIds.length} historical emails from ${sub.name}.`,
        undoItem: newLogItem
      });
      setTimeout(() => setPurgeToast(null), 6000);
    } catch (e) {
      console.error(e);
    } finally {
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(sub.email);
        return next;
      });
    }
  };

  const handleGhostBlock = async (sub: any) => {
    setProcessing(prev => new Set(prev).add(sub.email));
    try {
      const existing = await searchEmails(`from:${sub.email}`, 150);
      let trashedIds: string[] = [];
      if (existing.length > 0) {
        trashedIds = existing.flatMap(e => e.messageIds || [e.id]);
        await batchTrashEmails(trashedIds);
      }
      
      const newLogItem = {
        id: Date.now().toString(),
        type: 'ghost_block',
        action: 'trash',
        email: sub.email,
        name: sub.name,
        timestamp: Date.now(),
        trashedIds
      };
      saveActionLog([newLogItem, ...actionLog]);
      completion.complete(sub.email, 'Blocked');
      setPurgeToast({
        message: `Blocked sender & moved ${trashedIds.length} emails to Trash.`,
        undoItem: newLogItem
      });
      setTimeout(() => setPurgeToast(null), 6000);
    } catch (e) {
      console.error(e);
    } finally {
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(sub.email);
        return next;
      });
    }
  };

  const handleUndoAction = async (logItem: any) => {
    setProcessing(prev => new Set(prev).add(logItem.id));
    try {
      if (logItem.trashedIds && logItem.trashedIds.length > 0) {
        if (logItem.action === 'archive') {
          await batchModifyEmails(logItem.trashedIds, ['INBOX'], []);
        } else {
          await batchModifyEmails(logItem.trashedIds, ['INBOX'], ['TRASH']);
        }
      }
      saveActionLog(actionLog.filter(a => a.id !== logItem.id));
      setPurgeToast({ message: `Restored ${logItem.trashedIds?.length || 0} messages back to Inbox.` });
      setTimeout(() => setPurgeToast(null), 4000);
    } catch (e) {
      console.error("Undo failed", e);
    } finally {
      setProcessing(prev => {
        const next = new Set(prev);
        next.delete(logItem.id);
        return next;
      });
    }
  };

  const handleAIAudit = async () => {
    if (!aiSettings?.apiKey) {
      alert("Please configure your AI API key in the Dashboard settings first.");
      return;
    }
    setAnalyzing(true);
    try {
      const topSubs = subscriptions.slice(0, 15);
      const res = await fetch("/api/analyze-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subscriptions: topSubs,
          settings: aiSettings
        })
      });
      if (!res.ok) throw new Error("Failed to analyze subscriptions");
      const data = await res.json();
      if (data.analysis) {
        setAiAnalysis(data.analysis);
      }
    } catch (e) {
      console.error(e);
      alert("AI analysis failed. Please check your API key and connection.");
    } finally {
      setAnalyzing(false);
    }
  };

  const filteredSubs = subscriptions.filter(sub => {
    if (completion.isCleared(sub.email)) return false;
    if (!aiAnalysis || recommendationFilter === 'all') return true;
    const insight = aiAnalysis.find(a => a.email === sub.email);
    if (!insight) return false;
    return insight.recommendation === recommendationFilter;
  });

  const canUnsubscribeSubs = filteredSubs.filter(s => s.listUnsubscribe);
  const ghostBlockSubs = filteredSubs.filter(s => !s.listUnsubscribe);

  const logsToDisplay = actionLog.filter(l => {
    if (activeTab === 'unsubscribed') return l.type === 'unsubscribe';
    if (activeTab === 'ghost_blocked') return l.type === 'ghost_block';
    return true;
  });

  if (!isPage && !isOpen) return null;

  const toastElement = purgeToast && (
    <div className="bg-slate-900 text-white px-4 py-2.5 flex items-center justify-between text-xs font-semibold animate-in slide-in-from-top-2 duration-150 rounded-xl mb-4">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
        <span>{purgeToast.message}</span>
      </div>
      {purgeToast.undoItem && (
        <button
          onClick={() => handleUndoAction(purgeToast.undoItem)}
          className="flex items-center gap-1 bg-white/15 hover:bg-white/25 px-2.5 py-1 rounded-md text-[11px] font-medium text-white transition-colors cursor-pointer"
        >
          <Undo2 className="w-3 h-3" />
          <span>Undo</span>
        </button>
      )}
    </div>
  );

  const headerElement = (
    <div className={cn(
      "flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white",
      isPage ? "p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs" : "p-4 sm:p-6 border-b border-slate-100"
    )}>
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-amber-50 border border-amber-200/60 rounded-xl text-amber-700">
          <MailMinus className="w-5 h-5 sm:w-6 sm:h-6" />
        </div>
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg sm:text-xl font-bold text-slate-900">Subscription & Newsletter Manager</h2>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
              {subscriptions.length} active
            </span>
          </div>
          <p className="text-xs sm:text-sm text-slate-500">
            1-click unsubscribes, bulk sender block rules, and automatic historical purges.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 self-end sm:self-center">
        {activeTab === 'active' && !aiAnalysis && subscriptions.length > 0 && (
          <button
            onClick={handleAIAudit}
            disabled={analyzing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-lg text-xs font-medium transition-all shadow-xs disabled:opacity-50 cursor-pointer"
          >
            {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 text-amber-500" />}
            <span>Sender Audit</span>
          </button>
        )}
        {!isPage && (
          <button 
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );

  const mainBodyContent = (
    <>
      {/* Tabs */}
      <div className="flex border-b border-slate-200 px-4 sm:px-6 bg-slate-50/50">
          <button 
            onClick={() => setActiveTab('active')}
            className={cn("py-3 px-4 font-semibold text-xs sm:text-sm border-b-2 transition-all flex items-center gap-2", activeTab === 'active' ? "border-slate-800 text-slate-900 bg-white rounded-t-lg border-t border-x border-slate-200" : "border-transparent text-slate-500 hover:text-slate-700")}
          >
            <span>Active Senders</span>
            <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full font-bold">{subscriptions.length}</span>
          </button>
          <button 
            onClick={() => setActiveTab('unsubscribed')}
            className={cn("py-3 px-4 font-semibold text-xs sm:text-sm border-b-2 transition-all flex items-center gap-2", activeTab === 'unsubscribed' ? "border-slate-800 text-slate-900 bg-white rounded-t-lg border-t border-x border-slate-200" : "border-transparent text-slate-500 hover:text-slate-700")}
          >
            <span>Unsubscribed History</span>
            <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full font-bold">{actionLog.filter(a => a.type === 'unsubscribe').length}</span>
          </button>
          <button 
            onClick={() => setActiveTab('ghost_blocked')}
            className={cn("py-3 px-4 font-semibold text-xs sm:text-sm border-b-2 transition-all flex items-center gap-2", activeTab === 'ghost_blocked' ? "border-slate-800 text-slate-900 bg-white rounded-t-lg border-t border-x border-slate-200" : "border-transparent text-slate-500 hover:text-slate-700")}
          >
            <span>Blocked Senders</span>
            <span className="text-[10px] bg-slate-200 text-slate-700 px-1.5 py-0.5 rounded-full font-bold">{actionLog.filter(a => a.type === 'ghost_block').length}</span>
          </button>
        </div>

        <div className="p-4 sm:p-6 overflow-y-auto flex-1 flex flex-col gap-4">
          <WalkthroughTip 
            storageKey="tip_unsub_purge" 
            title="Unsubscribe & Historical Purge" 
            description="Use 'Unsubscribe & Trash All' to instantly remove yourself from a mailing list AND clear all historical clutter from that sender in one step. Everything can be undone from the history tab."
          />

          {activeTab === 'active' && (
            <>
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-4 text-slate-500 p-4 sm:p-16">
                  <TypingLoader 
                    title="Finding Subscriptions" 
                    messages={[
                      "Scanning inbox for newsletters...",
                      "Identifying tracking lists...",
                      "Extracting unsubscribe links...",
                      "Grouping by sender..."
                    ]} 
                  />
                </div>
              ) : subscriptions.length === 0 ? (
                <div className="p-12 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-200 border-dashed">
                  <ShieldCheck className="w-10 h-10 mx-auto text-slate-300 mb-4" />
                  <h3 className="font-semibold text-slate-700 text-lg mb-1">Your Inbox is Clean</h3>
                  <p className="text-sm">No active subscriptions detected.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  <div className="flex items-center gap-2 p-1 bg-slate-100 rounded-lg self-start">
                    <button 
                      onClick={() => setActiveSubTab('easy_unsub')}
                      className={cn("px-4 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-all whitespace-nowrap flex items-center gap-1.5", activeSubTab === 'easy_unsub' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
                    >
                      <MailMinus className="w-4 h-4" />
                      1-Click Unsubscribe ({canUnsubscribeSubs.length})
                    </button>
                    <button 
                      onClick={() => setActiveSubTab('block')}
                      className={cn("px-4 py-1.5 text-xs sm:text-sm font-semibold rounded-md transition-all whitespace-nowrap flex items-center gap-1.5", activeSubTab === 'block' ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700")}
                    >
                      <Skull className="w-4 h-4" />
                      Block Senders ({ghostBlockSubs.length})
                    </button>
                  </div>

                  {analyzing && (
                    <div className="p-4 bg-slate-50 border border-slate-200 text-slate-700 rounded-xl flex items-center gap-3">
                       <Loader2 className="w-5 h-5 animate-spin" />
                       <span className="text-sm font-medium">Running sender audit to analyze senders...</span>
                    </div>
                  )}
                  
                  {aiAnalysis && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-slate-500" />
                        <span className="text-sm font-semibold text-slate-700">Sender Analysis</span>
                      </div>
                      <select 
                        value={recommendationFilter}
                        onChange={(e) => setRecommendationFilter(e.target.value)}
                        className="text-sm border-slate-300 rounded-lg bg-white px-3 py-1.5 focus:ring-slate-800 focus:border-slate-800 text-slate-700 flex-1 sm:flex-none shadow-sm font-medium"
                      >
                        <option value="all">Show All Senders</option>
                        {Array.from(new Set(aiAnalysis.map(a => a.recommendation))).map(rec => (
                          <option key={rec} value={rec}>Action: {rec}</option>
                        ))}
                      </select>
                    </div>
                  )}

                  {activeSubTab === 'easy_unsub' && canUnsubscribeSubs.length === 0 && (
                    <div className="p-8 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-200 border-dashed">
                      <p className="text-sm">No standard unsubscribe lists found.</p>
                    </div>
                  )}

                  {activeSubTab === 'easy_unsub' && canUnsubscribeSubs.length > 0 && (
                    <div>
                      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <ul className="divide-y divide-slate-100">
                          {canUnsubscribeSubs.map((sub) => {
                            const isProcessing = processing.has(sub.email);
                            const doneLabel = completion.labelFor(sub.email);
                            const insight = aiAnalysis?.find(a => a.email === sub.email);
                            return (
                              <li key={sub.email} className={cn("p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4 transition-colors group", isProcessing && "opacity-50 pointer-events-none", doneLabel ? "bg-emerald-50/40" : "hover:bg-slate-50")}>
                                {doneLabel && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md self-start shrink-0 order-first">
                                    <CheckCircle2 className="w-3 h-3" />
                                    {doneLabel}
                                  </span>
                                )}
                                <div className="flex items-start sm:items-center gap-4 min-w-0 flex-1">
                                  <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm shrink-0 mt-0.5 sm:mt-0">
                                    {sub.name.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                      <h4 className="font-semibold text-slate-900 truncate max-w-[200px] sm:max-w-xs">{sub.name}</h4>
                                      <span className="text-[10px] sm:text-[11px] font-medium bg-slate-100 border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
                                        {sub.count} emails in inbox
                                      </span>
                                      {insight && (
                                        <span className="text-[10px] sm:text-[11px] font-semibold px-2 py-0.5 rounded shrink-0 uppercase tracking-wide bg-slate-100 border border-slate-200 text-slate-700">
                                          {insight.category} (Score: {insight.spamScore})
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-slate-500 truncate mb-1.5">{sub.email}</p>
                                    {insight ? (
                                      <p className="text-[11px] sm:text-xs font-medium text-slate-700 flex items-center gap-1.5 bg-slate-50 w-fit px-2 py-1 rounded border border-slate-200">
                                        <Tag className="w-3.5 h-3.5 text-slate-500" />
                                        <span className="text-slate-600">Intent: {insight.intent}</span>
                                        <span className="mx-1 text-slate-300">&bull;</span> 
                                        <span>Rec: <strong>{insight.recommendation}</strong></span>
                                      </p>
                                    ) : (
                                      <p className="text-[11px] sm:text-xs text-slate-400 truncate max-w-md italic flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0"></span>
                                        {sub.exampleSubject}
                                      </p>
                                    )}
                                  </div>
                                </div>

                                {/* Dual Action Controls: Unsubscribe vs Unsubscribe & Purge */}
                                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0 w-full lg:w-auto">
                                  <button
                                    onClick={() => handleUnsubscribeOnly(sub)}
                                    className="px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-100 hover:border-slate-300 text-slate-700 shadow-2xs flex-1 sm:flex-initial cursor-pointer"
                                    title="Unsubscribe from mailing list, but keep existing emails in your inbox"
                                  >
                                    <MailMinus className="w-3.5 h-3.5 text-slate-500" />
                                    <span>Unsubscribe Only</span>
                                  </button>

                                  <button
                                    onClick={() => handleUnsubscribeAndPurge(sub, 'trash')}
                                    className="px-3.5 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-1.5 bg-rose-50 border border-rose-200 hover:bg-rose-100 text-rose-700 shadow-2xs flex-1 sm:flex-initial cursor-pointer"
                                    title={`Unsubscribe from mailing list AND move all ~${sub.count} historical emails to Trash`}
                                  >
                                    <Trash2 className="w-3.5 h-3.5 text-rose-600" />
                                    <span>Unsub & Trash All ({sub.count})</span>
                                  </button>

                                  <button
                                    onClick={() => handleUnsubscribeAndPurge(sub, 'archive')}
                                    className="px-2.5 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center bg-slate-100 border border-slate-200 hover:bg-slate-200 text-slate-600 shadow-2xs cursor-pointer"
                                    title={`Unsubscribe & Archive all ~${sub.count} emails`}
                                  >
                                    <Archive className="w-3.5 h-3.5 text-slate-500" />
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  )}

                  {activeSubTab === 'block' && ghostBlockSubs.length === 0 && (
                    <div className="p-8 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-200 border-dashed">
                      <p className="text-sm">No senders found requiring a manual block.</p>
                    </div>
                  )}

                  {activeSubTab === 'block' && ghostBlockSubs.length > 0 && (
                    <div>
                      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <ul className="divide-y divide-slate-100">
                          {ghostBlockSubs.map((sub) => {
                            const isProcessing = processing.has(sub.email);
                            const insight = aiAnalysis?.find(a => a.email === sub.email);
                            return (
                              <li key={sub.email} className={cn("p-4 sm:p-5 flex flex-col sm:flex-row sm:items-start sm:items-center justify-between gap-4 hover:bg-slate-50 transition-colors group", isProcessing && "opacity-50 pointer-events-none")}>
                                <div className="flex items-start sm:items-center gap-4 min-w-0 flex-1">
                                  <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 text-slate-700 flex items-center justify-center font-bold text-sm shrink-0 mt-0.5 sm:mt-0">
                                    {sub.name.charAt(0).toUpperCase()}
                                  </div>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap mb-1">
                                      <h4 className="font-semibold text-slate-900 truncate max-w-[200px] sm:max-w-xs">{sub.name}</h4>
                                      <span className="text-[10px] sm:text-[11px] font-medium bg-slate-100 border border-slate-200 text-slate-600 px-1.5 py-0.5 rounded shrink-0">
                                        {sub.count} emails
                                      </span>
                                      {insight && (
                                        <span className="text-[10px] sm:text-[11px] font-semibold px-2 py-0.5 rounded shrink-0 uppercase tracking-wide bg-slate-100 border border-slate-200 text-slate-700">
                                          {insight.category} (Score: {insight.spamScore})
                                        </span>
                                      )}
                                    </div>
                                    <p className="text-xs text-slate-500 truncate mb-1.5">{sub.email}</p>
                                    {insight ? (
                                      <p className="text-[11px] sm:text-xs font-medium text-slate-700 flex items-center gap-1.5 bg-slate-50 w-fit px-2 py-1 rounded border border-slate-200">
                                        <Tag className="w-3.5 h-3.5 text-slate-500" />
                                        <span className="text-slate-600">Intent: {insight.intent}</span>
                                        <span className="mx-1 text-slate-300">&bull;</span> 
                                        <span>Rec: <strong>{insight.recommendation}</strong></span>
                                      </p>
                                    ) : (
                                      <p className="text-[11px] sm:text-xs text-slate-400 truncate max-w-md italic flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0"></span>
                                        {sub.exampleSubject}
                                      </p>
                                    )}
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
                                  <button
                                    onClick={() => handleGhostBlock(sub)}
                                    className="px-4 py-2 text-xs font-semibold rounded-xl transition-all flex items-center justify-center gap-2 bg-slate-900 hover:bg-slate-800 text-white shadow-2xs w-full sm:w-auto cursor-pointer"
                                  >
                                    <Skull className="w-3.5 h-3.5 text-slate-400" />
                                    <span>Block & Trash All ({sub.count})</span>
                                  </button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {activeTab !== 'active' && (
            <>
              {logsToDisplay.length === 0 ? (
                <div className="p-12 text-center text-slate-500 bg-slate-50 rounded-xl border border-slate-200 border-dashed">
                  {activeTab === 'unsubscribed' ? <MailMinus className="w-10 h-10 mx-auto text-slate-300 mb-4" /> : <Skull className="w-10 h-10 mx-auto text-slate-300 mb-4" />}
                  <h3 className="font-semibold text-slate-700 text-lg mb-1">No Records Found</h3>
                  <p className="text-sm">You haven't {activeTab === 'unsubscribed' ? 'unsubscribed from' : 'ghost blocked'} any senders yet.</p>
                </div>
              ) : (
                <>
                {logsToDisplay.length > 0 && (
                  <div className="flex items-center justify-between mb-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={selectedLogs.size === logsToDisplay.length && logsToDisplay.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedLogs(new Set(logsToDisplay.map(l => l.id)));
                          } else {
                            setSelectedLogs(new Set());
                          }
                        }}
                        className="rounded border-slate-300 text-slate-800 focus:ring-slate-800 w-4 h-4"
                      />
                      Select All
                    </label>
                    {selectedLogs.size > 0 && (
                      <button
                        onClick={handleDeleteLogs}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 font-medium text-xs sm:text-sm rounded-lg transition-colors border border-red-200 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        Clear Selected ({selectedLogs.size})
                      </button>
                    )}
                  </div>
                )}
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <ul className="divide-y divide-slate-100">
                    {logsToDisplay.map((log) => {
                      const isProcessing = processing.has(log.id);
                      return (
                        <li key={log.id} className={cn("p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-50 transition-colors", isProcessing && "opacity-50 pointer-events-none")}>
                          <div className="flex items-center gap-4">
                            <input 
                              type="checkbox" 
                              checked={selectedLogs.has(log.id)}
                              onChange={(e) => {
                                const next = new Set(selectedLogs);
                                if (e.target.checked) next.add(log.id);
                                else next.delete(log.id);
                                setSelectedLogs(next);
                              }}
                              className="rounded border-slate-300 text-slate-800 focus:ring-slate-800 w-4 h-4 mr-1 sm:mr-2"
                            />
                            <div className="w-9 h-9 rounded-full bg-slate-100 border border-slate-200 text-slate-500 flex items-center justify-center shrink-0">
                              {log.type === 'unsubscribe' ? <MailMinus className="w-4 h-4" /> : <Skull className="w-4 h-4" />}
                            </div>
                            <div>
                              <div className="flex items-center gap-2 mb-0.5">
                                <h4 className="font-semibold text-slate-900">{log.name}</h4>
                                <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                  {new Date(log.timestamp).toLocaleDateString()}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 mb-1">{log.email}</p>
                              <p className="text-[10px] sm:text-[11px] text-slate-400 flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                                {log.type === 'unsubscribe' 
                                  ? (log.action === 'trash' ? `Unsubscribed & ${log.trashedIds?.length || 0} historical emails trashed.` : log.action === 'archive' ? `Unsubscribed & ${log.trashedIds?.length || 0} emails archived.` : 'Unsubscribed (history retained).')
                                  : `Blocked & ${log.trashedIds?.length || 0} emails trashed.`}
                              </p>
                            </div>
                          </div>
                          {log.trashedIds && log.trashedIds.length > 0 && (
                            <button
                              onClick={() => handleUndoAction(log)}
                              className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 hover:border-slate-400 text-slate-700 text-xs font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 shrink-0 w-full sm:w-auto shadow-2xs cursor-pointer"
                            >
                              <Undo2 className="w-3.5 h-3.5" />
                              Undo & Restore ({log.trashedIds.length})
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                </>
              )}
            </>
          )}
        </div>
    </>
  );

  if (isPage) {
    return (
      <div className="w-full flex flex-col gap-4 animate-in fade-in duration-150">
        {toastElement}
        {headerElement}
        <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs overflow-hidden flex flex-col min-h-[600px]">
          {mainBodyContent}
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150">
        {toastElement}
        {headerElement}
        {mainBodyContent}
      </div>
    </div>
  );
}
