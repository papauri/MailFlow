import { SketchLoadingState } from "./SketchLoader";
import { CleanupRecommendations } from "./CleanupRecommendations";
import { PageHeader } from "./PageHeader";
import { analyseCleanup } from "../lib/cleanupModel";
import { CategoryAuditPanel } from "./CategoryAuditPanel";
import { auditCategory } from "../lib/categoryAudit";
import { fetchCategoryScan, categoryScanKey } from "../lib/inboxAnalytics";
import { useCachedResource, isCacheWarm, warmCachedResource, invalidateCachedResource, mutateCachedResource } from "../lib/useCachedResource";
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
  ArrowLeft,
  Mail
} from 'lucide-react';

import { 
  countEmails,
  estimateMessageCount,
  fetchGmailAPI, 
  processInChunks,
  listMessageIds,
  fetchMessagesMetadataBatch,

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

/**
 * Which Inbox Health counter an action in this category should optimistically patch.
 *
 * Only some categories map onto a counter Inbox Health tracks. Returning null for
 * the rest is deliberate: the cache is invalidated and revalidated either way, so
 * the honest outcome of clearing Forums is a brief revalidation, not a wrong number
 * subtracted from an unrelated tile.
 */
function optimisticMetricFor(categoryId: string): string | null {
  if (categoryId === 'promotions') return 'promo';
  if (categoryId === 'spam') return 'spam';
  if (categoryId === 'updates' || categoryId === 'social') return 'updatesAndSocial';
  return null;
}

/** Background rounds: larger, since nobody is waiting on them. */
const DEEPEN_PAGE = 200;

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
  /** Cursor for the background pass that keeps deepening the sample after load. */
  const [deepenToken, setDeepenToken] = useState<string | null>(null);
  const [scanProgress, setScanProgress] = useState<{ done: number; total: number } | null>(null);

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
          const numValue = rawCount;
          return {
            id: cat.id,
            name: cat.name,
            query: cat.query,
            filter: cat.filter,
            color: cat.color,
            value: numValue,
            displayCount: rawCount.toLocaleString(),
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
  /**
   * The selected category's scan, served from cache.
   *
   * Switching categories used to trigger a full rescan every time, which is both
   * slow and pointless — the mailbox has not changed between two clicks, and each
   * scan costs real quota. Results are cached per category, so switching is instant
   * once scanned and refreshing is something the user asks for.
   */
  const scan = useCachedResource<any[]>(
    categoryScanKey(selectedCategory, userEmail),
    () => fetchCategoryScan(
      (CATEGORY_CONFIG.find(c => c.id === selectedCategory) || CATEGORY_CONFIG[0]).query,
      (done, total) => setScanProgress({ done, total })
    ).finally(() => setScanProgress(null)) as Promise<any[]>
  );

  const categoryEmails = (scan.data || []) as EmailData[];
  const scanLoading = scan.loading;
  const scanError = scan.error ? (scan.error.message || 'Failed to scan this category.') : null;

  /**
   * Warm the categories the user has not opened yet, one at a time in the
   * background, so every tab is already scanned by the time it is clicked. Only the
   * unscanned ones are queued, and the scheduler keeps this behind anything the user
   * is waiting on.
   */
  const pendingCategory = CATEGORY_CONFIG.find(
    c => c.id !== selectedCategory && !isCacheWarm(categoryScanKey(c.id, userEmail))
  );

  useBackgroundTask(
    !scanLoading && pendingCategory
      ? {
          id: `scan:${pendingCategory.id}`,
          label: `Scanning ${pendingCategory.name}…`,
          priority: 30,
          step: async (signal) => {
            const key = categoryScanKey(pendingCategory.id, userEmail);
            if (signal.aborted || isCacheWarm(key)) return false;
            await warmCachedResource(key, () => fetchCategoryScan(pendingCategory.query, undefined, signal));
            return false;
          },
        }
      : null
  );

  /**
   * Behavioural analysis of the scanned messages. Pure and local, so it is always
   * available regardless of AI quota — recomputed straight from the fetched sample.
   */
  const cleanupAnalysis = useMemo(
    () => (categoryEmails.length > 0
      ? analyseCleanup(categoryEmails, new Date(), {
          // The scan only saw this category, so the actions must only touch it.
          // Unscoped, a card measured against Promotions would have trashed the
          // sender's Primary and Sent mail too.
          scopeQuery: (CATEGORY_CONFIG.find(c => c.id === selectedCategory) || CATEGORY_CONFIG[0]).query,
        })
      : null),
    [categoryEmails, selectedCategory]
  );

  /**
   * Groups by what messages *are* rather than who sent them, which is the only way
   * to see mail like one-time codes — those come from hundreds of senders, so every
   * sender cohort looks small and nothing gets flagged.
   */
  const audit = useMemo(
    () => (categoryEmails.length > 0 ? auditCategory(categoryEmails, new Date(), { minClusterSize: 2, scopeQuery: (CATEGORY_CONFIG.find(c => c.id === selectedCategory) || CATEGORY_CONFIG[0]).query }) : null),
    [categoryEmails, selectedCategory]
  );

  /**
   * Summary of the current scan. Derived rather than stored: it is a view of the
   * scan result, and keeping it as separate state is what let it fall out of sync
   * and blank the page when the scan moved into the cache.
   */
  const diagnostic: CategoryDiagnostic | null = useMemo(() => {
    if (categoryEmails.length === 0) return null;
    const cfg = CATEGORY_CONFIG.find(c => c.id === selectedCategory) || CATEGORY_CONFIG[0];
    const unread = categoryEmails.filter(e => (e.labelIds || []).includes('UNREAD')).length;
    const bulk = categoryEmails.filter(e => !!e.listUnsubscribe).length;
    const total = categoryEmails.length;
    return {
      headline: `${cfg.name}: ${total.toLocaleString()} messages analysed`,
      clutterPercentage: Math.round((bulk / total) * 100),
      importantPercentage: Math.round(((total - bulk) / total) * 100),
      relocatablePercentage: Math.round((unread / total) * 100),
      overview: `${unread.toLocaleString()} unread · ${bulk.toLocaleString()} bulk mail.`,
      practicalAdvice: 'Recommendations below are ranked by what each is worth.',
    };
  }, [categoryEmails, selectedCategory]);

  /**
   * One scan covering every folder, rather than a scan per folder as you click into
   * each. Afterwards every tab is already analysed and switching is instant, which
   * is the point: the scan is the slow part, so it should happen once, deliberately,
   * for everything — not repeatedly and implicitly.
   */
  const [scanAllState, setScanAllState] = useState<{ current: string; done: number; total: number } | null>(null);
  const [showAllEmails, setShowAllEmails] = useState(false);

  const scanAllFolders = useCallback(async () => {
    setScanAllState({ current: '', done: 0, total: CATEGORY_CONFIG.length });
    for (let i = 0; i < CATEGORY_CONFIG.length; i++) {
      const cfg = CATEGORY_CONFIG[i];
      setScanAllState({ current: cfg.name, done: i, total: CATEGORY_CONFIG.length });
      const key = categoryScanKey(cfg.id, userEmail);
      // Already-scanned folders are skipped, so pressing this twice is cheap.
      if (!isCacheWarm(key)) {
        await warmCachedResource(key, () => fetchCategoryScan(cfg.query)).catch(() => undefined);
      }
    }
    setScanAllState(null);
  }, [userEmail]);

  const scannedCount = CATEGORY_CONFIG.filter(c => isCacheWarm(categoryScanKey(c.id, userEmail))).length;

  const rescan = useCallback(() => {
    invalidateCachedResource(categoryScanKey(selectedCategory, userEmail));
    scan.refresh();
  }, [selectedCategory, userEmail, scan]);

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

  const headerContent = isPage ? (
    <PageHeader
      title="Category Breakdown"
      badge="Overview"
      subtitle={
        scanLoading ? 'Scanning…'
          : categoryEmails.length > 0
            ? `${categoryEmails.length.toLocaleString()} messages analysed${scan.refreshing ? ' · refreshing' : ''}`
            : 'Volume across categories, with recommended cleanups.'
      }
      icon={<PieChartIcon className="w-4 h-4" />}
      onBack={onClose}
      backLabel="Back to Inbox Health"
      actions={
        <div className="flex items-center gap-1.5">
          <button
            onClick={scanAllFolders}
            disabled={!!scanAllState}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
            title="Scan every folder once, then switch between them instantly"
          >
            {scanAllState
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span className="hidden sm:inline">{scanAllState.current}… {scanAllState.done}/{scanAllState.total}</span></>
              : <><Layers className="w-3.5 h-3.5" /><span className="hidden sm:inline">Scan all folders</span></>}
          </button>
          <button
            onClick={rescan}
            disabled={scanLoading || scan.refreshing || !!scanAllState}
            className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer disabled:opacity-50"
            title="Rescan just this folder"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", (scanLoading || scan.refreshing) && "animate-spin")} />
          </button>
        </div>
      }
    />
  ) : (
    <div className="flex items-center justify-between bg-white shrink-0 gap-3 px-4 py-3 border-b border-slate-200">
      <div className="flex items-center gap-2 min-w-0">
        <h2 id="category-distribution-title" className="font-bold text-slate-900 text-base truncate">
          Category Breakdown
        </h2>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 shrink-0">
          Overview
        </span>
      </div>
      <button
        onClick={onClose}
        className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer shrink-0"
        title="Close modal"
        aria-label="Close dialog"
      >
        <X className="w-5 h-5" />
      </button>
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
                      if (data[index]) setSelectedCategory(data[index].id);
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
                    isSelected ? "bg-slate-100" : "hover:bg-slate-50"
                  )} 
                  onClick={() => setSelectedCategory(cat.id)}
                >
                   <div className="flex items-center gap-3">
                     <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: cat.color }} />
                     <div>
                       <h4 className={cn("font-semibold text-sm transition-colors", isSelected ? "text-slate-900" : "text-slate-800")}>{cat.name}</h4>
                       <p className="text-xs text-slate-500">{cat.displayCount} emails ({percent}%)</p>
                     </div>
                   </div>
                   <div className="flex items-center gap-2 shrink-0">
                     {onApplyCategory && (
                       <button 
                         onClick={(e) => { e.stopPropagation(); onApplyCategory(cat.query, cat.filter); }} 
                         className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors" 
                         title={`View emails in ${cat.name}`}
                       >
                         <Search className="w-4 h-4" />
                       </button>
                     )}
                     <button className={cn(
                       "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-xs whitespace-nowrap",
                       isSelected ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-700 group-hover:border-slate-300"
                     )}>
                       {scanLoading && isSelected
                         ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                         : isCacheWarm(categoryScanKey(cat.id, userEmail))
                           ? <><CheckCircle2 className="w-3.5 h-3.5" /><span>{isSelected ? 'Viewing' : 'Scanned'}</span></>
                           : <span>Not scanned</span>}
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
            <div className="bg-white border border-slate-200 rounded-2xl p-8 sm:p-12 shadow-xs flex flex-col items-center justify-center gap-3 text-center">
              <SketchLoadingState 
                scene="measuring"
                title={`Reviewing "${currentCategoryConfig.name}"...`}
                messages={[
                  `Streaming metadata for ${currentCategoryConfig.name.toLowerCase()}...`,
                  "Clustering repetitive sender patterns...",
                  "Identifying disposable verification codes and receipts...",
                  "Preparing automated cleanup rules..."
                ]}
                progress={scanProgress}
                progressLabel="Scanning category"
              />
            </div>
          ) : scanError ? (
            <div className="bg-white border border-red-200 rounded-2xl p-8 shadow-xs flex flex-col items-center justify-center gap-3 text-center">
              <AlertCircle className="w-6 h-6 text-red-500" />
              <p className="text-sm font-medium text-slate-800">{scanError}</p>
              <button
                onClick={rescan}
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
                  emails={categoryEmails}
                  aiSettings={aiSettings}
                  onInspect={(cluster) => {
                    // The cluster's own query, derived from the subject template it
                    // was built from, so Inspect shows exactly the group. Falls back
                    // to the category only when no distinctive phrase survives —
                    // wrong-but-wider beats pretending to filter.
                    const params = new URLSearchParams();
                    params.set('q', cluster.query || currentCategoryConfig.query);
                    params.set('title', cluster.sampleSubject.slice(0, 60));
                    params.set('badge', 'Audit group');
                    params.set('sub', cluster.query
                      ? `${cluster.volume.toLocaleString()} messages sharing this subject pattern`
                      : `${currentCategoryConfig.name} — no distinctive pattern to filter on`);
                    params.set('source', 'category-distribution');
                    params.set('action', 'trash');
                    window.location.hash = `#filter-view?${params.toString()}`;
                  }}
                  onCleared={(cluster, count) => {
                    setTotalCleanedInSession(prev => prev + count);
                    const gone = new Set(cluster.ids);
                    mutateCachedResource<any[]>(categoryScanKey(selectedCategory, userEmail),
                      prev => (prev || []).filter((e: any) => !gone.has(e.id)));
                    // Named by the category actually cleared. This was hardcoded to
                    // 'promo', so clearing Social or Updates decremented the stale
                    // promotions counter and every surface reading it went wrong.
                    window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
                      detail: { type: optimisticMetricFor(selectedCategory), count, isPartial: true }
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
                    const gone = new Set(rec.ids);
                    mutateCachedResource<any[]>(categoryScanKey(selectedCategory, userEmail),
                      prev => (prev || []).filter((e: any) => !gone.has(e.id)));
                    window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
                      detail: { type: optimisticMetricFor(selectedCategory), count: processed, isPartial: true }
                    }));
                  }}
                />
              )}

              {/* Catch-all: Remaining Emails (or all) inline viewer */}
              {categoryEmails.length > 0 && (
                <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden mt-2">
                  <div 
                    className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors"
                    onClick={() => setShowAllEmails(!showAllEmails)}
                  >
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-slate-500" />
                      <h4 className="text-sm font-semibold text-slate-900">All {categoryEmails.length.toLocaleString()} Scanned Emails</h4>
                    </div>
                    <ChevronDown className={cn("w-4 h-4 text-slate-400 transition-transform", showAllEmails && "rotate-180")} />
                  </div>
                  <AnimatePresence>
                    {showAllEmails && (
                      <motion.div
                        initial={{ height: 0 }}
                        animate={{ height: "auto" }}
                        exit={{ height: 0 }}
                        className="overflow-hidden border-t border-slate-100"
                      >
                        <div className="max-h-96 overflow-y-auto p-2 bg-slate-50">
                          <ul className="divide-y divide-slate-100 bg-white border border-slate-200 rounded-lg overflow-hidden">
                            {categoryEmails.map((email: any) => (
                              <li key={email.id} className="p-3 flex items-start gap-3 hover:bg-slate-50 transition-colors">
                                <div className="min-w-0 flex-1">
                                  <p className="text-[12px] font-semibold text-slate-900 truncate">
                                    {email.subject || '(No Subject)'}
                                  </p>
                                  <p className="text-[11px] text-slate-500 truncate mt-0.5">{email.sender}</p>
                                  <p className="text-[11px] text-slate-400 truncate mt-0.5">
                                    {email.snippet || ''}
                                  </p>
                                </div>
                                <span className="text-[10px] text-slate-400 shrink-0 tabular-nums font-medium whitespace-nowrap">
                                  {new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' })}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
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
