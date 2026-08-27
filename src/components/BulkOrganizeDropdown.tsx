import { motion, AnimatePresence } from 'motion/react';
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Layers, FolderPlus, Tag, Check, Loader2, X, AlertCircle, BarChart2, Trash2, Archive, SlidersHorizontal } from 'lucide-react';
import { cn } from '../lib/utils';
import { batchModifyEmails, createLabel, batchTrashEmails, batchArchiveEmails } from '../lib/gmail';
import { Search, ChevronDown, ChevronUp } from 'lucide-react';

interface Props {
  selectedIds: Set<string>;
  emails: any[];
  userLabels: any[];
  aiSettings?: any;
  onComplete: () => void;
  disabled?: boolean;
  className?: string;
}

export function BulkOrganizeDropdown({ selectedIds, emails, userLabels, aiSettings, onComplete, disabled, className }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'menu' | 'manual' | 'ai' | 'smart' | 'applying'>('menu');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());

  
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (aiSettings?.apiKey) {
      const cached = sessionStorage.getItem('ai_quota_ok');
      if (cached === 'false') {
        setAiAvailable(false);
      } else {
        setAiAvailable(true);
      }
    } else {
      setAiAvailable(false);
    }
  }, [aiSettings?.apiKey]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      setTimeout(() => {
        setMode('menu');
        setSuggestions([]);
        setError(null);
      }, 200);
    }
  }, [isOpen]);

  const selectedEmailsData = emails.filter(e => selectedIds.has(e.id));

  const applyLabel = async (labelName: string, targetIds: string[]) => {
    executeAction('label', targetIds, labelName);
  };

  const executeAction = async (action: 'trash' | 'archive' | 'label', targetIds: string[], labelName?: string) => {
    try {
      setLoading(true);
      setMode('applying');
      
      const allMessageIds: string[] = [];
      targetIds.forEach(tid => {
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
      } else if (action === 'label' && labelName) {
        let labelId = userLabels.find(l => l.name.toLowerCase() === labelName.toLowerCase())?.id;
        
        if (!labelId) {
          const newLabel = await createLabel(labelName);
          if (newLabel && newLabel.id) {
            labelId = newLabel.id;
          } else {
            throw new Error("Could not create label");
          }
        }
        
        if (labelId) {
          await batchModifyEmails(allMessageIds, [labelId], []);
        }
      }
      
      onComplete();
      setIsOpen(false);
    } catch (err: any) {
      setError(err.message || "Failed to execute action");
      setMode('menu');
    } finally {
      setLoading(false);
    }
  };

  const handleManualApply = (labelId: string) => {
    applyLabel(userLabels.find(l => l.id === labelId)?.name || '', Array.from(selectedIds));
  };

  const handleSmartOrganize = () => {
    setMode('smart');
    setLoading(true);
    setError(null);
    
    setTimeout(() => {
      try {
        const senderMap = new Map<string, string[]>();
        const outliers: string[] = [];
        
        selectedEmailsData.forEach(e => {
          const rawSender = e.sender || '';
          let name = rawSender.split('<')[0].replace(/"/g, '').trim();
          
          if (!name) {
            const match = rawSender.match(/<([^>]+)>/);
            const emailAddr = match ? match[1] : rawSender;
            name = emailAddr.includes('@') ? emailAddr.split('@')[1].split('.')[0] : 'unknown';
          }
          
          if (!senderMap.has(name)) senderMap.set(name, []);
          senderMap.get(name)!.push(e.id);
        });
        
        // Real Data Analytics: Statistical Distribution
        const senderCounts = Array.from(senderMap.values()).map(arr => arr.length);
        const meanCount = senderCounts.length ? senderCounts.reduce((a, b) => a + b, 0) / senderCounts.length : 0;
        const stdDevCount = senderCounts.length ? Math.sqrt(senderCounts.reduce((a, b) => a + Math.pow(b - meanCount, 2), 0) / senderCounts.length) : 0;
        
        // Minimum threshold is 3, or the mathematical outlier limit (+1 std dev)
        const minSamplePercent = Math.max(3, Math.ceil(selectedEmailsData.length * 0.05));
        const anomalyThreshold = Math.max(minSamplePercent, Math.ceil(meanCount + stdDevCount));

        const recs: any[] = [];
        
        senderMap.forEach((ids, name) => {
          if (ids.length >= anomalyThreshold && name.toLowerCase() !== 'unknown') {
             recs.push({
               title: name,
               suggestedLabel: name,
               emailIds: ids,
               reason: `Data Anomaly: ${ids.length} emails from ${name} exceeds the statistical mean distribution (+1σ) in this selection.`
             });
          } else {
             outliers.push(...ids);
          }
        });
        
        recs.sort((a, b) => b.emailIds.length - a.emailIds.length);
        
        if (outliers.length > 0) {
          recs.push({
            title: 'Outliers & One-Offs',
            suggestedLabel: 'Misc',
            emailIds: outliers,
            reason: `Data analytics detected ${outliers.length} one-off or isolated senders in this batch.`
          });
        }
        
        setSuggestions(recs);
      } catch (err: any) {
        setError("Failed to run local analytics");
      } finally {
        setLoading(false);
      }
    }, 500); // Simulate brief processing for UX
  };

  const handleAIOrganize = async () => {
    try {
      setMode('ai');
      setLoading(true);
      setError(null);
      
      const payload = {
        emails: selectedEmailsData.map(e => ({ id: e.id, sender: e.sender, subject: e.subject })),
        userLabels: userLabels.map(l => ({ id: l.id, name: l.name }))
      };
      
      const res = await fetch('/api/suggest-labels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        if (res.status === 429) {
           setAiAvailable(false);
           throw new Error("AI limit reached or API key invalid. Please check your settings.");
        }
        throw new Error("Failed to get AI suggestions");
      }
      
      const data = await res.json();
      const recs = (data.recommendations || []).map((r: any) => ({
        ...r,
        title: r.suggestedLabel
      }));
      setSuggestions(recs);
    } catch (err: any) {
      setError(err.message || "Failed to organize with AI");
    } finally {
      setLoading(false);
    }
  };

  const renderContent = () => (
    <>
      {mode === 'menu' && (
        <div className="p-2 flex flex-col gap-1">
          <button
            onClick={() => setMode('manual')}
            className="flex items-center gap-3 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md transition-colors text-left"
          >
            <Tag className="w-4 h-4 text-slate-500 shrink-0" />
            <div className="flex flex-col">
              <span className="font-medium">Categorize with existing label</span>
              <span className="text-xs text-slate-500">Select a Gmail label to apply to all selected emails</span>
            </div>
          </button>
          
          <button
            onClick={handleSmartOrganize}
            className="flex items-center gap-3 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md transition-colors text-left font-medium"
          >
            <BarChart2 className="w-4 h-4 text-slate-500" />
            <span>Group by Senders (Analytics)</span>
          </button>
          
          {aiAvailable && (
            <button
              onClick={handleAIOrganize}
              className="flex items-center gap-3 w-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 rounded-md transition-colors text-left font-medium"
            >
              <Layers className="w-4 h-4 text-slate-500" />
              <span>Deep Pattern Categorization</span>
            </button>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <div className="p-2 max-h-64 overflow-y-auto">
          <div className="flex items-center gap-2 mb-2 px-2 py-1">
            <button onClick={() => setMode('menu')} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Select Label</span>
          </div>
          <div className="flex flex-col gap-1">
            {userLabels.filter(l => l.type === 'user').map(label => (
              <button
                key={label.id}
                onClick={() => handleManualApply(label.id)}
                className="flex items-center w-full px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100 rounded-md text-left truncate"
              >
                {label.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {(mode === 'ai' || mode === 'smart') && (
        <div className="p-3">
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
              {mode === 'ai' ? <Layers className="w-4 h-4 text-slate-600" /> : <BarChart2 className="w-4 h-4 text-slate-600" />}
              {mode === 'ai' ? 'Categorization Suggestions' : 'Sender Groups'}
            </span>
            <button onClick={() => setMode('menu')} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-6 gap-3">
              <Loader2 className="w-6 h-6 animate-spin text-slate-600" />
              <span className="text-xs text-slate-500">Analyzing selected emails...</span>
            </div>
          ) : error ? (
            <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm flex gap-2 items-start">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="flex flex-col gap-3 max-h-[60vh] sm:max-h-80 overflow-y-auto p-1">
              {suggestions.map((rec, idx) => (
                <div key={idx} className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold text-sm text-slate-800">{rec.title}</div>
                      <div className="text-xs text-slate-500 mt-0.5">{rec.emailIds.length} emails</div>
                    </div>
                  </div>
                  <p className="text-xs text-slate-600 leading-snug">{rec.reason}</p>
                  <div className="flex flex-col w-full mt-1 mb-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setExpandedIndices(prev => {
                          const next = new Set(prev);
                          if (next.has(idx)) next.delete(idx);
                          else next.add(idx);
                          return next;
                        });
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors self-start"
                    >
                      {expandedIndices.has(idx) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      <span>{expandedIndices.has(idx) ? 'Hide emails' : `Review ${rec.emailIds.length} emails`}</span>
                    </button>
                    <AnimatePresence>
                      {expandedIndices.has(idx) && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden w-full mt-2"
                        >
                          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto custom-scrollbar pr-1 border border-slate-200 rounded-lg bg-white p-1">
                            {rec.emailIds.map((id: string) => {
                              const email = emails.find(e => e.id === id);
                              if (!email) return null;
                              const isDeselected = (rec.deselectedEmailIds || []).includes(id);
                              return (
                                <div key={id} className={cn("flex items-start gap-2 p-1.5 rounded-md group transition-colors", isDeselected ? "opacity-50" : "bg-slate-50 border border-slate-100 shadow-2xs hover:border-slate-200")}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setSuggestions(prev => prev.map((r, i) => {
                                        if (i !== idx) return r;
                                        const deselected = new Set(r.deselectedEmailIds || []);
                                        if (deselected.has(id)) deselected.delete(id);
                                        else deselected.add(id);
                                        return { ...r, deselectedEmailIds: Array.from(deselected) };
                                      }));
                                    }}
                                    className="mt-0.5 shrink-0 text-slate-400 hover:text-indigo-600 transition-colors"
                                  >
                                    {isDeselected ? <div className="w-3.5 h-3.5 rounded border border-slate-300" /> : <Check className="w-3.5 h-3.5 text-indigo-600" />}
                                  </button>
                                  <div className="flex-1 min-w-0">
                                    <p className={cn("text-[11px] font-medium truncate", isDeselected ? "text-slate-500 line-through" : "text-slate-700")}>{email.subject || '(No Subject)'}</p>
                                    <p className="text-[10px] text-slate-500 truncate">{email.sender}</p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                  <div className="flex flex-col gap-2 mt-2">
                    <button
                      onClick={() => executeAction('label', rec.emailIds.filter((id: string) => !(rec.deselectedEmailIds || []).includes(id)), rec.suggestedLabel)}
                      className="w-full flex justify-center items-center gap-1.5 px-3 py-2 text-xs font-medium text-white border border-slate-800 bg-slate-800 hover:bg-slate-900 rounded shadow-xs transition-colors"
                    >
                      <Tag className="w-3.5 h-3.5 shrink-0" /> Label as "{rec.suggestedLabel}"
                    </button>
                    <div className="flex gap-2">
                      <button
                        onClick={() => executeAction('trash', rec.emailIds.filter((id: string) => !(rec.deselectedEmailIds || []).includes(id)))}
                        className="flex-1 flex justify-center items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium bg-white border border-rose-200 text-rose-600 hover:bg-rose-50 rounded shadow-2xs transition-colors"
                      >
                        <Trash2 className="w-3 h-3" /> Trash
                      </button>
                      <button
                        onClick={() => executeAction('archive', rec.emailIds.filter((id: string) => !(rec.deselectedEmailIds || []).includes(id)))}
                        className="flex-1 flex justify-center items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium bg-white border border-slate-200 text-slate-600 hover:bg-slate-50 rounded shadow-2xs transition-colors"
                      >
                        <Archive className="w-3 h-3" /> Archive
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              {suggestions.length === 0 && (
                <div className="text-sm text-slate-500 py-4 text-center">No clear patterns found.</div>
              )}
            </div>
          )}
        </div>
      )}

      {mode === 'applying' && (
         <div className="flex flex-col items-center justify-center py-8 gap-3">
           <Loader2 className="w-6 h-6 text-slate-600 animate-spin" />
           <span className="text-sm text-slate-600 font-medium">Applying labels...</span>
         </div>
      )}
      
      
    </>
  );

  return (
    <div className={cn("relative inline-block text-left", className)} ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled || loading}
        className={cn(
          "flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs sm:text-sm font-semibold rounded-lg transition-colors w-full h-full cursor-pointer",
          "text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 shadow-2xs",
          (disabled || loading) && "opacity-50 cursor-not-allowed"
        )}
        title="Organize selected emails"
      >
        <FolderPlus className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-600" />
        <span>Organize</span>
      </button>

      {isOpen && (
        <>
          {/* Mobile Overlay & Modal */}
          <div className="sm:hidden fixed inset-0 z-[100]">
            <div className="absolute inset-0 bg-slate-900/40" onClick={(e) => { e.stopPropagation(); setIsOpen(false); }} />
            <div className="absolute inset-0 m-auto w-[calc(100vw-2rem)] max-w-[380px] h-fit max-h-[85vh] bg-white rounded-xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden">
              {renderContent()}
            </div>
          </div>

          {/* Desktop Dropdown */}
          <div className="hidden sm:flex absolute right-0 mt-2 w-96 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 flex-col max-h-[85vh] overflow-hidden origin-top-right">
            {renderContent()}
          </div>
        </>
      )}
    </div>
  );
}
