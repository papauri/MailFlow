import React, { useState, useEffect } from 'react';
import { X, Loader2, CheckCircle2, Inbox, Archive, Star, FolderDown, Tag, CornerDownRight, Zap, Layers, Filter, ArrowRight } from 'lucide-react';
import { searchEmails, batchModifyEmails, batchArchiveEmails, createLabel, createFilter } from '../lib/gmail';

export function SmartTriageModal({ isOpen, onClose, aiSettings, userLabels }: { isOpen: boolean, onClose: () => void, aiSettings: any, userLabels?: any[] }) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [fetchedEmails, setFetchedEmails] = useState<any[]>([]);
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
      setFetchedEmails(payload);

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

  const executeAction = async (suggestion: any, createFolder: boolean = false) => {
    setProcessingId(suggestion.emailId);
    try {
      // Find all matching emails from this sender to process in one click
      const matchingEmails = fetchedEmails.filter(e => e.sender === suggestion.sender);
      const msgIds = matchingEmails.flatMap(e => e.messageIds);
      
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
        } else if (createFolder) {
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
      
      // Mark all matching emails as completed
      const newCompleted = new Set(completedIds);
      matchingEmails.forEach(e => newCompleted.add(e.id));
      setCompletedIds(newCompleted);
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
                const actionUi = getActionLabel(suggestion.suggestedAction);
                const isCompleted = completedIds.has(suggestion.emailId);
                const isProcessing = processingId === suggestion.emailId;
                
                // Retrieve original email to see current state
                const originalEmail = fetchedEmails.find(e => e.id === suggestion.emailId);
                const currentLabels = originalEmail?.labelIds || [];
                
                const standardMap: Record<string, string> = {
                  'INBOX': 'Inbox',
                  'CATEGORY_PERSONAL': 'Primary',
                  'CATEGORY_UPDATES': 'Updates',
                  'CATEGORY_PROMOTIONS': 'Promotions',
                  'CATEGORY_SOCIAL': 'Social',
                  'STARRED': 'Starred'
                };
                
                const resolvedLabels = currentLabels
                  .filter((id: string) => id !== 'UNREAD' && id !== 'IMPORTANT')
                  .map((id: string) => standardMap[id] || userLabels?.find(l => l.id === id)?.name || id);

                // Calculate batch impact
                const matchingCount = fetchedEmails.filter(e => e.sender === suggestion.sender).length;
                
                // Check if suggested label requires creation
                const labelExists = !suggestion.suggestedLabel || userLabels?.some(l => l.name.toLowerCase() === suggestion.suggestedLabel.toLowerCase());

                return (
                  <div key={idx} className={`bg-white border rounded-xl p-3 sm:p-4 transition-all ${isCompleted ? 'border-green-200 bg-green-50/50' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm'}`}>
                    {/* Top Row: Email Context & Buttons */}
                    <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between mb-3">
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-bold text-slate-800 truncate leading-tight">{suggestion.sender}</h4>
                        <p className="text-xs text-slate-500 truncate mt-0.5">{suggestion.subject}</p>
                      </div>
                      
                      <div className="shrink-0 w-full sm:w-auto flex gap-1.5">
                        {isCompleted ? (
                          <div className="flex items-center justify-center gap-1.5 w-full sm:w-auto px-4 py-1.5 bg-green-100 text-green-700 rounded-lg font-bold text-xs">
                            <CheckCircle2 className="w-4 h-4" /> Done
                          </div>
                        ) : (
                          <>
                            {!labelExists && suggestion.suggestedLabel && (
                              <button 
                                onClick={() => executeAction(suggestion, true)}
                                disabled={isProcessing}
                                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-teal-500 hover:bg-teal-600 text-white font-medium text-xs transition-all shadow-sm disabled:opacity-50"
                              >
                                {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Tag className="w-3 h-3" />}
                                Create & Approve
                              </button>
                            )}
                            <button 
                              onClick={() => executeAction(suggestion, false)}
                              disabled={isProcessing}
                              className={`flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-white font-medium text-xs transition-all shadow-sm disabled:opacity-50 ${labelExists ? actionUi.color : 'bg-slate-700 hover:bg-slate-800'}`}
                            >
                              {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                              {labelExists ? "Approve" : "Approve Only"}
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Middle Row: The Logic */}
                    <div className="bg-slate-50 border border-slate-100 rounded-lg p-3">
                      {/* Before -> After visual */}
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs font-medium text-slate-600 mb-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400">Current:</span>
                          {resolvedLabels.length > 0 ? (
                            resolvedLabels.map((lbl: string, i: number) => (
                              <span key={i} className="px-1.5 py-0.5 bg-white border border-slate-200 text-slate-600 rounded">
                                {lbl}
                              </span>
                            ))
                          ) : (
                            <span className="px-1.5 py-0.5 bg-white border border-slate-200 text-slate-400 rounded">None</span>
                          )}
                        </div>
                        
                        <ArrowRight className="w-3 h-3 text-slate-300" />
                        
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-400">Proposed:</span>
                          <span className="px-1.5 py-0.5 bg-blue-50 border border-blue-100 text-blue-700 rounded flex items-center gap-1">
                            {actionUi.icon} {actionUi.text}
                          </span>
                          {suggestion.suggestedLabel && (
                            <span className="px-1.5 py-0.5 bg-teal-50 border border-teal-100 text-teal-700 rounded flex items-center gap-1">
                              <Tag className="w-3 h-3" /> {suggestion.suggestedLabel} {!labelExists && '(New)'}
                            </span>
                          )}
                        </div>
                      </div>
                      
                      {/* Reason */}
                      <p className="text-xs text-slate-500 flex items-start gap-1.5 mt-2">
                        <CornerDownRight className="w-3 h-3 mt-0.5 shrink-0 text-slate-400" />
                        {suggestion.reason}
                      </p>
                      
                      {/* Impact Badges */}
                      {(matchingCount > 1 || suggestion.applyToAllFuture) && (
                        <div className="flex flex-wrap gap-2 mt-3 pt-2 border-t border-slate-100">
                          {matchingCount > 1 && (
                            <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-bold border border-slate-200">
                              Affects {matchingCount} recent emails
                            </span>
                          )}
                          {suggestion.applyToAllFuture && (
                            <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide border border-slate-200">
                              <Zap className="w-3 h-3 text-slate-400" /> Auto-apply to future emails
                            </span>
                          )}
                        </div>
                      )}
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
