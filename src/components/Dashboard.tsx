import React, { useState, useEffect, useMemo, useRef, FormEvent } from "react";
import { Mail, Search, CheckCircle, Clock, Trash2, Archive, LogOut, ChevronDown, Filter, Calendar, Loader2, Sparkles, Settings, Inbox, RefreshCw, ShieldAlert, Eye, EyeOff, ChevronUp, HelpCircle, AlertTriangle, Flame, Activity } from "lucide-react";
import { AdminPanel } from "./AdminPanel";
import { fetchGmailAPI, batchDeleteEmails, batchTrashEmails, batchArchiveEmails, batchMarkAsRead, processInChunks, countEmails, EmailData, emptyAllTrash, markAllAsReadByQuery } from "../lib/gmail";
import { InboxHealth } from "./InboxHealth";
import { OnboardingWalkthrough } from "./OnboardingWalkthrough";
import { BulkOrganizeDropdown } from "./BulkOrganizeDropdown";
import { WalkthroughTip } from "./WalkthroughTip";
import { HealthScoreWidget } from "./HealthScoreWidget";
import { cn } from "../lib/utils";

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function Dashboard({ user }: { user: any }) {
  const [walkthroughKey, setWalkthroughKey] = useState(0);
  const [query, setQuery] = useState("");
  const queryRef = useRef(query);
  useEffect(() => { queryRef.current = query; }, [query]);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [excludeSent, setExcludeSent] = useState(false);
  const [onlyUnread, setOnlyUnread] = useState(false);
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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);

  const [useAI, setUseAI] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [showContextHelp, setShowContextHelp] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [adminConfig, setAdminConfig] = useState({
    enablePermanentDelete: false,
    useGlobalAiKey: false,
    globalAiKey: '',
    globalProvider: 'gemini'
  });

  const [aiSettings, setAiSettings] = useState({ provider: 'gemini', model: 'gemini-2.5-flash', apiKey: '' });

  const effectiveAiSettings = useMemo(() => {
    if (adminConfig.useGlobalAiKey && adminConfig.globalAiKey) {
      return {
        provider: adminConfig.globalProvider,
        apiKey: adminConfig.globalAiKey,
        model: adminConfig.globalProvider === 'openai' ? 'gpt-4o-mini' : 
               adminConfig.globalProvider === 'gemini' ? 'gemini-2.5-flash' : 
               adminConfig.globalProvider === 'anthropic' ? 'claude-3-5-haiku-20241022' : 'gemini-2.5-flash'
      };
    }
    return aiSettings;
  }, [adminConfig, aiSettings]);

  useEffect(() => {
    const loadGlobalConfig = async () => {
      try {
        const { db } = await import('../lib/firebase');
        const { doc, getDoc } = await import('firebase/firestore');
        const docRef = doc(db, 'appConfig', 'global');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
          setAdminConfig(prev => ({ ...prev, ...docSnap.data() }));
        } else {
          const local = localStorage.getItem('globalAdminSettings');
          if (local) setAdminConfig(JSON.parse(local));
        }
      } catch (e) {
        const local = localStorage.getItem('globalAdminSettings');
        if (local) setAdminConfig(JSON.parse(local));
      }
    };
    loadGlobalConfig();
  }, []);
  
  const [connectionStatus, setConnectionStatus] = useState<'idle'|'testing'|'success'|'error'>('idle');
  const [connectionMessage, setConnectionMessage] = useState('');
  
  useEffect(() => {
    if (!effectiveAiSettings.apiKey) {
      setConnectionStatus('idle');
      return;
    }
    const timer = setTimeout(async () => {
      setConnectionStatus('testing');
      setConnectionMessage('Testing connection...');
      try {
        const res = await fetch('/api/check-quota', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: effectiveAiSettings })
        });
        if (res.ok) {
          setConnectionStatus('success');
          setConnectionMessage('Connection successful! AI features enabled.');
          setUseAI(true);
          setAiError(null);
        } else {
          setConnectionStatus('error');
          setConnectionMessage('Invalid API key or quota exceeded.');
        }
      } catch (e) {
        setConnectionStatus('error');
        setConnectionMessage('Network error checking key.');
      }
    }, 1000);
    return () => clearTimeout(timer);
  }, [effectiveAiSettings.apiKey, effectiveAiSettings.provider]);
  const [dynamicModels, setDynamicModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    async function fetchModels() {
      if (!effectiveAiSettings.provider) return;
      setLoadingModels(true);
      try {
        const res = await fetch('/api/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: effectiveAiSettings })
        });
        if (res.ok) {
          const data = await res.json();
          let modelList = data.models;
          
          if (!modelList || modelList.length === 0) {
            // Fallbacks
            if (effectiveAiSettings.provider === 'gemini') modelList = ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];
            if (effectiveAiSettings.provider === 'openai') modelList = ['gpt-4o-mini', 'gpt-4o', 'o1-mini', 'o1', 'o3-mini'];
            if (effectiveAiSettings.provider === 'anthropic') modelList = ['claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest'];
            if (effectiveAiSettings.provider === 'groq') modelList = ['llama-3.1-8b-instant', 'llama-3.3-70b-versatile'];
            if (effectiveAiSettings.provider === 'deepseek') modelList = ['deepseek-chat', 'deepseek-reasoner'];
            if (effectiveAiSettings.provider === 'mistral') modelList = ['mistral-small-latest', 'mistral-large-latest'];
            if (effectiveAiSettings.provider === 'zhipu') modelList = ['glm-4-flash', 'glm-4-plus'];
            if (effectiveAiSettings.provider === 'grok') modelList = ['grok-2-latest', 'grok-beta'];
          }
          setDynamicModels(modelList);
          
          const cheapestMap: Record<string, string> = {
            'gemini': 'gemini-2.5-flash',
            'openai': 'gpt-4o-mini',
            'anthropic': 'claude-3-5-haiku-20241022',
            'groq': 'llama-3.1-8b-instant',
            'deepseek': 'deepseek-chat',
            'mistral': 'mistral-small-latest',
            'zhipu': 'glm-4-flash',
            'grok': 'grok-2-latest'
          };
          const cheapest = cheapestMap[effectiveAiSettings.provider];
          
          if (cheapest && effectiveAiSettings.model !== cheapest && !adminConfig.useGlobalAiKey) {
            const newSettings = { ...aiSettings, model: cheapest };
            setAiSettings(newSettings);
            localStorage.setItem('adminAiSettings', JSON.stringify(newSettings));
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
  }, [effectiveAiSettings.provider, effectiveAiSettings.apiKey, showSettings]);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    const saved = localStorage.getItem('adminAiSettings');
    if (saved) {
      try { 
        const parsed = JSON.parse(saved);
        setAiSettings({ provider: 'gemini', model: 'gemini-2.5-flash', apiKey: '', ...parsed });
        if (parsed.apiKey) setUseAI(true);
      } catch (e) {}
    }
  }, []);

  // Automatically trigger search when quick filters change
  const initialMount = useRef(true);
  useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    if (searchIdRef.current > 0) {
      const timer = setTimeout(() => handleSearch(undefined, undefined, undefined, true), 100);
      return () => clearTimeout(timer);
    }
  }, [onlyUnread, excludeSent, startDate, endDate]);

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
          body: JSON.stringify({ prompt: textQuery, settings: effectiveAiSettings })
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
        return `label:"${f}"`;
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
    if (onlyUnread) parts.push(`is:unread`);

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
      const results = await fetchGmailAPI(`/threads?q=${encodeURIComponent(q)}&maxResults=100`);
      if (searchIdRef.current !== searchId) return;

      if (results && results.threads && results.threads.length > 0) {
        setNextPageToken(results.nextPageToken || null);
        const detailed = await processInChunks(results.threads, 8, async (thread: any) => {
          try {
            const detail = await fetchGmailAPI(`/threads/${thread.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=List-Unsubscribe`);
            if (!detail.messages || detail.messages.length === 0) return null;
            
            const firstMsg = detail.messages[0];
            const lastMsg = detail.messages[detail.messages.length - 1];
            const firstHeaders = firstMsg.payload?.headers || [];
            const lastHeaders = lastMsg.payload?.headers || firstHeaders;
            const sizeEstimate = detail.messages.reduce((sum: number, m: any) => sum + (m.sizeEstimate || 0), 0);
            const messageIds = detail.messages.map((m: any) => m.id);
            const labelIds = [...new Set(detail.messages.flatMap((m: any) => m.labelIds || []))] as string[];

            const nestedMessages = detail.messages.map((m: any) => {
              const h = m.payload?.headers || [];
              return {
                id: m.id,
                sender: h.find((x: any) => x.name.toLowerCase() === 'from')?.value || 'Unknown',
                subject: h.find((x: any) => x.name.toLowerCase() === 'subject')?.value || '(No Subject)',
                snippet: m.snippet || '',
                date: new Date(m.internalDate ? parseInt(m.internalDate) : (h.find((x: any) => x.name.toLowerCase() === 'date')?.value || new Date())),
                labelIds: m.labelIds || [],
                listUnsubscribe: h.find((x: any) => x.name.toLowerCase() === 'list-unsubscribe')?.value
              };
            });

            return {
              id: thread.id,
              threadId: thread.id,
              messageIds: messageIds,
              snippet: detail.messages.length > 1 ? `(${detail.messages.length}) ${lastMsg.snippet || thread.snippet}` : (lastMsg.snippet || thread.snippet),
              labelIds: labelIds,
              sender: firstHeaders.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown',
              subject: firstHeaders.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)',
              date: new Date(lastMsg.internalDate ? parseInt(lastMsg.internalDate) : (lastHeaders.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date())),
              sizeEstimate: sizeEstimate,
              listUnsubscribe: firstHeaders.find((h: any) => h.name.toLowerCase() === 'list-unsubscribe')?.value,
              messages: nestedMessages
            } as EmailData;
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
      const results = await fetchGmailAPI(`/threads?q=${encodeURIComponent(lastExecutedQuery)}&maxResults=100&pageToken=${encodeURIComponent(currentToken)}`);
      if (results && results.threads && results.threads.length > 0) {
        setNextPageToken(results.nextPageToken || null);
        const detailed = await processInChunks(results.threads, 8, async (thread: any) => {
          try {
            const detail = await fetchGmailAPI(`/threads/${thread.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=List-Unsubscribe`);
            if (!detail.messages || detail.messages.length === 0) return null;
            
            const firstMsg = detail.messages[0];
            const lastMsg = detail.messages[detail.messages.length - 1];
            const firstHeaders = firstMsg.payload?.headers || [];
            const lastHeaders = lastMsg.payload?.headers || firstHeaders;
            const sizeEstimate = detail.messages.reduce((sum: number, m: any) => sum + (m.sizeEstimate || 0), 0);
            const messageIds = detail.messages.map((m: any) => m.id);
            const labelIds = [...new Set(detail.messages.flatMap((m: any) => m.labelIds || []))] as string[];

            const nestedMessages = detail.messages.map((m: any) => {
              const h = m.payload?.headers || [];
              return {
                id: m.id,
                sender: h.find((x: any) => x.name.toLowerCase() === 'from')?.value || 'Unknown',
                subject: h.find((x: any) => x.name.toLowerCase() === 'subject')?.value || '(No Subject)',
                snippet: m.snippet || '',
                date: new Date(m.internalDate ? parseInt(m.internalDate) : (h.find((x: any) => x.name.toLowerCase() === 'date')?.value || new Date())),
                labelIds: m.labelIds || []
              };
            });

            return {
              id: thread.id,
              threadId: thread.id,
              messageIds: messageIds,
              snippet: detail.messages.length > 1 ? `(${detail.messages.length}) ${lastMsg.snippet || thread.snippet}` : (lastMsg.snippet || thread.snippet),
              labelIds: labelIds,
              sender: firstHeaders.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown',
              subject: firstHeaders.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)',
              date: new Date(lastMsg.internalDate ? parseInt(lastMsg.internalDate) : (lastHeaders.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date())),
              sizeEstimate: sizeEstimate,
              messages: nestedMessages
            } as EmailData;
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
    const timer = setTimeout(() => {
      handleSearch();
    }, 100);
    return () => clearTimeout(timer);
  }, [startDate, endDate, excludeSent, onlyUnread]);

  useEffect(() => {
    fetchGmailAPI('/labels').then(data => {
      if (data && data.labels) setUserLabels(data.labels);
    });
    
  const handleHashChange = () => {
      const hash = decodeURIComponent(window.location.hash.replace('#', '')) || 'dashboard';
      if (hash === 'health') {
        setShowHealth(true);
      } else {
        setShowHealth(false);
        let folders = ['anywhere'];
        if (hash.startsWith('folders=')) {
          folders = Array.from(new Set(hash.replace('folders=', '').split(',').filter(Boolean)));
        } else if (hash.startsWith('folder-')) { // Backwards compat with what I just wrote
          folders = [hash.replace('folder-', '')];
        }
        
        if (folders.length === 0) folders = ['anywhere'];
        
        setFolderFilters(folders);
        setTimeout(() => handleSearch(undefined, queryRef.current, folders), 0);
      }
    };

    window.addEventListener('hashchange', handleHashChange);
    handleHashChange(); // Trigger on mount

    return () => window.removeEventListener('hashchange', handleHashChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDeleteSelected = () => {
    if (selectedIds.size === 0) return;
    setShowDeleteSelectedConfirm(true);
  };

  const executeDeleteSelected = async () => {
    setShowDeleteSelectedConfirm(false);
    setActionLoading("delete");
    setProcessingProgress({ current: 0, total: selectedIds.size });
    const ids = Array.from(selectedIds) as string[];
    setProcessingIds(new Set(ids));
    
    const allMessageIds: string[] = [];
    ids.forEach(tid => {
      const email = emails.find(e => e.id === tid);
      if (email && email.messageIds) {
        allMessageIds.push(...email.messageIds);
      } else {
        allMessageIds.push(tid);
      }
    });
    
    try {
      await batchDeleteEmails(allMessageIds);
      setEmails(prev => prev.filter(e => !ids.includes(e.id)));
      setTotalCount(prev => typeof prev === 'number' ? Math.max(0, prev - ids.length) : prev);
      setSelectedIds(new Set());
      const newCount = emails.length - ids.length;
      if (newCount < 20 && nextPageToken) {
        setTimeout(() => handleLoadMore(), 100);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
      setProcessingIds(new Set());
      setProcessingProgress(null);
    }
  };

  const executeMarkAllRead = async () => {
    if (emails.length === 0) return;
    const confirm = window.confirm("Are you sure you want to mark ALL emails matching this view as read?");
    if (!confirm) return;

    setActionLoading("read");
    try {
      await markAllAsReadByQuery(lastExecutedQuery);
      handleSearch(); // Refresh list to reflect changes
    } catch (e) {
      console.error(e);
      alert("Failed to mark all as read");
    } finally {
      setActionLoading(null);
    }
  };

  const handleEmptyTrash = async () => {
    setShowEmptyTrashConfirm(true);
  };

  const executeEmptyTrash = async () => {
    setShowEmptyTrashConfirm(false);
    setActionLoading("empty_trash");
    setProcessingProgress({ current: 0, total: 1 }); // We don't know the exact total upfront, just show progress
    
    try {
      await emptyAllTrash((deleted) => {
        setProcessingProgress({ current: deleted, total: deleted + 1 });
      });
      
      setEmails([]);
      setTotalCount(0);
      setSelectedIds(new Set());
    } catch (err) {
      console.error(err);
    } finally {
      setActionLoading(null);
      setProcessingProgress(null);
    }
  };

  const handleBulkAction = async (action: "trash" | "archive" | "read" | "delete") => {
    if (selectedIds.size === 0) return;
    
    setActionLoading(action);
    setProcessingProgress({ current: 0, total: selectedIds.size });
    const ids = Array.from(selectedIds) as string[];
    setProcessingIds(new Set(ids));
    
    const allMessageIds: string[] = [];
    ids.forEach(tid => {
      const email = emails.find(e => e.id === tid);
      if (email && email.messageIds) {
        allMessageIds.push(...email.messageIds);
      } else {
        allMessageIds.push(tid);
      }
    });
    
    const isUnreadView = onlyUnread || 
      query.toLowerCase().includes('is:unread') || 
      (parsedQuery?.query || '').toLowerCase().includes('is:unread') ||
      lastExecutedQuery.toLowerCase().includes('is:unread');

    // Optimistically update the UI instantly
    if (action !== "read" || (action === "read" && isUnreadView)) {
      setEmails(prev => prev.filter(e => !ids.includes(e.id)));
      setTotalCount(prev => typeof prev === 'number' ? Math.max(0, prev - ids.length) : prev);
    } else {
      setEmails(prev => prev.map(e => ids.includes(e.id) ? { ...e, labelIds: e.labelIds.filter(l => l !== 'UNREAD') } : e));
    }
    
    // Clear selected state
    setSelectedIds(new Set());
    
    try {
      if (action === "trash") await batchTrashEmails(allMessageIds);
      else if (action === "archive") await batchArchiveEmails(allMessageIds);
      else if (action === "read") await batchMarkAsRead(allMessageIds);
      // delete action is handled separately by executeDeleteSelected
      
      // Auto-replenish if we are running low on displayed emails
      const removedCount = (action !== "read" || isUnreadView) ? ids.length : 0;
      const newCount = emails.length - removedCount;
      if (removedCount > 0 && newCount < 20 && nextPageToken) {
        setTimeout(() => handleLoadMore(), 100);
      }
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

  const toggleExpand = (id: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleSingleAction = async (id: string, action: "trash" | "archive" | "read" | "delete", e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (actionLoading !== null || processingIds.has(id)) return;

    if (action === "delete") {
      const confirmed = window.confirm(
        "⚠️ PERMANENT DELETE\n\nYou are about to permanently delete this email from Gmail. This action cannot be undone.\n\nAre you sure you want to delete this email permanently?"
      );
      if (!confirmed) return;
    }

    setProcessingIds(prev => new Set([...prev, id]));
    setActionLoading(action);

    const isUnreadView = onlyUnread || 
      query.toLowerCase().includes('is:unread') || 
      (parsedQuery?.query || '').toLowerCase().includes('is:unread') ||
      lastExecutedQuery.toLowerCase().includes('is:unread');

    // Optimistically update the UI instantly
    if (action !== "read" || (action === "read" && isUnreadView)) {
      setEmails(prev => prev.filter(email => email.id !== id));
      setTotalCount(prev => typeof prev === 'number' ? Math.max(0, prev - 1) : prev);
      setSelectedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setExpandedIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } else {
      setEmails(prev => prev.map(email => email.id === id ? { ...email, labelIds: email.labelIds.filter(l => l !== 'UNREAD') } : email));
    }

    try {
      if (action === "trash") await batchTrashEmails([id]);
      else if (action === "archive") await batchArchiveEmails([id]);
      else if (action === "read") await batchMarkAsRead([id]);
      else if (action === "delete") await batchDeleteEmails([id]);

      // Auto-replenish if we are running low on displayed emails
      const removedCount = (action !== "read" || isUnreadView) ? 1 : 0;
      const newCount = emails.length - removedCount;
      if (removedCount > 0 && newCount < 20 && nextPageToken) {
        setTimeout(() => handleLoadMore(), 100);
      }
    } catch (err) {
      console.error(`Failed to execute ${action} on email ${id}`, err);
    } finally {
      setProcessingIds(prev => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setActionLoading(null);
    }
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
  
  const [localKeyword, setLocalKeyword] = useState('');
  
  const filteredEmails = useMemo(() => {
    if (!localKeyword.trim()) return sortedEmails;
    const lower = localKeyword.toLowerCase();
    return sortedEmails.filter(e => 
      (e.subject && e.subject.toLowerCase().includes(lower)) ||
      (e.sender && e.sender.toLowerCase().includes(lower)) ||
      (e.snippet && e.snippet.toLowerCase().includes(lower))
    );
  }, [sortedEmails, localKeyword]);

  const showSize = sortBy === "size" || 
    query.toLowerCase().includes("larger:") || 
    query.toLowerCase().includes("size:") ||
    (parsedQuery?.query || "").toLowerCase().includes("larger:") ||
    (parsedQuery?.query || "").toLowerCase().includes("size:");


  const isActuallyUnreadOnly = onlyUnread || 
    query.toLowerCase().includes('is:unread') || 
    (parsedQuery?.query || '').toLowerCase().includes('is:unread') ||
    lastExecutedQuery.toLowerCase().includes('is:unread');

  const shouldCategorize = isActuallyUnreadOnly || folderFilters.length > 1 || query.includes(' OR ') || (parsedQuery?.query || '').includes(' OR ') || lastExecutedQuery.includes(' OR ');

  const groupedEmails = useMemo(() => {
    if (!shouldCategorize) {
      return [{ title: null, emails: filteredEmails }];
    }
    const groups: any = {};
    
    const getPrimaryFolder = (email: any) => {
      const labels = email.labelIds || [];
      const customLabel = labels.find((l: string) => !l.startsWith('CATEGORY_') && l !== 'UNREAD' && l !== 'STARRED' && l !== 'IMPORTANT' && l !== 'INBOX' && l !== 'SENT' && l !== 'SPAM' && l !== 'TRASH');
      
      if (customLabel) {
        const userLabel = userLabels.find((ul: any) => ul.id === customLabel);
        return userLabel ? userLabel.name : customLabel.replace('Label_', 'Folder ');
      }
      
      if (labels.includes('CATEGORY_PROMOTIONS')) return 'Promotions';
      if (labels.includes('CATEGORY_SOCIAL')) return 'Social';
      if (labels.includes('CATEGORY_UPDATES')) return 'Updates';
      if (labels.includes('CATEGORY_FORUMS')) return 'Forums';
      if (labels.includes('SPAM')) return 'Spam';
      if (labels.includes('TRASH')) return 'Trash';
      
      return 'Primary Inbox';
    };

    filteredEmails.forEach((email: any) => {
      const folder = getPrimaryFolder(email);
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(email);
    });

    // Sort groups alphabetically, but keep Primary Inbox first
    return Object.entries(groups)
      .map(([title, emails]) => ({ title, emails: emails as any[] }))
      .sort((a, b) => {
        if (a.title === 'Primary Inbox') return -1;
        if (b.title === 'Primary Inbox') return 1;
        return a.title.localeCompare(b.title);
      });
  }, [filteredEmails, shouldCategorize, userLabels]);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col">
      <OnboardingWalkthrough key={walkthroughKey} onComplete={() => {}} />
      
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3 sm:py-4 flex items-center justify-between sticky top-0 z-30 shadow-sm">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-800 text-white flex items-center justify-center font-bold shrink-0">
            <Mail className="w-5 h-5" />
          </div>
          <h1 onDoubleClick={() => setShowAdminPanel(true)} className="text-lg sm:text-xl font-bold tracking-tight text-slate-800 cursor-default select-none">MailFlow</h1>
          <div className="hidden sm:block ml-4 border-l border-slate-200 pl-4">
            <HealthScoreWidget />
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <button 
            onClick={() => setShowContextHelp(true)}
            className="p-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            title="Help / Walkthrough"
          >
            <HelpCircle className="w-4 h-4 shrink-0" />
          </button>
          <button 
            onClick={() => window.location.reload()}
            className="p-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-colors"
            title="Refresh Page"
          >
            <RefreshCw className={cn("w-4 h-4 shrink-0", isSearching && "animate-spin")} />
          </button>
          <button 
            onClick={() => { window.location.hash = showHealth ? '#dashboard' : '#health'; }}
            className={cn("p-2 sm:px-4 sm:py-2 rounded-lg text-xs sm:text-sm font-semibold transition-colors flex items-center gap-1.5 sm:gap-2", showHealth ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}
            title="Inbox Health"
          >
            <Activity className="w-4 h-4 shrink-0" /> 
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

      <main className="flex-1 w-full max-w-6xl mx-auto p-4 md:p-6 flex flex-col gap-6">
        
        {/* Breadcrumbs Navigation */}
        <div className="flex items-center gap-2 text-sm text-slate-500 mb-[-12px]">
          <button 
            onClick={() => { window.location.hash = '#dashboard'; }} 
            className="hover:text-slate-900 transition-colors flex items-center gap-1"
          >
            Dashboard
          </button>
          
          {showHealth && (
            <>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <span className="text-slate-800 font-medium flex items-center gap-1">
                <Activity className="w-3.5 h-3.5" />
                Inbox Health
              </span>
            </>
          )}

          {!showHealth && folderFilters.length > 0 && !(folderFilters.length === 1 && folderFilters[0] === 'anywhere') && (
            <>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <span className="text-slate-800 font-medium capitalize flex items-center gap-1">
                {folderFilters.length === 1 ? (
                  <>
                    {folderFilters[0] === 'trash' ? <Trash2 className="w-3.5 h-3.5" /> : null}
                    {folderFilters[0].replace('category:', '')}
                  </>
                ) : (
                  <span>Multiple Folders</span>
                )}
              </span>
            </>
          )}
        </div>

        {showHealth ? (
           <InboxHealth 
             userEmail={user?.email}
             aiSettings={aiSettings} 
             userLabels={userLabels}
             onApplyQuery={(q, filter, sortOption) => {
               setQuery(q);
               if (sortOption) {
                 setSortBy(sortOption);
                 setSortDesc(true); // Always sort highest to lowest by default
               }
               let newFilters = ['anywhere'];
               if (filter) {
                 if (filter === 'spam+trash') newFilters = ['spam', 'trash'];
                 else if (filter === 'inbox') newFilters = ['inbox'];
                 else if (filter.startsWith('category:')) newFilters = [filter];
                 else newFilters = [filter];
               }
               setFolderFilters(newFilters);
               
               // We want hash so back button works!
               const newHash = newFilters.length > 0 && !(newFilters.length === 1 && newFilters[0] === 'anywhere')
                 ? `#folders=${newFilters.join(',')}` 
                 : '#dashboard';
                 
               if (window.location.hash !== newHash) {
                 window.location.hash = newHash;
               } else {
                 setShowHealth(false);
               }
               
               setTimeout(() => handleSearch(undefined, q, newFilters, true), 0);
              }}
            />
        ) : (
        <>
        <WalkthroughTip 
          storageKey="tip_dashboard" 
          title="Welcome to your MailFlow Workspace" 
          description="Try out the new 'Inbox Health' button above to unleash the automated Folder Optimizer, or select multiple emails below to test out Smart Organize Analytics and the Rule Suggester!"
        />
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

          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-1 pb-1 relative z-20">
            <div className="shrink-0">
              <FolderMultiSelect 
                selected={folderFilters} 
                onChange={(newFilters) => {
                  const newHash = newFilters.length > 0 && !(newFilters.length === 1 && newFilters[0] === 'anywhere')
                    ? `#folders=${newFilters.join(',')}` 
                    : '#dashboard';
                  
                  if (window.location.hash !== newHash) {
                    window.location.hash = newHash;
                  }
                  // We also call setFolderFilters synchronously so the component feels responsive
                  setFolderFilters(newFilters);
                }} 
                
                userLabels={userLabels} 
              />
            </div>
            <div className="h-5 w-px bg-slate-200 shrink-0"></div>
            <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} />
            <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer group bg-slate-50 border border-slate-200 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full hover:bg-slate-100 transition-colors shrink-0">
              <input type="checkbox" checked={onlyUnread} onChange={e => {
                const val = e.target.checked;
                setOnlyUnread(val);
                // Trigger search on toggle by temporarily putting the value in the query or relying on effect? 
                // Because handleSearch uses the React state `onlyUnread` which hasn't updated yet.
                // Wait, it uses the state. So I should call a helper or use useEffect. Let's just set the state and then the user can search, or we can use a setTimeout to wait for state to propagate (React 18 batches them). But actually we need a useEffect for this to be perfect.
                // Alternatively, just let it be. The user says "Make sure the tabs switching is easy".
                // I'll leave the checkbox as is, it's just a filter toggle. I'll stick to my previous change. Let me just undo this replacement by keeping it the same, except I'll just restore the original code since it works fine. Wait, I can just use a `useEffect`.
              }} className="rounded text-indigo-600 focus:ring-indigo-500 border-slate-300 w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="text-xs sm:text-sm font-medium text-slate-700 group-hover:text-slate-900 whitespace-nowrap">Unread Only</span>
            </label>
            <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer group bg-slate-50 border border-slate-200 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full hover:bg-slate-100 transition-colors shrink-0">
              <input type="checkbox" checked={excludeSent} onChange={e => {
                const val = e.target.checked;
                setExcludeSent(val);
              }} className="rounded text-slate-600 focus:ring-slate-500 border-slate-300 w-3.5 h-3.5 sm:w-4 sm:h-4" />
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

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 flex flex-col flex-1">
          <div className="sticky top-[57px] sm:top-[65px] z-10 bg-slate-50 flex flex-col border-b border-slate-200 rounded-t-2xl">
            <div className="p-2.5 sm:p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3">
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

                {/* Mobile-only sort & filter */}
                <div className="flex sm:hidden items-center bg-slate-100 rounded-lg p-0.5 shrink-0 flex-1">
                   <div className="relative border-r border-slate-200 mr-1 pr-1 flex-1">
                     <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                     <input
                       type="text"
                       placeholder="Filter..."
                       value={localKeyword}
                       onChange={e => setLocalKeyword(e.target.value)}
                       className="bg-transparent text-xs font-medium text-slate-700 outline-none pl-6 pr-1 py-1 w-full"
                     />
                   </div>
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
              
              <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                 <div className="hidden sm:flex items-center bg-slate-100 rounded-lg p-1 mr-1 shrink-0">
                   <div className="relative border-r border-slate-200 mr-1 pr-1">
                     <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
                     <input
                       type="text"
                       placeholder="Filter view..."
                       value={localKeyword}
                       onChange={e => setLocalKeyword(e.target.value)}
                       className="bg-transparent text-sm font-medium text-slate-700 outline-none pl-7 pr-2 py-0.5 w-32 focus:w-48 transition-all"
                     />
                   </div>
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
                  adminConfig.enablePermanentDelete ? (
                    <>
                      <ActionButton icon={<Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />} label="Delete Selected" onClick={handleDeleteSelected} disabled={selectedIds.size === 0 || actionLoading !== null} loading={actionLoading === "delete"} className="text-rose-600 hover:bg-rose-50 flex-1 sm:flex-initial justify-center" />
                      <ActionButton icon={<Flame className="w-3.5 h-3.5 sm:w-4 sm:h-4" />} label="Empty Trash" onClick={handleEmptyTrash} disabled={actionLoading !== null || emails.length === 0} loading={actionLoading === "empty_trash"} className="text-slate-700 hover:bg-slate-100 flex-1 sm:flex-initial justify-center" />
                    </>
                  ) : (
                    <div className="text-xs sm:text-sm text-slate-500 flex items-center gap-2 bg-slate-100 px-3 py-1.5 rounded-lg border border-slate-200">
                      <Trash2 className="w-4 h-4 shrink-0 text-slate-400" />
                      <span className="hidden sm:inline">Emails in Trash auto-delete after 30 days. To empty immediately, please use the official Gmail app.</span>
                      <span className="sm:hidden">Auto-deletes after 30 days.</span>
                    </div>
                  )
                ) : (
                  <>
                    <ActionButton icon={<Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />} label="Trash" onClick={() => handleBulkAction("trash")} disabled={selectedIds.size === 0 || actionLoading !== null} loading={actionLoading === "trash"} className="text-rose-600 hover:bg-rose-50 flex-1 sm:flex-initial justify-center" />
                    <ActionButton icon={<Archive className="w-3.5 h-3.5 sm:w-4 sm:h-4" />} label="Archive" onClick={() => handleBulkAction("archive")} disabled={selectedIds.size === 0 || actionLoading !== null} loading={actionLoading === "archive"} className="flex-1 sm:flex-initial justify-center" />
                  </>
                )}
                
                <BulkOrganizeDropdown 
                  className="flex-1 sm:flex-initial"
                  selectedIds={selectedIds} 
                  emails={emails} 
                  userLabels={userLabels || []}
                  aiSettings={aiSettings}
                  onComplete={() => {
                    setSelectedIds(new Set());
                    setIsSearching(true);
                    setTimeout(() => handleSearch(), 500);
                  }} 
                  disabled={selectedIds.size === 0 || actionLoading !== null} 
                />
                
                {selectedIds.size > 0 ? (
                   <ActionButton icon={<CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />} label="Mark Read" onClick={() => handleBulkAction("read")} disabled={actionLoading !== null} loading={actionLoading === "read"} className="flex-1 sm:flex-initial justify-center bg-indigo-50 text-indigo-700 hover:bg-indigo-100" />
                ) : (
                   <ActionButton icon={<CheckCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4" />} label="Mark All Read" onClick={executeMarkAllRead} disabled={emails.length === 0 || actionLoading !== null} loading={actionLoading === "read"} className="flex-1 sm:flex-initial justify-center bg-slate-100 text-slate-700 hover:bg-slate-200" title="Mark all unread emails in this view as read" />
                )}
              </div>
            </div>

            {isActuallyUnreadOnly && (
              <div className="flex items-center px-2 sm:px-3 pb-1 overflow-x-auto no-scrollbar border-t border-slate-200/50 bg-slate-50/50 pt-2 gap-1 sm:gap-2">
                {[
                  { id: 'anywhere', label: 'All Unread' },
                  { id: 'category:personal', label: 'Primary' },
                  { id: 'category:promotions', label: 'Promotions' },
                  { id: 'category:updates', label: 'Updates' },
                  { id: 'category:social', label: 'Social' },
                  { id: 'category:forums', label: 'Forums' }
                ].map(tab => {
                  const isActive = folderFilters.length === 1 && folderFilters[0] === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        const newFilters = [tab.id];
                        setFolderFilters(newFilters);
                        setTimeout(() => handleSearch(undefined, query, newFilters), 0);
                      }}
                      className={cn(
                        "px-3 sm:px-4 py-1.5 sm:py-2 rounded-t-lg text-xs sm:text-sm font-semibold transition-all shrink-0 border-b-2",
                        isActive 
                          ? "text-indigo-600 border-indigo-600 bg-indigo-50/50"
                          : "text-slate-500 border-transparent hover:text-slate-700 hover:bg-slate-100/50"
                      )}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {folderFilters.includes('trash') && (
            <div className="bg-amber-50 border-b border-amber-200 px-3 sm:px-4 py-2 flex items-center gap-2 text-amber-800 text-xs sm:text-sm">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span className="font-medium">You are viewing Trash.</span>
              <span className="text-amber-700">Emails here will be automatically deleted by Gmail after 30 days. Use "Delete Forever" to permanently remove them — this cannot be undone.</span>
            </div>
          )}

          <div className="flex-1 flex flex-col">
            {emails.length === 0 ? (
              (isSearching || isLoadingMore) ? (
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
                  <div className="flex flex-col gap-4 pb-4">
                    {groupedEmails.map((group, groupIdx) => {
                      const isCollapsed = collapsedGroups.has(group.title || "");
                      const toggleGroup = () => {
                        if (!group.title) return;
                        setCollapsedGroups(prev => {
                          const next = new Set(prev);
                          if (next.has(group.title!)) next.delete(group.title!);
                          else next.add(group.title!);
                          return next;
                        });
                      };
                      return (
                      <div key={groupIdx} className="bg-white">
                        {group.title && (
                          <div 
                            onClick={toggleGroup}
                            className="bg-slate-100/80 px-4 py-2 border-y border-slate-200 font-semibold text-slate-800 text-sm flex items-center justify-between sticky top-0 z-10 backdrop-blur-sm shadow-sm cursor-pointer hover:bg-slate-200/80 transition-colors"
                          >
                            <div className="flex items-center gap-3">
                              <div 
                                className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors shadow-sm", group.emails.length > 0 && group.emails.every(e => selectedIds.has(e.id)) ? "bg-slate-800 border-slate-800" : "border-slate-300 bg-white")}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const allSelected = group.emails.every(e => selectedIds.has(e.id));
                                  setSelectedIds(prev => {
                                    const next = new Set(prev);
                                    if (allSelected) {
                                      group.emails.forEach(e => next.delete(e.id));
                                    } else {
                                      group.emails.forEach(e => next.add(e.id));
                                    }
                                    return next;
                                  });
                                }}
                              >
                                {group.emails.length > 0 && group.emails.every(e => selectedIds.has(e.id)) && <CheckCircle className="w-3 h-3 text-white" />}
                              </div>
                              <div className="flex items-center gap-2">
                                <ChevronDown className={cn("w-4 h-4 transition-transform", isCollapsed && "-rotate-90")} />
                                <span>{group.title}</span>
                              </div>
                            </div>
                            <span className="text-xs bg-white px-2 py-0.5 rounded-full border border-slate-200 text-slate-500 font-medium shadow-xs">{group.emails.length}</span>
                          </div>
                        )}
                        {!isCollapsed && (
                        <ul className="divide-y divide-slate-100">
                          {group.emails.map(email => {
                    const isSelected = selectedIds.has(email.id);
                    const isProcessing = processingIds.has(email.id);
                    const isExpanded = expandedIds.has(email.id);
                    return (
                      <li 
                        key={email.id} 
                        id={`email-row-${email.id}`}
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
                              {showSize && (email.sizeEstimate || 0) > 102400 && (
                                 <span className={cn(
                                   "inline-block text-[10px] sm:text-xs font-semibold px-1.5 py-0.5 rounded shadow-sm border",
                                   (email.sizeEstimate || 0) > 5242880 ? "bg-red-50 text-red-700 border-red-200" : // > 5MB
                                   (email.sizeEstimate || 0) > 1048576 ? "bg-amber-50 text-amber-700 border-amber-200" : // > 1MB
                                   "bg-slate-50 text-slate-600 border-slate-200" // Default for large emails
                                 )}>
                                   {formatSize(email.sizeEstimate || 0)}
                                 </span>
                              )}
                              <span className="text-[11px] sm:text-xs font-medium text-slate-500 tabular-nums">
                                {(email.date instanceof Date && !isNaN(email.date.getTime()) ? email.date : new Date(email.date)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                                <span className="hidden sm:inline">, {(email.date instanceof Date && !isNaN(email.date.getTime()) ? email.date : new Date(email.date)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
                              </span>
                              <button
                                type="button"
                                id={`preview-btn-${email.id}`}
                                onClick={(e) => toggleExpand(email.id, e)}
                                className={cn(
                                  "flex items-center gap-1 text-[11px] sm:text-xs font-semibold px-2 py-0.5 rounded-md border transition-all cursor-pointer",
                                  isExpanded
                                    ? "bg-slate-800 text-white border-slate-800 shadow-xs"
                                    : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200"
                                )}
                                title={isExpanded ? "Collapse thread" : "Expand thread"}
                              >
                                {isExpanded ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3 text-slate-600" />}
                                <span>{isExpanded ? "Hide" : (email.messages && email.messages.length > 1 ? `View ${email.messages.length} replies` : "Preview")}</span>
                              </button>
                            </div>
                          </div>
                          
                          <div className="flex items-center gap-2 mb-0.5 sm:mb-0">
                            {(() => {
                               const labels = email.labelIds || [];
                               const badges = [];
                               
                               if (shouldCategorize) return null;
                               
                               if (labels.includes('SPAM')) badges.push({ text: 'Spam', color: 'bg-red-50 text-red-700 border-red-100' });
                               else if (labels.includes('TRASH')) badges.push({ text: 'Trash', color: 'bg-red-50 text-red-700 border-red-100' });
                               
                               labels.forEach(l => {
                                 if (l.startsWith('CATEGORY_')) {
                                    if (l === 'CATEGORY_PROMOTIONS') badges.push({ text: 'Promotions', color: 'bg-amber-50 text-amber-700 border-amber-100' });
                                    else if (l === 'CATEGORY_SOCIAL') badges.push({ text: 'Social', color: 'bg-purple-50 text-purple-700 border-purple-100' });
                                    else if (l === 'CATEGORY_UPDATES') badges.push({ text: 'Updates', color: 'bg-green-50 text-green-700 border-green-100' });
                                    else if (l === 'CATEGORY_FORUMS') badges.push({ text: 'Forums', color: 'bg-slate-100 text-slate-700 border-slate-200' });
                                    else if (l === 'CATEGORY_PERSONAL') badges.push({ text: 'Primary', color: 'bg-blue-50 text-blue-700 border-blue-100' });
                                 } else if (l === 'SENT') {
                                    badges.push({ text: 'Sent', color: 'bg-slate-100 text-slate-600 border-slate-200' });
                                 } else if (l === 'INBOX' && !labels.some(x => x.startsWith('CATEGORY_'))) {
                                    badges.push({ text: 'Inbox', color: 'bg-indigo-50 text-indigo-700 border-indigo-100' });
                                 } else if (!['UNREAD', 'STARRED', 'IMPORTANT', 'INBOX', 'SPAM', 'TRASH', 'SENT'].includes(l)) {
                                    // Custom Label
                                    const ul = userLabels.find(ul => ul.id === l);
                                    const name = ul ? ul.name : l.replace('Label_', 'Folder ');
                                    badges.push({ text: name, color: 'bg-teal-50 text-teal-700 border-teal-100' });
                                 }
                               });
                               
                               // Deduplicate badges by text
                               const uniqueBadges = Array.from(new Map(badges.map(item => [item.text, item])).values());
                               
                               if (uniqueBadges.length === 0) return null;
                               
                               return (
                                 <div className="flex gap-1.5 flex-wrap shrink-0">
                                   {uniqueBadges.slice(0, 3).map((b, i) => (
                                     <span key={i} className={`inline-block text-[10px] font-semibold border px-1.5 py-0.5 rounded truncate max-w-[100px] ${b.color}`}>
                                       {b.text}
                                     </span>
                                   ))}
                                   {uniqueBadges.length > 3 && (
                                     <span className="inline-block text-[10px] font-semibold border px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border-slate-200">
                                       +{uniqueBadges.length - 3}
                                     </span>
                                   )}
                                 </div>
                               );
                            })()}
                            <p className="text-xs sm:text-sm font-medium text-slate-800 truncate">{email.subject}</p>
                          </div>
                          {!isExpanded && (
                            <p className="text-xs sm:text-sm text-slate-500 truncate mt-0.5">{email.snippet}</p>
                          )}

                          {isExpanded && (
                            <div 
                              id={`email-preview-card-${email.id}`}
                              className="mt-3 bg-slate-50 border border-slate-200/90 rounded-xl flex flex-col shadow-inner select-text cursor-default overflow-hidden"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="max-h-[60vh] overflow-y-auto p-3 sm:p-4 flex flex-col gap-4">
                                {(email.messages && email.messages.length > 0 ? email.messages : [email as any]).map((msg, idx, arr) => (
                                  <div key={msg.id} className={cn("flex flex-col gap-2.5", idx !== arr.length - 1 && "pb-4 border-b border-slate-200/80")}>
                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <span className="font-semibold text-slate-900 break-all">{msg.sender.replace(/<.*>/, "").trim() || msg.sender}</span>
                                        <span className="text-slate-500 hidden sm:inline">&lt;{msg.sender.match(/<(.*)>/)?.[1] || msg.sender}&gt;</span>
                                      </div>
                                      <div className="text-slate-500 font-medium text-[11px] sm:text-xs shrink-0">
                                        {(msg.date instanceof Date && !isNaN(msg.date.getTime()) ? msg.date : new Date(msg.date)).toLocaleString(undefined, { 
                                          weekday: 'short', 
                                          year: 'numeric', 
                                          month: 'short', 
                                          day: 'numeric', 
                                          hour: 'numeric', 
                                          minute: '2-digit' 
                                        })}
                                      </div>
                                    </div>
                                    <div>
                                      {idx === 0 && <h4 className="text-sm sm:text-base font-bold text-slate-900 mb-2 leading-snug">{msg.subject || '(No Subject)'}</h4>}
                                      <div className="bg-white p-3 sm:p-3.5 rounded-lg border border-slate-200 text-slate-700 text-xs sm:text-sm leading-relaxed whitespace-pre-wrap font-normal">
                                        {msg.snippet ? msg.snippet : <span className="italic text-slate-400">No snippet preview available for this message.</span>}
                                      </div>
                                    </div>
                                  </div>
                                ))}
                              </div>

                              <div className="flex flex-wrap items-center justify-between p-3 sm:p-4 gap-2 border-t border-slate-200/60 bg-slate-50">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  {folderFilters.includes('trash') ? (
                                    <button
                                      type="button"
                                      id={`single-del-${email.id}`}
                                      onClick={(e) => handleSingleAction(email.id, "delete", e)}
                                      disabled={actionLoading !== null || isProcessing}
                                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                      <span>Delete Forever</span>
                                    </button>
                                  ) : (
                                    <>
                                      <button
                                        type="button"
                                        id={`single-trash-${email.id}`}
                                        onClick={(e) => handleSingleAction(email.id, "trash", e)}
                                        disabled={actionLoading !== null || isProcessing}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200 transition-colors disabled:opacity-50 cursor-pointer"
                                      >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        <span>Trash</span>
                                      </button>
                                      <button
                                        type="button"
                                        id={`single-archive-${email.id}`}
                                        onClick={(e) => handleSingleAction(email.id, "archive", e)}
                                        disabled={actionLoading !== null || isProcessing}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-colors disabled:opacity-50 cursor-pointer"
                                      >
                                        <Archive className="w-3.5 h-3.5" />
                                        <span>Archive</span>
                                      </button>
                                    </>
                                  )}
                                  {email.labelIds?.includes('UNREAD') && (
                                    <button
                                      type="button"
                                      id={`single-read-${email.id}`}
                                      onClick={(e) => handleSingleAction(email.id, "read", e)}
                                      disabled={actionLoading !== null || isProcessing}
                                      className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 transition-colors disabled:opacity-50 cursor-pointer"
                                    >
                                      <CheckCircle className="w-3.5 h-3.5" />
                                      <span>Mark Read</span>
                                    </button>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  id={`single-collapse-${email.id}`}
                                  onClick={(e) => toggleExpand(email.id, e)}
                                  className="text-xs font-medium text-slate-600 hover:text-slate-900 flex items-center gap-1 px-2 py-1 hover:bg-slate-200 rounded-lg transition-colors ml-auto cursor-pointer"
                                >
                                  <ChevronUp className="w-3.5 h-3.5" />
                                  <span>Hide Preview</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      </li>
                    );
                  })}
                        </ul>
                        )}
                      </div>
                    );
                  })}
                </div>

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

      {showDeleteSelectedConfirm && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="p-5 sm:p-6 flex flex-col gap-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-600" />
                Delete Selected?
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                You are about to permanently delete {selectedIds.size} selected email(s). This action cannot be undone.
              </p>
            </div>
            <div className="bg-slate-50 px-5 py-4 flex gap-2 justify-end border-t border-slate-100">
              <button
                onClick={() => setShowDeleteSelectedConfirm(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 hover:text-slate-900 transition-colors shadow-sm"
              >
                Cancel
              </button>
              <button
                onClick={executeDeleteSelected}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors shadow-sm flex items-center gap-1.5"
              >
                Permanently Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showEmptyTrashConfirm && (
        <div className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-200">
            <div className="p-5 sm:p-6 flex flex-col gap-3">
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <Trash2 className="w-5 h-5 text-rose-600" />
                Empty Trash?
              </h2>
              <p className="text-sm text-slate-600 leading-relaxed">
                All emails in your Trash will be permanently deleted. You won't be able to recover them.
              </p>
            </div>
            <div className="bg-slate-50 px-5 py-4 flex gap-2 justify-end border-t border-slate-100">
              <button
                onClick={() => setShowEmptyTrashConfirm(false)}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 hover:text-slate-900 transition-colors shadow-sm"
              >
                Cancel
              </button>
              <button
                onClick={executeEmptyTrash}
                className="px-4 py-2 rounded-xl text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 transition-colors shadow-sm flex items-center gap-1.5"
              >
                Permanently Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showContextHelp && (
        <div 
          className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-3 sm:p-4 overscroll-contain backdrop-blur-sm"
          onClick={() => setShowContextHelp(false)}
        >
          <div 
            className="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200 border border-slate-200"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-5 sm:p-6 flex flex-col gap-4">
              <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                <HelpCircle className="w-6 h-6 text-indigo-600" />
                Help & Tips
              </h2>
              <div className="text-sm text-slate-600 space-y-4 leading-relaxed">
                {showHealth ? (
                  <p>You are viewing <strong>Inbox Health</strong>. This dashboard provides analytics about your email habits, highlights top senders, and helps you identify where most of your clutter is coming from.</p>
                ) : folderFilters.includes('trash') ? (
                  <>
                    <p>You are viewing the <strong>Trash</strong> folder. Emails here will be automatically deleted by Gmail after 30 days.</p>
                    <ul className="list-disc pl-5 space-y-2">
                      <li>Use <strong>Empty Trash</strong> to instantly and permanently remove everything in this folder.</li>
                      <li>Select specific emails and use <strong>Delete Selected</strong> to permanently remove only those items.</li>
                    </ul>
                    <div className="p-3 bg-amber-50 rounded-lg text-amber-800 text-xs font-medium flex gap-2 items-start mt-2 border border-amber-200/50">
                      <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
                      <p>Note: Deletions from the Trash are permanent and cannot be undone.</p>
                    </div>
                  </>
                ) : folderFilters.includes('archive') ? (
                  <p>You are viewing the <strong>Archive</strong>. These are emails you have removed from your main Inbox to keep it clean, but haven't deleted. They will remain here indefinitely unless you move them to Trash.</p>
                ) : (
                  <>
                    <p>You are viewing your <strong>Inbox</strong> (or a custom filter). From here, you can manage your messages efficiently:</p>
                    <ul className="list-disc pl-5 space-y-2">
                      <li><strong>Advanced Filtering:</strong> Use the filter bar to select multiple folders, set a date range, or toggle <strong>Unread Only / Exclude Sent</strong> to focus purely on new incoming messages.</li>
                      <li><strong>AI Natural Language Search:</strong> Use the search bar to find emails conversationally (e.g., <em>"show me receipts from last week"</em> or <em>"newsletters about ai"</em>).</li>
                      <li><strong>Smart Organize:</strong> Select multiple emails and use Organize to have AI categorize them or bulk apply labels.</li>
                      <li><strong>Archive:</strong> Removes the email from your Inbox but keeps it safe for future reference.</li>
                    </ul>
                  </>
                )}
              </div>
            </div>
            <div className="bg-slate-50 px-5 py-4 flex items-center justify-between border-t border-slate-100">
              <button
                onClick={() => {
                  setShowContextHelp(false);
                  localStorage.removeItem('hasSeenOnboarding');
                  setWalkthroughKey(prev => prev + 1);
                }}
                className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors"
              >
                Restart Tour
              </button>
              <button
                onClick={() => setShowContextHelp(false)}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 transition-colors shadow-sm"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      )}

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
                       if (p === 'gemini') saveSettings({...aiSettings, model: 'gemini-2.5-flash'});
                       if (p === 'openai') saveSettings({...aiSettings, model: 'gpt-4o-mini'});
                       if (p === 'anthropic') saveSettings({...aiSettings, model: 'claude-3-5-haiku-20241022'});
                       if (p === 'groq') saveSettings({...aiSettings, model: 'llama-3.1-8b-instant'});
                       if (p === 'deepseek') saveSettings({...aiSettings, model: 'deepseek-chat'});
                       if (p === 'zhipu') saveSettings({...aiSettings, model: 'glm-4-flash'});
                       if (p === 'mistral') saveSettings({...aiSettings, model: 'mistral-small-latest'});
                       if (p === 'grok') saveSettings({...aiSettings, model: 'grok-2-latest'});
                    }}
                    className="text-[11px] sm:text-xs font-semibold text-slate-600 bg-slate-200 hover:bg-slate-300 px-2 py-1 rounded transition-colors self-start sm:self-auto"
                  >
                    Auto-select fastest/cheapest model
                  </button>
                </div>
                
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 sm:gap-2 mb-3 sm:mb-4">
                  {['gemini', 'openai', 'anthropic', 'groq', 'deepseek', 'zhipu', 'mistral', 'grok'].map(p => (
                    <button
                      key={p}
                      onClick={() => saveSettings({...aiSettings, provider: p, model: (
    p === 'gemini' ? 'gemini-2.5-flash' :
    p === 'openai' ? 'gpt-4o-mini' :
    p === 'anthropic' ? 'claude-3-5-haiku-20241022' :
    p === 'groq' ? 'llama-3.1-8b-instant' :
    p === 'deepseek' ? 'deepseek-chat' :
    p === 'zhipu' ? 'glm-4-flash' :
    p === 'mistral' ? 'mistral-small-latest' :
    p === 'grok' ? 'grok-2-latest' : aiSettings.model
  )})}
                      className={cn("px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg border text-xs sm:text-sm font-medium capitalize text-center truncate", aiSettings.provider === p ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50')}
                    >
                      {p === 'zhipu' ? 'Zhipu (GLM)' : p === 'openai' ? 'ChatGPT' : p === 'grok' ? 'Grok (xAI)' : p}
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
                    placeholder={aiSettings.provider === 'zhipu' ? 'e.g. glm-4' : 'e.g. gemini-2.5-flash'}
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
                      aiSettings.provider === 'grok' ? 'https://console.x.ai/team/api-keys' :
                      'https://platform.deepseek.com/api_keys'
                    }
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="inline-block bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 font-medium px-3 py-2 rounded-lg transition-colors text-xs text-center shadow-sm"
                  >
                    Get {aiSettings.provider === 'zhipu' ? 'Zhipu (GLM)' : aiSettings.provider === 'openai' ? 'ChatGPT' : aiSettings.provider === 'grok' ? 'Grok (xAI)' : aiSettings.provider} API Key &rarr;
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
                {connectionStatus !== 'idle' && (
                  <div className={"mt-2 text-[11px] sm:text-xs font-medium flex items-center gap-1.5 px-2 py-1.5 rounded " + (
                    connectionStatus === 'testing' ? "bg-blue-50 text-blue-600" :
                    connectionStatus === 'success' ? "bg-emerald-50 text-emerald-600" :
                    "bg-red-50 text-red-600"
                  )}>
                    {connectionStatus === 'testing' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {connectionStatus === 'success' && <CheckCircle className="w-3.5 h-3.5" />}
                    {connectionStatus === 'error' && <AlertTriangle className="w-3.5 h-3.5" />}
                    {connectionMessage}
                  </div>
                )}
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
      <AdminPanel isOpen={showAdminPanel} onClose={() => setShowAdminPanel(false)} />
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

  const label = selected.includes('anywhere') || selected.length === 0 ? 'All Mail' : selected.length === 1 ? options.find(o => o.value === selected[0])?.label || selected[0].replace('category:', '') : `${selected.length} Folders`;

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
