import React, { useState, useEffect, useMemo, useRef, FormEvent } from "react";
import { Mail, Search, CheckCircle, Clock, Trash2, Archive, LogOut, ChevronDown, Filter, Calendar, Loader2, Sparkles, Settings, Inbox, RefreshCw, ShieldAlert } from "lucide-react";
import { fetchGmailAPI, batchDeleteEmails, batchTrashEmails, batchArchiveEmails, batchMarkAsRead, processInChunks, countEmails, EmailData } from "../lib/gmail";
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
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [totalCount, setTotalCount] = useState<number | string | null>(null);
  const [isCounting, setIsCounting] = useState(false);
  const [lastExecutedQuery, setLastExecutedQuery] = useState("");
  const searchIdRef = useRef(0);
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
    
    const searchId = ++searchIdRef.current;
    setIsSearching(true);
    setEmails([]);
    setSelectedIds(new Set());
    setNextPageToken(null);
    setTotalCount(null);
    setParsedQuery(null);
    setAiError(null);
    setIsCounting(true);

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
      if (!finalQuery.toLowerCase().includes('in:trash')) {
        parts.push('-in:trash');
      }
    }

    if (startDate) parts.push(`after:${startDate.replace(/-/g, '/')}`);
    if (endDate) parts.push(`before:${endDate.replace(/-/g, '/')}`);
    if (excludeSent) parts.push(`-in:sent`);

    const q = parts.filter(Boolean).join(" ");
    setLastExecutedQuery(q);

    // Concurrently trigger exact total count calculation up to 5,000 cap
    countEmails(q)
      .then(count => {
        if (searchIdRef.current === searchId) {
          setTotalCount(count);
        }
      })
      .catch(err => {
        console.error("Failed to count emails", err);
        if (searchIdRef.current === searchId) {
          setTotalCount(0);
        }
      })
      .finally(() => {
        if (searchIdRef.current === searchId) {
          setIsCounting(false);
        }
      });
    
    try {
      const results = await fetchGmailAPI(`/messages?q=${encodeURIComponent(q)}&maxResults=100`);
      if (searchIdRef.current !== searchId) return;

      if (results && results.messages && results.messages.length > 0) {
        setNextPageToken(results.nextPageToken || null);
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
        if (searchIdRef.current === searchId) {
          setEmails(detailed.filter(Boolean) as EmailData[]);
        }
      } else {
        setEmails([]);
        setNextPageToken(null);
      }
    } catch (err) {
      console.error(err);
      if (searchIdRef.current === searchId) {
        setEmails([]);
        setNextPageToken(null);
      }
    } finally {
      if (searchIdRef.current === searchId) {
        setIsSearching(false);
      }
    }
  };

  const handleLoadMore = async () => {
    if (!nextPageToken || isLoadingMore) return;
    setIsLoadingMore(true);
    const currentToken = nextPageToken;

    try {
      const results = await fetchGmailAPI(`/messages?q=${encodeURIComponent(lastExecutedQuery)}&maxResults=100&pageToken=${encodeURIComponent(currentToken)}`);
      if (results && results.messages && results.messages.length > 0) {
        setNextPageToken(results.nextPageToken || null);
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
        const validDetails = detailed.filter(Boolean) as EmailData[];
        setEmails(prev => {
          const existingIds = new Set(prev.map(e => e.id));
          const uniqueNew = validDetails.filter(e => !existingIds.has(e.id));
          return [...prev, ...uniqueNew];
        });
      } else {
        setNextPageToken(null);
      }
    } catch (err) {
      console.error("Error loading more emails", err);
    } finally {
      setIsLoadingMore(false);
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
      else if (action === "delete") {
        // Permanent delete - only available from trash view, with user confirmation
        const confirmed = window.confirm(
          `⚠️ PERMANENT DELETE\n\nYou are about to permanently delete ${ids.length} email(s). This action cannot be undone and the emails cannot be recovered.\n\nAre you sure you want to proceed?`
        );
        if (!confirmed) {
          setActionLoading(null);
          setProcessingIds(new Set());
          setProcessingProgress(null);
          return;
        }
        await batchDeleteEmails(ids);
      }
      
      // Optimistically remove processed emails from the UI to reflect changes instantly
      if (action !== "read") {
        setEmails(prev => prev.filter(e => !ids.includes(e.id)));
        setTotalCount(prev => typeof prev === 'number' ? Math.max(0, prev - ids.length) : prev);
      }
      
      // Clear selected state
      setSelectedIds(new Set());
      
      // Silently refresh the search in the background (Gmail index takes a few seconds)
      setTimeout(() => handleSearch(), 2000);
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

  const sortedEmails = useMemo(() => {
    return [...emails].sort((a, b) => {
      let cmp = 0;
      if (sortBy === "date") {
        const timeA = a.date instanceof Date && !isNaN(a.date.getTime()) 
          ? a.date.getTime() 
          : (!isNaN(new Date(a.date).getTime()) ? new Date(a.date).getTime() : 0);
        const timeB = b.date instanceof Date && !isNaN(b.date.getTime()) 
          ? b.date.getTime() 
          : (!isNaN(new Date(b.date).getTime()) ? new Date(b.date).getTime() : 0);
        cmp = timeA - timeB;
      } else if (sortBy === "size") {
        const sizeA = Number(a.sizeEstimate) || 0;
        const sizeB = Number(b.sizeEstimate) || 0;
        cmp = sizeA - sizeB;
      } else if (sortBy === "sender") {
        const senderA = (a.sender || '').toLowerCase().trim();
        const senderB = (b.sender || '').toLowerCase().trim();
        cmp = senderA.localeCompare(senderB);
      }
      return sortDesc ? -cmp : cmp;
    });
  }, [emails, sortBy, sortDesc]);

  return (
    <div className={cn("min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col", !showHealth && "h-screen overflow-hidden")}>
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-800 text-white flex items-center justify-center font-bold shrink-0">
            <Mail className="w-5 h-5" />
          </div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-800">MailFlow</h1>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button 
            onClick={() => setShowHealth(!showHealth)}
            className={cn("p-2 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors flex items-center gap-1.5 sm:gap-2", showHealth ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}
            title="Inbox Health"
          >
            <Sparkles className="w-4 h-4 shrink-0" /> 
            <span className="hidden sm:inline">Inbox Health</span>
          </button>
          <button 
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            title="Model Configuration"
          >
            <Settings className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
          {user.photoURL ? (
            <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-100 p-1 sm:px-3 sm:py-1.5 rounded-full font-medium" title={user.email}>
              <img src={user.photoURL} alt="Profile" className="w-6 h-6 rounded-full" />
              <span className="hidden md:inline text-xs">{user.email}</span>
            </div>
          ) : null}
          <button onClick={() => window.location.reload()} className="p-2 text-slate-400 hover:text-slate-700 transition-colors" title="Log out">
            <LogOut className="w-4 h-4 sm:w-5 sm:h-5" />
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto p-4 md:p-6 flex flex-col gap-6 min-h-0">
        {showHealth ? (
           <InboxHealth 
             aiSettings={aiSettings} 
             onApplyQuery={(q, filter) => {
               setQuery(q);
               let newFilters = ['anywhere'];
               if (filter) {
                 if (filter === 'spam+trash') newFilters = ['spam', 'trash'];
                 else if (filter === 'inbox') newFilters = ['inbox'];
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
        <div className="bg-white p-3.5 sm:p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col gap-3 sm:gap-4">
          <form onSubmit={handleSearch} className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4 sm:w-5 sm:h-5" />
              <input 
                type="text" 
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder={useAI ? "Describe what you're looking for (e.g., 'newsletters from last week')" : "Search emails (e.g. from:boss@company.com)"}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-9 sm:pl-10 pr-3 sm:pr-4 py-2.5 sm:py-3 text-sm sm:text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:bg-white transition-all shadow-inner"
              />
            </div>
            <button 
              type="submit" 
              disabled={isSearching}
              className="bg-slate-800 hover:bg-slate-900 text-white px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl font-medium text-sm sm:text-base transition-all shadow-sm disabled:opacity-70 disabled:cursor-wait flex items-center justify-center shrink-0 min-w-[72px] sm:min-w-[120px]"
            >
              {isSearching ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> : "Search"}
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

          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1 pb-1 relative z-50">
            <div className="shrink-0">
              <FolderMultiSelect 
                selected={folderFilters} 
                onChange={setFolderFilters} 
                onClose={() => setTimeout(() => handleSearch(), 0)}
                userLabels={userLabels} 
              />
            </div>
            <div className="h-5 w-px bg-slate-200 shrink-0"></div>
            <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} />
            <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer group bg-slate-50 border border-slate-200 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full hover:bg-slate-100 transition-colors shrink-0">
              <input type="checkbox" checked={excludeSent} onChange={e => setExcludeSent(e.target.checked)} className="rounded text-slate-600 focus:ring-slate-500 border-slate-300 w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="text-xs sm:text-sm font-medium text-slate-700 group-hover:text-slate-900 whitespace-nowrap">Exclude Sent</span>
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

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col flex-1 overflow-hidden min-h-0">
          <div className="border-b border-slate-200 p-2.5 sm:p-3 bg-slate-50 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3 sticky top-0 z-10">
            <div className="flex items-center justify-between sm:justify-start gap-2 sm:gap-3">
              <div className="flex items-center gap-2 sm:gap-3">
                <button 
                  onClick={() => setSelectedIds(selectedIds.size === emails.length ? new Set() : new Set(emails.map(e => e.id)))}
                  className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg hover:bg-slate-200 text-slate-500 transition-colors shrink-0"
                  disabled={emails.length === 0}
                >
                  <div className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors", selectedIds.size > 0 ? "bg-slate-800 border-slate-800" : "border-slate-300")}>
                    {selectedIds.size > 0 && <CheckCircle className="w-3 h-3 text-white" />}
                  </div>
                </button>
                <span className="text-xs sm:text-sm font-semibold text-slate-700 whitespace-nowrap">
                  {selectedIds.size > 0 ? (
                    `${selectedIds.size} selected`
                  ) : emails.length === 0 ? (
                    `0 emails`
                  ) : totalCount !== null ? (
                    typeof totalCount === "number" ? (
                      emails.length < totalCount ? (
                        `Showing ${emails.length} of ${totalCount.toLocaleString()} emails`
                      ) : (
                        `${emails.length} emails`
                      )
                    ) : (
                      `Showing ${emails.length} of ${totalCount} emails`
                    )
                  ) : isCounting && nextPageToken ? (
                    `Showing ${emails.length} emails...`
                  ) : (
                    `${emails.length} emails`
                  )}
                </span>
              </div>

              {/* Mobile-only sort selector */}
              <div className="flex sm:hidden items-center bg-slate-100 rounded-lg p-0.5 shrink-0">
                 <select value={sortBy} onChange={(e: any) => setSortBy(e.target.value)} className="bg-transparent text-xs font-medium text-slate-700 outline-none px-1.5 py-1 cursor-pointer">
                   <option value="date">Date</option>
                   <option value="size">Size</option>
                   <option value="sender">Sender</option>
                 </select>
                 <button onClick={() => setSortDesc(!sortDesc)} className="p-1 hover:bg-slate-200 rounded text-slate-500" title="Toggle sort direction">
                    <Filter className={cn("w-3.5 h-3.5 transition-transform", !sortDesc && "rotate-180")} />
                 </button>
              </div>
            </div>
            
            <div className="flex items-center justify-end gap-1.5 sm:gap-2 w-full sm:w-auto">
              <div className="hidden sm:flex items-center bg-slate-100 rounded-lg p-1 mr-1 shrink-0">
                 <select value={sortBy} onChange={(e: any) => setSortBy(e.target.value)} className="bg-transparent text-sm font-medium text-slate-700 outline-none px-2 cursor-pointer">
                   <option value="date">Date</option>
                   <option value="size">Size</option>
                   <option value="sender">Sender</option>
                 </select>
                 <button onClick={() => setSortDesc(!sortDesc)} className="p-1 hover:bg-slate-200 rounded text-slate-500" title="Toggle sort direction">
                    <Filter className={cn("w-4 h-4 transition-transform", !sortDesc && "rotate-180")} />
                 </button>
              </div>
              {folderFilters.includes('trash') ? (
                <>
                  <ActionButton icon={<Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />} label="Delete Forever" onClick={() => handleBulkAction("delete")} disabled={selectedIds.size === 0 || actionLoading !== null} loading={actionLoading === "delete"} className="text-rose-600 hover:bg-rose-50 flex-1 sm:flex-initial justify-center" />
                </>
              ) : (
                <>
                  <ActionButton icon={<Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />} label="Trash" onClick={() => handleBulkAction("trash")} disabled={selectedIds.size === 0 || actionLoading !== null} loading={actionLoading === "trash"} className="text-rose-600 hover:bg-rose-50 flex-1 sm:flex-initial justify-center" />
                  <ActionButton icon={<Archive className="w-3.5 h-3.5 sm:w-4 sm:h-4" />} label="Archive" onClick={() => handleBulkAction("archive")} disabled={selectedIds.size === 0 || actionLoading !== null} loading={actionLoading === "archive"} className="flex-1 sm:flex-initial justify-center" />
                </>
              )}
              <ActionButton icon={<CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />} label="Mark Read" onClick={() => handleBulkAction("read")} disabled={selectedIds.size === 0 || actionLoading !== null} loading={actionLoading === "read"} className="flex-1 sm:flex-initial justify-center" />
            </div>
          </div>

          {folderFilters.includes('trash') && (
            <div className="bg-amber-50 border-b border-amber-200 px-3 sm:px-4 py-2 flex items-center gap-2 text-amber-800 text-xs sm:text-sm">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span className="font-medium">You are viewing Trash.</span>
              <span className="text-amber-700">Emails here will be automatically deleted by Gmail after 30 days. Use "Delete Forever" to permanently remove them — this cannot be undone.</span>
            </div>
          )}

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
              <>
                <ul className="divide-y divide-slate-100">
                  {sortedEmails.map(email => {
                    const isSelected = selectedIds.has(email.id);
                    const isProcessing = processingIds.has(email.id);
                    return (
                      <li 
                        key={email.id} 
                        className={cn(
                          "flex items-start gap-2.5 sm:gap-4 p-3 sm:p-4 hover:bg-slate-50 active:bg-slate-100/70 transition-colors group cursor-pointer",
                          isSelected ? "bg-slate-50/80" : "",
                          isProcessing ? "opacity-50 grayscale" : ""
                        )}
                        onClick={() => !isProcessing && toggleSelect(email.id)}
                      >
                        <div className="pt-0.5 shrink-0">
                          <div className={cn("w-4 h-4 sm:w-5 sm:h-5 rounded border flex items-center justify-center transition-colors", isSelected ? "bg-slate-800 border-slate-800" : "border-slate-300 bg-white")}>
                            {isSelected && <CheckCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-white" />}
                          </div>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 sm:gap-4 mb-0.5 sm:mb-1">
                            <span className="font-semibold text-slate-900 text-sm sm:text-base truncate" title={email.sender}>
                              {email.sender.replace(/<.*>/, "").trim() || email.sender}
                            </span>
                            <div className="flex items-center gap-1.5 sm:gap-3 shrink-0">
                              {(() => {
                                 let badge = '';
                                 let badgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-100';
                                 const labels = email.labelIds || [];
                                 // SPAM and TRASH take highest priority — if it's junk, show it
                                 if (labels.includes('SPAM')) { badge = 'Spam'; badgeColor = 'bg-red-50 text-red-700 border-red-100'; }
                                 else if (labels.includes('TRASH')) { badge = 'Trash'; badgeColor = 'bg-red-50 text-red-700 border-red-100'; }
                                 // Then sub-categories (within Inbox)
                                 else if (labels.includes('CATEGORY_PROMOTIONS')) { badge = 'Promotions'; badgeColor = 'bg-amber-50 text-amber-700 border-amber-100'; }
                                 else if (labels.includes('CATEGORY_SOCIAL')) { badge = 'Social'; badgeColor = 'bg-purple-50 text-purple-700 border-purple-100'; }
                                 else if (labels.includes('CATEGORY_UPDATES')) { badge = 'Updates'; badgeColor = 'bg-green-50 text-green-700 border-green-100'; }
                                 else if (labels.includes('CATEGORY_FORUMS')) { badge = 'Forums'; badgeColor = 'bg-slate-100 text-slate-700 border-slate-200'; }
                                 else if (labels.includes('CATEGORY_PERSONAL')) { badge = 'Primary'; badgeColor = 'bg-blue-50 text-blue-700 border-blue-100'; }
                                 else if (labels.includes('SENT')) { badge = 'Sent'; badgeColor = 'bg-slate-100 text-slate-600 border-slate-200'; }
                                 else if (labels.includes('INBOX')) { badge = 'Inbox'; badgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-100'; }
                                 else {
                                   const custom = labels.find(l => !l.startsWith('CATEGORY_') && l !== 'UNREAD' && l !== 'STARRED' && l !== 'IMPORTANT');
                                   if (custom) badge = custom;
                                 }
                                 
                                 return badge ? (
                                   <span className={`hidden sm:inline-block text-[10px] sm:text-xs font-semibold border px-1.5 py-0.5 rounded truncate max-w-[100px] ${badgeColor}`}>
                                     {badge}
                                   </span>
                                 ) : null;
                              })()}
                              {(email.sizeEstimate || 0) > 102400 && (
                                 <span className="hidden sm:inline-block text-[10px] sm:text-xs font-semibold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded">
                                   {formatSize(email.sizeEstimate || 0)}
                                 </span>
                              )}
                              <span className="text-[11px] sm:text-xs font-medium text-slate-500 tabular-nums">
                                {(email.date instanceof Date && !isNaN(email.date.getTime()) ? email.date : new Date(email.date)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                <span className="hidden sm:inline">, {(email.date instanceof Date && !isNaN(email.date.getTime()) ? email.date : new Date(email.date)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                              </span>
                            </div>
                          </div>
                          <p className="text-xs sm:text-sm font-medium text-slate-800 truncate">{email.subject}</p>
                          <p className="text-xs sm:text-sm text-slate-500 truncate mt-0.5">{email.snippet}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {nextPageToken && (
                  <div className="p-3.5 sm:p-5 flex justify-center border-t border-slate-100 bg-slate-50/50">
                    <button
                      onClick={handleLoadMore}
                      disabled={isLoadingMore}
                      className="flex items-center gap-2 px-5 sm:px-6 py-2.5 bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-200 hover:border-slate-300 text-slate-700 font-semibold rounded-xl text-xs sm:text-sm transition-all shadow-sm disabled:opacity-60 disabled:cursor-wait"
                    >
                      {isLoadingMore ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin text-slate-600" />
                          <span>Loading more emails...</span>
                        </>
                      ) : (
                        <>
                          <RefreshCw className="w-4 h-4 text-slate-500" />
                          <span>Load More Emails</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        </>
        )}
      </main>

      {showSettings && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-3 sm:p-4 overscroll-contain"
          onClick={() => setShowSettings(false)}
        >
          <div 
            className="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-[85vh] sm:max-h-[90vh]"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-3.5 sm:p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-slate-800" />
                <h2 className="font-bold text-slate-800 text-base sm:text-lg">Bring Your Own Key (BYOK)</h2>
              </div>
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600 font-bold text-xl leading-none">&times;</button>
            </div>
            <div className="p-3.5 sm:p-6 flex flex-col gap-4 sm:gap-5 overflow-y-auto">
              
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 sm:p-4 text-sm text-slate-700">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <span className="font-bold text-xs sm:text-sm">1. Select Model Provider</span>
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
                    className="text-[11px] sm:text-xs font-semibold text-slate-600 bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded transition-colors self-start sm:self-auto"
                  >
                    Auto-select fastest/cheapest model
                  </button>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 mb-3 sm:mb-4">
                  {['gemini', 'openai', 'anthropic', 'groq', 'deepseek', 'zhipu', 'mistral'].map(p => (
                    <button
                      key={p}
                      onClick={() => saveSettings({...aiSettings, provider: p})}
                      className={cn("px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg border text-xs sm:text-sm font-medium capitalize text-center truncate", aiSettings.provider === p ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')}
                    >
                      {p === 'zhipu' ? 'Zhipu (GLM)' : p}
                    </button>
                  ))}
                </div>

                <div className="flex flex-col gap-1 mb-3 sm:mb-4">
                  <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Model</label>
                  <input
                    type="text"
                    list="model-suggestions"
                    value={aiSettings.model}
                    onChange={e => saveSettings({...aiSettings, model: e.target.value})}
                    placeholder={aiSettings.provider === 'zhipu' ? 'e.g. glm-4' : 'e.g. gemini-1.5-flash'}
                    className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs sm:text-sm focus:ring-slate-500 focus:border-slate-500 outline-none"
                  />
                  <datalist id="model-suggestions">
                    {dynamicModels.map(m => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </div>
                
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-wider">Get API Key</label>
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
                <label className="block text-xs sm:text-sm font-bold text-slate-700 mb-1.5 sm:mb-2">2. Paste Your API Key</label>
                <input
                  type="password"
                  value={aiSettings.apiKey}
                  onChange={e => saveSettings({...aiSettings, apiKey: e.target.value})}
                  placeholder="sk-..."
                  className="w-full border border-slate-300 rounded-lg px-3.5 sm:px-4 py-2.5 sm:py-3 text-xs sm:text-sm focus:ring-slate-500 focus:border-slate-500 outline-none shadow-sm"
                />
                <p className="text-[11px] sm:text-xs text-slate-500 mt-1.5 sm:mt-2 flex items-center gap-1">
                  <CheckCircle className="w-3 h-3 text-slate-400 shrink-0" /> Stored securely in your browser's local storage.
                </p>
              </div>
            </div>
            <div className="p-3.5 sm:p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 sm:gap-3 shrink-0">
              <button onClick={() => setShowSettings(false)} className="px-3 sm:px-4 py-1.5 sm:py-2 text-slate-600 hover:bg-slate-200 font-medium rounded-lg text-xs sm:text-sm transition-colors">
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
              }} className="px-3.5 sm:px-4 py-1.5 sm:py-2 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-lg text-xs sm:text-sm transition-colors shadow-sm">
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
        "flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors",
        disabled ? "opacity-60 cursor-not-allowed grayscale" : "",
        className || (disabled ? "text-slate-400" : "text-slate-700 hover:bg-slate-100 hover:text-slate-900")
      )}
      title={label}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" /> : icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

function FolderMultiSelect({ selected, onChange, onClose, userLabels }: { selected: string[], onChange: (s: string[]) => void, onClose?: () => void, userLabels: any[] }) {
  const [open, setOpen] = useState(false);
  
  const handleClose = () => {
    setOpen(false);
    if (onClose) onClose();
  };

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
      <button 
        type="button" 
        onClick={() => {
          if (open) handleClose();
          else setOpen(true);
        }} 
        className="bg-slate-50 border border-slate-200 rounded-full px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm text-slate-700 font-medium flex items-center gap-1.5 sm:gap-2 hover:bg-slate-100 transition-colors whitespace-nowrap"
      >
        <span className="truncate max-w-[110px] sm:max-w-none">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 shrink-0" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={handleClose} />
          <div className="absolute top-full left-0 mt-1 w-52 sm:w-56 bg-white border border-slate-200 rounded-lg shadow-lg z-20 max-h-80 sm:max-h-96 overflow-y-auto py-1">
            {options.map(opt => (
              <label key={opt.value} className="flex items-center gap-2.5 sm:gap-3 px-3 py-1.5 sm:py-2 hover:bg-slate-50 cursor-pointer text-xs sm:text-sm">
                <input 
                  type="checkbox" 
                  checked={selected.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  className="rounded border-slate-300 text-slate-700 focus:ring-slate-500 w-3.5 h-3.5 sm:w-4 sm:h-4"
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

function DateRangeFilter({ startDate, endDate, onStartChange, onEndChange }: any) {
  const [open, setOpen] = useState(false);
  const todayStr = new Date().toISOString().split("T")[0];
  
  let label = "Any time";
  if (startDate && endDate) {
    label = `${startDate} to ${endDate}`;
  } else if (startDate) {
    label = `After ${startDate}`;
  } else if (endDate) {
    label = `Before ${endDate}`;
  }

  const setRange = (days: number) => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - days);
    onStartChange(start.toISOString().split("T")[0]);
    onEndChange(end.toISOString().split("T")[0]);
    setOpen(false);
  };

  const clearRange = () => {
    onStartChange("");
    onEndChange("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <button 
        type="button" 
        onClick={() => setOpen(!open)} 
        className={cn("bg-slate-50 border rounded-full px-2.5 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm font-medium flex items-center gap-1.5 sm:gap-2 transition-all shadow-sm shrink-0 whitespace-nowrap", startDate || endDate ? "border-slate-800 text-slate-800 bg-white" : "border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-100")}
      >
        <Calendar className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-500" />
        <span className="truncate max-w-[150px]">{label}</span>
        <ChevronDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400 shrink-0" />
      </button>
      
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-lg z-20 p-3 flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1 px-2">Quick Select</span>
              <button type="button" onClick={() => setRange(7)} className="text-left px-3 py-1.5 text-xs sm:text-sm text-slate-700 hover:bg-slate-100 rounded-lg transition-colors font-medium">Last 7 days</button>
              <button type="button" onClick={() => setRange(30)} className="text-left px-3 py-1.5 text-xs sm:text-sm text-slate-700 hover:bg-slate-100 rounded-lg transition-colors font-medium">Last 30 days</button>
              <button type="button" onClick={() => setRange(365)} className="text-left px-3 py-1.5 text-xs sm:text-sm text-slate-700 hover:bg-slate-100 rounded-lg transition-colors font-medium">Last year</button>
              <button type="button" onClick={clearRange} className="text-left px-3 py-1.5 text-xs sm:text-sm text-slate-700 hover:bg-slate-100 rounded-lg transition-colors font-medium">Any time</button>
            </div>
            
            <div className="h-px bg-slate-100 -mx-3" />
            
            <div className="flex flex-col gap-2 px-1">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1">Custom Range</span>
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-8 font-medium">From</span>
                  <input type="date" value={startDate} onChange={e => onStartChange(e.target.value)} max={todayStr} className="flex-1 bg-slate-50 border border-slate-200 text-slate-700 rounded-md px-2 py-1 outline-none text-xs sm:text-sm focus:ring-2 focus:ring-slate-400 font-medium cursor-pointer" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-8 font-medium">To</span>
                  <input type="date" value={endDate} onChange={e => onEndChange(e.target.value)} max={todayStr} className="flex-1 bg-slate-50 border border-slate-200 text-slate-700 rounded-md px-2 py-1 outline-none text-xs sm:text-sm focus:ring-2 focus:ring-slate-400 font-medium cursor-pointer" />
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
