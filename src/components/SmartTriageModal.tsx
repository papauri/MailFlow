import React, { useState, useEffect } from 'react';
import { X, Bot, Sparkles, Loader2, CheckCircle2, Inbox, Archive, Star, FolderDown } from 'lucide-react';
import { searchEmails, batchModifyEmails, batchArchiveEmails } from '../lib/gmail';

export function SmartTriageModal({ isOpen, onClose, aiSettings }: { isOpen: boolean, onClose: () => void, aiSettings: any }) {
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
      // Fetch recent emails from inbox
      const recentEmails = await searchEmails("in:inbox", 50);
      
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
        body: JSON.stringify({ emails: payload, settings: aiSettings })
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
      if (suggestion.suggestedAction === 'move_to_primary') {
        await batchModifyEmails(msgIds, ['CATEGORY_PERSONAL'], ['CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL']);
      } else if (suggestion.suggestedAction === 'move_to_updates') {
        await batchModifyEmails(msgIds, ['CATEGORY_UPDATES'], ['CATEGORY_PERSONAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL']);
      } else if (suggestion.suggestedAction === 'move_to_promotions') {
        await batchModifyEmails(msgIds, ['CATEGORY_PROMOTIONS'], ['CATEGORY_PERSONAL', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL']);
      } else if (suggestion.suggestedAction === 'archive') {
        await batchArchiveEmails(msgIds);
      } else if (suggestion.suggestedAction === 'star') {
        await batchModifyEmails(msgIds, ['STARRED'], []);
      }
      
      setCompletedIds(prev => new Set(prev).add(suggestion.emailId));
    } catch (err) {
      console.error(err);
      alert("Failed to execute action.");
    } finally {
      setProcessingId(null);
    }
  };

  const getActionLabel = (action: string) => {
    switch (action) {
      case 'move_to_primary': return { icon: <Inbox className="w-4 h-4" />, text: "Move to Primary", color: "bg-indigo-500 hover:bg-indigo-600" };
      case 'move_to_updates': return { icon: <FolderDown className="w-4 h-4" />, text: "Move to Updates", color: "bg-blue-500 hover:bg-blue-600" };
      case 'move_to_promotions': return { icon: <FolderDown className="w-4 h-4" />, text: "Move to Promos", color: "bg-amber-500 hover:bg-amber-600" };
      case 'archive': return { icon: <Archive className="w-4 h-4" />, text: "Archive", color: "bg-slate-600 hover:bg-slate-700" };
      case 'star': return { icon: <Star className="w-4 h-4" />, text: "Star", color: "bg-yellow-500 hover:bg-yellow-600" };
      default: return { icon: <CheckCircle2 className="w-4 h-4" />, text: "Execute", color: "bg-slate-800 hover:bg-slate-900" };
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-4 sm:p-6 opacity-100 animate-in fade-in">
      <div className="bg-white w-full max-w-3xl max-h-[85vh] sm:max-h-[80vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden ring-1 ring-slate-900/5 animate-in zoom-in-95 relative">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between bg-white relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-50 border border-indigo-100 flex items-center justify-center">
              <Bot className="w-5 h-5 text-indigo-600" />
            </div>
            <div>
              <h2 className="text-lg {font-bold} text-slate-800 flex items-center gap-2">
                Smart AI Triage
                <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider">Experimental</span>
              </h2>
              <p className="text-sm text-slate-500 mt-0.5">Let AI review your inbox and suggest actions.</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-full transition-colors text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4 sm:p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="relative">
                <Loader2 className="w-12 h-12 text-indigo-500 animate-spin" />
                <Sparkles className="w-5 h-5 text-indigo-400 absolute -top-1 -right-1 animate-pulse" />
              </div>
              <p className="text-slate-600 font-medium mt-4">AI is analyzing your inbox...</p>
              <p className="text-slate-400 text-sm mt-1 max-w-xs text-center">Reading headers, identifying senders, and finding miscategorized emails.</p>
            </div>
          ) : error ? (
            <div className="bg-red-50 text-red-600 p-4 rounded-xl border border-red-100 flex items-start gap-3">
              <X className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">Analysis Failed</p>
                <p className="text-sm mt-1">{error}</p>
                <button onClick={analyzeInbox} className="mt-3 bg-white text-red-600 border border-red-200 px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-red-50">Try Again</button>
              </div>
            </div>
          ) : suggestions.length > 0 ? (
            <div className="space-y-3">
              {suggestions.map((suggestion, idx) => {
                const actionUi = getActionLabel(suggestion.suggestedAction);
                const isCompleted = completedIds.has(suggestion.emailId);
                const isProcessing = processingId === suggestion.emailId;

                return (
                  <div key={idx} className={`bg-white border rounded-xl p-4 transition-all ${isCompleted ? 'border-green-200 bg-green-50/50' : 'border-slate-200 hover:border-indigo-300 hover:shadow-md'}`}>
                    <div className="flex flex-col sm:flex-zow gap-4 items-start sm:items-center justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-slate-800 truncate">{suggestion.sender}</p>
                        <p className="text-sm text-slate-600 truncate mt-0.5">{suggestion.subject}</p>
                        <div className="flex items-start gap-2 mt-2.5 bg-indigo-50/50 text-indigo-800 px-3 py-2 rounded-lg text-xs sm:text-sm">
                          <Sparkles className="w-4 h-4 shrink-0 text-indigo-500 mt-0.5" />
                          <p className="leading-relaxed font-medium">{suggestion.reason}</p>
                        </div>
                      </div>
                      <div className="shrink-0 w-full sm:w-auto">
                        {isCompleted ? (
                          <div className="flex items-center justify-center gap-1.5 w-full sm:w-auto px-4 py-2 bg-green-100 text-green-700 rounded-lg font-bold text-sm">
                            <CheckCircle2 className="w-4 h-4" />
                            Done
                          </div>
                        ) : (
                          <button 
                            onClick={() => executeAction(suggestion)}
                            disabled={isProcessing}
                            className={`w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-white font-medium text-sm transition-all shadow-sm disabled:opacity-50 ${actionUi.color}`}
                          >
                            {isProcessing ? <Loader2 className="w-4 h-4 animate-spin" /> : actionUi.icon}
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
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mb-4">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-800">Your Inbox is perfect!</h3>
              <p className="text-slate-500 mt-1 max-w-sm">The AI analyzed your recent emails and couldn't find any that needed immediate triage or re-categorization.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
