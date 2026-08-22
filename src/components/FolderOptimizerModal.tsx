import React, { useState, useEffect } from 'react';
import { X, Sparkles, Loader2, CheckCircle, Trash2, Archive, FolderInput, AlertTriangle, Cpu } from 'lucide-react';
import { cn } from '../lib/utils';
import { batchModifyEmails, batchTrashEmails, batchArchiveEmails, createLabel } from '../lib/gmail';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  emails: any[];
  userLabels: any[];
  onComplete: () => void;
  aiSettings?: any;
}

interface Recommendation {
  emailIds: string[];
  suggestedLabel: string;
  reason: string;
  title?: string;
}

export function FolderOptimizerModal({ isOpen, onClose, emails, userLabels, onComplete, aiSettings }: Props) {
  const [loading, setLoading] = useState(true);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<number | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<number>>(new Set());
  const [usedAi, setUsedAi] = useState(false);

  useEffect(() => {
    if (isOpen) {
      runAnalysis();
    } else {
      setRecommendations([]);
      setError(null);
      setCompletedIds(new Set());
    }
  }, [isOpen]);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    setUsedAi(false);
    
    // We only analyze the top 150 loaded emails to keep it fast and within token limits
    const sample = emails.slice(0, 150);
    if (sample.length === 0) {
      setError("No emails to analyze in this view.");
      setLoading(false);
      return;
    }

    try {
      // 1. Try AI first
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

      // 2. Fallback to Local Data Analytics Model
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

      // Simple keyword heuristics for Promo / Updates / Purchases
      if (subject.includes('sale') || subject.includes('% off') || subject.includes('discount')) {
        if (!keywordMap.has('Promotions')) keywordMap.set('Promotions', []);
        keywordMap.get('Promotions')!.push(e);
      } else if (subject.includes('order') || subject.includes('receipt') || subject.includes('invoice') || subject.includes('shipped')) {
        if (!keywordMap.has('Purchases')) keywordMap.set('Purchases', []);
        keywordMap.get('Purchases')!.push(e);
      } else if (e.listUnsubscribe || subject.includes('newsletter') || subject.includes('digest')) {
        if (!keywordMap.has('Newsletters')) keywordMap.set('Newsletters', []);
        keywordMap.get('Newsletters')!.push(e);
      }
    });

    // 1. High Volume Senders (Outliers)
    senderMap.forEach((emails, addr) => {
      if (emails.length > 3) {
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

    // 2. Keyword Groupings
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

    // Deduplicate and sort by impact (number of emails)
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
      const allMessageIds: string[] = [];
      rec.emailIds.forEach(tid => {
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
          // Add to new label, remove from INBOX
          await batchModifyEmails(allMessageIds, [labelId], ['INBOX']);
        }
      }
      
      setCompletedIds(prev => new Set(prev).add(idx));
      // Notify parent to remove these from view optimistically
      setTimeout(() => onComplete(), 500);
    } catch (e) {
      console.error(e);
      alert("Failed to apply action.");
    } finally {
      setProcessingId(null);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-900/40 backdrop-blur-sm">
      <div 
        className="bg-white rounded-2xl shadow-xl w-full max-w-2xl flex flex-col overflow-hidden max-h-[85vh] animate-in fade-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className={cn("p-2 rounded-lg", usedAi ? "bg-indigo-100" : "bg-emerald-100")}>
              {usedAi ? <Sparkles className="w-5 h-5 text-indigo-600" /> : <Cpu className="w-5 h-5 text-emerald-600" />}
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">
                {usedAi ? "AI Folder Optimizer" : "Smart Folder Optimizer"}
              </h2>
              <p className="text-xs text-slate-500">
                {usedAi ? "Powered by AI analytics" : "Powered by local behavioral heuristics"}
              </p>
            </div>
          </div>
          <button 
            onClick={() => { onClose(); }}
            className="p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-500"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 sm:p-5 bg-slate-50/50">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
              <div className="text-center">
                <p className="text-sm font-semibold text-slate-700">Scanning folder for outliers...</p>
                <p className="text-xs text-slate-500 mt-1">Analyzing sender patterns and topics.</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-rose-500">
              <AlertTriangle className="w-8 h-8" />
              <p className="text-sm font-medium">{error}</p>
            </div>
          ) : recommendations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-slate-500">
              <CheckCircle className="w-8 h-8 text-emerald-500" />
              <p className="text-sm font-medium text-slate-700">Looking good!</p>
              <p className="text-xs text-center max-w-sm">We couldn't find any major outliers or messy bundles in this view.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              <p className="text-sm text-slate-600 font-medium mb-1">
                We detected {recommendations.length} actionable {recommendations.length === 1 ? 'group' : 'groups'} in this view:
              </p>
              
              {recommendations.map((rec, idx) => {
                const isCompleted = completedIds.has(idx);
                const isProcessing = processingId === idx;
                
                return (
                  <div key={idx} className={cn("bg-white border rounded-xl p-4 transition-all shadow-sm", isCompleted ? "border-emerald-200 bg-emerald-50/30 opacity-75" : "border-slate-200")}>
                    <div className="flex justify-between items-start gap-4 mb-3">
                      <div>
                        <h4 className="font-bold text-slate-800 flex items-center gap-2">
                          {rec.title || rec.suggestedLabel}
                          <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
                            {rec.emailIds.length} emails
                          </span>
                        </h4>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                          {rec.reason}
                        </p>
                      </div>
                      {isCompleted && <CheckCircle className="w-5 h-5 text-emerald-500 shrink-0" />}
                    </div>
                    
                    {!isCompleted && (
                      <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-slate-100">
                        <button
                          onClick={() => handleAction(idx, 'move', rec)}
                          disabled={isProcessing}
                          className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                        >
                          {isProcessing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderInput className="w-3.5 h-3.5" />}
                          Move to {rec.suggestedLabel}
                        </button>
                        <button
                          onClick={() => handleAction(idx, 'archive', rec)}
                          disabled={isProcessing}
                          className="flex items-center justify-center gap-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                        >
                          <Archive className="w-3.5 h-3.5" />
                          Archive All
                        </button>
                        <button
                          onClick={() => handleAction(idx, 'trash', rec)}
                          disabled={isProcessing}
                          className="flex items-center justify-center gap-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          Trash All
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
