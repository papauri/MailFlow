import React, { useState, useEffect } from 'react';
import { MailMinus, ShieldCheck, Search, Loader2, Skull, BrainCircuit, X, Undo2, CheckCircle2, Trash2, Filter } from 'lucide-react';
import { searchEmails, batchTrashEmails, batchModifyEmails } from '../lib/gmail';
import { cn } from '../lib/utils';
import { WalkthroughTip } from "./WalkthroughTip";

export function UnsubscribeManager({ isOpen, onClose, onApplyQuery, aiSettings }: { isOpen: boolean; onClose: () => void; onApplyQuery: (q: string, filter?: string, sortOption?: "date" | "size" | "sender") => void; aiSettings?: any }) {
  const [activeTab, setActiveTab] = useState<'active' | 'unsubscribed' | 'ghost_blocked'>('active');
  const [activeSubTab, setActiveSubTab] = useState<'easy_unsub' | 'block'>('easy_unsub');
  const [loading, setLoading] = useState(true);
  const [subscriptions, setSubscriptions] = useState<any[]>([]);
  const [actionLog, setActionLog] = useState<any[]>([]);
  const [processing, setProcessing] = useState<Set<string>>(new Set());
  const [analyzing, setAnalyzing] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<any[] | null>(null);

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
  };

  useEffect(() => {
    if (!isOpen) return;
    async function loadSubs() {
      setLoading(true);
      try {
        const emails = await searchEmails("category:promotions OR category:updates OR unsubscribe OR label:unread", 300);
        
        const senders = new Map();
        emails.forEach(email => {
          const match = email.sender.match(/<([^>]+)>/);
          const emailAddr = match ? match[1].toLowerCase() : email.sender.toLowerCase();
          const name = email.sender.replace(/<[^>]+>/, '').trim() || emailAddr;
          
          if (!senders.has(emailAddr)) {
            senders.set(emailAddr, {
              email: emailAddr,
              name,
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

  const handleUnsubscribe = async (sub: any) => {
    setProcessing(prev => new Set(prev).add(sub.email));
    try {
      if (sub.listUnsubscribe) {
        const urls = sub.listUnsubscribe.split(',').map((s: string) => s.trim().replace(/^</, '').replace(/>$/, ''));
        const httpUrl = urls.find((u: string) => u.startsWith('http'));
        const mailtoUrl = urls.find((u: string) => u.startsWith('mailto:'));
        
        if (httpUrl) {
          window.open(httpUrl, '_blank');
        } else if (mailtoUrl) {
          window.open(mailtoUrl, '_self');
        }
      }
      
      const existing = await searchEmails(`from:${sub.email}`, 100);
      let trashedIds: string[] = [];
      if (existing.length > 0) {
        trashedIds = existing.flatMap(e => e.messageIds || [e.id]);
        await batchTrashEmails(trashedIds);
      }
      
      const newLogItem = {
        id: Date.now().toString(),
        type: 'unsubscribe',
        email: sub.email,
        name: sub.name,
        timestamp: Date.now(),
        trashedIds
      };
      saveActionLog([newLogItem, ...actionLog]);
      setSubscriptions(prev => prev.filter(s => s.email !== sub.email));
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
      const existing = await searchEmails(`from:${sub.email}`, 100);
      let trashedIds: string[] = [];
      if (existing.length > 0) {
        trashedIds = existing.flatMap(e => e.messageIds || [e.id]);
        await batchTrashEmails(trashedIds);
      }
      
      const newLogItem = {
        id: Date.now().toString(),
        type: 'ghost_block',
        email: sub.email,
        name: sub.name,
        timestamp: Date.now(),
        trashedIds
      };
      saveActionLog([newLogItem, ...actionLog]);
      setSubscriptions(prev => prev.filter(s => s.email !== sub.email));
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
        await batchModifyEmails(logItem.trashedIds, ['INBOX'], ['TRASH']);
      }
      saveActionLog(actionLog.filter(a => a.id !== logItem.id));
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
    } finally {
      setAnalyzing(false);
    }
  };

  // AUTO TRIGGER AI ANALYSIS
  useEffect(() => {
    if (subscriptions.length > 0 && aiSettings?.apiKey && !aiAnalysis && !analyzing) {
      handleAIAudit();
    }
  }, [subscriptions.length, aiSettings?.apiKey]);

  if (!isOpen) return null;

  const unsubLog = actionLog.filter(a => a.type === 'unsubscribe');
  const ghostLog = actionLog.filter(a => a.type === 'ghost_block');

  const logsToDisplay = activeTab === 'unsubscribed' ? unsubLog : ghostLog;
  
  const filteredSubs = recommendationFilter === 'all' 
    ? subscriptions 
    : subscriptions.filter(s => aiAnalysis?.find(a => a.email === s.email)?.recommendation === recommendationFilter);
  const canUnsubscribeSubs = filteredSubs.filter(s => !!s.listUnsubscribe);
  const ghostBlockSubs = filteredSubs.filter(s => !s.listUnsubscribe);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
        
        <div className="p-4 sm:p-6 border-b border-slate-200 flex flex-col gap-5 bg-slate-50/50">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="p-2 sm:p-2.5 bg-white border border-slate-200 text-slate-800 rounded-lg shadow-sm">
                <ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6" />
              </div>
              <div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight">Subscription Manager</h2>
                <p className="text-xs sm:text-sm text-slate-500 mt-0.5">Filter noisy senders and manage your inbox flow.</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          <div className="flex items-center gap-1.5 self-start overflow-x-auto pb-1 sm:pb-0 w-full no-scrollbar">
            <button 
              onClick={() => setActiveTab('active')}
              className={cn("px-4 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all whitespace-nowrap", activeTab === 'active' ? "bg-slate-800 text-white shadow-sm" : "text-slate-600 bg-white border border-slate-200 hover:bg-slate-50")}
            >
              Active Senders ({subscriptions.length})
            </button>
            <button 
              onClick={() => setActiveTab('unsubscribed')}
              className={cn("px-4 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all whitespace-nowrap flex items-center gap-2", activeTab === 'unsubscribed' ? "bg-slate-800 text-white shadow-sm" : "text-slate-600 bg-white border border-slate-200 hover:bg-slate-50")}
            >
              <MailMinus className="w-4 h-4" />
              Unsubscribed ({unsubLog.length})
            </button>
            <button 
              onClick={() => setActiveTab('ghost_blocked')}
              className={cn("px-4 py-2 text-xs sm:text-sm font-semibold rounded-md transition-all whitespace-nowrap flex items-center gap-2", activeTab === 'ghost_blocked' ? "bg-slate-800 text-white shadow-sm" : "text-slate-600 bg-white border border-slate-200 hover:bg-slate-50")}
            >
              <Skull className="w-4 h-4" />
              <Skull className="w-4 h-4" />
              Blocked ({ghostLog.length})
            </button>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-white">
          <WalkthroughTip 
            storageKey="tip_unsub" 
            title="AI Subscription Manager" 
            description="Use 1-Click Unsubscribe to easily remove yourself from standard mailing lists. If you have an AI key connected, MailFlow will automatically run an Intent Audit to identify the type of list to help you decide!"
          />
          {activeTab === 'active' && (
            <>
              {loading ? (
                <div className="flex flex-col items-center justify-center gap-4 text-slate-500 p-16">
                  <Loader2 className="w-8 h-8 animate-spin text-slate-300" />
                  <span className="font-medium text-sm">Scanning inbox for newsletters and tracking lists...</span>
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
                    <div className="p-4 bg-blue-50 border border-blue-200 text-blue-700 rounded-xl flex items-center gap-3">
                       <Loader2 className="w-5 h-5 animate-spin" />
                       <span className="text-sm font-medium">Running AI Intent Audit to analyze senders...</span>
                    </div>
                  )}
                  
                  {aiAnalysis && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-slate-500" />
                        <span className="text-sm font-semibold text-slate-700">AI Recommendations</span>
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
                      <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                        <MailMinus className="w-4 h-4 text-slate-500" />
                        Standard Unsubscribe
                      </h3>
                      <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                        <ul className="divide-y divide-slate-100">
                          {canUnsubscribeSubs.map((sub) => {
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
                                        <BrainCircuit className="w-3.5 h-3.5 text-slate-500" />
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
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
                                  <button
                                    onClick={() => handleUnsubscribe(sub)}
                                    className="px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 bg-white border border-slate-300 hover:bg-slate-50 hover:border-slate-400 text-slate-700"
                                  >
                                    <MailMinus className="w-3.5 h-3.5" />
                                    Unsubscribe
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
                      <h3 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2">
                        <Skull className="w-4 h-4 text-slate-500" />
                        Block Senders (No Unsubscribe Link)
                      </h3>
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
                                        <BrainCircuit className="w-3.5 h-3.5 text-slate-500" />
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
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
                                  <button
                                    onClick={() => handleGhostBlock(sub)}
                                    className="px-4 py-2 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 border border-slate-800 text-white"
                                  >
                                    <Skull className="w-3.5 h-3.5" />
                                    <Skull className="w-3.5 h-3.5" />
                                    Block & Trash
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
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-xs sm:text-sm rounded-lg transition-colors border border-red-200"
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
                                <CheckCircle2 className="w-3 h-3" />
                                {log.type === 'unsubscribe' ? 'Unsubscribed & Local copies trashed.' : 'Ghost Blocked & Local copies trashed.'}
                              </p>
                            </div>
                          </div>
                          <button
                            onClick={() => handleUndoAction(log)}
                            className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 hover:border-slate-400 text-slate-700 text-xs font-semibold rounded-lg transition-colors flex items-center justify-center gap-1.5 shrink-0 w-full sm:w-auto"
                          >
                            <Undo2 className="w-3.5 h-3.5" />
                            Undo & Restore
                          </button>
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
      </div>
    </div>
  );
}
