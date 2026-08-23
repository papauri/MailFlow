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
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set());
  const [selectedFolder, setSelectedFolder] = useState<string>("anywhere");

  useEffect(() => {
    if (isOpen && suggestions.length === 0 && !loading && !error) {
      analyzeInbox(selectedFolder);
    }
  }, [isOpen]);

  const handleFolderChange = (folder: string) => {
    setSelectedFolder(folder);
    setSuggestions([]);
    setCompletedIds(new Set());
    setIgnoredIds(new Set());
    analyzeInbox(folder);
  };

  const analyzeInbox = async (folderQuery: string) => {
    setLoading(true);
    setError(null);
    try {
      let q = "-in:trash -in:spam";
      if (folderQuery !== "anywhere") {
        if (folderQuery.startsWith("label:")) {
           const labelName = folderQuery.split(":")[1];
           q = `label:"${labelName}" -in:trash -in:spam`;
        } else {
           q = `${folderQuery} -in:trash -in:spam`;
        }
      }
      
      const recentEmails = await searchEmails(q, 100);
      
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
      // Find all matching emails from this sender to process in one click using exact sender string
      const originalEmail = fetchedEmails.find(e => e.id === suggestion.emailId);
      const trueSender = originalEmail?.sender || suggestion.sender;
      const matchingEmails = fetchedEmails.filter(e => e.sender === trueSender);
      
      const msgIds = matchingEmails.flatMap(e => e.messageIds);
      
      let addLabels: string[] = [];
      let removeLabels: string[] = [];

      // 1. Base Action
      if (suggestion.suggestedAction === 'move_to_primary') {
        addLabels.push('INBOX', 'CATEGORY_PERSONAL');
        removeLabels.push('CATEGORY_PROMOTIONS', 'CATEGORY_UPDATES', 'CATEGORY_SOCIAL');
      } else if (suggestion.suggestedAction === 'move_to_updates') {
        addLabels.push('INBOX', 'CATEGORY_UPDATES');
        removeLabels.push('CATEGORY_PERSONAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL');
      } else if (suggestion.suggestedAction === 'move_to_promotions') {
        addLabels.push('INBOX', 'CATEGORY_PROMOTIONS');
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
           try {
             // Gmail API only supports specific system labels for filter removal
             const validFilterRemoveLabels = removeLabels.filter(l => ['INBOX', 'SPAM', 'TRASH', 'UNREAD'].includes(l));
             await createFilter(`from:${senderEmail}`, addLabels, validFilterRemoveLabels);
           } catch (filterErr) {
             console.error("Non-fatal: Failed to create future filter for", senderEmail, filterErr);
           }
         }
      }
      
      // Mark all matching emails as completed
      const newCompleted = new Set(completedIds);
      newCompleted.add(suggestion.emailId);
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

  const processedCount = completedIds.size + ignoredIds.size;
  const hasCompletedAll = suggestions.length > 0 && processedCount === suggestions.length;
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
              <div className="flex items-center flex-wrap gap-2">
                <h2 className="text-base font-bold text-slate-800">
                  Smart Organizer
                </h2>
                <div className="h-4 w-px bg-slate-200 hidden sm:block"></div>
                <select
                  value={selectedFolder}
                  onChange={(e) => handleFolderChange(e.target.value)}
                  disabled={loading}
                  className="bg-slate-50 border border-slate-200 rounded-md py-0.5 px-2 text-xs font-semibold text-slate-700 focus:ring-2 focus:ring-blue-500 cursor-pointer disabled:opacity-50"
                >
                  <option value="anywhere">Everywhere</option>
                  {(() => {
                    if (!userLabels) return null;
                    const systemMap: Record<string, string> = {
                      'INBOX': 'Inbox',
                      'CATEGORY_PERSONAL': 'Primary',
                      'CATEGORY_PROMOTIONS': 'Promotions',
                      'CATEGORY_UPDATES': 'Updates',
                      'CATEGORY_SOCIAL': 'Social',
                      'CATEGORY_FORUMS': 'Forums'
                    };
                    const allowedSystem = Object.keys(systemMap);
                    
                    const options = [];
                    for (const l of userLabels) {
                      if (l.type === 'system' && allowedSystem.includes(l.id)) {
                        let query = l.id.startsWith('CATEGORY_') ? `category:${l.id.replace('CATEGORY_', '').toLowerCase()}` : `in:${l.id.toLowerCase()}`;
                        if (query === 'category:personal') query = 'category:primary';
                        options.push(<option key={l.id} value={query}>{systemMap[l.id]}</option>);
                      } else if (l.type === 'user') {
                        options.push(<option key={l.id} value={`label:"${l.name}"`}>{l.name}</option>);
                      }
                    }
                    return options;
                  })()}
                </select>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">Triage and organize emails by folder.</p>
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
              {suggestions.filter(s => !completedIds.has(s.emailId) && !ignoredIds.has(s.emailId)).map((suggestion) => {
                const actionUi = getActionLabel(suggestion.suggestedAction);
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

                // Calculate batch impact using the true sender from the payload, not the AI's string
                const trueSender = originalEmail?.sender || suggestion.sender;
                const matchingCount = fetchedEmails.filter(e => e.sender === trueSender).length;
                
                // Check if suggested label requires creation
                const labelExists = !suggestion.suggestedLabel || userLabels?.some(l => l.name.toLowerCase() === suggestion.suggestedLabel.toLowerCase());

                return (
                  <div key={suggestion.emailId} className="bg-white border rounded-xl p-3 sm:p-4 transition-all flex flex-col gap-3 border-slate-200 hover:border-slate-300 animate-in slide-in-from-bottom-2 fade-in duration-200">
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                      
                      {/* Left: Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h4 className="text-sm font-bold text-slate-900 truncate">{suggestion.sender}</h4>
                          <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-500">
                            {resolvedLabels.length > 0 ? (
                              <div className="flex gap-1">
                                {resolvedLabels.map((lbl: string, i: number) => (
                                  <span key={i} className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-600">{lbl}</span>
                                ))}
                              </div>
                            ) : (
                              <span className="px-1.5 py-0.5 bg-slate-100 rounded text-slate-400">None</span>
                            )}
                            
                            <ArrowRight className="w-3 h-3 text-slate-300" />
                            
                            <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded flex items-center gap-1">
                              {actionUi.text}
                            </span>
                            {suggestion.suggestedLabel && (
                              <span className="px-1.5 py-0.5 bg-teal-50 text-teal-700 rounded">
                                {suggestion.suggestedLabel} {!labelExists && '(New)'}
                              </span>
                            )}
                          </div>
                        </div>
                        
                        <p className="text-sm text-slate-600 truncate">{suggestion.subject}</p>
                        <p className="text-xs text-slate-500 mt-1">{suggestion.reason}</p>
                      </div>

                      {/* Right: Actions */}
                      <div className="shrink-0 flex flex-col gap-2 w-full sm:w-36">
                        {labelExists ? (
                          <button 
                            onClick={() => executeAction(suggestion, false)}
                            disabled={isProcessing}
                            className={`w-full flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-white font-medium text-xs transition-colors shadow-sm disabled:opacity-50 ${actionUi.color}`}
                          >
                            {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
                            Execute
                          </button>
                        ) : (
                          <>
                            <button 
                              onClick={() => executeAction(suggestion, false)}
                              disabled={isProcessing}
                              className={`w-full flex items-center justify-center gap-1.5 px-4 py-1.5 rounded-lg text-white font-medium text-xs transition-colors shadow-sm disabled:opacity-50 ${actionUi.color}`}
                            >
                              {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : actionUi.icon}
                              {actionUi.text} Only
                            </button>
                            <button 
                              onClick={() => executeAction(suggestion, true)}
                              disabled={isProcessing}
                              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-teal-700 bg-teal-50 hover:bg-teal-100 border border-teal-200 font-medium text-xs transition-colors disabled:opacity-50"
                            >
                              {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Tag className="w-3 h-3" />}
                              + Create '{suggestion.suggestedLabel}'
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => setIgnoredIds(new Set(ignoredIds).add(suggestion.emailId))}
                          disabled={isProcessing}
                          className="w-full text-center py-1 mt-0.5 text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-wider disabled:opacity-50"
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>

                    {/* Bottom: Context details */}
                    {(matchingCount > 1 || suggestion.applyToAllFuture) && (
                      <div className="flex items-center gap-3 text-[10px] font-bold text-slate-400 uppercase tracking-wide">
                        {matchingCount > 1 && <span>• Affects {matchingCount} emails</span>}
                        {suggestion.applyToAllFuture && <span>• Auto-applies to future</span>}
                      </div>
                    )}
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
