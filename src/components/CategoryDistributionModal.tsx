import { TypingLoader } from "./TypingLoader";
import { CleanupRecommendations } from "./CleanupRecommendations";
import { analyseCleanup } from "../lib/cleanupModel";
import { CategoryAuditPanel } from "./CategoryAuditPanel";
import { auditCategory } from "../lib/categoryAudit";
import { fetchCategoryPage } from "../lib/inboxAnalytics";
import { useBackgroundTask } from "../lib/useBackgroundTask";
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { 
  X, 
  Loader2, 
  RefreshCw, 
  PieChart as PieChartIcon, 
  ArrowRight, 
  AlertCircle, 
  Trash2, 
  Archive, 
  FolderInput, 
  Bookmark, 
  CheckCircle2, 
  ChevronDown, 
  ChevronUp, 
  Filter, 
  CheckCircle,
  FolderPlus,
  Layers,
  Inbox,
  ShieldCheck,
  BellRing,
  AlertTriangle,
  ExternalLink,
  Search,
  ArrowLeft
} from 'lucide-react';

import { 
  countEmails, 
  fetchGmailAPI, 
  processInChunks, 
  batchTrashEmails, 
  batchArchiveEmails, 
  batchModifyEmails, 
  createFilter,
  createLabel,
  EmailData
} from '../lib/gmail';
import { cn } from '../lib/utils';
import { 
  tokenizeText, 
  buildTFIDFMatrix, 
  computeCosineSimilarity 
} from '../lib/emailUtils';

export interface CategoryItem {
  id: string;
  name: string;
  query: string;
  filter: string;
  color: string;
  value: number;
  displayCount: string;
}

export const CATEGORY_CONFIG = [
  { id: 'updates', name: 'Updates', query: 'category:updates -in:trash -in:spam -in:sent', filter: 'category:updates', color: '#10B981', desc: 'System alerts, confirmations, receipts, bills, and notifications.' },
  { id: 'promotions', name: 'Promotions', query: 'category:promotions -in:trash -in:spam -in:sent', filter: 'category:promotions', color: '#F59E0B', desc: 'Marketing campaigns, store offers, discounts, and newsletters.' },
  { id: 'social', name: 'Social', query: 'category:social -in:trash -in:spam -in:sent', filter: 'category:social', color: '#0EA5E9', desc: 'Social network notifications, invitations, and activity updates.' },
  { id: 'forums', name: 'Forums', query: 'category:forums -in:trash -in:spam -in:sent', filter: 'category:forums', color: '#64748B', desc: 'Discussion boards, community groups, and mailing lists.' },
  { id: 'primary', name: 'Primary', query: 'category:primary -in:trash -in:spam -in:sent', filter: 'category:primary', color: '#3B82F6', desc: 'Direct emails, personal conversations, and important messages.' },
  { id: 'spam', name: 'Spam & Trash', query: 'in:spam OR in:trash', filter: 'anywhere', color: '#EF4444', desc: 'Junk and deleted messages waiting to be permanently removed.' },
];

export interface CategoryDistributionModalProps {
  isOpen?: boolean;
  onClose: () => void;
  onApplyCategory?: (query: string, filter?: string, sortOption?: "date" | "size" | "sender") => void;
  userLabels?: any[];
  aiSettings?: any;
  userEmail?: string;
  onRefresh?: () => void;
  isPage?: boolean;
  isWidget?: boolean;
}

export interface AttentionItem {
  id: string;
  sender: string;
  subject: string;
  reason: string;
  urgencyLevel: 'high' | 'medium';
  tag: string;
  date?: string;
  snippet?: string;
}

export interface ActionBundle {
  id: string;
  title: string;
  actionType: 'trash' | 'archive' | 'move_to_label' | 'star_keep' | 'mark_read';
  suggestedLabel?: string;
  emailIds: string[];
  deselectedEmailIds?: string[];
  urgency: 'safe_to_delete' | 'safe_to_archive' | 'relocate_to_folder' | 'critical_keep';
  categoryTag: string;
  description: string;
  suggestFilterRule?: {
    senderQuery: string;
    description: string;
  };
}

export interface CategoryDiagnostic {
  headline: string;
  clutterPercentage: number;
  importantPercentage: number;
  relocatablePercentage: number;
  overview: string;
  practicalAdvice?: string;
}

export function CategoryDistributionModal({
  isOpen = true,
  onClose,
  onApplyCategory,
  userLabels = [],
  aiSettings,
  userEmail,
  onRefresh,
  isPage = false,
  isWidget = false
}: CategoryDistributionModalProps) {
  // Navigation & View Mode
  const [selectedCategory, setSelectedCategory] = useState<string>('updates');

  // Distribution Data
  const [data, setData] = useState<CategoryItem[]>([]);
  const [loadingDistribution, setLoadingDistribution] = useState(false);
  const [distributionError, setDistributionError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  // Category Cleanup State
  const [scanLoading, setScanLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [categoryEmails, setCategoryEmails] = useState<EmailData[]>([]);
  /** Cursor for the background pass that keeps deepening the sample after load. */
  const [deepenToken, setDeepenToken] = useState<string | null>(null);

  /**
   * Keeps loading the rest of the category after the page is already usable.
   *
   * A first fetch can only reasonably cover a few hundred messages, so a category
   * holding thousands was judged on a fraction of itself and the counts understated
   * the real picture. This walks the remaining pages one at a time in the
   * background, re-running the audit as each lands, so the findings sharpen while
   * the user reads them rather than making them wait up front.
   */
  const DEEPEN_LIMIT = 2500;
  useBackgroundTask(
    deepenToken && categoryEmails.length < DEEPEN_LIMIT
      ? {
          id: `deepen:${selectedCategory}`,
          label: `Analysing more of ${CATEGORY_CONFIG.find(c => c.id === selectedCategory)?.name || 'this category'}…`,
          priority: 10,
          step: async (signal) => {
            const config = CATEGORY_CONFIG.find(c => c.id === selectedCategory) || CATEGORY_CONFIG[0];
            const page = await fetchCategoryPage(config.query, deepenToken, 300);
            if (signal.aborted) return false;

            if (page.emails.length > 0) {
              setCategoryEmails(prev => {
                // The user may have cleared messages while this page was in flight,
                // so merge on id rather than blindly appending.
                const seen = new Set(prev.map(e => e.id));
                return [...prev, ...page.emails.filter((e: any) => !seen.has(e.id))];
              });
            }
            setDeepenToken(page.nextPageToken);
            return Boolean(page.nextPageToken);
          },
        }
      : null
  );

  /**
   * Behavioural analysis of the scanned messages. Pure and local, so it is always
   * available regardless of AI quota — recomputed straight from the fetched sample.
   */
  const cleanupAnalysis = useMemo(
    () => (categoryEmails.length > 0 ? analyseCleanup(categoryEmails) : null),
    [categoryEmails]
  );

  /**
   * Groups by what messages *are* rather than who sent them, which is the only way
   * to see mail like one-time codes — those come from hundreds of senders, so every
   * sender cohort looks small and nothing gets flagged.
   */
  const audit = useMemo(
    () => (categoryEmails.length > 0 ? auditCategory(categoryEmails, new Date(), { minClusterSize: 3 }) : null),
    [categoryEmails]
  );
  const [diagnostic, setDiagnostic] = useState<CategoryDiagnostic | null>(null);
  const [dismissedAttentionIds, setDismissedAttentionIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('mf_dismissed_attention');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });
  const [dismissedBundleIds, setDismissedBundleIds] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem('mf_dismissed_bundles');
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  const handleDismissAttention = (id: string) => {
    setDismissedAttentionIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('mf_dismissed_attention', JSON.stringify(Array.from(next)));
      return next;
    });
  };

  const handleDismissBundle = (id: string) => {
    setDismissedBundleIds(prev => {
      const next = new Set(prev);
      next.add(id);
      localStorage.setItem('mf_dismissed_bundles', JSON.stringify(Array.from(next)));
      return next;
    });
  };
  const [handledAttentionIds, setHandledAttentionIds] = useState<Set<string>>(new Set());
  const [handlingAttentionId, setHandlingAttentionId] = useState<string | null>(null);
  const [protectingAllAttention, setProtectingAllAttention] = useState(false);
  const [expandedBundleIds, setExpandedBundleIds] = useState<Set<string>>(new Set());

  // Execution & Progress State
  const [executingBundleId, setExecutingBundleId] = useState<string | null>(null);
  const [executingAll, setExecutingAll] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<{ current: number; total: number; message: string }>({ current: 0, total: 0, message: '' });
  const [completedBundleIds, setCompletedBundleIds] = useState<Set<string>>(new Set());
  const [createdFilterIds, setCreatedFilterIds] = useState<Set<string>>(new Set());
  const [creatingFilterId, setCreatingFilterId] = useState<string | null>(null);
  const [totalCleanedInSession, setTotalCleanedInSession] = useState<number>(0);
  const [actionFilter, setActionFilter] = useState<'all' | 'trash' | 'move' | 'archive' | 'keep'>('all');

  // Helper to ensure guaranteed unique keys for bundles
  const ensureUniqueActionIds = (list: ActionBundle[]): ActionBundle[] => {
    const seen = new Set<string>();
    return list.map((item, idx) => {
      let baseId = item.id || `action_${idx}`;
      let uniqueId = baseId;
      let counter = 1;
      while (seen.has(uniqueId)) {
        uniqueId = `${baseId}_${counter++}`;
      }
      seen.add(uniqueId);
      return { ...item, id: uniqueId };
    });
  };

  // Helper to ensure guaranteed unique keys for attention items
  const ensureUniqueAttentionIds = (list: AttentionItem[]): AttentionItem[] => {
    const seen = new Set<string>();
    return list.map((item, idx) => {
      let baseId = item.id || `attention_${idx}`;
      let uniqueId = baseId;
      let counter = 1;
      while (seen.has(uniqueId)) {
        uniqueId = `${baseId}_${counter++}`;
      }
      seen.add(uniqueId);
      return { ...item, id: uniqueId };
    });
  };

  // Fetch Category Distribution Overview
  const fetchCategoryData = useCallback(async () => {
    setLoadingDistribution(true);
    setDistributionError(null);
    try {
      const results: CategoryItem[] = await Promise.all(
        CATEGORY_CONFIG.map(async (cat) => {
          const rawCount = await countEmails(cat.query);
          const numValue =
            typeof rawCount === 'number'
              ? rawCount
              : parseInt(String(rawCount).replace(/[^0-9]/g, ''), 10) || 5000;
          return {
            id: cat.id,
            name: cat.name,
            query: cat.query,
            filter: cat.filter,
            color: cat.color,
            value: numValue,
            displayCount: typeof rawCount === 'number' ? rawCount.toLocaleString() : String(rawCount),
          };
        })
      );
      const total = results.reduce((acc, curr) => acc + curr.value, 0);
      setData(results);
      setTotalCount(total);
    } catch (err: any) {
      console.error('Failed to load category distribution:', err);
      setDistributionError(err?.message || 'Failed to load category counts.');
    } finally {
      setLoadingDistribution(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchCategoryData();
    }
  }, [isOpen, fetchCategoryData]);

  // Run Category Scan & Analysis
  const runCategoryAudit = useCallback(async (categoryId: string) => {
    const config = CATEGORY_CONFIG.find(c => c.id === categoryId) || CATEGORY_CONFIG[0];
    setSelectedCategory(categoryId);
    setScanLoading(true);
    setScanError(null);
    setCompletedBundleIds(new Set());
    setCreatedFilterIds(new Set());
    setExpandedBundleIds(new Set());
    
    setHandledAttentionIds(new Set());

    // Scroll to the cleanup section if it exists
    setTimeout(() => {
      const el = document.getElementById('cleanup-recommendations');
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 50);

    try {
      // 1. Fetch a sample from this category. 100 was far too small: a category
      //    holding thousands of messages spread over hundreds of senders left every
      //    sender with a handful of hits, below any threshold worth acting on, so the
      //    analysis concluded "nothing to clean" from a sliver of the evidence.
      const listRes = await fetchGmailAPI(`/threads?q=${encodeURIComponent(config.query)}&maxResults=500`);
      setDeepenToken(listRes?.nextPageToken || null);
      if (!listRes || !listRes.threads || listRes.threads.length === 0) {
        setCategoryEmails([]);
        setDiagnostic({
          headline: `${config.name} is completely clear`,
          clutterPercentage: 0,
          importantPercentage: 100,
          relocatablePercentage: 0,
          overview: `There are no messages matching "${config.name}".`,
          practicalAdvice: `No cleanup needed for this category.`
        });
        setScanLoading(false);
        return;
      }

      // 2. Fetch metadata details in efficient batches
      const sampledThreads = listRes.threads.slice(0, 500);
      const detailedEmails: EmailData[] = (await processInChunks(sampledThreads, 10, async (thread: any) => {
        try {
          const detail = await fetchGmailAPI(`/threads/${thread.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date&metadataHeaders=List-Unsubscribe`);
          if (!detail.messages || detail.messages.length === 0) return null;
          const firstMsg = detail.messages[0];
          const lastMsg = detail.messages[detail.messages.length - 1];
          const headers = firstMsg.payload?.headers || [];
          const lastHeaders = lastMsg.payload?.headers || headers;

          const sender = headers.find((h: any) => h.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
          const subject = headers.find((h: any) => h.name.toLowerCase() === 'subject')?.value || '(No Subject)';
          const dateStr = lastHeaders.find((h: any) => h.name.toLowerCase() === 'date')?.value || new Date().toISOString();

          return {
            id: thread.id,
            threadId: thread.id,
            messageIds: detail.messages.map((m: any) => m.id),
            snippet: lastMsg.snippet || thread.snippet || '',
            sender,
            subject,
            date: new Date(dateStr),
            sizeEstimate: detail.messages.reduce((sum: number, m: any) => sum + (m.sizeEstimate || 0), 0),
            labelIds: [...new Set(detail.messages.flatMap((m: any) => m.labelIds || []))] as string[],
            listUnsubscribe: detail.messages.flatMap((m: any) => m.payload?.headers || []).find((h: any) => h.name.toLowerCase() === 'list-unsubscribe')?.value,
          } as EmailData;
        } catch {
          return null;
        }
      })).filter(Boolean) as EmailData[];

      setCategoryEmails(detailedEmails);

      if (detailedEmails.length === 0) {
        setDiagnostic({
          headline: `No Accessible Messages in ${config.name}`,
          clutterPercentage: 0,
          importantPercentage: 0,
          relocatablePercentage: 0,
          overview: `Could not retrieve message details for category ${config.name}.`,
          practicalAdvice: `Please check your network connection.`
        });
        setScanLoading(false);
        return;
      }

      // 3. Summarise locally. The behavioural model below derives the actual
      //    recommendations; this is just the headline for the category.
      const catMeta = data.find(d => d.id === categoryId);
      const estTotal = catMeta ? catMeta.displayCount : detailedEmails.length;
      const unreadShare = detailedEmails.length > 0
        ? detailedEmails.filter(e => (e.labelIds || []).includes('UNREAD')).length / detailedEmails.length
        : 0;
      const bulkShare = detailedEmails.length > 0
        ? detailedEmails.filter(e => !!e.listUnsubscribe).length / detailedEmails.length
        : 0;

      setDiagnostic({
        headline: `${config.name}: ${estTotal.toLocaleString()} messages`,
        clutterPercentage: Math.round(bulkShare * 100),
        importantPercentage: Math.round((1 - bulkShare) * 100),
        relocatablePercentage: Math.round(unreadShare * 100),
        overview: `Analysed a sample of ${detailedEmails.length.toLocaleString()} messages from ${config.name}.`,
        practicalAdvice: 'Recommendations below are ranked by how much each one is worth.'
      });

    } catch (err: any) {
      console.error('Failed to run category audit:', err);
      setScanError(err?.message || 'Failed to scan and analyze category.');
    } finally {
      setScanLoading(false);
    }
  }, [aiSettings, data, userLabels]);

  // Keyboard navigation & body lock
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    
    let originalOverflow = '';
    if (!isPage && !isWidget) {
      originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (!isPage && !isWidget) document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose, isPage, isWidget]);

  if (!isPage && !isOpen) return null;

  const currentCategoryConfig = CATEGORY_CONFIG.find(c => c.id === selectedCategory) || CATEGORY_CONFIG[0];
  const currentCategoryData = data.find(d => d.id === selectedCategory);

  const headerContent = (
    <div className={cn(
      "flex flex-col sm:flex-row sm:items-center justify-between bg-white shrink-0 gap-4",
      isPage ? "p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-2xs mb-4" : "px-5 py-4 border-b border-slate-200"
    )}>
      <div className="flex items-center gap-3">
        {isPage && (
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold transition-colors cursor-pointer shrink-0"
            title="Back to Inbox Health"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Inbox Health</span>
          </button>
        )}
        <div>
          <div className="flex items-center gap-2">
            <h2 id="category-distribution-title" className="font-bold text-slate-900 text-base sm:text-lg">
              Category Breakdown
            </h2>
            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200">
              Overview
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            View volume across categories and review recommended cleanups.
          </p>
        </div>
      </div>

      {/* Tab Selector Removed - unified layout */}
      <div className="flex items-center gap-2">
        {!isPage && (
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            title="Close modal"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );

  const bodyContent = (
    <div className="flex flex-col gap-6 w-full pb-10">
      {/* Top Bento Grid: Donut + Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 w-full">
        
        {/* Left: Donut Chart */}
        <div className="col-span-1 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col items-center justify-center">
          <h3 className="w-full text-sm font-bold text-slate-900 mb-6 text-center">Volume Distribution</h3>
          {loadingDistribution ? (
            <div className="flex-1 flex flex-col items-center justify-center min-h-[200px]">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400 mb-2" />
              <span className="text-xs text-slate-500">Analyzing...</span>
            </div>
          ) : distributionError ? (
             <div className="flex-1 flex items-center justify-center min-h-[200px] text-center text-xs text-red-500">
               {distributionError}
             </div>
          ) : data.length > 0 ? (
            <div className="w-full aspect-square relative flex items-center justify-center max-w-[220px] mx-auto mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius="65%"
                    outerRadius="85%"
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                    onMouseEnter={(_, index) => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(null)}
                    onClick={(_, index) => {
                      if (data[index]) runCategoryAudit(data[index].id);
                    }}
                  >
                    {data.map((entry, index) => (
                      <Cell key={`cell-${entry.id}`} fill={entry.color} opacity={activeIndex === null || activeIndex === index ? 1 : 0.4} className="cursor-pointer" />
                    ))}
                  </Pie>
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const item = payload[0].payload;
                        const percent = totalCount > 0 ? ((item.value / totalCount) * 100).toFixed(1) : '0';
                        return (
                          <div className="bg-slate-900 text-white px-3 py-2 rounded-lg shadow-lg border border-slate-800 text-xs flex flex-col gap-0.5 pointer-events-none">
                            <div className="flex items-center gap-1.5 font-semibold">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                              <span>{item.name}</span>
                            </div>
                            <div className="text-slate-300 text-[11px]">{item.displayCount} emails ({percent}%)</div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {activeIndex !== null && data[activeIndex] ? (
                  <>
                    <span className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{data[activeIndex].displayCount}</span>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{data[activeIndex].name}</span>
                  </>
                ) : (
                  <>
                    <span className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{totalCount.toLocaleString()}</span>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Total</span>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Right: Categories List */}
        <div className="col-span-1 lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">Category Scanner</h3>
              <p className="text-xs text-slate-500 mt-0.5">Select a category to audit unneeded emails.</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[350px] custom-scrollbar">
            {data.map(cat => {
              const isSelected = selectedCategory === cat.id;
              const percent = totalCount > 0 ? Math.round((cat.value / totalCount) * 100) : 0;
              return (
                <div 
                  key={cat.id} 
                  className={cn(
                    "p-3 sm:p-4 border-b border-slate-100 last:border-0 flex items-center justify-between gap-4 cursor-pointer transition-colors group", 
                    isSelected ? "bg-indigo-50/50" : "hover:bg-slate-50"
                  )} 
                  onClick={() => runCategoryAudit(cat.id)}
                >
                   <div className="flex items-center gap-3">
                     <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: cat.color }} />
                     <div>
                       <h4 className={cn("font-semibold text-sm transition-colors", isSelected ? "text-indigo-900" : "text-slate-900")}>{cat.name}</h4>
                       <p className="text-xs text-slate-500">{cat.displayCount} emails ({percent}%)</p>
                     </div>
                   </div>
                   <div className="flex items-center gap-2 shrink-0">
                     {onApplyCategory && (
                       <button 
                         onClick={(e) => { e.stopPropagation(); onClose(); onApplyCategory(cat.query, cat.filter); }} 
                         className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors" 
                         title={`View emails in ${cat.name}`}
                       >
                         <Search className="w-4 h-4" />
                       </button>
                     )}
                     <button className={cn(
                       "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-xs", 
                       isSelected ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-700 group-hover:border-slate-300"
                     )}>
                       {scanLoading && isSelected ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Scan</span>}
                     </button>
                   </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Bottom: Scanner Results */}
      <div id="cleanup-recommendations" className="w-full mt-2">
         {scanLoading ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 shadow-xs flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="w-7 h-7 animate-spin text-slate-700" />
              <div>
                <h3 className="text-sm sm:text-base font-semibold text-slate-800">
                  Reviewing emails in "{currentCategoryConfig.name}"...
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Checking for expired login codes, receipts, and repetitive notifications.
                </p>
              </div>
            </div>
          ) : scanError ? (
            <div className="bg-white border border-red-200 rounded-2xl p-8 shadow-xs flex flex-col items-center justify-center gap-3 text-center">
              <AlertCircle className="w-6 h-6 text-red-500" />
              <p className="text-sm font-medium text-slate-800">{scanError}</p>
              <button
                onClick={() => runCategoryAudit(selectedCategory)}
                className="mt-1 flex items-center gap-1.5 bg-slate-900 text-white text-xs font-medium px-3.5 py-1.5 rounded-lg shadow-xs hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          ) : diagnostic ? (
            <div className="flex flex-col gap-6">
              {/* Behavioural cleanup model — leads the page because these are the
                  bulk decisions that actually clear a category, rather than
                  per-message chores. Runs entirely on-device. */}
              {audit && (
                <CategoryAuditPanel
                  audit={audit}
                  categoryName={currentCategoryConfig.name}
                  aiSettings={aiSettings}
                  onInspect={(ids, title) => {
                    // Thread ids aren't a Gmail query, so scope by the category and
                    // let the page filter — better than pretending to query by id.
                    const params = new URLSearchParams();
                    params.set('q', currentCategoryConfig.query);
                    params.set('title', title);
                    params.set('badge', 'Audit group');
                    params.set('sub', `${ids.length} similar messages in ${currentCategoryConfig.name}`);
                    params.set('source', 'category-distribution');
                    params.set('action', 'trash');
                    window.location.hash = `#filter-view?${params.toString()}`;
                  }}
                  onCleared={(cluster, count) => {
                    setTotalCleanedInSession(prev => prev + count);
                    const gone = new Set(cluster.ids);
                    setCategoryEmails(prev => prev.filter(e => !gone.has(e.id)));
                    window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
                      detail: { type: 'promo', count, isPartial: true }
                    }));
                  }}
                />
              )}

              {cleanupAnalysis && (
                <CleanupRecommendations
                  analysis={cleanupAnalysis}
                  categoryName={currentCategoryConfig.name}
                  aiSettings={aiSettings}
                  onInspect={(query, title) => {
                    const params = new URLSearchParams();
                    params.set('q', query);
                    params.set('title', title);
                    params.set('badge', 'Recommended cleanup');
                    params.set('sub', `Messages matching this recommendation`);
                    params.set('source', 'category-distribution');
                    params.set('action', 'trash');
                    window.location.hash = `#filter-view?${params.toString()}`;
                  }}
                  onCompleted={(rec, processed) => {
                    setTotalCleanedInSession(prev => prev + processed);
                    setCategoryEmails(prev => prev.filter(e => !rec.ids.includes(e.id)));
                    window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
                      detail: { type: 'promo', count: processed, isPartial: true }
                    }));
                  }}
                />
              )}
            </div>
          ) : null}
      </div>

    </div>
  );

  if (isWidget) {
    return (
      <div className="w-full flex flex-col gap-4 animate-in fade-in duration-150">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs p-4 sm:p-5 overflow-hidden flex flex-col relative">
           <div className="flex items-center gap-2 mb-4 pb-3 border-b border-slate-100">
             <PieChartIcon className="w-5 h-5 text-indigo-600" />
             <h2 className="font-bold text-slate-900 text-base">Category Breakdown</h2>
           </div>
          {bodyContent}
        </div>
      </div>
    );
  }

  if (isPage) {
    return (
      <div className="w-full max-w-5xl mx-auto flex flex-col animate-in fade-in duration-150">
        {headerContent}
        {bodyContent}
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 lg:p-6 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-distribution-title"
    >
      <div
        className="bg-white w-full max-w-5xl shadow-xl flex flex-col overflow-hidden border border-slate-200 h-full sm:h-[90vh] sm:rounded-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {headerContent}
        <div className="flex-1 overflow-y-auto bg-slate-50/50 p-4 sm:p-6 flex flex-col relative">
          {bodyContent}
        </div>
      </div>
    </div>
  );
}
