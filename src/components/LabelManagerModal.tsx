import React, { useState, useEffect } from 'react';
import { X, Tag, Loader2, Sparkles, Folder, Inbox } from 'lucide-react';
import { fetchGmailAPI, searchEmails } from '../lib/gmail';
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

  const handleLabelClick = async (label: any) => {
    setActiveLabel(label);
    setLoadingEmails(true);
    setAiAnalysis('');
    try {
      // Fetch some emails for this label
      const emails = await searchEmails(`label:${label.id}`, 20);
      setLabelEmails(emails);
    } catch (e) {
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
                    className={cn(
                      "flex items-center justify-between px-3 py-2.5 rounded-lg text-sm transition-all text-left w-full",
                      activeLabel?.id === label.id 
                        ? "bg-indigo-50 text-indigo-700 font-semibold shadow-sm ring-1 ring-indigo-200/50" 
                        : "text-slate-600 hover:bg-slate-100 font-medium"
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
                    <div className="flex flex-col gap-3">
                      <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Recent Emails</h4>
                      {labelEmails.map((email: any) => (
                        <div key={email.id} className="p-3 border border-slate-100 rounded-xl hover:border-slate-200 hover:bg-slate-50 transition-colors group cursor-default">
                          <div className="flex items-center justify-between gap-4 mb-1">
                            <span className="font-semibold text-slate-800 text-sm truncate">{email.sender.replace(/<.*>/, "").trim() || email.sender}</span>
                            <span className="text-xs text-slate-400 whitespace-nowrap">
                              {(email.date instanceof Date && !isNaN(email.date.getTime()) ? email.date : new Date(email.date)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                          <p className="text-sm font-medium text-slate-700 truncate">{email.subject}</p>
                          <p className="text-xs text-slate-500 truncate mt-1">{email.snippet}</p>
                        </div>
                      ))}
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
