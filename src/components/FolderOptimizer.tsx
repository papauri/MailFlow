import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2, CheckCircle, Trash2, Archive, FolderInput, AlertTriangle, Cpu, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../lib/utils';
import { batchModifyEmails, batchTrashEmails, batchArchiveEmails, createLabel } from '../lib/gmail';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  emails: any[];
  userLabels: any[];
  aiSettings?: any;
  isFetching?: boolean;
  onReload?: () => void;
}

interface Recommendation {
  emailIds: string[];
  suggestedLabel: string;
  reason: string;
  title?: string;
  deselectedEmailIds?: string[];
}

export function FolderOptimizer({ emails, userLabels, aiSettings, isFetching, onReload }: Omit<Props, 'isOpen' | 'onClose'>) {
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [usedAi, setUsedAi] = useState(false);
  const [expandedRecs, setExpandedRecs] = useState<Set<number>>(new Set());

  // Trigger analysis when emails array changes or fetching completes
  useEffect(() => {
    if (!isFetching) {
      runAnalysis();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emails.length, isFetching]);

  const runAnalysis = async () => {
    if (emails.length === 0) {
      setError("Your inbox is empty or no emails matched the scan. Nothing to optimize!");
      setLoading(false);
      return;
    }
    
    setLoading(true);
    setError(null);
    setUsedAi(false);
    
    const sample = emails.slice(0, 150);

    try {
      const hasAiKey = !!(aiSettings?.apiKey || sessionStorage.getItem('ai_quota_ok') !== 'false');
      let aiSucceeded = false;
      
      if (hasAiKey) {
        try {
          const payload = {
            emails: sample.map(e => ({ id: e.id, sender: e.sender, subject: e.subject })),
            userLabels: userLabels.map(l => ({ id: l.id, name: l.name })),
            settings: aiSettings
          };
          
          const res = await fetch('/api/suggest-labels', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
          });
          
          if (res.ok) {
            const data = await res.json();
            if (data.recommendations && data.recommendations.length > 0) {
              setRecommendations(data.recommendations);
              setUsedAi(true);
              aiSucceeded = true;
            }
          } else if (res.status === 429) {
            sessionStorage.setItem('ai_quota_ok', 'false');
          }
        } catch (e) {
          console.warn("AI optimization failed, falling back to local heuristics", e);
        }
      }

      if (!aiSucceeded) {
        const localRecs = runLocalHeuristics(sample);
        setRecommendations(localRecs);
        setUsedAi(false);
      }
    } catch (err: any) {
      setError("Analysis failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const runLocalHeuristics = (sample: any[]): Recommendation[] => {
    const recs: Recommendation[] = [];
    const senderMap = new Map<string, any[]>();
    const keywordMap = new Map<string, any[]>();

    sample.forEach(e => {
      const rawSender = e.sender || '';
      const match = rawSender.match(/<([^>]+)>/);
      const emailAddr = (match ? match[1] : rawSender).toLowerCase();
      const subject = (e.subject || '').toLowerCase();
      
      if (!senderMap.has(emailAddr)) senderMap.set(emailAddr, []);
      senderMap.get(emailAddr)!.push(e);

      if (subject.includes('sale') || subject.includes('% off') || subject.includes('discount') || subject.includes('promo')) {
        if (!keywordMap.has('Promotions')) keywordMap.set('Promotions', []);
        keywordMap.get('Promotions')!.push(e);
      } else if (subject.includes('order') || subject.includes('receipt') || subject.includes('invoice') || subject.includes('shipped') || subject.includes('delivery')) {
        if (!keywordMap.has('Purchases')) keywordMap.set('Purchases', []);
        keywordMap.get('Purchases')!.push(e);
      } else if (subject.includes('statement') || subject.includes('bill') || subject.includes('payment') || subject.includes('bank') || subject.includes('subscription')) {
        if (!keywordMap.has('Finance & Bills')) keywordMap.set('Finance & Bills', []);
        keywordMap.get('Finance & Bills')!.push(e);
      } else if (subject.includes('alert') || subject.includes('notification') || subject.includes('update') || subject.includes('security')) {
        if (!keywordMap.has('Alerts & Notifications')) keywordMap.set('Alerts & Notifications', []);
        keywordMap.get('Alerts & Notifications')!.push(e);
      } else if (e.listUnsubscribe || subject.includes('newsletter') || subject.includes('digest') || subject.includes('weekly')) {
        if (!keywordMap.has('Newsletters')) keywordMap.set('Newsletters', []);
        keywordMap.get('Newsletters')!.push(e);
      }
    });

    senderMap.forEach((emails, addr) => {
      if (emails.length > 2) {
        const domain = addr.split('@')[1] || addr;
        const brand = domain.split('.')[0];
        const title = brand.charAt(0).toUpperCase() + brand.slice(1);
        recs.push({
          suggestedLabel: title,
          emailIds: emails.map(e => e.id),
          reason: `High volume detected: ${emails.length} emails from ${addr}. Group them together or bulk clear them.`
        });
      }
    });

    keywordMap.forEach((emails, category) => {
      if (emails.length > 2) {
        const uniqueIds = [...new Set(emails.map(e => e.id))];
        recs.push({
          suggestedLabel: category,
          emailIds: uniqueIds,
          reason: `Found ${uniqueIds.length} emails matching common "${category}" patterns.`
        });
      }
    });

    const finalRecs = recs.sort((a, b) => b.emailIds.length - a.emailIds.length).slice(0, 5);
    
    if (finalRecs.length === 0 && sample.length > 0) {
      finalRecs.push({
        suggestedLabel: 'Archive Ready',
        emailIds: sample.slice(0, Math.min(5, sample.length)).map(e => e.id),
        reason: "These older items don't seem to have urgent action required."
      });
    }

    return finalRecs;
  };

  const handleAction = async (idx: number, action: 'trash' | 'archive' | 'move', rec: Recommendation) => {
    setProcessingId(idx);
    try {
      const activeEmailIds = rec.emailIds.filter(id => !(rec.deselectedEmailIds || []).includes(id));
      if (activeEmailIds.length === 0) {
        setProcessingId(null);
        return;
      }
      
      const allMessageIds: string[] = [];
      activeEmailIds.forEach(tid => {
        const email = emails.find(e => e.id === tid);
        if (email && email.messageIds) {
          allMessageIds.push(...email.messageIds);
        } else {
          allMessageIds.push(tid);
        }
      });

      if (action === 'trash') {
        await batchTrashEmails(allMessageIds);
      } else if (action === 'archive') {
        await batchArchiveEmails(allMessageIds);
      } else if (action === 'move') {
        let labelId = userLabels.find(l => l.name.toLowerCase() === rec.suggestedLabel.toLowerCase())?.id;
        if (!labelId) {
          const newLabel = await createLabel(rec.suggestedLabel);
          if (newLabel && newLabel.id) labelId = newLabel.id;
        }
        if (labelId) {
          await batchModifyEmails(allMessageIds, [labelId], ['INBOX']);
        }
      }
      
      setCompletedIds(prev => new Set(prev).add(idx));
    } catch (e) {
      console.error(e);
      alert("Failed to apply action.");
    } finally {
      setProcessingId(null);
    }
  };

  const toggleExpand = (idx: number) => {
    setExpandedRecs(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const toggleEmailSelection = (recIdx: number, emailId: string) => {
    setRecommendations(prev => prev.map((rec, i) => {
      if (i !== recIdx) return rec;
      const deselects = new Set(rec.deselectedEmailIds || []);
      if (deselects.has(emailId)) deselects.delete(emailId);
      else deselects.add(emailId);
      return { ...rec, deselectedEmailIds: Array.from(deselects) };
    }));
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden shadow-sm mt-6 sm:mt-8">
      <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className={cn("p-2 rounded-lg", usedAi ? "bg-indigo-100" : "bg-emerald-100")}>
            {usedAi ? <Sparkles className="w-5 h-5 text-indigo-600" /> : <Cpu className="w-5 h-5 text-emerald-600" />}
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-800">
              {usedAi ? "AI Folder Optimizer" : "Smart Folder Optimizer"}
            </h2>
            <p className="text-xs text-slate-500">
              {usedAi ? "Powered by AI analytics" : "Powered by local behavioral heuristics"}
            </p>
          </div>
        </div>
        {onReload && (
          <button 
            onClick={onReload}
            disabled={loading || isFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 hover:text-slate-800 rounded-lg shadow-sm transition-colors disabled:opacity-50"
            title="Scan inbox again for new outliers"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", (loading || isFetching) && "animate-spin")} />
            <span className="hidden sm:inline">Scan Again</span>
          </button>
        )}
      </div>

      <div className="p-4 sm:p-6 bg-slate-50/30">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700">Scanning inbox for outliers...</p>
              <p className="text-xs text-slate-500 mt-1">Analyzing sender patterns and topics.</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-rose-500">
            <AlertTriangle className="w-8 h-8" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        ) : recommendations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-slate-500">
            <CheckCircle className="w-8 h-8 text-emerald-500" />
            <p className="text-sm font-medium text-slate-700">Looking good!</p>
            <p className="text-xs text-center max-w-sm">We couldn't find any major outliers or messy bundles in this view.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {recommendations.map((rec, idx) => {
              const isCompleted = completedIds.has(idx);
              const isProcessing = processingId === idx;
              const activeEmailCount = rec.emailIds.length - (rec.deselectedEmailIds?.length || 0);
              
              return (
                <div key={idx} className={cn("bg-white border rounded-xl p-4 sm:p-5 transition-all shadow-sm flex flex-col h-full", isCompleted ? "border-emerald-200 bg-emerald-50/30 opacity-75" : "border-slate-200 hover:shadow-md")}>
                  <div className="flex justify-between items-start gap-4 mb-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-slate-800 flex items-center gap-2 text-sm sm:text-base">
                        {rec.title || rec.suggestedLabel}
                        <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full whitespace-nowrap">
                          {activeEmailCount} emails
                        </span>
                      </h4>
                      <p className="text-xs sm:text-sm text-slate-500 mt-1.5 leading-relaxed">
                        {rec.reason}
                      </p>
                    </div>
                    {isCompleted && <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />}
                  </div>
                  
                  {!isCompleted && (
                    <>
                      <button 
                        onClick={() => toggleExpand(idx)}
                        className="flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-3 transition-colors"
                      >
                        {expandedRecs.has(idx) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        {expandedRecs.has(idx) ? 'Hide contents' : 'View contents'}
                      </button>
                      
                      {expandedRecs.has(idx) && (
                        <div className="bg-slate-50 rounded-lg p-2.5 mb-4 max-h-[160px] overflow-y-auto border border-slate-100 flex flex-col gap-1.5 custom-scrollbar">
                          {emails
                            .filter(e => rec.emailIds.includes(e.id))
                            .map((e, i) => {
                              const isSelected = !(rec.deselectedEmailIds || []).includes(e.id);
                              return (
                                <div key={i} className="text-xs flex items-start gap-2 border-b border-slate-200/60 pb-1.5 last:border-0 last:pb-0 cursor-pointer hover:bg-slate-100/50 p-1 rounded transition-colors" onClick={() => toggleEmailSelection(idx, e.id)}>
                                  <input 
                                    type="checkbox" 
                                    checked={isSelected}
                                    readOnly
                                    className="mt-0.5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-600 shrink-0 cursor-pointer"
                                  />
                                  <div className="flex flex-col gap-0.5 min-w-0">
                                    <span className={cn("font-semibold truncate transition-colors", isSelected ? "text-slate-700" : "text-slate-400 line-through")}>{e.sender}</span>
                                    <span className={cn("truncate transition-colors", isSelected ? "text-slate-500" : "text-slate-400 line-through")}>{e.subject}</span>
                                  </div>
                                </div>
                              );
                            })}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2 mt-auto pt-4 border-t border-slate-100">
                      <button
                        onClick={() => handleAction(idx, 'move', rec)}
                        disabled={isProcessing || activeEmailCount === 0}
                        className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderInput className="w-3.5 h-3.5" />}
                        Move to {rec.suggestedLabel}
                      </button>
                      <button
                        onClick={() => handleAction(idx, 'archive', rec)}
                        disabled={isProcessing || activeEmailCount === 0}
                        className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        Archive
                      </button>
                      <button
                        onClick={() => handleAction(idx, 'trash', rec)}
                        disabled={isProcessing || activeEmailCount === 0}
                        className="flex items-center justify-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                        Trash
                      </button>
                    </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
