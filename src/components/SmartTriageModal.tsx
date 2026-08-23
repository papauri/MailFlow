import React, { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle2, Inbox, Archive, Star, FolderDown, Tag, CornerDownRight, Zap, Layers, Filter } from 'lucide-react';
import { searchEmails, batchModifyEmails, batchArchiveEmails, createLabel, createFilter } from '../lib/gmail';

export function SmartTriageModal({ isOpen, onClose, aiSettings, userLabels }: { isOpen: boolean, onClose: () => void, aiSettings: any, userLabels?: any[] }) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (isOpen && suggestions.length === 0 && !loading && !error) {
      analyzeInbox();
    }
  }, [isOpen]);

  const analyzeInbox = async () => {
    setLoading(true);
    setError(null);
    try {
      // Fetch recent emails from across the mailbox (excluding junk) for thorough analysis
      const recentEmails = await searchEmails("-in:trash -in:spam", 100);
      
      const payload = recentEmails.map(e => ({
        id: e.id,
        sender: e.sender,
        subject: e.subject,
        labelIds: e.labelIds,
        messageIds: e.messageIds
      }));

      const res = await fetch("/api/smart-triage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails: payload, settings: aiSettings, existingLabels: userLabels })
      });

      if (!res.ok) {
        throw new Error("Failed to generate AI suggestions");
      }
      const data = await res.json();
      
      // Merge messageIds back into suggestions
      const enrichedSuggestions = data.suggestions.map((s: any) => {
        const original = payload.find(p => p.id === s.emailId);
        return { ...s, messageIds: original?.messageIds || [s.emailId] };
      });
      
      setSuggestions(enrichedSuggestions);
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  const executeAction = async (suggestion: any) => {
    setProcessingId(suggestion.emailId);
    try {
      const msgIds = suggestion.messageIds;
      let addLabels: string[] = [];
      let removeLabels: string[] = [];

      // 1. Base Action
      if (suggestion.suggestedAction === 'move_to_primary') {
        addLabels.push('CATEGORY_PERSONAL');
        removeLabels.push('CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL');
      } else if (suggestion.suggestedAction === 'move_to_updates') {
        addLabels.push('CATEGORY_UPDATES');
        removeLabels.push('CATEGORY_PERSONAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL');
      } else if (suggestion.suggestedAction === 'move_to_promotions') {
        addLabels.push('CATEGORY_PROMOTIONS');
        removeLabels.push('CATEGORY_PERSONAL', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL');
      } else if (suggestion.suggestedAction === 'archive') {
        removeLabels.push('INBOX');
      } else if (suggestion.suggestedAction === 'star') {
        addLabels.push('STARRED');
      }

      // 2. Additional Label 
      if (suggestion.suggestedLabel) {
        const existing = userLabels?.find(l => l.name.toLowerCase() === suggestion.suggestedLabel.toLowerCase());
        if (existing) {
          addLabels.push(existing.id);
        } else {
          const lbl = await createLabel(suggestion.suggestedLabel);
          if (lbl && lbl.id) {
            addLabels.push(lbl.id);
          }
        }
      }
      
      if (addLabels.length > 0 || removeLabels.length > 0) {
         await batchModifyEmails(msgIds, addLabels, removeLabels);
      }
      
      if (suggestion.applyToAllFuture && suggestion.sender) {
         const senderEmail = suggestion.sender.match(/<([^>]+)>/)?.[1] || suggestion.sender;
         if (senderEmail && senderEmail.includes('@')) {
           await createFilter(`from:${senderEmail}`, addLabels, removeLabels);
         }
      }
      
      setCompletedIds(prev => new Set(prev).add(suggestion.emailId));
    } catch (err) {
      console.error(err);
      alert("Failed to execute action.");
    } finally {
      setProcessingId(null);
    }
  };

  const getActionLabel = (action: string, labelName?: string) => {
    let base = { icon: <CheckCircle2 className="w-4 h-4" />, text: "Organize", color: "bg-blue-600 hover:bg-blue-700" };
    switch (action) {
      case 'move_to_primary': base = { icon: <Inbox className="w-4 h-4" />, text: "Primary", color: "bg-blue-600 hover:bg-blue-700" }; break;
      case 'move_to_updates': base = { icon: <FolderDown className="w-4 h-4" />, text: "Updates", color: "bg-blue-600 hover:bg-blue-700" }; break;
      case 'move_to_promotions': base = { icon: <FolderDown className="w-4 h-4" />, text: "Promos", color: "bg-blue-600 hover:bg-blue-700" }; break;
      case 'archive': base = { icon: <Archive className="w-4 h-4" />, text: "Archive", color: "bg-slate-700 hover:bg-slate-800" }; break;
      case 'star': base = { icon: <Star className="w-4 h-4" />, text: "Star", color: "bg-amber-500 hover:bg-amber-600" }; break;
    }
    
    if (labelName) {
      base.text = action === 'keep_in_inbox' ? `Label: ${labelName}` : `${base.text} + ${labelName}`;
    }
    return base;
  };

  const hasCompletedAll = suggestions.length > 0 && completedIds.size === suggestions.length;
  const timeSaved = completedIds.size * 2 + suggestions.filter(s => s.applyToAllFuture && completedIds.has(s.emailId)).length * 5;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 opacity-100 animate-in fade-in">
      <div className="bg-white w-full max-w-3xl max-h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-slate-900/5 animate-in zoom-in-95 relative">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between bg-white relative z-10">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center">
              <Layers className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
                Smart Organizer
              </h2>
              <p className="text-xs text-slate-500">Intelligently analyze your inbox and suggest actions.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50/50 p-3 sm:p-4">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="relative">
                <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
              </div>
              <p className="text-slate-600 font-medium mt-3 text-sm">Analyzing your inbox...</p>
              <p className="text-slate-400 text-xs mt-1 max-w-xs text-center">Reading headers, identifying senders, and finding miscategorized emails.</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg border border-red-100 flex items-start gap-2">
              <X className="w-4 h-4 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm">Analysis Failed</p>
                <p className="text-xs mt-0.5">{error}</p>
                <button onClick={analyzeInbox} className="mt-2 bg-white text-red-600 border border-red-200 px-2 py-1 rounded-md text-xs font-medium hover:bg-red-50">Try Again</button>
              </div>
            </div>
          ) : hasCompletedAll ? (
            <div className="flex flex-col items-center justify-center py-16 text-center animate-in zoom-in duration-300">
              <div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-4 shadow-sm">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-2xl font-bold text-slate-800 tracking-tight">You're all caught up!</h3>
              <p className="text-slate-500 mt-2 max-w-sm text-sm">
                You successfully processed {completedIds.size} items. 
                With your new automated filters, the system has saved you an estimated <strong className="text-slate-700 font-bold">{timeSaved} minutes</strong> of manual sorting every month.
              </p>
              <button 
                onClick={onClose} 
                className="mt-6 bg-slate-800 text-white px-5 py-2.5 rounded-xl font-semibold shadow-sm hover:bg-slate-900 transition-colors"
              >
                Return to Inbox
              </button>
            </div>
          ) : suggestions.length > 0 ? (
            <div className="space-y-2">
              {suggestions.map((suggestion, idx) => {
                const actionUi = getActionLabel(suggestion.suggestedAction, suggestion.suggestedLabel);
                const isCompleted = completedIds.has(suggestion.emailId);
                const isProcessing = processingId === suggestion.emailId;

                return (
                  <div key={idx} className={`bg-white border rounded-xl p-3 transition-all ${isCompleted ? 'border-green-200 bg-green-50/50' : 'border-slate-200 hover:border-blue-300 hover:shadow-sm'}`}>
                    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate leading-tight">{suggestion.sender}</p>
                        <p className="text-xs text-slate-600 truncate mt-0.5">{suggestion.subject}</p>
                        
                        <div className="flex items-center gap-1.5 mt-1.5 bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5 inline-flex">
                          <p className="text-xs text-slate-600 font-medium flex items-center gap-1">
                            <CornerDownRight className="w-3 h-3 text-slate-400" /> {suggestion.reason}
                          </p>
                        </div>
                        
                        {suggestion.applyToAllFuture && (
                          <div className="mt-2 flex">
                            <div className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border border-amber-100">
                              <Zap className="w-3 h-3" /> Applies to all future emails
                            </div>
                          </div>
                        )}
                      </div>
                      
                      <div className="shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
                        {isCompleted ? (
                          <div className="flex items-center justify-center gap-1.5 w-full sm:w-auto px-3 py-1.5 bg-green-100 text-green-700 rounded-lg font-bold text-xs">
                            <CheckCircle2 className="w-3 h-3" />
                            Done
                          </div>
                        ) : (
                          <button 
                            onClick={() => executeAction(suggestion)}
                            disabled={isProcessing}
                            className={`w-full sm:w-auto flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-white font-medium text-xs transition-all shadow-sm disabled:opacity-50 ${actionUi.color}`}
                          >
                            {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : actionUi.icon}
                            {actionUi.text}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-3">
                <CheckCircle2 className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-800">Your Inbox is perfect!</h3>
              <p className="text-slate-500 mt-1 max-w-xs text-sm">We analyzed your recent emails and couldn't find any that needed immediate triage or re-categorization.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
