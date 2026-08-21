import React, { useState, useEffect, FormEvent } from "react";
import { Mail, Search, CheckCircle, Clock, Trash2, Archive, LogOut, ChevronDown, Filter, Calendar, Loader2, Sparkles, Settings, Inbox, RefreshCw } from "lucide-react";
import { fetchGmailAPI, batchDeleteEmails, batchTrashEmails, batchArchiveEmails, batchMarkAsRead, processInChunks, EmailData } from "../lib/gmail";
import { InboxHealth } from "./InboxHealth";
import { cn } from "../lib/utils";

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function Dashboard({ user }: { user: any }) {
  const [query, setQuery] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [excludeSent, setExcludeSent] = useState(false);
  const [folderFilters, setFolderFilters] = useState<string[]>(["anywhere"]);
  const [userLabels, setUserLabels] = useState<any[]>([]);
  const [parsedQuery, setParsedQuery] = useState<{
    query: string;
    explanation: string;
    suggestedFolder?: string;
    suggestedGmailCategory?: string;
    operators?: any;
  } | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [emails, setEmails] = useState<EmailData[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<"date" | "size" | "sender">("date");
  const [sortDesc, setSortDesc] = useState(true);
  const todayStr = new Date().toISOString().split("T")[0];
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showHealth, setShowHealth] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [processingProgress, setProcessingProgress] = useState<{current: number, total: number} | null>(null);

  const [useAI, setUseAI] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [aiSettings, setAiSettings] = useState({ provider: 'gemini', model: 'gemini-1.5-flash', apiKey: '' });
  const [dynamicModels, setDynamicModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    async function fetchModels() {
      if (!aiSettings.provider) return;
      setLoadingModels(true);
      try {
        const res = await fetch('/api/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: aiSettings })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.models && data.models.length > 0) {
            setDynamicModels(data.models);
          } else {
            // Fallbacks
            if (aiSettings.provider === 'gemini') setDynamicModels(['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-2.5-flash']);
            if (aiSettings.provider === 'openai') setDynamicModels(['gpt-4o-mini', 'gpt-4o', 'o1-mini', 'o1', 'o3-mini']);
            if (aiSettings.provider === 'anthropic') setDynamicModels(['claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest']);
            if (aiSettings.provider === 'groq') setDynamicModels(['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']);
            if (aiSettings.provider === 'deepseek') setDynamicModels(['deepseek-chat', 'deepseek-reasoner']);
            if (aiSettings.provider === 'mistral') setDynamicModels(['mistral-small-latest', 'mistral-large-latest']);
            if (aiSettings.provider === 'zhipu') setDynamicModels(['glm-4-flash', 'glm-4-plus']);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingModels(false);
      }
    }
    if (showSettings) {
      fetchModels();
    }
  }, [aiSettings.provider, aiSettings.apiKey, showSettings]);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('adminAiSettings');
    if (saved) {
      try { 
        const parsed = JSON.parse(saved);
        setAiSettings({ provider: 'gemini', model: 'gemini-1.5-flash', apiKey: '', ...parsed });
        if (parsed.apiKey) setUseAI(true);
      } catch (e) {}
    }
  }, []);

  const saveSettings = (s: any) => {
    setAiSettings(s);
    localStorage.setItem('adminAiSettings', JSON.stringify(s));
    if (s.apiKey) setUseAI(true);
  };

  const handleSearch = async (e?: FormEvent, customQuery?: string, customFilters?: string[], bypassAI: boolean = false) => {
    if (e) e.preventDefault();
    const textQuery = customQuery ?? query;
    // Removed early return so we can load all emails initially
    
    setIsSearching(true);
    setEmails([]);
    setSelectedIds(new Set());
    setParsedQuery(null);
    setAiError(null);

    let finalQuery = textQuery;
    let actualFolderFilter = customFilters ?? folderFilters;

    if (useAI && textQuery.trim() && !bypassAI) {
      try {
        const aiRes = await fetch("/api/parse-query", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt: textQuery, settings: aiSettings })
        });
        const data = await aiRes.json();
        
        if (aiRes.status === 429) {
           setAiError("rate_limit");
           setUseAI(false);
        } else if (aiRes.status === 503) {
           setAiError("overloaded");
           setUseAI(false);
        } else if (!aiRes.ok) {
           setAiError("error");
           setUseAI(false);
        } else if (aiRes.ok && data) {
           setParsedQuery(data);
           finalQuery = data.query;
           if (data.suggestedFolder) {
             actualFolderFilter = [data.suggestedFolder];
           }
        }
      } catch (err) {
        console.error("Failed to parse query via AI", err);
      }
    }

    const parts = [finalQuery];
    
    if (!actualFolderFilter.includes('anywhere')) {
      const folderQueries = actualFolderFilter.map(f => {
        if (f.startsWith('category:')) return f;
        if (f === 'inbox') return 'in:inbox';
        if (f === 'spam') return 'in:spam';
        if (f === 'trash') return 'in:trash';
        return `label:${f.replace(/ /g, '-')}`;
      });
      if (folderQueries.length > 0) {
        parts.push(`(${folderQueries.join(' OR ')})`);
      }
    } else {
      parts.push('in:anywhere');
    }

    if (startDate) parts.push(`after:${startDate.replace(/-/g, '/')}`);
    if (endDate) parts.push(`before:${endDate.replace(/-/g, '/')}`);
    if (excludeSent) parts.push(`-in:sent`);

    const q = parts.filter(Boolean).join(" ");
    
    try {
      const results = await fetchGmailAPI(`/messages?q=${encodeURIComponent(q)}&maxResults=100`);
      if (results && results.messages) {
        const detailed = await processInChunks(results.messages, 15, async (msg: any) => {
          try {
            const detail = await fetchGmailAPI(`/messages/${msg.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`);
            const headers = detail.payload?.headers || [];
            return {
              id: detail.id,
              threadId: detail.threadId,
              snippet: detail.snippet,
              labelIds: detail.labelIds || [],
              sender: headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown',
              subject: headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)',
              date: new Date(headers.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date()),
              sizeEstimate: detail.sizeEstimate || 0
            };
          } catch (e) {
            return null;
          }
        });
        setEmails(detailed.filter(Boolean) as EmailData[]);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    fetchGmailAPI('/labels').then(data => {
      if (data && data.labels) setUserLabels(data.labels);
    });
    handleSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBulkAction = async (action: "trash" | "archive" | "read" | "delete") => {
    if (selectedIds.size === 0) return;
    
    setActionLoading(action);
    setProcessingProgress({ current: 0, total: selectedIds.size });
    const ids = Array.from(selectedIds) as string[];
    setProcessingIds(new Set(ids));
    
    try {
      if (action === "trash") await batchTrashEmails(ids);
      else if (action === "archive") await batchArchiveEmails(ids);
      else if (action === "read") await batchMarkAsRead(ids);
      else if (action === "delete") await batchDeleteEmails(ids);
      
      setEmails(emails.filter(e => !ids.includes(e.id)));
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
      setProcessingIds(new Set());
      setProcessingProgress(null);
    }
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const sortedEmails = [...emails].sort((a, b) => {
    let cmp = 0;
    if (sortBy === "date") cmp = a.date.getTime() - b.date.getTime();
    else if (sortBy === "size") cmp = (a.sizeEstimate || 0) - (b.sizeEstimate || 0);
    else if (sortBy === "sender") cmp = a.sender.localeCompare(b.sender);
    return sortDesc ? -cmp : cmp;
  });

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-800 text-white flex items-center justify-center font-bold">
            <Mail className="w-5 h-5" />
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-800">MailFlow</h1>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setShowHealth(!showHealth)}
            className={cn("px-4 py-2 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2", showHealth ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}
          >
            <Sparkles className="w-4 h-4" /> 
            <span className="hidden sm:inline">Inbox Health</span>
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            title="Model Configuration"
          >
            <Settings className="w-5 h-5" />
          </button>
          <div className="hidden md:flex items-center gap-2 text-sm text-slate-600 bg-slate-100 px-3 py-1.5 rounded-full font-medium">
            <img src={user.photoURL} alt="Profile" className="w-6 h-6 rounded-full" />
            {user.email}
          </div>
          <button onClick={() => window.location.reload()} className="p-2 text-slate-400 hover:text-slate-700 transition-colors" title="Log out">
            <LogOut className="w-5 h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto p-4 md:p-6 flex flex-col gap-6">
        {showHealth ? (
           <InboxHealth 
             aiSettings={aiSettings} 
             onApplyQuery={(q, filter) => {
               setQuery(q);
               let newFilters = ['anywhere'];
               if (filter) {
                 if (filter === 'inbox') newFilters = ['inbox'];
                 else if (filter.startsWith('category:')) newFilters = [filter];
                 else newFilters = [filter];
               }
               setFolderFilters(newFilters);
               setShowHealth(false);
               setTimeout(() => handleSearch(undefined, q, newFilters, true), 0);
             }} 
           />
        ) : (
        <>
        <div className="bg-white p-4 md:p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col gap-4">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input 
                type="text" 
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={useAI ? "Describe what you're looking for (e.g., 'newsletters from last week')" : "Search emails (e.g. from:boss@company.com)"}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:bg-white transition-all shadow-inner"
              />
            </div>
            <button 
              type="submit" 
              disabled={isSearching}
              className="bg-slate-800 hover:bg-slate-900 text-white px-6 py-3 rounded-xl font-medium transition-all shadow-sm disabled:opacity-70 disabled:cursor-wait flex items-center justify-center min-w-[120px]"
            >
              {isSearching ? <Loader2 className="w-5 h-5 animate-spin" /> : "Search"}
            </button>
          </form>

          {aiError && (
             <div className="bg-orange-50 border border-orange-200 text-orange-800 p-3 rounded-xl text-sm flex items-start gap-2">
               <Settings className="w-5 h-5 mt-0.5 shrink-0" />
               <div>
                 <p className="font-bold">
                    {aiError === "rate_limit" ? "Analysis Rate Limit Exceeded" : 
                     aiError === "overloaded" ? "AI Model Overloaded" : 
                     "Smart Search Failed"}
                 </p>
                 <p className="mt-1 opacity-90">
                    {aiError === "rate_limit" ? (
                      <>Your API key reached its quota. Smart features have been disabled for this search, falling back to standard Gmail search. To fix this, you can <button onClick={() => setShowSettings(true)} className="underline font-semibold hover:text-orange-900">update your API Key</button>.</>
                    ) : aiError === "overloaded" ? (
                      "The selected AI model is currently experiencing high demand. Smart features have been disabled for this search. Please try again later."
                    ) : (
                      "An error occurred while communicating with the AI provider. Smart features have been disabled for this search."
                    )}
                 </p>
               </div>
             </div>
          )}

          <div className="flex flex-wrap items-center gap-3 mt-2 overflow-x-auto pb-2 scrollbar-hide">
            <FolderMultiSelect selected={folderFilters} onChange={setFolderFilters} userLabels={userLabels} />
            <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>
            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-full px-3 py-1.5 focus-within:ring-2 focus-within:ring-slate-400 focus-within:bg-white transition-colors flex-shrink-0">
              <Calendar className="w-4 h-4 text-slate-400 mr-2" />
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} max={todayStr} className="bg-transparent text-sm text-slate-700 outline-none w-28" />
              <span className="text-slate-400 mx-2 text-sm">to</span>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} max={todayStr} className="bg-transparent text-sm text-slate-700 outline-none w-28" />
            </div>
            <label className="flex items-center gap-2 cursor-pointer group bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-full hover:bg-slate-100 transition-colors flex-shrink-0">
              <input type="checkbox" checked={excludeSent} onChange={e => setExcludeSent(e.target.checked)} className="rounded text-slate-600 focus:ring-slate-500 border-slate-300" />
              <span className="text-sm font-medium text-slate-700 group-hover:text-slate-900">Exclude Sent</span>
            </label>
          </div>
        </div>

        {parsedQuery && (
          <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 flex gap-3 text-sm animate-in fade-in slide-in-from-top-2">
            <Sparkles className="w-5 h-5 text-slate-600 shrink-0" />
            <div>
              <p className="font-medium text-slate-800">Smart Query Interpretation</p>
              <p className="text-slate-600 mt-1">{parsedQuery.explanation}</p>
              <p className="mt-2 text-xs font-mono bg-slate-200 inline-block px-2 py-1 rounded text-slate-700">Gmail Search: {parsedQuery.query}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col flex-1 overflow-hidden">
          <div className="border-b border-slate-200 p-3 bg-slate-50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <button 
                onClick={() => setSelectedIds(selectedIds.size === emails.length ? new Set() : new Set(emails.map(e => e.id)))}
                className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors"
                disabled={emails.length === 0}
              >
                <div className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors", selectedIds.size > 0 ? "bg-slate-800 border-slate-800" : "border-slate-300")}>
                  {selectedIds.size > 0 && <CheckCircle className="w-3 h-3 text-white" />}
                </div>
              </button>
              <span className="text-sm font-semibold text-slate-700">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : `${emails.length} emails`}
              </span>
            </div>
            
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-slate-100 rounded-lg p-1 mr-2">
                 <select value={sortBy} onChange={(e: any) => setSortBy(e.target.value)} className="bg-transparent text-sm font-medium text-slate-700 outline-none px-2 cursor-pointer">
                   <option value="date">Date</option>
                   <option value="size">Size</option>
                   <option value="sender">Sender</option>
                 </select>
                 <button onClick={() => setSortDesc(!sortDesc)} className="p-1 hover:bg-slate-200 rounded text-slate-500">
                    <Filter className={cn("w-4 h-4 transition-transform", !sortDesc && "rotate-180")} />
                 </button>
              </div>
              <ActionButton icon={<Trash2 className="w-4 h-4" />} label="Trash" onClick={() => handleBulkAction("trash")} disabled={selectedIds.size === 0 || actionLoading !== null} loading={actionLoading === "trash"} className="text-rose-600 hover:bg-rose-50" />
              <ActionButton icon={<Archive className="w-4 h-4" />} label="Archive" onClick={() => handleBulkAction("archive")} disabled={selectedIds.size === 0 || actionLoading !== null} loading={actionLoading === "archive"} />
              <ActionButton icon={<CheckCircle className="w-4 h-4" />} label="Mark Read" onClick={() => handleBulkAction("read")} disabled={selectedIds.size === 0 || actionLoading !== null} loading={actionLoading === "read"} />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {emails.length === 0 ? (
              isSearching ? (
                <div className="flex flex-col items-center justify-center h-96 text-slate-400 px-4 text-center">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                    <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-700 mb-2">Loading messages...</h3>
                  <p className="text-sm text-slate-500 max-w-sm mb-6">
                    Fetching your emails from Gmail.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-96 text-slate-400 px-4 text-center">
                  <div className="w-20 h-20 bg-slate-100 rounded-full flex items-center justify-center mb-6">
                    <Search className="w-10 h-10 text-slate-400" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-700 mb-2">No messages found</h3>
                  <p className="text-sm text-slate-500 max-w-sm mb-6">
                    We couldn't find any emails matching your current search and filters.
                  </p>
                  {(query || (folderFilters.length > 0 && !folderFilters.includes('anywhere'))) && (
                    <button 
                      onClick={() => {
                        setQuery('');
                        setFolderFilters(['anywhere']);
                        setTimeout(() => handleSearch(undefined, '', ['anywhere']), 0);
                      }}
                      className="flex items-center gap-2 bg-slate-100 hover:bg-slate-200 text-slate-700 px-5 py-2.5 rounded-lg text-sm font-medium transition-all shadow-sm"
                    >
                      Clear Filters
                    </button>
                  )}
                </div>
              )
            ) : (
              <ul className="divide-y divide-slate-100">
                {sortedEmails.map(email => {
                  const isSelected = selectedIds.has(email.id);
                  const isProcessing = processingIds.has(email.id);
                  return (
                    <li 
                      key={email.id} 
                      className={cn(
                        "flex items-start gap-4 p-4 hover:bg-slate-50 transition-colors group cursor-pointer",
                        isSelected ? "bg-slate-50/50" : "",
                        isProcessing ? "opacity-50 grayscale" : ""
                      )}
                      onClick={() => !isProcessing && toggleSelect(email.id)}
                    >
                      <div className="pt-1">
                        <div className={cn("w-5 h-5 rounded border flex items-center justify-center transition-colors", isSelected ? "bg-slate-800 border-slate-800" : "border-slate-300 bg-white")}>
                          {isSelected && <CheckCircle className="w-3.5 h-3.5 text-white" />}
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-4 mb-1">
                          <span className="font-semibold text-slate-900 truncate" title={email.sender}>
                            {email.sender.replace(/<.*>/, "").trim() || email.sender}
                          </span>
                          <div className="flex items-center gap-3 shrink-0">
                            {email.sizeEstimate > 102400 && (
                               <span className="text-xs font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                                 {formatSize(email.sizeEstimate)}
                               </span>
                            )}
                            <span className="text-xs font-medium text-slate-500 tabular-nums">
                              {email.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm font-medium text-slate-800 truncate">{email.subject}</p>
                        <p className="text-sm text-slate-500 truncate mt-0.5">{email.snippet}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
        </>
        )}
      </main>

      {showSettings && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4"
          onClick={() => setShowSettings(false)}
        >
          <div 
            className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-slate-800" />
                <h2 className="font-bold text-slate-800">Bring Your Own Key (BYOK)</h2>
              </div>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600 font-bold text-xl leading-none">&times;</button>
            </div>
            <div className="p-4 sm:p-6 flex flex-col gap-5 overflow-y-auto">
              
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm text-slate-700">
                <div className="flex items-center justify-between mb-3">
                  <span className="font-bold">1. Select Model Provider</span>
                  <button 
                    onClick={() => {
                       const p = aiSettings.provider;
                       if (p === 'gemini') saveSettings({...aiSettings, model: 'gemini-1.5-flash'});
                       if (p === 'openai') saveSettings({...aiSettings, model: 'gpt-4o-mini'});
                       if (p === 'anthropic') saveSettings({...aiSettings, model: 'claude-3-5-haiku-20241022'});
                       if (p === 'groq') saveSettings({...aiSettings, model: 'llama-3.1-8b-instant'});
                       if (p === 'deepseek') saveSettings({...aiSettings, model: 'deepseek-chat'});
                       if (p === 'zhipu') saveSettings({...aiSettings, model: 'glm-4-flash'});
                       if (p === 'mistral') saveSettings({...aiSettings, model: 'mistral-small-latest'});
                    }}
                    className="text-xs font-semibold text-slate-600 bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded transition-colors"
                  >
                    Auto-select fastest/cheapest model
                  </button>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                  {['gemini', 'openai', 'anthropic', 'groq', 'deepseek', 'zhipu', 'mistral'].map(p => (
                    <button
                      key={p}
                      onClick={() => saveSettings({...aiSettings, provider: p})}
                      className={`px-3 py-2 rounded-lg border text-sm font-medium capitalize ${aiSettings.provider === p ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                    >
                      {p === 'zhipu' ? 'Zhipu (GLM)' : p}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-1 mb-4">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Model</label>
                  <input
                    type="text"
                    list="model-suggestions"
                    value={aiSettings.model}
                    onChange={e => saveSettings({...aiSettings, model: e.target.value})}
                    placeholder={aiSettings.provider === 'zhipu' ? 'e.g. glm-4' : 'e.g. gemini-1.5-flash'}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-sm focus:ring-slate-500 focus:border-slate-500 outline-none"
                  />
                  <datalist id="model-suggestions">
                    {dynamicModels.map(m => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
                
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-bold text-slate-500 uppercase tracking-wider">Get API Key</label>
                  <a 
                    href={
                      aiSettings.provider === 'gemini' ? 'https://aistudio.google.com/app/apikey' : 
                      aiSettings.provider === 'openai' ? 'https://platform.openai.com/api-keys' : 
                      aiSettings.provider === 'anthropic' ? 'https://console.anthropic.com/settings/keys' : 
                      aiSettings.provider === 'groq' ? 'https://console.groq.com/keys' : 
                      aiSettings.provider === 'zhipu' ? 'https://open.bigmodel.cn/usercenter/apikeys' :
                      aiSettings.provider === 'mistral' ? 'https://console.mistral.ai/api-keys/' :
                      'https://platform.deepseek.com/api_keys'
                    }
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="inline-block bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-medium px-3 py-2 rounded-lg transition-colors text-xs text-center shadow-sm"
                  >
                    Get {aiSettings.provider === 'zhipu' ? 'Zhipu (GLM)' : aiSettings.provider} API Key &rarr;
                  </a>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-2">2. Paste Your API Key</label>
                <input
                  type="password"
                  value={aiSettings.apiKey}
                  onChange={e => saveSettings({...aiSettings, apiKey: e.target.value})}
                  placeholder="sk-..."
                  className="w-full border border-slate-300 rounded-lg px-4 py-3 text-sm focus:ring-slate-500 focus:border-slate-500 outline-none shadow-sm"
                />
                <p className="text-xs text-slate-500 mt-2 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-slate-400" /> Stored securely in your browser's local storage.
                </p>
              </div>
            </div>
            <div className="p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-3">
              <button onClick={() => setShowSettings(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-200 font-medium rounded-lg text-sm transition-colors">
                Cancel
              </button>
              <button onClick={() => {
                setShowSettings(false);
                if (aiSettings.apiKey) {
                   if (!showHealth) {
                     handleSearch(undefined, query);
                   } else {
                     window.location.reload();
                   }
                }
              }} className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-lg text-sm transition-colors shadow-sm">
                Save & Retry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ActionButton({ icon, label, onClick, disabled, loading, className }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
        disabled ? "opacity-60 cursor-not-allowed grayscale" : "",
        className || (disabled ? "text-slate-400" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900")
      )}
      title={label}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function FolderMultiSelect({ selected, onChange, userLabels }: { selected: string[], onChange: (s: string[]) => void, userLabels: any[] }) {
  const [open, setOpen] = useState(false);
  
  const options = [
    { value: 'anywhere', label: 'All Mail' },
    { value: 'inbox', label: 'Inbox' },
    { value: 'category:primary', label: 'Primary' },
    { value: 'category:promotions', label: 'Promotions' },
    { value: 'category:social', label: 'Social' },
    { value: 'category:updates', label: 'Updates' },
    { value: 'category:forums', label: 'Forums' },
    ...userLabels.filter(l => l.type === 'user').map(l => ({ value: l.name, label: l.name })),
    { value: 'spam', label: 'Spam' },
    { value: 'trash', label: 'Trash' }
  ];

  const toggle = (val: string) => {
    if (val === 'anywhere') {
      onChange(['anywhere']);
      return;
    }
    let next = selected.filter(x => x !== 'anywhere');
    if (next.includes(val)) {
      next = next.filter(x => x !== val);
    } else {
      next.push(val);
    }
    if (next.length === 0) next = ['anywhere'];
    onChange(next);
  };

  const label = selected.includes('anywhere') ? 'All Mail' : selected.length === 1 ? options.find(o => o.value === selected[0])?.label : `${selected.length} Folders`;

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(!open)} className="bg-slate-50 border border-slate-200 rounded-md px-3 py-1.5 text-sm text-slate-700 font-medium flex items-center gap-2 hover:bg-slate-100 transition-colors">
        {label}
        <ChevronDown className="w-4 h-4 text-slate-400" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-96 overflow-y-auto py-1">
            {options.map(opt => (
              <label key={opt.value} className="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm">
                <input 
                  type="checkbox" 
                  checked={selected.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  className="rounded border-slate-300 text-slate-700 focus:ring-slate-500"
                />
                <span className="text-slate-700 truncate">{opt.label}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
