import React, { useState, useEffect, useMemo, useRef, FormEvent } from "react";
import { Mail, Search, CheckCircle, Clock, Trash2, Archive, LogOut, ChevronDown, Filter, Calendar, Loader2, Settings, Inbox, RefreshCw, ShieldAlert, Eye, EyeOff, ChevronUp, HelpCircle, AlertTriangle, Flame, Activity, LayoutList, Folder, Tag, AlignJustify, HardDrive, SlidersHorizontal } from "lucide-react";
import { AdminPanel } from "./AdminPanel";
import { fetchGmailAPI, batchDeleteEmails, batchTrashEmails, batchArchiveEmails, batchMarkAsRead, processInChunks, countEmails, EmailData, emptyAllTrash, markAllAsReadByQuery } from "../lib/gmail";
import { InboxHealth } from "./InboxHealth";
import { TypingLoader } from "./TypingLoader";
import { OnboardingWalkthrough } from "./OnboardingWalkthrough";
import { BulkOrganizeDropdown } from "./BulkOrganizeDropdown";
import { WalkthroughTip } from "./WalkthroughTip";
import { HealthScoreWidget } from "./HealthScoreWidget";
import { LabelManagerModal } from "./LabelManagerModal";
import { CategoryDistributionModal } from "./CategoryDistributionModal";
import { UnsubscribeManager } from "./UnsubscribeManager";
import { SmartTriageModal } from "./SmartTriageModal";
import { HealthScoreModal } from "./HealthScoreModal";
import { FolderOptimizer } from "./FolderOptimizer";
import { CleanupPresetsBar, CleanupPreset } from "./CleanupPresetsBar";
import { StorageBreakdownBar } from "./StorageBreakdownBar";
import { RuleSuggester } from "./RuleSuggester";
import { FilteredEmailPage, FilterPageParams } from "./FilteredEmailPage";
import { ManageInboxPortal } from "./ManageInboxPortal";
import { SmartAutomationsPortal } from "./SmartAutomationsPortal";
import { QuickFiltersDropdown } from "./QuickFiltersDropdown";
import { cn } from "../lib/utils";

function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function Dashboard({ user, onLogout }: { user: any, onLogout?: () => void }) {
  const [walkthroughKey, setWalkthroughKey] = useState(0);
  const [query, setQueryState] = useState("");
  const queryRef = useRef(query);
  const setQuery = (newQuery: string) => {
    queryRef.current = newQuery;
    setQueryState(newQuery);
  };
  useEffect(() => { queryRef.current = query; }, [query]);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [includeSent, setIncludeSent] = useState(false);
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
  const [currentHash, setCurrentHash] = useState<string>("dashboard");
  const [filterPageParams, setFilterPageParams] = useState<FilterPageParams | null>(null);
  const [showHealth, setShowHealth] = useState(false);
  const [hasVisitedHealth, setHasVisitedHealth] = useState(false);
  const [processingIds, setProcessingIds] = useState<Set<string>>(new Set());
  const [processingProgress, setProcessingProgress] = useState<{current: number, total: number} | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [showEmptyTrashConfirm, setShowEmptyTrashConfirm] = useState(false);
  const [showDeleteSelectedConfirm, setShowDeleteSelectedConfirm] = useState(false);

  const [useAI, setUseAI] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showLabelManager, setShowLabelManager] = useState(false);
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [showContextHelp, setShowContextHelp] = useState(false);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [isScrolledDown, setIsScrolledDown] = useState(false);
  const [viewDensity, setViewDensity] = useState<"comfortable" | "compact">(() => {
    try {
      return (localStorage.getItem("ais_email_view_density") as "comfortable" | "compact") || "comfortable";
    } catch {
      return "comfortable";
    }
  });

  const toggleDensity = () => {
    setViewDensity(prev => {
      const next = prev === "comfortable" ? "compact" : "comfortable";
      try {
        localStorage.setItem("ais_email_view_density", next);
      } catch {}
      return next;
    });
  };

  const handleApplyPreset = (preset: CleanupPreset) => {
    setQuery(preset.query);
    setFolderFilters(preset.folderFilters || ['anywhere']);
    if (preset.sortBy) setSortBy(preset.sortBy);
    if (preset.sortDesc !== undefined) setSortDesc(preset.sortDesc);
    
    setTimeout(() => {
      handleSearch(undefined, preset.query, preset.folderFilters, true);
    }, 20);
  };

  useEffect(() => {
    const handleScroll = () => {
      // When scrolled past the top search box (~180px), show folder dropdown in sticky bar
      if (window.scrollY > 180) {
        setIsScrolledDown(true);
      } else {
        setIsScrolledDown(false);
      }
    };
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);
  const [adminConfig, setAdminConfig] = useState({
    enablePermanentDelete: false,
    useGlobalAiKey: false,
    globalAiKey: '',
    globalProvider: 'gemini'
  });

  const [aiSettings, setAiSettings] = useState({ provider: 'gemini', model: 'gemini-3.6-flash', apiKey: '' });

  const effectiveAiSettings = useMemo(() => {
    if (adminConfig.useGlobalAiKey && adminConfig.globalAiKey) {
      return {
        provider: adminConfig.globalProvider,
        apiKey: adminConfig.globalAiKey,
        model: adminConfig.globalProvider === 'openai' ? 'gpt-4o-mini' : 
               adminConfig.globalProvider === 'gemini' ? 'gemini-3.6-flash' : 
               adminConfig.globalProvider === 'anthropic' ? 'claude-3-5-haiku-20241022' : 'gemini-3.6-flash'
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
        
        // Use Promise.race to timeout getDoc after 3 seconds
        const docSnap = await Promise.race([
          getDoc(docRef),
          new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Firestore timeout')), 3000))
        ]);

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
          const errData = await res.json().catch(() => null);
          setConnectionStatus('error');
          setConnectionMessage(errData?.error || 'Invalid API key or quota exceeded.');
        }
      } catch (e: any) {
        setConnectionStatus('error');
        setConnectionMessage(e.message || 'Network error checking key.');
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
            if (effectiveAiSettings.provider === 'gemini') modelList = ['gemini-3.6-flash', 'gemini-2.5-pro', 'gemini-2.0-flash'];
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
            'gemini': 'gemini-3.6-flash',
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
        setAiSettings({ provider: 'gemini', model: 'gemini-3.6-flash', apiKey: '', ...parsed });
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
  }, [onlyUnread, includeSent, startDate, endDate]);

  const saveSettings = (s: any) => {
    setAiSettings(s);
    localStorage.setItem('adminAiSettings', JSON.stringify(s));
    if (s.apiKey) setUseAI(true);
  };

  const handleSearch = async (e?: FormEvent, customQuery?: string, customFilters?: string[], bypassAI: boolean = false) => {
    if (e) e.preventDefault();
    const textQuery = customQuery ?? query;
    // Removed early return so we can load all emails initially
    
    // Always anchor back to top when a new search is initiated
    window.scrollTo({ top: 0, behavior: 'smooth' });

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
    if (!includeSent) parts.push(`-in:sent`);
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
  }, [startDate, endDate, includeSent, onlyUnread]);

  useEffect(() => {
    fetchGmailAPI('/labels').then(data => {
      if (data && data.labels) setUserLabels(data.labels);
    });
    
  const handleHashChange = () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      const rawHash = decodeURIComponent(window.location.hash.replace('#', '')) || 'dashboard';
      const hashKey = rawHash.split('?')[0] || 'dashboard';
      const queryString = rawHash.includes('?') ? rawHash.slice(rawHash.indexOf('?') + 1) : '';
      const params = new URLSearchParams(queryString);

      setCurrentHash(hashKey);

      if (hashKey === 'health' || hashKey === 'sender-analytics') {
        setShowHealth(true);
        setHasVisitedHealth(true);
        setFilterPageParams(null);
      } else if (hashKey === 'filter-view' || hashKey === 'inspect') {
        setShowHealth(false);
        const filterParams: FilterPageParams = {
          title: params.get('title') || 'Filtered Messages',
          query: params.get('q') || '',
          badge: params.get('badge') || undefined,
          subtitle: params.get('sub') || undefined,
          folder: params.get('folder') || 'anywhere',
          sort: (params.get('sort') as any) || undefined,
          source: params.get('source') || 'health'
        };
        setFilterPageParams(filterParams);
        
        // Configure search query & filters for this page
        setQuery(filterParams.query);
        if (filterParams.sort) {
          setSortBy(filterParams.sort);
          setSortDesc(true);
        }
        let newFilters = ['anywhere'];
        if (filterParams.folder) {
          if (filterParams.folder === 'spam+trash') newFilters = ['spam', 'trash'];
          else if (filterParams.folder === 'inbox') newFilters = ['inbox'];
          else if (filterParams.folder.startsWith('category:')) newFilters = [filterParams.folder];
          else newFilters = [filterParams.folder];
        }
        setFolderFilters(newFilters);
        setTimeout(() => handleSearch(undefined, filterParams.query, newFilters, true), 0);
      } else if (['category-distribution', 'subscriptions', 'smart-triage', 'label-manager', 'health-score', 'folder-optimizer', 'rule-suggester', 'rules'].includes(hashKey)) {
        setShowHealth(false);
        setFilterPageParams(null);
      } else {
        setShowHealth(false);
        setFilterPageParams(null);
        let folders = ['anywhere'];
        if (hashKey.startsWith('folders=')) {
          folders = Array.from(new Set(hashKey.replace('folders=', '').split(',').filter(Boolean)));
        } else if (hashKey.startsWith('folder-')) { // Backwards compat
          folders = [hashKey.replace('folder-', '')];
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
      
      window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
        detail: { type: 'spam', count: ids.length, isPartial: true }
      }));
      if (filterPageParams?.source === 'sender-analytics') {
        window.dispatchEvent(new CustomEvent('sender_analytics_emails_removed', {
          detail: { query: filterPageParams.query, count: ids.length }
        }));
      }

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
      window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
        detail: { type: 'unread', count: emails.length, isPartial: false }
      }));
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

      window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
        detail: { type: 'spam', count: 9999, isPartial: false }
      }));
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
      if (action === "trash") {
        await batchTrashEmails(allMessageIds);
        window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
          detail: { type: 'promo', count: ids.length, isPartial: true }
        }));
        if (filterPageParams?.source === 'sender-analytics') {
          window.dispatchEvent(new CustomEvent('sender_analytics_emails_removed', {
            detail: { query: filterPageParams.query, count: ids.length }
          }));
        }
      } else if (action === "archive") {
        await batchArchiveEmails(allMessageIds);
        window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
          detail: { type: 'unread', count: ids.length, isPartial: true }
        }));
      } else if (action === "read") {
        await batchMarkAsRead(allMessageIds);
        window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
          detail: { type: 'unread', count: ids.length, isPartial: true }
        }));
      }
      
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
    const groups: Record<string, any[]> = {};
    
    const getPrimaryFolder = (email: any) => {
      const labels = email.labelIds || [];
      
      // 1. If active folder filters are set (and not 'anywhere'), match against active filters first
      if (folderFilters && folderFilters.length > 0 && !folderFilters.includes('anywhere')) {
        for (const f of folderFilters) {
          if (f === 'trash' && labels.includes('TRASH')) return 'Trash';
          if (f === 'spam' && labels.includes('SPAM')) return 'Spam';
          if (f === 'inbox' && labels.includes('INBOX')) return 'Primary Inbox';
          if (f === 'category:promotions' && labels.includes('CATEGORY_PROMOTIONS')) return 'Promotions';
          if (f === 'category:updates' && labels.includes('CATEGORY_UPDATES')) return 'Updates';
          if (f === 'category:social' && labels.includes('CATEGORY_SOCIAL')) return 'Social';
          if (f === 'category:forums' && labels.includes('CATEGORY_FORUMS')) return 'Forums';
          if (f === 'category:primary' && (labels.includes('CATEGORY_PERSONAL') || labels.includes('INBOX'))) return 'Primary Inbox';
          
          const userLabel = userLabels.find((ul: any) => ul.name === f || ul.id === f);
          if (userLabel && labels.includes(userLabel.id)) {
            return userLabel.name;
          }
        }
      }

      // 2. Trash & Spam ALWAYS take precedence over generic Google categories
      if (labels.includes('TRASH')) return 'Trash';
      if (labels.includes('SPAM')) return 'Spam';

      // 3. User-created Custom Labels
      const customLabel = labels.find((l: string) => 
        !l.startsWith('CATEGORY_') && 
        !['UNREAD', 'STARRED', 'IMPORTANT', 'INBOX', 'SENT', 'SPAM', 'TRASH', 'DRAFT', 'CHAT'].includes(l)
      );
      if (customLabel) {
        const userLabel = userLabels.find((ul: any) => ul.id === customLabel);
        return userLabel ? userLabel.name : customLabel.replace('Label_', 'Folder ');
      }
      
      // 4. Standard Categories
      if (labels.includes('CATEGORY_PERSONAL')) return 'Primary Inbox';
      if (labels.includes('CATEGORY_PROMOTIONS')) return 'Promotions';
      if (labels.includes('CATEGORY_UPDATES')) return 'Updates';
      if (labels.includes('CATEGORY_SOCIAL')) return 'Social';
      if (labels.includes('CATEGORY_FORUMS')) return 'Forums';
      if (labels.includes('INBOX')) return 'Primary Inbox';
      if (labels.includes('SENT')) return 'Sent';
      
      return 'Other';
    };

    filteredEmails.forEach((email: any) => {
      const folder = getPrimaryFolder(email);
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(email);
    });

    const orderPriority: Record<string, number> = {
      'Primary Inbox': 1,
      'Inbox': 2,
      'Promotions': 3,
      'Updates': 4,
      'Social': 5,
      'Forums': 6,
      'Spam': 7,
      'Trash': 8,
      'Other': 99
    };

    // Sort groups with priority and alphabetical order
    return Object.entries(groups)
      .map(([title, emails]) => ({ title, emails: emails as any[] }))
      .sort((a, b) => {
        const pA = orderPriority[a.title] ?? 50;
        const pB = orderPriority[b.title] ?? 50;
        if (pA !== pB) return pA - pB;
        return a.title.localeCompare(b.title);
      });
  }, [filteredEmails, shouldCategorize, userLabels, folderFilters]);

  return (
    <div className="min-h-screen bg-slate-50 font-sans text-slate-900 flex flex-col">
      <OnboardingWalkthrough key={walkthroughKey} onComplete={() => {}} />
      
      <header className="bg-white border-b border-slate-200 px-3 sm:px-6 py-2 sm:py-3.5 flex items-center justify-between sticky top-0 z-30 shadow-2xs">
        <div className="flex items-center gap-1.5 sm:gap-3">
          <div className="w-8 h-8 rounded-xl bg-slate-800 text-white flex items-center justify-center font-bold shrink-0 shadow-2xs">
            <Mail className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <h1 onDoubleClick={() => setShowAdminPanel(true)} className="text-base sm:text-xl font-bold tracking-tight text-slate-800 cursor-default select-none">MailFlow</h1>
          <div className="ml-1 sm:ml-2 border-l border-slate-200 pl-1.5 sm:pl-3 flex items-center">
            <HealthScoreWidget 
              onApplyQuery={(q, filter, sortOption) => {
                setQuery(q);
                if (sortOption) {
                  setSortBy(sortOption);
                  setSortDesc(true);
                }
                let newFilters = ['anywhere'];
                if (filter) {
                  if (filter === 'spam+trash') newFilters = ['spam', 'trash'];
                  else if (filter === 'inbox') newFilters = ['inbox'];
                  else if (filter.startsWith('category:')) newFilters = [filter];
                  else newFilters = [filter];
                }
                setFolderFilters(newFilters);
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
              onOpenUnsubscribe={() => {
                window.location.hash = '#health';
                setShowHealth(true);
              }}
            />
          </div>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2.5">
          <button 
            onClick={() => { 
              window.location.hash = ['health', 'category-distribution', 'subscriptions', 'smart-triage', 'label-manager', 'health-score'].includes(currentHash) 
                ? '#dashboard' 
                : '#health'; 
            }}
            className={cn(
              "px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer",
              ['health', 'category-distribution', 'subscriptions', 'smart-triage', 'label-manager', 'health-score'].includes(currentHash) 
                ? "bg-slate-800 text-white" 
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            )}
            title="Inbox Health & Storage Visualizer"
          >
            <Activity className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-500 shrink-0" /> 
            <span>{['health', 'category-distribution', 'subscriptions', 'smart-triage', 'label-manager', 'health-score'].includes(currentHash) ? "Dashboard" : "Health"}</span>
          </button>

          <button 
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-200 text-xs sm:text-sm font-medium transition-colors cursor-pointer"
            title="Settings & Display Options"
          >
            <Settings className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span className="hidden sm:inline">Settings</span>
          </button>

          <button 
            onClick={() => setShowContextHelp(true)}
            className="p-1.5 sm:p-2 rounded-xl bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors cursor-pointer"
            title="Help / Walkthrough"
          >
            <HelpCircle className="w-4 h-4 shrink-0" />
          </button>

          <button 
            onClick={onLogout} 
            className="p-1.5 sm:p-2 text-slate-400 hover:text-rose-600 rounded-xl hover:bg-slate-100 transition-colors cursor-pointer" 
            title="Log out"
          >
            <LogOut className="w-4 h-4 shrink-0" />
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-6xl mx-auto p-4 md:p-6 flex flex-col gap-6">
        
        {/* Breadcrumbs Navigation */}
        <div className="flex items-center gap-1.5 sm:gap-2 text-xs sm:text-sm text-slate-500 mb-[-12px] flex-wrap">
          <button 
            onClick={() => { window.location.hash = '#dashboard'; }} 
            className="hover:text-slate-900 transition-colors flex items-center gap-1 cursor-pointer font-medium"
          >
            <Inbox className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-slate-400" />
            <span>Dashboard</span>
          </button>
          
          {currentHash === 'health' && (
            <>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <span className="text-slate-900 font-semibold flex items-center gap-1">
                <Activity className="w-3.5 h-3.5 text-emerald-500" />
                Inbox Health
              </span>
            </>
          )}

          {currentHash === 'category-distribution' && (
            <>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <button 
                onClick={() => { window.location.hash = '#health'; }} 
                className="hover:text-slate-900 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-500" />
                Inbox Health
              </button>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <span className="text-slate-900 font-semibold">Category Breakdown</span>
            </>
          )}

          {currentHash === 'subscriptions' && (
            <>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <button 
                onClick={() => { window.location.hash = '#health'; }} 
                className="hover:text-slate-900 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-500" />
                Inbox Health
              </button>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <span className="text-slate-900 font-semibold">Subscriptions Manager</span>
            </>
          )}

          {currentHash === 'smart-triage' && (
            <>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <button 
                onClick={() => { window.location.hash = '#health'; }} 
                className="hover:text-slate-900 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-500" />
                Inbox Health
              </button>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <span className="text-slate-900 font-semibold">Smart Batch Organizer</span>
            </>
          )}

          {currentHash === 'label-manager' && (
            <>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <button 
                onClick={() => { window.location.hash = '#health'; }} 
                className="hover:text-slate-900 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-500" />
                Inbox Health
              </button>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <span className="text-slate-900 font-semibold">Folders & Labels</span>
            </>
          )}

          {currentHash === 'health-score' && (
            <>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <button 
                onClick={() => { window.location.hash = '#health'; }} 
                className="hover:text-slate-900 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-500" />
                Inbox Health
              </button>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <span className="text-slate-900 font-semibold">Inbox Health Score</span>
            </>
          )}

          {currentHash === 'folder-optimizer' && (
            <>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <button 
                onClick={() => { window.location.hash = '#health'; }} 
                className="hover:text-slate-900 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-500" />
                Inbox Health
              </button>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <span className="text-slate-900 font-semibold">Folder Optimizer & Rules</span>
            </>
          )}

          {(currentHash === 'rule-suggester' || currentHash === 'rules') && (
            <>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <button 
                onClick={() => { window.location.hash = '#health'; }} 
                className="hover:text-slate-900 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-500" />
                Inbox Health
              </button>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <span className="text-slate-900 font-semibold">Automated Sorting Rules</span>
            </>
          )}

          {(currentHash === 'filter-view' || currentHash === 'inspect') && filterPageParams && (
            <>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <button 
                onClick={() => {
                  window.location.hash = '#' + (filterPageParams.source || 'health');
                }} 
                className="hover:text-slate-900 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Activity className="w-3.5 h-3.5 text-emerald-500" />
                {filterPageParams.source === 'health-score'
                  ? 'Health Score'
                  : filterPageParams.source === 'rule-suggester'
                  ? 'Automated Rules'
                  : filterPageParams.source === 'sender-analytics'
                  ? 'Sender Analytics'
                  : 'Inbox Health'}
              </button>
              <ChevronDown className="w-3.5 h-3.5 -rotate-90 text-slate-400" />
              <span className="text-slate-900 font-semibold truncate max-w-[220px] sm:max-w-none">
                {filterPageParams.title}
              </span>
            </>
          )}

          {currentHash !== 'health' && !['category-distribution', 'subscriptions', 'smart-triage', 'label-manager', 'health-score', 'folder-optimizer', 'rule-suggester', 'rules', 'filter-view', 'inspect'].includes(currentHash) && folderFilters.length > 0 && !(folderFilters.length === 1 && folderFilters[0] === 'anywhere') && (
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

        {hasVisitedHealth && (
          <div className={(currentHash === 'health' || currentHash === 'sender-analytics') ? '' : 'hidden'}>
          <InboxHealth
             userEmail={user?.email}
             aiSettings={aiSettings} 
             userLabels={userLabels}
             isAiWorking={connectionStatus === 'success'}
             onRefresh={() => handleSearch()}
             onApplyQuery={(q, filter, sortOption) => {
               setQuery(q);
               if (sortOption) {
                 setSortBy(sortOption);
                 setSortDesc(true);
               }
               let newFilters = ['anywhere'];
               if (filter) {
                 if (filter === 'spam+trash') newFilters = ['spam', 'trash'];
                 else if (filter === 'inbox') newFilters = ['inbox'];
                 else if (filter.startsWith('category:')) newFilters = [filter];
                 else newFilters = [filter];
               }
               setFolderFilters(newFilters);
               
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
          </div>
        )}

        {currentHash === 'category-distribution' && (
          <CategoryDistributionModal
            isPage={true}
            isOpen={true}
            onClose={() => { window.location.hash = '#health'; }}
            onApplyCategory={(q, filter, sortOption) => {
              setQuery(q);
              if (sortOption) {
                 setSortBy(sortOption);
                 setSortDesc(true);
               }
               let newFilters = ['anywhere'];
               if (filter) {
                 if (filter === 'spam+trash') newFilters = ['spam', 'trash'];
                 else if (filter === 'inbox') newFilters = ['inbox'];
                 else if (filter.startsWith('category:')) newFilters = [filter];
                 else newFilters = [filter];
               }
               setFolderFilters(newFilters);
               const newHash = newFilters.length > 0 && !(newFilters.length === 1 && newFilters[0] === 'anywhere')
                 ? `#folders=${newFilters.join(',')}` 
                 : '#dashboard';
               window.location.hash = newHash;
               setTimeout(() => handleSearch(undefined, q, newFilters, true), 0);
            }}
            userLabels={userLabels}
            aiSettings={aiSettings}
            userEmail={user?.email}
            onRefresh={() => handleSearch()}
          />
        )}
        
        {currentHash === 'manage-inbox' && (
          <ManageInboxPortal
            userLabels={userLabels}
            aiSettings={aiSettings}
            onClose={() => { window.location.hash = '#health'; }}
            onRefreshLabels={() => {
              fetchGmailAPI('/labels').then(data => {
                if (data && data.labels) setUserLabels(data.labels);
              });
              handleSearch();
            }}
            onApplyQuery={(q, filter, sortOption) => {
              setQuery(q);
              if (sortOption) {
                setSortBy(sortOption);
                setSortDesc(true);
              }
              let newFilters = ['anywhere'];
              if (filter) {
                if (filter === 'spam+trash') newFilters = ['spam', 'trash'];
                else if (filter === 'inbox') newFilters = ['inbox'];
                else if (filter.startsWith('category:')) newFilters = [filter];
                else newFilters = [filter];
              }
              setFolderFilters(newFilters);
              const newHash = newFilters.length > 0 && !(newFilters.length === 1 && newFilters[0] === 'anywhere')
                ? `#folders=${newFilters.join(',')}` 
                : '#dashboard';
              window.location.hash = newHash;
              setTimeout(() => handleSearch(undefined, q, newFilters, true), 0);
            }}
          />
        )}
        {currentHash === 'smart-automations' && (
          <SmartAutomationsPortal
            userEmail={user?.email}
            userLabels={userLabels}
            emails={emails}
            aiSettings={aiSettings}
            isSearching={isSearching}
            connectionStatus={connectionStatus}
            onClose={() => { window.location.hash = '#health'; }}
            onRefresh={() => handleSearch()}
            onSearchQuery={(q) => {
              setQuery(q);
              window.location.hash = '#dashboard';
              setTimeout(() => handleSearch(undefined, q, ['anywhere'], true), 0);
            }}
          />
        )}
        {currentHash === 'health-score' && (
          <HealthScoreModal
            isPage={true}
            isOpen={true}
            onClose={() => { window.location.hash = '#health'; }}
            onApplyQuery={(q, filter, sortOption) => {
              setQuery(q);
              if (sortOption) {
                setSortBy(sortOption);
                setSortDesc(true);
              }
              let newFilters = ['anywhere'];
              if (filter) {
                if (filter === 'spam+trash') newFilters = ['spam', 'trash'];
                else if (filter === 'inbox') newFilters = ['inbox'];
                else if (filter.startsWith('category:')) newFilters = [filter];
                else newFilters = [filter];
              }
              setFolderFilters(newFilters);
              const newHash = newFilters.length > 0 && !(newFilters.length === 1 && newFilters[0] === 'anywhere')
                ? `#folders=${newFilters.join(',')}` 
                : '#dashboard';
              window.location.hash = newHash;
              setTimeout(() => handleSearch(undefined, q, newFilters, true), 0);
            }}
            onOpenUnsubscribe={() => { window.location.hash = '#manage-inbox'; }}
          />
        )}
        
        {currentHash === 'folder-optimizer' && (
          <FolderOptimizer
            emails={emails}
            userLabels={userLabels}
            aiSettings={aiSettings}
            isFetching={isSearching}
            isAiWorking={connectionStatus === 'success'}
            onReload={() => handleSearch()}
          />
        )}
        
        {currentHash === 'rule-suggester' && (
          <RuleSuggester
            isPage={true}
            onClose={() => { window.location.hash = '#health'; }}
            userLabels={userLabels}
            recentEmails={emails}
            aiSettings={aiSettings}
            isAiWorking={connectionStatus === 'success'}
          />
        )}

        {(currentHash === 'filter-view' || currentHash === 'inspect') && filterPageParams && (
          <FilteredEmailPage
            params={filterPageParams}
            emails={emails}
            isSearching={isSearching}
            totalCount={totalCount}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onSelectAll={() => {
              if (selectedIds.size === emails.length && emails.length > 0) {
                setSelectedIds(new Set());
              } else {
                setSelectedIds(new Set(emails.map(e => e.id)));
              }
            }}
            onClearSelection={() => setSelectedIds(new Set())}
            onDeleteSelected={handleDeleteSelected}
            onArchiveSelected={() => handleBulkAction("archive")}
            onMarkReadSelected={() => handleBulkAction("read")}
            onStarSelected={() => {}}
            userLabels={userLabels}
            viewDensity={viewDensity}
            setViewDensity={setViewDensity}
            onLoadMore={handleLoadMore}
            hasMore={!!nextPageToken}
            isLoadingMore={isLoadingMore}
            onRefresh={() => handleSearch(undefined, filterPageParams.query, folderFilters, true)}
            onBack={() => { window.location.hash = '#' + (filterPageParams.source || 'health'); }}
            actionLoading={actionLoading}
          />
        )}
        <div style={{ display: !['health', 'category-distribution', 'manage-inbox', 'smart-automations', 'health-score', 'filter-view', 'inspect', 'folder-optimizer', 'rule-suggester'].includes(currentHash) ? 'block' : 'none' }}>
        <WalkthroughTip 
          storageKey="tip_dashboard" 
          title="Welcome to your MailFlow Workspace" 
          description="Try out the new 'Inbox Health' button above to unleash the automated Folder Optimizer, or select multiple emails below to test out Smart Organize Analytics and the Rule Suggester!"
        />
        <div className="bg-white p-3.5 sm:p-6 rounded-2xl shadow-sm border border-slate-200 flex flex-col gap-3 sm:gap-4 relative z-30">
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

          <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 mt-1 pb-2 relative z-30">
            <QuickFiltersDropdown onApplyPreset={handleApplyPreset} />
            <FolderMultiSelect 
              selected={folderFilters} 
              onChange={(newFilters) => {
                const newHash = newFilters.length > 0 && !(newFilters.length === 1 && newFilters[0] === 'anywhere')
                  ? `#folders=${newFilters.join(',')}` 
                  : '#dashboard';
                
                if (window.location.hash !== newHash) {
                  window.location.hash = newHash;
                }
                setFolderFilters(newFilters);
              }} 
              userLabels={userLabels} 
              onOpenLabelManager={() => setShowLabelManager(true)}
            />
            <DateRangeFilter startDate={startDate} endDate={endDate} onStartChange={setStartDate} onEndChange={setEndDate} />
            <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer group bg-slate-50 border border-slate-200 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full hover:bg-slate-100 transition-colors shrink-0">
              <input type="checkbox" checked={onlyUnread} onChange={e => setOnlyUnread(e.target.checked)} className="rounded text-slate-700 focus:ring-slate-500 border-slate-300 w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="text-xs sm:text-sm font-medium text-slate-700 group-hover:text-slate-900 whitespace-nowrap">Unread Only</span>
            </label>
            <label className="flex items-center gap-1.5 sm:gap-2 cursor-pointer group bg-slate-50 border border-slate-200 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-full hover:bg-slate-100 transition-colors shrink-0">
              <input type="checkbox" checked={includeSent} onChange={e => setIncludeSent(e.target.checked)} className="rounded text-slate-600 focus:ring-slate-500 border-slate-300 w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span className="text-xs sm:text-sm font-medium text-slate-700 group-hover:text-slate-900 whitespace-nowrap">Include Sent</span>
            </label>
          </div>

          <CleanupPresetsBar 
            currentQuery={query}
            currentFolders={folderFilters}
            currentSortBy={sortBy}
            currentSortDesc={sortDesc}
            onApplyPreset={handleApplyPreset}
            className="pt-2 border-t border-slate-100"
          />
        </div>

        {parsedQuery && (
          <div className="bg-slate-100 border border-slate-200 rounded-xl p-4 flex gap-3 text-sm animate-in fade-in slide-in-from-top-2">
            <Filter className="w-5 h-5 text-slate-600 shrink-0" />
            <div>
              <p className="font-medium text-slate-800">Query Interpretation</p>
              <p className="text-slate-600 mt-1">{parsedQuery.explanation}</p>
              <p className="mt-2 text-xs font-mono bg-slate-200 inline-block px-2 py-1 rounded text-slate-700">Gmail Search: {parsedQuery.query}</p>
            </div>
          </div>
        )}

        <div className="bg-white rounded-2xl shadow-xs border border-slate-200 flex flex-col flex-1 relative z-10">
          <div className="sticky top-[57px] sm:top-[65px] z-10 bg-white flex flex-col border-b border-slate-200 rounded-t-2xl shadow-2xs">
            <div className="p-2.5 sm:p-3 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2.5 sm:gap-3">
              <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                <button 
                  type="button"
                  id="select-all-emails-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (emails.length === 0) return;
                    const isAllSelected = selectedIds.size > 0 && emails.every(item => selectedIds.has(item.id));
                    if (isAllSelected) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(emails.map(item => item.id)));
                    }
                  }}
                  className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors shrink-0 cursor-pointer"
                  disabled={emails.length === 0}
                  title={selectedIds.size > 0 && emails.every(item => selectedIds.has(item.id)) ? "Deselect all" : "Select all"}
                >
                  <div className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors shadow-2xs", selectedIds.size > 0 && emails.every(item => selectedIds.has(item.id)) ? "bg-slate-800 border-slate-800" : selectedIds.size > 0 ? "bg-slate-800/80 border-slate-800" : "border-slate-300 bg-white")}>
                    {selectedIds.size > 0 && <CheckCircle className="w-3 h-3 text-white" />}
                  </div>
                </button>

                {isScrolledDown && (
                  <div className="animate-in fade-in zoom-in-95 duration-150">
                    <FolderMultiSelect 
                      selected={folderFilters} 
                      onChange={(newFilters) => {
                        const newHash = newFilters.length > 0 && !(newFilters.length === 1 && newFilters[0] === 'anywhere')
                          ? `#folders=${newFilters.join(',')}` 
                          : '#dashboard';
                        
                        if (window.location.hash !== newHash) {
                          window.location.hash = newHash;
                        }
                        setFolderFilters(newFilters);
                      }} 
                      userLabels={userLabels} 
                      onOpenLabelManager={() => setShowLabelManager(true)}
                    />
                  </div>
                )}

                <span className="text-xs sm:text-sm font-semibold text-slate-700 whitespace-nowrap">
                  {selectedIds.size > 0 ? (
                    <span className="text-slate-700 bg-slate-50 border border-slate-100 px-2 py-0.5 rounded-md font-bold flex items-center gap-1.5">
                      <span>{selectedIds.size} selected</span>
                      <button 
                        onClick={() => setSelectedIds(new Set())}
                        className="text-[10px] text-slate-500 hover:text-slate-800 underline font-medium ml-0.5 cursor-pointer"
                      >
                        Clear
                      </button>
                    </span>
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
              
              <div className="flex items-center justify-between sm:justify-end gap-2 flex-wrap sm:flex-nowrap">
                {selectedIds.size === 0 ? (
                  <>
                    {/* Search & Sort Capsule */}
                    <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg p-0.5 shrink-0">
                      <div className="relative border-r border-slate-200 pr-1 flex items-center">
                        <Search className="absolute left-2 w-3.5 h-3.5 text-slate-400 pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Filter view..."
                          value={localKeyword}
                          onChange={e => setLocalKeyword(e.target.value)}
                          className="bg-transparent text-xs sm:text-sm font-medium text-slate-700 outline-none pl-7 pr-2 py-1 w-20 sm:w-32 focus:w-40 transition-all"
                        />
                      </div>
                      <select 
                        value={sortBy} 
                        onChange={(e: any) => setSortBy(e.target.value)} 
                        className="bg-transparent text-xs sm:text-sm font-medium text-slate-700 outline-none px-1.5 py-1 cursor-pointer"
                      >
                        <option value="date">Date</option>
                        <option value="size">Size</option>
                        <option value="sender">Sender</option>
                      </select>
                      <button 
                        onClick={() => setSortDesc(!sortDesc)} 
                        className="p-1 hover:bg-slate-200 rounded text-slate-500 transition-colors cursor-pointer" 
                        title="Toggle sort direction"
                      >
                        <Filter className={cn("w-3.5 h-3.5 transition-transform", !sortDesc && "rotate-180")} />
                      </button>
                    </div>

                    {/* Prominent View Density Segmented Switcher */}
                    <div className="flex items-center bg-slate-100 p-0.5 rounded-lg border border-slate-200/90 shrink-0" title="Switch layout density">
                      <button
                        type="button"
                        onClick={() => {
                          setViewDensity("comfortable");
                          try { localStorage.setItem("ais_email_view_density", "comfortable"); } catch {}
                        }}
                        className={cn(
                          "px-2 sm:px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer",
                          viewDensity === "comfortable"
                            ? "bg-white text-slate-900 shadow-2xs font-bold"
                            : "text-slate-500 hover:text-slate-800"
                        )}
                        title="Comfortable view with snippets"
                      >
                        <LayoutList className="w-3.5 h-3.5" />
                        <span>Comfortable</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setViewDensity("compact");
                          try { localStorage.setItem("ais_email_view_density", "compact"); } catch {}
                        }}
                        className={cn(
                          "px-2 sm:px-2.5 py-1 rounded-md text-xs font-semibold transition-all flex items-center gap-1 cursor-pointer",
                          viewDensity === "compact"
                            ? "bg-white text-slate-900 shadow-2xs font-bold"
                            : "text-slate-500 hover:text-slate-800"
                        )}
                        title="Compact single-line dense view"
                      >
                        <AlignJustify className="w-3.5 h-3.5" />
                        <span>Compact</span>
                      </button>
                    </div>

                    {/* Quick Mark All Read button */}
                    <ActionButton 
                      icon={<CheckCircle className="w-3.5 h-3.5" />} 
                      label="Mark All Read" 
                      onClick={executeMarkAllRead} 
                      disabled={emails.length === 0 || actionLoading !== null} 
                      loading={actionLoading === "read"} 
                      className="bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200 shrink-0 shadow-2xs" 
                      title="Mark all unread emails in this view as read" 
                    />
                  </>
                ) : (
                  /* Action Bar when emails are selected */
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap shrink-0">
                    {folderFilters.includes('trash') ? (
                      adminConfig.enablePermanentDelete && (
                        <>
                          <ActionButton 
                            icon={<Trash2 className="w-3.5 h-3.5" />} 
                            label="Delete Forever" 
                            onClick={handleDeleteSelected} 
                            disabled={actionLoading !== null} 
                            loading={actionLoading === "delete"} 
                            className="text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200" 
                          />
                          <ActionButton 
                            icon={<Flame className="w-3.5 h-3.5" />} 
                            label="Empty Trash" 
                            onClick={handleEmptyTrash} 
                            disabled={actionLoading !== null || emails.length === 0} 
                            loading={actionLoading === "empty_trash"} 
                            className="text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200" 
                          />
                        </>
                      )
                    ) : (
                      <>
                        <ActionButton 
                          icon={<Trash2 className="w-3.5 h-3.5" />} 
                          label="Trash" 
                          onClick={() => handleBulkAction("trash")} 
                          disabled={actionLoading !== null} 
                          loading={actionLoading === "trash"} 
                          className="text-rose-600 bg-rose-50 hover:bg-rose-100 border border-rose-200" 
                        />
                        <ActionButton 
                          icon={<Archive className="w-3.5 h-3.5" />} 
                          label="Archive" 
                          onClick={() => handleBulkAction("archive")} 
                          disabled={actionLoading !== null} 
                          loading={actionLoading === "archive"} 
                          className="text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200" 
                        />
                      </>
                    )}
                    
                    <BulkOrganizeDropdown 
                      selectedIds={selectedIds} 
                      emails={emails} 
                      userLabels={userLabels || []}
                      aiSettings={aiSettings}
                      onComplete={() => {
                        setSelectedIds(new Set());
                        setIsSearching(true);
                        setTimeout(() => handleSearch(), 500);
                      }} 
                      disabled={actionLoading !== null} 
                    />
                    
                    <ActionButton 
                      icon={<CheckCircle className="w-3.5 h-3.5" />} 
                      label="Mark Read" 
                      onClick={() => handleBulkAction("read")} 
                      disabled={actionLoading !== null} 
                      loading={actionLoading === "read"} 
                      className="bg-slate-50 text-slate-700 hover:bg-slate-100 border border-slate-200" 
                    />
                  </div>
                )}
              </div>
            </div>

            {isActuallyUnreadOnly && (
              <div className="flex items-center px-3 pb-1 overflow-x-auto no-scrollbar border-t border-slate-200/60 bg-slate-50/50 pt-2 gap-1.5 sm:gap-2">
                {(() => {
                  const unreadTabs = [{ id: 'anywhere', label: 'All Unread' }];
                  const sysMap: Record<string, string> = {
                    'CATEGORY_PERSONAL': 'Primary',
                    'CATEGORY_PROMOTIONS': 'Promotions',
                    'CATEGORY_UPDATES': 'Updates',
                    'CATEGORY_SOCIAL': 'Social',
                    'CATEGORY_FORUMS': 'Forums'
                  };
                  userLabels.forEach(l => {
                    if (l.type === 'system' && sysMap[l.id]) {
                      let query = l.id.startsWith('CATEGORY_') ? `category:${l.id.replace('CATEGORY_', '').toLowerCase()}` : `in:${l.id.toLowerCase()}`;
                      if (query === 'category:personal') query = 'category:primary';
                      unreadTabs.push({ id: query, label: sysMap[l.id] });
                    }
                  });
                  return unreadTabs;
                })().map(tab => {
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
                        "px-3 sm:px-4 py-1.5 rounded-t-lg text-xs sm:text-sm font-semibold transition-all shrink-0 border-b-2",
                        isActive 
                          ? "text-slate-600 border-slate-600 bg-slate-50/50"
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
            <div className="bg-amber-50/90 border-b border-amber-200 px-3 sm:px-4 py-2.5 flex items-center gap-2.5 text-amber-900 text-xs sm:text-sm">
              <ShieldAlert className="w-4 h-4 shrink-0 text-amber-700" />
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-semibold text-amber-950">You are viewing Trash.</span>
                <span className="text-amber-800">Emails here will be automatically deleted by Gmail after 30 days.</span>
                {!adminConfig.enablePermanentDelete && (
                  <span className="text-amber-700/90">To empty immediately, please use the official Gmail app.</span>
                )}
              </div>
            </div>
          )}

          <div className="flex-1 flex flex-col">
            {emails.length === 0 ? (
              (isSearching || isLoadingMore) ? (
                <div className="flex flex-col items-center justify-center h-96 text-slate-400 px-4 text-center">
                  <TypingLoader 
                    title="Loading Messages" 
                    messages={[
                      "Fetching emails from Gmail...",
                      "Applying current filters...",
                      "Sorting inbox...",
                      "Preparing view..."
                    ]} 
                  />
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
                            className="bg-slate-50/90 px-4 py-2.5 border-y border-slate-200/90 font-semibold text-slate-800 text-xs sm:text-sm flex items-center justify-between shadow-2xs cursor-pointer hover:bg-slate-100/90 transition-colors"
                          >
                            <div className="flex items-center gap-2.5 sm:gap-3">
                              <div 
                                className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors shadow-2xs", group.emails.length > 0 && group.emails.every(e => selectedIds.has(e.id)) ? "bg-slate-800 border-slate-800" : "border-slate-300 bg-white")}
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
                                <ChevronDown className={cn("w-4 h-4 text-slate-500 transition-transform", isCollapsed && "-rotate-90")} />
                                {(() => {
                                  if (group.title === 'Trash') return <Trash2 className="w-4 h-4 text-rose-500" />;
                                  if (group.title === 'Spam') return <ShieldAlert className="w-4 h-4 text-amber-500" />;
                                  if (group.title === 'Promotions') return <Tag className="w-4 h-4 text-amber-600" />;
                                  if (group.title === 'Updates') return <Activity className="w-4 h-4 text-emerald-600" />;
                                  if (group.title === 'Social') return <Mail className="w-4 h-4 text-slate-600" />;
                                  if (group.title === 'Primary Inbox' || group.title === 'Inbox' || group.title === 'Primary') return <Inbox className="w-4 h-4 text-blue-600" />;
                                  return <Folder className="w-4 h-4 text-slate-500" />;
                                })()}
                                <span>{group.title}</span>
                              </div>
                            </div>
                            <span className="text-[11px] sm:text-xs bg-white px-2.5 py-0.5 rounded-full border border-slate-200 text-slate-600 font-bold shadow-2xs">{group.emails.length}</span>
                          </div>
                        )}
                        {!isCollapsed && (
                        <ul className="divide-y divide-slate-100">
                          {group.emails.map(email => {
                    const isSelected = selectedIds.has(email.id);
                    const isProcessing = processingIds.has(email.id);
                    const isExpanded = expandedIds.has(email.id);
                    const isUnread = email.labelIds?.includes('UNREAD');

                    if (viewDensity === 'compact') {
                      return (
                        <li 
                          key={email.id} 
                          id={`email-row-${email.id}`}
                          className={cn(
                            "px-3 sm:px-4 py-2 hover:bg-slate-50 active:bg-slate-100/70 transition-colors group cursor-pointer border-b border-slate-100 last:border-b-0",
                            isSelected ? "bg-slate-50/80" : "",
                            isProcessing ? "opacity-50 grayscale" : ""
                          )}
                          onClick={() => !isProcessing && toggleSelect(email.id)}
                        >
                          <div className="flex items-center gap-2.5 sm:gap-3.5">
                            <div className="shrink-0">
                              <div className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors", isSelected ? "bg-slate-800 border-slate-800" : "border-slate-300 bg-white")}>
                                {isSelected && <CheckCircle className="w-3 h-3 text-white" />}
                              </div>
                            </div>

                            <span 
                              className={cn("w-28 sm:w-44 shrink-0 text-xs sm:text-sm truncate", isUnread ? "font-bold text-slate-900" : "font-medium text-slate-700")} 
                              title={email.sender}
                            >
                              {email.sender.replace(/<.*>/, "").trim() || email.sender}
                            </span>

                            <div className="flex-1 min-w-0 flex items-center gap-1.5 sm:gap-2">
                              {(() => {
                                const labels = email.labelIds || [];
                                if (shouldCategorize) return null;
                                let firstBadge: { text: string; color: string } | null = null;
                                if (labels.includes('SPAM')) firstBadge = { text: 'Spam', color: 'bg-red-50 text-red-700 border-red-100' };
                                else if (labels.includes('TRASH')) firstBadge = { text: 'Trash', color: 'bg-red-50 text-red-700 border-red-100' };
                                else if (labels.includes('CATEGORY_PROMOTIONS')) firstBadge = { text: 'Promotions', color: 'bg-amber-50 text-amber-700 border-amber-100' };
                                else if (labels.includes('CATEGORY_UPDATES')) firstBadge = { text: 'Updates', color: 'bg-green-50 text-green-700 border-green-100' };
                                else if (labels.includes('CATEGORY_SOCIAL')) firstBadge = { text: 'Social', color: 'bg-slate-50 text-slate-700 border-slate-100' };
                                
                                if (!firstBadge) return null;
                                return (
                                  <span className={cn("hidden md:inline-block text-[9px] font-bold border px-1.5 py-0.5 rounded shrink-0", firstBadge.color)}>
                                    {firstBadge.text}
                                  </span>
                                );
                              })()}

                              <span className={cn("text-xs sm:text-sm truncate shrink-0 max-w-[45%]", isUnread ? "font-bold text-slate-900" : "font-medium text-slate-800")}>
                                {email.subject}
                              </span>
                              <span className="text-xs text-slate-400 font-normal truncate hidden sm:inline">
                                - {email.snippet}
                              </span>
                            </div>

                            {showSize && (email.sizeEstimate || 0) > 102400 && (
                              <span className={cn(
                                "hidden lg:inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded shadow-xs border shrink-0",
                                (email.sizeEstimate || 0) > 5242880 ? "bg-red-50 text-red-700 border-red-200" : 
                                (email.sizeEstimate || 0) > 1048576 ? "bg-amber-50 text-amber-700 border-amber-200" : 
                                "bg-slate-50 text-slate-600 border-slate-200"
                              )}>
                                {formatSize(email.sizeEstimate || 0)}
                              </span>
                            )}

                            <span className={cn("text-[11px] sm:text-xs tabular-nums shrink-0 whitespace-nowrap", isUnread ? "font-bold text-slate-700" : "font-medium text-slate-500")}>
                              {(email.date instanceof Date && !isNaN(email.date.getTime()) ? email.date : new Date(email.date)).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                            </span>

                            <button
                              type="button"
                              id={`preview-btn-${email.id}`}
                              onClick={(e) => toggleExpand(email.id, e)}
                              className={cn(
                                "p-1 sm:px-2 sm:py-0.5 rounded-md border text-[11px] font-semibold transition-all shrink-0 cursor-pointer",
                                isExpanded
                                  ? "bg-slate-800 text-white border-slate-800 shadow-xs"
                                  : "bg-slate-100 hover:bg-slate-200 text-slate-700 border-slate-200"
                              )}
                              title={isExpanded ? "Collapse thread" : "Preview email"}
                            >
                              {isExpanded ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3 text-slate-600" />}
                              <span className="hidden sm:inline ml-1">{isExpanded ? "Hide" : "Preview"}</span>
                            </button>
                          </div>

                          {isExpanded && (
                            <div 
                              id={`email-preview-card-${email.id}`}
                              className="mt-2.5 bg-slate-50 border border-slate-200/90 rounded-xl flex flex-col shadow-inner select-text cursor-default overflow-hidden"
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
                        </li>
                      );
                    }

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
                            <span className={cn("text-sm sm:text-base truncate", isUnread ? "font-bold text-slate-900" : "font-semibold text-slate-700")} title={email.sender}>
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
                              <span className={cn("text-[11px] sm:text-xs tabular-nums", isUnread ? "font-bold text-slate-700" : "font-medium text-slate-500")}>
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
                                    else if (l === 'CATEGORY_SOCIAL') badges.push({ text: 'Social', color: 'bg-slate-50 text-slate-700 border-slate-100' });
                                    else if (l === 'CATEGORY_UPDATES') badges.push({ text: 'Updates', color: 'bg-green-50 text-green-700 border-green-100' });
                                    else if (l === 'CATEGORY_FORUMS') badges.push({ text: 'Forums', color: 'bg-slate-100 text-slate-700 border-slate-200' });
                                    else if (l === 'CATEGORY_PERSONAL') badges.push({ text: 'Primary', color: 'bg-blue-50 text-blue-700 border-blue-100' });
                                 } else if (l === 'SENT') {
                                    badges.push({ text: 'Sent', color: 'bg-slate-100 text-slate-600 border-slate-200' });
                                 } else if (l === 'INBOX' && !labels.some(x => x.startsWith('CATEGORY_'))) {
                                    badges.push({ text: 'Inbox', color: 'bg-slate-50 text-slate-700 border-slate-100' });
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
                                     <span key={i} className={cn(
                                       "inline-block text-[10px] font-semibold border px-1.5 py-0.5 rounded truncate max-w-[80px] sm:max-w-[100px]",
                                       b.color,
                                       i > 0 ? "hidden sm:inline-block" : ""
                                     )}>
                                       {b.text}
                                     </span>
                                   ))}
                                   {uniqueBadges.length > 3 && (
                                     <span className="hidden sm:inline-block text-[10px] font-semibold border px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border-slate-200">
                                       +{uniqueBadges.length - 3}
                                     </span>
                                   )}
                                 </div>
                               );
                            })()}
                            <p className={cn("text-xs sm:text-sm truncate", isUnread ? "font-bold text-slate-900" : "font-medium text-slate-800")}>{email.subject}</p>
                          </div>
                          {!isExpanded && (
                            <p className={cn("text-xs sm:text-sm truncate mt-0.5", isUnread ? "font-medium text-slate-700" : "text-slate-500")}>{email.snippet}</p>
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
                      className="flex items-center gap-2 px-5 sm:px-6 py-2.5 bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-200 hover:border-slate-300 text-slate-700 font-medium rounded-xl text-xs sm:text-sm transition-all shadow-sm disabled:opacity-60 disabled:cursor-wait"
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
        </div>
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
                className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 transition-colors shadow-sm flex items-center gap-1.5"
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
                className="px-4 py-2 rounded-xl text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 transition-colors shadow-sm flex items-center gap-1.5"
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
                <HelpCircle className="w-6 h-6 text-slate-600" />
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
                      <li><strong>Advanced Filtering:</strong> Use the filter bar to select multiple folders, set a date range, or toggle <strong>Unread Only / Include Sent</strong> to focus purely on new incoming messages.</li>
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
                className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors"
              >
                Restart Tour
              </button>
              <button
                onClick={() => setShowContextHelp(false)}
                className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 transition-colors shadow-sm"
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
              <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-600 font-medium text-xl leading-none">&times;</button>
            </div>
            <div className="p-3.5 sm:p-6 flex flex-col gap-4 sm:gap-5 overflow-y-auto">
              
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 sm:p-4 text-sm text-slate-700">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                  <span className="font-bold text-xs sm:text-sm">1. Select Model Provider</span>
                  <button 
                    onClick={() => {
                       const p = aiSettings.provider;
                       if (p === 'gemini') saveSettings({...aiSettings, model: 'gemini-3.6-flash'});
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
    p === 'gemini' ? 'gemini-3.6-flash' :
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
                    placeholder={aiSettings.provider === 'zhipu' ? 'e.g. glm-4' : 'e.g. gemini-3.6-flash'}
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
                  <div className="mt-2 flex flex-col gap-1.5">
                    <div className={"text-[11px] sm:text-xs font-medium flex items-center gap-1.5 px-2.5 py-2 rounded-lg " + (
                      connectionStatus === 'testing' ? "bg-blue-50 text-blue-700 border border-blue-200" :
                      connectionStatus === 'success' ? "bg-emerald-50 text-emerald-700 border border-emerald-200" :
                      "bg-amber-50 text-amber-800 border border-amber-200"
                    )}>
                      {connectionStatus === 'testing' && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0 text-blue-600" />}
                      {connectionStatus === 'success' && <CheckCircle className="w-3.5 h-3.5 shrink-0 text-emerald-600" />}
                      {connectionStatus === 'error' && <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />}
                      <span className="leading-snug">{connectionMessage}</span>
                    </div>
                    {connectionStatus === 'error' && (
                      <button
                        type="button"
                        onClick={() => {
                          const updated = { provider: 'gemini', model: 'gemini-3.6-flash', apiKey: '' };
                          saveSettings(updated);
                          setConnectionStatus('idle');
                        }}
                        className="self-start text-[11px] font-semibold text-indigo-600 hover:text-indigo-800 underline underline-offset-2 cursor-pointer mt-0.5"
                      >
                        Reset to default Gemini service
                      </button>
                    )}
                  </div>
                )}
              </div>
              {/* Display Density Preference */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 sm:p-4 text-sm text-slate-700">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="font-bold text-xs sm:text-sm text-slate-900">3. Email Layout Density</span>
                  <span className="text-[11px] font-semibold text-slate-500 capitalize">{viewDensity} View</span>
                </div>
                <p className="text-xs text-slate-500 mb-3 leading-relaxed">
                  Choose how much content to display per email row. You can also toggle this instantly above the email list on the dashboard.
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setViewDensity("comfortable");
                      try { localStorage.setItem("ais_email_view_density", "comfortable"); } catch {}
                    }}
                    className={cn(
                      "p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1.5",
                      viewDensity === "comfortable"
                        ? "bg-white border-slate-900 shadow-xs ring-2 ring-slate-900/10"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <LayoutList className="w-4 h-4 text-slate-800 shrink-0" />
                      <span className="font-bold text-xs sm:text-sm text-slate-900">Comfortable</span>
                    </div>
                    <span className="text-[11px] text-slate-500 leading-tight">Multiline preview with subject & snippet</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setViewDensity("compact");
                      try { localStorage.setItem("ais_email_view_density", "compact"); } catch {}
                    }}
                    className={cn(
                      "p-3 rounded-xl border text-left transition-all cursor-pointer flex flex-col gap-1.5",
                      viewDensity === "compact"
                        ? "bg-white border-slate-900 shadow-xs ring-2 ring-slate-900/10"
                        : "bg-white border-slate-200 text-slate-600 hover:bg-slate-50"
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <AlignJustify className="w-4 h-4 text-slate-800 shrink-0" />
                      <span className="font-bold text-xs sm:text-sm text-slate-900">Compact</span>
                    </div>
                    <span className="text-[11px] text-slate-500 leading-tight">Dense single-line rows for fast scanning</span>
                  </button>
                </div>
              </div>
            </div>
            <div className="p-3.5 sm:p-4 border-t border-slate-200 bg-slate-50 flex justify-end gap-2 sm:gap-3 shrink-0">
              <button onClick={() => setShowSettings(false)} className="px-3 sm:px-4 py-1.5 sm:py-2 text-slate-600 hover:bg-slate-200 font-medium rounded-lg text-xs sm:text-sm transition-colors cursor-pointer">
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
              }} className="px-3.5 sm:px-4 py-1.5 sm:py-2 bg-slate-800 hover:bg-slate-900 text-white font-medium rounded-lg text-xs sm:text-sm transition-colors shadow-2xs cursor-pointer">
                Save Preferences
              </button>
            </div>
          </div>
        </div>
      )}
      <LabelManagerModal
        isOpen={showLabelManager}
        onClose={() => setShowLabelManager(false)}
        userLabels={userLabels}
        onLabelsUpdated={() => {
          fetchGmailAPI('/labels').then(data => {
            if (data && data.labels) setUserLabels(data.labels);
          });
        }}
        onApplyQuery={(q, filter) => {
          setShowLabelManager(false);
          setQuery(q);
          const f = filter ? [filter] : ['anywhere'];
          setFolderFilters(f);
          handleSearch(undefined, q, f, true);
        }}
      />
      <AdminPanel isOpen={showAdminPanel} onClose={() => setShowAdminPanel(false)} />
    </div>
  );
}

function ActionButton({ icon, label, onClick, disabled, loading, className, title }: any) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs sm:text-sm font-medium transition-colors cursor-pointer whitespace-nowrap",
        disabled ? "opacity-50 cursor-not-allowed grayscale" : "",
        className || (disabled ? "text-slate-400" : "text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 shadow-2xs")
      )}
      title={title || label}
    >
      {loading ? <Loader2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin shrink-0" /> : icon}
      <span>{label}</span>
    </button>
  );
}

function FolderMultiSelect({ selected, onChange, onClose, userLabels, onOpenLabelManager }: { selected: string[], onChange: (s: string[]) => void, onClose?: () => void, userLabels: any[], onOpenLabelManager?: () => void }) {
  const [open, setOpen] = useState(false);
  
  const handleClose = () => {
    setOpen(false);
    if (onClose) onClose();
  };

  const options = (() => {
    const opts = [{ value: 'anywhere', label: 'All Mail' }];
    const systemMap: Record<string, string> = {
      'INBOX': 'Inbox',
      'CATEGORY_PERSONAL': 'Primary',
      'CATEGORY_PROMOTIONS': 'Promotions',
      'CATEGORY_UPDATES': 'Updates',
      'CATEGORY_SOCIAL': 'Social',
      'CATEGORY_FORUMS': 'Forums',
      'SPAM': 'Spam',
      'TRASH': 'Trash'
    };
    
    userLabels.forEach(l => {
      if (l.type === 'system' && systemMap[l.id]) {
        let val = l.id.startsWith('CATEGORY_') ? `category:${l.id.replace('CATEGORY_', '').toLowerCase()}` : l.id.toLowerCase();
        if (val === 'category:personal') val = 'category:primary';
        opts.push({ value: val, label: systemMap[l.id] });
      } else if (l.type === 'user') {
        opts.push({ value: l.name, label: l.name });
      }
    });
    
    // Sort so Spam and Trash are at the bottom
    opts.sort((a, b) => {
      if (a.value === 'anywhere') return -1;
      if (b.value === 'anywhere') return 1;
      if (['spam', 'trash'].includes(a.value)) return 1;
      if (['spam', 'trash'].includes(b.value)) return -1;
      return 0;
    });
    
    return opts;
  })();

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
          <div className="fixed inset-0 z-40" onClick={handleClose} />
          <div className="absolute top-full left-0 mt-1 w-52 sm:w-56 bg-white border border-slate-200 rounded-xl shadow-xl z-50 max-h-80 sm:max-h-96 overflow-y-auto py-1">
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
            {onOpenLabelManager && (
              <div className="border-t border-slate-100 mt-1 pt-1 px-1">
                <button
                  type="button"
                  onClick={() => {
                    handleClose();
                    onOpenLabelManager();
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-slate-100 text-xs font-medium text-slate-800 flex items-center gap-2"
                >
                  <Folder className="w-3.5 h-3.5 text-slate-500" />
                  <span>Manage Folders & Labels...</span>
                </button>
              </div>
            )}
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
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-2 w-64 bg-white border border-slate-200 rounded-xl shadow-xl z-50 p-3 flex flex-col gap-3">
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
