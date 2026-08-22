import React, { useState, useEffect } from 'react';
import { X, Tag, Loader2, Sparkles, Folder, Inbox, Trash2, CheckCircle, ChevronDown, MoveRight, Search } from 'lucide-react';
import { fetchGmailAPI, searchEmails, searchEmailsPaginated, batchModifyEmails } from '../lib/gmail';
import { cn } from '../lib/utils';

export function LabelManagerModal({ isOpen, onClose, userLabels, aiSettings }: any) {
  const [labels, setLabels] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeLabel, setActiveLabel] = useState<any>(null);
  const [labelEmails, setLabelEmails] = useState<any[]>([]);
  const [loadingEmails, setLoadingEmails] = useState(false);
  
  // AI State
  const [aiAnalysis, setAiAnalysis] = useState<string>('');
  const [analyzing, setAnalyzing] = useState(false);

  // Selection & Drag/Drop
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [dragOverLabelId, setDragOverLabelId] = useState<string | null>(null);
  const [showMoveMenu, setShowMoveMenu] = useState(false);

  // Pagination & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [pageToken, setPageToken] = useState<string | undefined>(undefined);
  const [loadingMore, setLoadingMore] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  useEffect(() => {
    if (isOpen) {
      loadLabels();
    }
  }, [isOpen, userLabels]);

  const loadLabels = async () => {
    setLoading(true);
    try {
      // Filter out system labels
      const userOnly = (userLabels || []).filter((l: any) => l.type === 'user');
      
      // Fetch details for each label to get counts (messagesTotal, messagesUnread)
      const detailed = await Promise.all(
        userOnly.map((l: any) => fetchGmailAPI(`/labels/${l.id}`).catch(() => l))
      );
      
      setLabels(detailed);
      if (detailed.length > 0 && !activeLabel) {
        handleLabelClick(detailed[0]);
      }
    } catch (e) {
      console.error("Failed to load detailed labels", e);
    } finally {
      setLoading(false);
    }
  };

  const handleLabelClick = (label: any) => {
    setActiveLabel(label);
    setSearchQuery('');
    setDebouncedQuery('');
    setAiAnalysis('');
    setSelectedIds(new Set());
    setShowMoveMenu(false);
  };

  useEffect(() => {
    if (!activeLabel) return;
    const fetchFirstPage = async () => {
      setLoadingEmails(true);
      try {
        const formattedName = activeLabel.name.includes(' ') ? `"${activeLabel.name}"` : activeLabel.name;
        let query = `label:${formattedName}`;
        if (debouncedQuery.trim()) {
           query += ` (${debouncedQuery})`;
        }
        const res = await searchEmailsPaginated(query, 50, "");
        setLabelEmails(res.emails);
        setPageToken(res.nextPageToken);
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingEmails(false);
      }
    };
    fetchFirstPage();
  }, [activeLabel, debouncedQuery]);

  const handleLoadMore = async () => {
    if (!activeLabel || !pageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const formattedName = activeLabel.name.includes(' ') ? `"${activeLabel.name}"` : activeLabel.name;
      let query = `label:${formattedName}`;
      if (debouncedQuery.trim()) {
         query += ` (${debouncedQuery})`;
      }
      const res = await searchEmailsPaginated(query, 50, pageToken);
      setLabelEmails(prev => [...prev, ...res.emails]);
      setPageToken(res.nextPageToken);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMore(false);
    }
  };

  const handleDeleteLabel = async () => {
    if (!activeLabel) return;
    const confirm = window.confirm(`Are you sure you want to delete the label "${activeLabel.name}"?\n\nThe label will be removed from all associated emails, leaving them in your main inbox or archive. No emails will be deleted.`);
    if (!confirm) return;
    
    try {
      setLoadingEmails(true);
      await fetchGmailAPI(`/labels/${activeLabel.id}`, { method: 'DELETE' });
      setLabels(prev => prev.filter(l => l.id !== activeLabel.id));
      setActiveLabel(null);
      setLabelEmails([]);
    } catch (e) {
      alert("Failed to delete label. Check console for details.");
      console.error(e);
    } finally {
      setLoadingEmails(false);
    }
  };
  
  const handleAnalyze = async () => {
    if (!aiSettings?.apiKey) {
       alert("AI is not configured. Please add an API key in settings.");
       return;
    }
    setAnalyzing(true);
    try {
      const emailContext = labelEmails.slice(0, 10).map(e => `Subject: ${e.subject}\nSnippet: ${e.snippet}`).join('\n\n');
      const prompt = `Analyze these recent emails from the label "${activeLabel.name}". Provide a very short 2-3 sentence summary of what kind of emails are stored here, and suggest if this label could be reorganized or if rules could be better optimized. Emails:\n${emailContext}`;
      
      const res = await fetch("/api/parse-query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, settings: aiSettings, bypassJson: true })
      });
      
      const text = await res.text();
      setAiAnalysis(text);
    } catch (e) {
      setAiAnalysis("Failed to analyze label with AI.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleMoveToLabel = async (targetLabelId: string, emailIds: string[]) => {
    if (!activeLabel || emailIds.length === 0) return;
    setMoving(true);
    try {
      await batchModifyEmails(emailIds, [targetLabelId], [activeLabel.id]);
      
      // Update UI optimistically
      setLabelEmails(prev => prev.filter(e => !emailIds.includes(e.id)));
      setSelectedIds(new Set());
      setShowMoveMenu(false);
      
      // Update counts in sidebar (approximate)
      setLabels(prev => prev.map(l => {
        if (l.id === activeLabel.id) {
           return { ...l, messagesTotal: Math.max(0, (l.messagesTotal || 0) - emailIds.length) };
        }
        if (l.id === targetLabelId) {
           return { ...l, messagesTotal: (l.messagesTotal || 0) + emailIds.length };
        }
        return l;
      }));
    } catch (e) {
      alert("Failed to move emails.");
      console.error(e);
    } finally {
      setMoving(false);
    }
  };

  const handleDragStart = (e: React.DragEvent, emailId: string) => {
    // If dragging an unselected item, select it first (or just drag it alone)
    const idsToMove = selectedIds.has(emailId) ? Array.from(selectedIds) : [emailId];
    e.dataTransfer.setData("text/plain", JSON.stringify(idsToMove));
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDrop = (e: React.DragEvent, targetLabelId: string) => {
    e.preventDefault();
    setDragOverLabelId(null);
    if (targetLabelId === activeLabel?.id) return;
    
    try {
      const data = e.dataTransfer.getData("text/plain");
      const idsToMove = JSON.parse(data);
      if (Array.isArray(idsToMove) && idsToMove.length > 0) {
        handleMoveToLabel(targetLabelId, idsToMove);
      }
    } catch (err) {
      console.error("Invalid drop data");
    }
  };


  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="bg-white rounded-2xl shadow-xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden ring-1 ring-slate-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-600">
              <Tag className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Label Manager</h2>
              <p className="text-xs text-slate-500 font-medium">Fully manage and explore your custom labels</p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-200 rounded-full text-slate-500 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex flex-col sm:flex-row flex-1 overflow-hidden">
          {/* Sidebar */}
          <div className="w-full sm:w-64 border-r border-slate-100 bg-slate-50/30 overflow-y-auto flex-shrink-0">
            {loading ? (
              <div className="p-8 flex justify-center">
                <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
              </div>
            ) : labels.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-sm">
                No custom labels found.
              </div>
            ) : (
              <div className="p-3 flex flex-col gap-1">
                {labels.map(label => (
                  <button
                    key={label.id}
                    onClick={() => handleLabelClick(label)}
                    onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; }}
                    onDragEnter={() => setDragOverLabelId(label.id)}
                    onDragLeave={() => setDragOverLabelId(null)}
                    onDrop={(e) => handleDrop(e, label.id)}
                    className={cn(
                      "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all text-left w-full border border-transparent",
                      activeLabel?.id === label.id 
                        ? "bg-indigo-50 text-indigo-700 font-semibold shadow-sm ring-1 ring-indigo-200/50" 
                        : "text-slate-600 hover:bg-slate-100 font-medium",
                      dragOverLabelId === label.id && activeLabel?.id !== label.id && "bg-indigo-50 border-indigo-300 ring-2 ring-indigo-300 scale-[1.02]"
                    )}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <Folder className={cn("w-4 h-4 shrink-0", activeLabel?.id === label.id ? "text-indigo-500" : "text-slate-400")} />
                      <span className="truncate">{label.name}</span>
                    </div>
                    {label.messagesTotal !== undefined && (
                      <span className="text-[10px] font-bold bg-white/60 px-1.5 py-0.5 rounded text-slate-500 ml-2">
                        {label.messagesTotal}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Main Content */}
          <div className="flex-1 flex flex-col overflow-hidden bg-white">
            {activeLabel ? (
              <>
                <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <h3 className="text-xl font-bold text-slate-800">{activeLabel.name}</h3>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {activeLabel.messagesTotal || 0} total messages {activeLabel.messagesUnread ? `(${activeLabel.messagesUnread} unread)` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleDeleteLabel}
                      className="flex items-center gap-2 bg-rose-50 hover:bg-rose-100 text-rose-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors"
                      title="Delete this label entirely"
                    >
                      <Trash2 className="w-4 h-4" />
                      Delete Label
                    </button>
                    {aiSettings?.apiKey && (
                      <button
                        onClick={handleAnalyze}
                        disabled={analyzing || labelEmails.length === 0}
                        className="flex items-center gap-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-4 py-2 rounded-xl text-sm font-semibold transition-colors disabled:opacity-50"
                      >
                        {analyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                        AI Analysis
                      </button>
                    )}
                  </div>
                </div>

                <div className="px-4 sm:px-5 py-3 border-b border-slate-100 bg-slate-50/50">
                  <div className="relative">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      placeholder="Filter by sender, subject, or keywords..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all shadow-sm"
                    />
                  </div>
                </div>

                {aiAnalysis && (
                   <div className="mx-4 sm:mx-5 mt-4 p-4 bg-indigo-50/50 border border-indigo-100 rounded-xl relative">
                     <button onClick={() => setAiAnalysis('')} className="absolute top-3 right-3 text-indigo-400 hover:text-indigo-600"><X className="w-4 h-4" /></button>
                     <div className="flex items-start gap-3">
                       <Sparkles className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" />
                       <div className="text-sm text-indigo-900 leading-relaxed whitespace-pre-wrap">
                         <span className="font-semibold block mb-1">AI Label Insights</span>
                         {aiAnalysis}
                       </div>
                     </div>
                   </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 sm:p-5">
                  {loadingEmails ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                      <Loader2 className="w-8 h-8 animate-spin mb-4" />
                      <p className="text-sm font-medium">Loading emails in {activeLabel.name}...</p>
                    </div>
                  ) : labelEmails.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                      <Inbox className="w-12 h-12 mb-4 text-slate-300" />
                      <p className="text-sm font-medium">No emails found in this label.</p>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-3 relative">
                      <div className="flex items-center justify-between mb-1 sticky top-0 bg-white z-10 py-2 border-b border-slate-100">
                        <div className="flex items-center gap-3">
                          <div 
                            className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors shadow-sm cursor-pointer", labelEmails.length > 0 && selectedIds.size === labelEmails.length ? "bg-slate-800 border-slate-800" : "border-slate-300 bg-white hover:border-slate-400")}
                            onClick={() => {
                              if (selectedIds.size === labelEmails.length) {
                                setSelectedIds(new Set());
                              } else {
                                setSelectedIds(new Set(labelEmails.map(e => e.id)));
                              }
                            }}
                          >
                            {selectedIds.size === labelEmails.length && labelEmails.length > 0 && <CheckCircle className="w-3 h-3 text-white" />}
                          </div>
                          <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Recent Emails</h4>
                          {selectedIds.size > 0 && (
                            <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full font-semibold">
                              {selectedIds.size} selected
                            </span>
                          )}
                        </div>
                        {selectedIds.size > 0 && (
                          <div className="relative">
                            <button 
                              onClick={() => setShowMoveMenu(!showMoveMenu)}
                              className="flex items-center gap-1.5 text-xs font-semibold bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg shadow-sm transition-all"
                            >
                              <MoveRight className="w-3.5 h-3.5" />
                              Move to...
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                            {showMoveMenu && (
                              <>
                                <div className="fixed inset-0 z-10" onClick={() => setShowMoveMenu(false)} />
                                <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-xl shadow-lg border border-slate-100 py-1.5 z-20 max-h-64 overflow-y-auto">
                                  {labels.filter(l => l.id !== activeLabel.id).map(l => (
                                    <button
                                      key={l.id}
                                      onClick={() => handleMoveToLabel(l.id, Array.from(selectedIds))}
                                      className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 hover:text-indigo-600 transition-colors flex items-center gap-2 truncate"
                                    >
                                      <Folder className="w-4 h-4 shrink-0 opacity-50" />
                                      <span className="truncate">{l.name}</span>
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                      {labelEmails.map((email: any) => {
                        const isSelected = selectedIds.has(email.id);
                        return (
                          <div 
                            key={email.id} 
                            draggable
                            onDragStart={(e) => handleDragStart(e, email.id)}
                            onClick={() => {
                              setSelectedIds(prev => {
                                const next = new Set(prev);
                                if (next.has(email.id)) next.delete(email.id);
                                else next.add(email.id);
                                return next;
                              });
                            }}
                            className={cn(
                              "p-3 border rounded-xl transition-colors group cursor-pointer flex gap-3",
                              isSelected ? "bg-slate-50 border-slate-300 shadow-sm" : "border-slate-100 hover:border-slate-200 hover:bg-slate-50",
                              moving ? "opacity-50 pointer-events-none" : ""
                            )}
                          >
                            <div className="pt-0.5 shrink-0">
                              <div className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors", isSelected ? "bg-slate-800 border-slate-800" : "border-slate-300 bg-white")}>
                                {isSelected && <CheckCircle className="w-3 h-3 text-white" />}
                              </div>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-4 mb-1">
                                <span className="font-semibold text-slate-800 text-sm truncate">{email.sender.replace(/<.*>/, "").trim() || email.sender}</span>
                                <span className="text-xs text-slate-400 whitespace-nowrap">
                                  {(email.date instanceof Date && !isNaN(email.date.getTime()) ? email.date : new Date(email.date)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                </span>
                              </div>
                              <p className="text-sm font-medium text-slate-700 truncate">{email.subject}</p>
                              <p className="text-xs text-slate-500 truncate mt-1">{email.snippet}</p>
                            </div>
                          </div>
                        );
                      })}
                      
                      {pageToken && (
                        <div className="pt-2 flex justify-center">
                          <button
                            onClick={handleLoadMore}
                            disabled={loadingMore}
                            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-6 py-2.5 rounded-xl text-sm font-semibold shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                          >
                            {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />}
                            Load More
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="h-full flex items-center justify-center text-slate-400 p-6 text-center">
                <div>
                  <Tag className="w-12 h-12 mx-auto mb-4 text-slate-300" />
                  <p className="font-medium text-slate-600">Select a label</p>
                  <p className="text-sm mt-1">Choose a label from the sidebar to view and manage its contents.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
