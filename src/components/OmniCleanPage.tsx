import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { PageHeader } from './PageHeader';
import {
  Sparkles,
  Trash2,
  Archive,
  FolderInput,
  ShieldCheck,
  Search,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  Loader2,
  Folder,
  SlidersHorizontal,
  Check,
  X
} from 'lucide-react';
import { cn } from '../lib/utils';
import { formatBytes } from '../lib/csvExport';
import { scanFolderMetadata, batchTrashEmails, batchArchiveEmails, batchModifyEmails, createLabel } from '../lib/gmail';
import {
  clusterEmailsIntoBatches,
  computeOmniScanSummary,
  OmniClusterBatch,
  OmniScanSummary
} from '../lib/omniClusterModel';

interface OmniCleanPageProps {
  userEmail?: string;
  userLabels?: any[];
  aiSettings?: any;
  isAiWorking?: boolean;
  onBack?: () => void;
  onRefreshInbox?: () => void;
  embedded?: boolean;
  initialScope?: string;
}

interface ScanScopeOption {
  id: string;
  label: string;
  query: string;
  description: string;
}

const SCOPE_OPTIONS: ScanScopeOption[] = [
  { id: 'inbox', label: 'Inbox', query: 'in:inbox', description: 'Active unarchived inbox messages' },
  { id: 'all_mail', label: 'All Mail', query: '-in:trash -in:spam', description: 'Full mailbox minus trash & spam' },
  { id: 'promotions', label: 'Promotions', query: 'category:promotions', description: 'Commercial offers and marketing digests' },
  { id: 'updates', label: 'Updates', query: 'category:updates', description: 'System alerts, notifications, and receipts' },
  { id: 'social', label: 'Social', query: 'category:social', description: 'Social networks and platform updates' },
  { id: 'stale', label: 'Stale (>6 Months)', query: 'older_than:6m', description: 'Older messages not touched recently' },
  { id: 'large', label: 'Heavy Files (>5MB)', query: 'has:attachment larger:5M', description: 'Storage-heavy messages with attachments' },
];

const SCAN_DEPTH_OPTIONS = [
  { value: 0, label: 'Entire Folder (All)' },
  { value: 1000, label: '1,000 Messages' },
  { value: 500, label: '500 Messages' },
  { value: 250, label: '250 Messages' },
  { value: 100, label: '100 Messages' },
];

export function OmniCleanPage({
  userEmail,
  userLabels = [],
  aiSettings,
  isAiWorking,
  onBack,
  onRefreshInbox,
  embedded = false,
  initialScope
}: OmniCleanPageProps) {
  const [selectedScope, setSelectedScope] = useState<string>(initialScope || 'inbox');
  // Default to 0 (Entire Folder / Unlimited up to safety ceiling 2500)
  const [sampleLimit, setSampleLimit] = useState<number>(0);
  
  // Pipeline State
  const [stage, setStage] = useState<'idle' | 'fetching' | 'clustering' | 'ai_coop' | 'ready'>('idle');
  const [scanProgressText, setScanProgressText] = useState<string>('');
  const [scanMetrics, setScanMetrics] = useState<{ done: number; total: number } | null>(null);
  const [batches, setBatches] = useState<OmniClusterBatch[]>([]);
  const [executiveSummary, setExecutiveSummary] = useState<{ headline: string; verdictText: string; recommendedImmediateAction: string } | null>(null);
  const [isAiEnriched, setIsAiEnriched] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // View Filtering
  const [filterDisposition, setFilterDisposition] = useState<'all' | 'trash' | 'archive' | 'route' | 'stay'>('all');
  const [expandedBatchId, setExpandedBatchId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Action Execution State
  const [executingBatchId, setExecutingBatchId] = useState<string | null>(null);
  const [bulkActionProgress, setBulkActionProgress] = useState<{ total: number; done: number; title: string } | null>(null);
  const [completedBatchIds, setCompletedBatchIds] = useState<Set<string>>(new Set());

  // Abort controller ref to cancel scans when switching scopes
  const abortControllerRef = useRef<AbortController | null>(null);

  const cancelScan = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStage('idle');
    setScanProgressText('Scan cancelled.');
    setScanMetrics(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  // Active query computed from scope
  const activeQuery = useMemo(() => {
    if (selectedScope.startsWith('label:')) {
      const labelName = selectedScope.replace('label:', '');
      return `label:"${labelName}"`;
    }
    const found = SCOPE_OPTIONS.find(s => s.id === selectedScope);
    return found ? found.query : 'in:inbox';
  }, [selectedScope]);

  const activeScopeName = useMemo(() => {
    if (selectedScope.startsWith('label:')) {
      return `Folder "${selectedScope.replace('label:', '')}"`;
    }
    const found = SCOPE_OPTIONS.find(s => s.id === selectedScope);
    return found ? found.label : 'Inbox';
  }, [selectedScope]);

  // Main Scan Pipeline
  const runOmniScan = useCallback(async () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setError(null);
    setBatches([]);
    setExecutiveSummary(null);
    setExpandedBatchId(null);
    setCompletedBatchIds(new Set());
    setScanMetrics(null);
    
    try {
      // Step 1: Ingest & Query Gmail using Multipart Batch Engine
      // If sampleLimit is 0 (Entire Folder), query up to 5000 messages
      const fetchLimit = sampleLimit === 0 ? 5000 : sampleLimit;
      const depthText = sampleLimit === 0 ? 'entire folder' : `${sampleLimit} messages`;

      setStage('fetching');
      setScanProgressText(`Locating message index for ${activeScopeName}…`);
      
      const rawEmails = await scanFolderMetadata(
        activeQuery,
        fetchLimit,
        (done, total, phase) => {
          if (controller.signal.aborted) return;
          if (phase === 'listing') {
            setScanProgressText(`Indexing messages matching scope…`);
          } else if (phase === 'fetching') {
            setScanMetrics({ done, total });
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            setScanProgressText(`Streaming message metadata: ${done} of ${total} (${pct}%)…`);
          }
        },
        controller.signal
      );
      
      if (controller.signal.aborted) return;

      if (!rawEmails || rawEmails.length === 0) {
        setStage('ready');
        setBatches([]);
        setScanProgressText('No messages found in this scope.');
        return;
      }

      // Step 2: Advanced K-Means & Feature Vector Clustering
      setStage('clustering');
      setScanProgressText(`Vectorizing features & running K-Means clustering across ${rawEmails.length} messages…`);
      
      // Small tick to allow UI update
      await new Promise(r => setTimeout(r, 40));
      if (controller.signal.aborted) return;

      const initialBatches = clusterEmailsIntoBatches(rawEmails, userLabels);

      if (initialBatches.length === 0) {
        setStage('ready');
        setBatches([]);
        return;
      }

      // Step 3: AI Bot Co-Op (if AI is active/configured)
      let finalBatches = initialBatches;
      let summary = {
        headline: `Summary for ${activeScopeName}`,
        verdictText: `Grouped ${rawEmails.length} messages into ${initialBatches.length} batches based on similar content and sender patterns.`,
        recommendedImmediateAction: `Act on the largest batches sorted by size for the fastest inbox cleanup.`
      };

      setStage('ai_coop');
      setScanProgressText(`Analyzing emails to provide cleanup suggestions…`);

      try {
        const res = await fetch('/api/omni-clean-coop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            batches: initialBatches,
            scopeName: activeScopeName,
            userLabels,
            settings: aiSettings
          }),
          signal: controller.signal
        });

        if (controller.signal.aborted) return;

        if (res.ok) {
          const data = await res.json();
          if (data && data.executiveSummary) {
            summary = data.executiveSummary;
          }
          if (data && Array.isArray(data.batchDecisions) && data.batchDecisions.length > 0) {
            const decisionMap = new Map<string, any>(data.batchDecisions.map((d: any) => [d.id, d]));
            
            finalBatches = initialBatches.map(b => {
              const aiDecision = decisionMap.get(b.id);
              if (!aiDecision) return b;
              return {
                ...b,
                disposition: (aiDecision.disposition === 'STAY' ? 'STAY' : 'GO') as 'GO' | 'STAY',
                action: aiDecision.action || b.action,
                suggestedLabel: aiDecision.suggestedLabel || b.suggestedLabel,
                title: aiDecision.refinedTitle || b.title,
                rationale: aiDecision.rationale || b.rationale,
                confidence: aiDecision.confidence || b.confidence,
                categoryTag: aiDecision.categoryTag || b.categoryTag,
                algorithmAgreement: 'Auto Grouped'
              };
            });
            setIsAiEnriched(!data.fallback);
          } else {
            setIsAiEnriched(false);
          }
        }
      } catch (aiErr: any) {
        if (controller.signal.aborted || aiErr?.name === 'AbortError') {
          return;
        }
        console.warn('AI Co-Op request bypassed, utilizing deterministic model:', aiErr);
        setIsAiEnriched(false);
      }

      if (controller.signal.aborted) return;

      // Final sort: strictly descending by batch size
      finalBatches.sort((a, b) => b.emailIds.length - a.emailIds.length);
      setBatches(finalBatches);
      setExecutiveSummary(summary);
      setStage('ready');
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === 'AbortError') {
        // Cleanly aborted for new scope or user cancel
        return;
      }
      console.error('Batch Cleanup Pipeline Error:', err);
      setError(err.message || 'Failed to complete batch cleanup scan.');
      setStage('idle');
    }
  }, [activeQuery, activeScopeName, sampleLimit, userLabels, aiSettings]);

  // Initial trigger on mount or scope switch
  useEffect(() => {
    runOmniScan();
  }, [selectedScope, sampleLimit]);

  // Summary Metrics
  const summary: OmniScanSummary = useMemo(() => {
    return computeOmniScanSummary(batches, activeScopeName);
  }, [batches, activeScopeName]);

  // Filtered Batches
  const visibleBatches = useMemo(() => {
    return batches.filter(b => {
      // Completed exclusion
      if (completedBatchIds.has(b.id)) return false;

      // Disposition filter
      if (filterDisposition === 'trash' && !(b.disposition === 'GO' && b.action === 'trash')) return false;
      if (filterDisposition === 'archive' && !(b.disposition === 'GO' && b.action === 'archive')) return false;
      if (filterDisposition === 'route' && !(b.disposition === 'GO' && b.action === 'route_to_label')) return false;
      if (filterDisposition === 'stay' && b.disposition !== 'STAY') return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = b.title.toLowerCase().includes(q);
        const matchesSender = b.dominantSender.toLowerCase().includes(q);
        const matchesDomain = b.dominantDomain.toLowerCase().includes(q);
        const matchesTag = b.categoryTag.toLowerCase().includes(q);
        const matchesLabel = b.suggestedLabel?.toLowerCase().includes(q);
        if (!matchesTitle && !matchesSender && !matchesDomain && !matchesTag && !matchesLabel) {
          return false;
        }
      }

      return true;
    });
  }, [batches, completedBatchIds, filterDisposition, searchQuery]);

  // Toggle individual message selection inside a batch review accordion
  const handleToggleEmailInBatch = (batchId: string, emailId: string) => {
    setBatches(prev => prev.map(b => {
      if (b.id !== batchId) return b;
      const nextSelected = new Set(b.selectedIds);
      if (nextSelected.has(emailId)) {
        nextSelected.delete(emailId);
      } else {
        nextSelected.add(emailId);
      }
      return { ...b, selectedIds: nextSelected };
    }));
  };

  // Toggle Select All in batch
  const handleToggleSelectAllInBatch = (batchId: string) => {
    setBatches(prev => prev.map(b => {
      if (b.id !== batchId) return b;
      const allSelected = b.selectedIds.size === b.emailIds.length;
      return {
        ...b,
        selectedIds: allSelected ? new Set() : new Set(b.emailIds)
      };
    }));
  };

  // Single Batch Execution
  const handleExecuteBatch = async (batch: OmniClusterBatch) => {
    const targetIds = Array.from(batch.selectedIds);
    if (targetIds.length === 0) return;

    setExecutingBatchId(batch.id);
    try {
      if (batch.action === 'trash') {
        await batchTrashEmails(targetIds);
      } else if (batch.action === 'archive') {
        await batchArchiveEmails(targetIds);
      } else if (batch.action === 'route_to_label' && batch.suggestedLabel) {
        let labelObj = userLabels.find(l => l.name?.toLowerCase() === batch.suggestedLabel!.toLowerCase());
        let labelId = labelObj?.id;
        if (!labelId) {
          const created = await createLabel(batch.suggestedLabel);
          if (created && created.id) {
            labelId = created.id;
          }
        }
        if (labelId) {
          await batchModifyEmails(targetIds, [labelId], ['INBOX']);
        } else {
          await batchArchiveEmails(targetIds);
        }
      } else if (batch.action === 'stay_keep') {
        // Keep Protected: user acknowledges staying in place
      }

      setCompletedBatchIds(prev => new Set(prev).add(batch.id));
      if (onRefreshInbox) onRefreshInbox();
    } catch (err: any) {
      console.error(`Failed to execute batch ${batch.id}:`, err);
      alert(`Action error: ${err.message || 'Could not complete batch action.'}`);
    } finally {
      setExecutingBatchId(null);
    }
  };

  // Bulk Apply All Approved "GO" Batches of a specific type
  const handleBulkExecuteAction = async (targetAction: 'trash' | 'archive') => {
    const candidateBatches = batches.filter(b => 
      !completedBatchIds.has(b.id) &&
      b.disposition === 'GO' &&
      b.action === targetAction &&
      b.selectedIds.size > 0
    );

    if (candidateBatches.length === 0) return;

    const totalEmails = candidateBatches.reduce((sum, b) => sum + b.selectedIds.size, 0);
    const actionName = targetAction === 'trash' ? 'Trash' : 'Archive';

    if (!confirm(`Are you sure you want to bulk ${actionName.toLowerCase()} ${totalEmails} emails across ${candidateBatches.length} batches?`)) {
      return;
    }

    setBulkActionProgress({ total: candidateBatches.length, done: 0, title: `Bulk ${actionName}ing ${candidateBatches.length} Batches…` });

    for (let i = 0; i < candidateBatches.length; i++) {
      const b = candidateBatches[i];
      const targetIds = Array.from(b.selectedIds);
      try {
        if (targetAction === 'trash') {
          await batchTrashEmails(targetIds);
        } else {
          await batchArchiveEmails(targetIds);
        }
        setCompletedBatchIds(prev => new Set(prev).add(b.id));
      } catch (err) {
        console.error(`Bulk execution error on batch ${b.id}:`, err);
      }
      setBulkActionProgress({ total: candidateBatches.length, done: i + 1, title: `Bulk ${actionName}ing ${candidateBatches.length} Batches…` });
    }

    setBulkActionProgress(null);
    if (onRefreshInbox) onRefreshInbox();
  };

  const isScanning = stage === 'fetching' || stage === 'clustering' || stage === 'ai_coop';

  return (
    <div className={cn(
      "flex flex-col gap-5",
      embedded ? "w-full p-4 sm:p-5" : "max-w-7xl mx-auto pb-16"
    )}>
      {/* Header (only when not embedded in SmartAutomationsPortal) */}
      {!embedded && (
        <PageHeader
          title="Batch Cleanup"
          subtitle="Group similar emails together to archive, delete, or file in bulk."
          actions={
            <div className="flex items-center gap-2">
              <button
                onClick={runOmniScan}
                disabled={isScanning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isScanning && "animate-spin")} />
                <span>Rescan Scope</span>
              </button>
              {onBack && (
                <button
                  onClick={onBack}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  Back to Health
                </button>
              )}
            </div>
          }
        />
      )}

      {/* Scope & Scan Depth Configuration Toolbar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-2xs flex flex-col gap-4">
        {/* Top row: Target Folder Scope selection */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 flex-wrap flex-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1 flex items-center gap-1.5">
              <Folder className="w-3.5 h-3.5" /> Scope:
            </span>
            {SCOPE_OPTIONS.map(opt => (
              <button
                key={opt.id}
                onClick={() => setSelectedScope(opt.id)}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer",
                  selectedScope === opt.id
                    ? "bg-slate-900 text-white border-slate-900 shadow-2xs"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50 hover:border-slate-300"
                )}
              >
                {opt.label}
              </button>
            ))}

            {/* Custom user labels dropdown */}
            {userLabels.length > 0 && (
              <select
                value={selectedScope.startsWith('label:') ? selectedScope : ''}
                onChange={e => {
                  if (e.target.value) setSelectedScope(e.target.value);
                }}
                className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-200 bg-white text-slate-700 hover:border-slate-300 focus:outline-none cursor-pointer"
              >
                <option value="">Custom Labels…</option>
                {userLabels.map(lbl => (
                  <option key={lbl.id} value={`label:${lbl.name}`}>
                    {lbl.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {embedded && (
            <div className="flex items-center gap-2 shrink-0 self-end md:self-auto">
              <button
                onClick={runOmniScan}
                disabled={isScanning}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={cn("w-3.5 h-3.5", isScanning && "animate-spin")} />
                <span>Rescan Scope</span>
              </button>
            </div>
          )}
        </div>

        {/* Bottom row: Scan Depth explicit tab selector */}
        <div className="flex items-center justify-between flex-wrap gap-2 pt-3 border-t border-slate-100">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 mr-1 flex items-center gap-1.5">
              <SlidersHorizontal className="w-3.5 h-3.5" /> Scan Depth:
            </span>
            {SCAN_DEPTH_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSampleLimit(opt.value)}
                className={cn(
                  "px-2.5 py-1 text-xs font-medium rounded-lg border transition-all cursor-pointer",
                  sampleLimit === opt.value
                    ? "bg-slate-800 text-white border-slate-800 shadow-2xs"
                    : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <span className="text-[11px] text-slate-400 font-medium">
            {sampleLimit === 0 ? 'Full mailbox scan enabled' : `Limited to top ${sampleLimit} messages`}
          </span>
        </div>
      </div>

      {/* Progress & Pipeline Status Notification */}
      {isScanning && (
        <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm flex flex-col gap-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <Loader2 className="w-4 h-4 animate-spin text-white shrink-0" />
              <div>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300">
                    {stage === 'fetching' && 'Step 1 of 3: Loading emails'}
                    {stage === 'clustering' && 'Step 2 of 3: Grouping similar emails'}
                    {stage === 'ai_coop' && 'Step 3 of 3: Checking suggestions'}
                  </span>
                </div>
                <p className="text-xs font-medium text-slate-100">{scanProgressText}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              {scanMetrics && scanMetrics.total > 0 && (
                <span className="text-xs font-mono font-bold text-slate-200">
                  {Math.round((scanMetrics.done / scanMetrics.total) * 100)}%
                </span>
              )}
              <button
                onClick={cancelScan}
                className="px-2 py-1 text-xs font-medium bg-white/10 hover:bg-white/20 text-slate-200 hover:text-white rounded-md transition-colors flex items-center gap-1 cursor-pointer"
                title="Cancel active scan"
              >
                <X className="w-3 h-3" />
                <span>Cancel</span>
              </button>
            </div>
          </div>
          {scanMetrics && scanMetrics.total > 0 && (
            <div className="w-full bg-white/20 h-1.5 rounded-full overflow-hidden">
              <div
                className="bg-emerald-400 h-full transition-all duration-150"
                style={{ width: `${Math.min(100, Math.round((scanMetrics.done / scanMetrics.total) * 100))}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Bulk Action Progress Banner */}
      {bulkActionProgress && (
        <div className="bg-slate-900 text-white rounded-xl p-4 shadow-sm flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
            <div>
              <p className="text-xs font-bold">{bulkActionProgress.title}</p>
              <p className="text-[11px] text-slate-300">
                Processed {bulkActionProgress.done} of {bulkActionProgress.total} batches…
              </p>
            </div>
          </div>
          <div className="w-28 bg-white/20 h-1.5 rounded-full overflow-hidden">
            <div
              className="bg-emerald-400 h-full transition-all duration-200"
              style={{ width: `${Math.round((bulkActionProgress.done / bulkActionProgress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

      {/* Error Message */}
      {error && (
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-3.5 text-rose-800 text-xs flex items-center gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <p className="flex-1">{error}</p>
          <button
            onClick={runOmniScan}
            className="px-2.5 py-1 bg-rose-600 text-white rounded-md text-xs font-semibold cursor-pointer hover:bg-rose-700"
          >
            Retry
          </button>
        </div>
      )}

      {/* Summary Metrics Strip */}
      {stage === 'ready' && batches.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 shadow-2xs">
          {/* Executive verdict row */}
          {executiveSummary && (
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                    {executiveSummary.headline}
                  </h3>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md border bg-slate-100 text-slate-800 border-slate-200">
                    Auto Grouped
                  </span>
                </div>
                <p className="text-slate-600 text-xs leading-relaxed max-w-3xl mb-1.5">
                  {executiveSummary.verdictText}
                </p>
                <div className="flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-slate-50 border border-slate-200 px-2.5 py-1 rounded-md w-fit">
                  <Sparkles className="w-3 h-3 text-slate-600 shrink-0" />
                  <span>Recommendation: {executiveSummary.recommendedImmediateAction}</span>
                </div>
              </div>

              {/* Bulk execution buttons */}
              {summary.reclaimableCount > 0 && (
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleBulkExecuteAction('trash')}
                    disabled={Boolean(executingBatchId || bulkActionProgress)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-rose-700 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Trash All Trash Batches</span>
                  </button>
                  <button
                    onClick={() => handleBulkExecuteAction('archive')}
                    disabled={Boolean(executingBatchId || bulkActionProgress)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>Archive All Archive Batches</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Metric Badges */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-4">
            <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg">
              <span className="text-[11px] font-semibold text-slate-500 block mb-0.5">Total Batches</span>
              <span className="text-base font-bold text-slate-900">{summary.totalBatches} batches</span>
              <span className="text-[11px] text-slate-500 block mt-0.5">{summary.totalScanned} messages scanned</span>
            </div>
            <div className="p-3 bg-rose-50/50 border border-rose-200/70 rounded-lg">
              <span className="text-[11px] font-semibold text-rose-700 block mb-0.5">Actionable (Go)</span>
              <span className="text-base font-bold text-rose-900">{summary.reclaimableCount} msgs</span>
              <span className="text-[11px] text-rose-600 block mt-0.5">{summary.goBatchesCount} batches flagged</span>
            </div>
            <div className="p-3 bg-slate-100/70 border border-slate-200 rounded-lg">
              <span className="text-[11px] font-semibold text-slate-700 block mb-0.5">Storage Footprint</span>
              <span className="text-base font-bold text-slate-900">{formatBytes(summary.reclaimableBytes)}</span>
              <span className="text-[11px] text-slate-600 block mt-0.5">reclaimable space</span>
            </div>
            <div className="p-3 bg-emerald-50/50 border border-emerald-200/70 rounded-lg">
              <span className="text-[11px] font-semibold text-emerald-700 block mb-0.5">Protected (Stay)</span>
              <span className="text-base font-bold text-emerald-900">{summary.protectedCount} msgs</span>
              <span className="text-[11px] text-emerald-600 block mt-0.5">{summary.stayBatchesCount} safe batches</span>
            </div>
          </div>
        </div>
      )}

      {/* Filter Toolbar & Search */}
      {stage === 'ready' && batches.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Filter Chips */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <button
              onClick={() => setFilterDisposition('all')}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer",
                filterDisposition === 'all'
                  ? "bg-slate-900 text-white border-slate-900 shadow-2xs"
                  : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
              )}
            >
              All Batches ({batches.length - completedBatchIds.size})
            </button>
            <button
              onClick={() => setFilterDisposition('trash')}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1",
                filterDisposition === 'trash'
                  ? "bg-rose-700 text-white border-rose-700 shadow-2xs"
                  : "bg-white text-rose-700 border-rose-200 hover:bg-rose-50"
              )}
            >
              <span>Go: Trash</span>
              <span>({batches.filter(b => !completedBatchIds.has(b.id) && b.disposition === 'GO' && b.action === 'trash').length})</span>
            </button>
            <button
              onClick={() => setFilterDisposition('archive')}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1",
                filterDisposition === 'archive'
                  ? "bg-amber-700 text-white border-amber-700 shadow-2xs"
                  : "bg-white text-amber-800 border-amber-200 hover:bg-amber-50"
              )}
            >
              <span>Go: Archive</span>
              <span>({batches.filter(b => !completedBatchIds.has(b.id) && b.disposition === 'GO' && b.action === 'archive').length})</span>
            </button>
            <button
              onClick={() => setFilterDisposition('route')}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1",
                filterDisposition === 'route'
                  ? "bg-blue-700 text-white border-blue-700 shadow-2xs"
                  : "bg-white text-blue-700 border-blue-200 hover:bg-blue-50"
              )}
            >
              <span>Go: File to Folder</span>
              <span>({batches.filter(b => !completedBatchIds.has(b.id) && b.disposition === 'GO' && b.action === 'route_to_label').length})</span>
            </button>
            <button
              onClick={() => setFilterDisposition('stay')}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-semibold border transition-all cursor-pointer flex items-center gap-1",
                filterDisposition === 'stay'
                  ? "bg-emerald-700 text-white border-emerald-700 shadow-2xs"
                  : "bg-white text-emerald-700 border-emerald-200 hover:bg-emerald-50"
              )}
            >
              <span>No: Stay / Keep</span>
              <span>({batches.filter(b => !completedBatchIds.has(b.id) && b.disposition === 'STAY').length})</span>
            </button>
          </div>

          {/* Search box */}
          <div className="relative sm:w-56">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search sender, tag, label…"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-2.5 py-1 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:bg-white focus:border-slate-300 text-slate-800"
            />
          </div>
        </div>
      )}

      {/* Batch Cards Grid (Arranged strictly by batch size descending) */}
      {stage === 'ready' && (
        <div className="flex flex-col gap-3.5">
          {visibleBatches.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center shadow-2xs">
              <CheckCircle2 className="w-8 h-8 text-emerald-600 mx-auto mb-2" />
              <h4 className="font-bold text-slate-800 text-sm mb-1">
                {completedBatchIds.size > 0 ? 'All Filtered Batches Completed' : 'No Batches Found'}
              </h4>
              <p className="text-slate-500 text-xs max-w-md mx-auto mb-3">
                {completedBatchIds.size > 0
                  ? 'You have successfully executed actions on all batches in this filter view.'
                  : 'Try selecting a different scope or changing the search filter.'}
              </p>
              <button
                onClick={runOmniScan}
                className="px-3.5 py-1.5 bg-slate-900 text-white text-xs font-semibold rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                Scan Again
              </button>
            </div>
          ) : (
            visibleBatches.map(batch => {
              const isExpanded = expandedBatchId === batch.id;
              const isExecuting = executingBatchId === batch.id;
              const selectedCount = batch.selectedIds.size;
              const totalCount = batch.emailIds.length;

              return (
                <div
                  key={batch.id}
                  className="bg-white border border-slate-200 rounded-xl shadow-2xs hover:border-slate-300 transition-all overflow-hidden"
                >
                  {/* Card Header & Main Overview */}
                  <div className="p-4">
                    <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3.5">
                      {/* Left: Disposition Badge, Title, Sender, Rationale */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                          {/* Disposition Indicator */}
                          {batch.disposition === 'GO' && batch.action === 'trash' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-100 text-rose-800 border border-rose-200">
                              <Trash2 className="w-3 h-3" /> YES GO • TRASH
                            </span>
                          )}
                          {batch.disposition === 'GO' && batch.action === 'archive' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                              <Archive className="w-3 h-3" /> YES GO • ARCHIVE
                            </span>
                          )}
                          {batch.disposition === 'GO' && batch.action === 'route_to_label' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
                              <FolderInput className="w-3 h-3" /> YES GO • FILE TO "{batch.suggestedLabel}"
                            </span>
                          )}
                          {batch.disposition === 'STAY' && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                              <ShieldCheck className="w-3 h-3" /> NO STAY • KEEP PROTECTED
                            </span>
                          )}

                          {/* Category Tag */}
                          <span className="text-[10px] font-medium bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded-md border border-slate-200">
                            {batch.categoryTag}
                          </span>

                          {/* Confidence */}
                          <span className="text-[10px] text-slate-500 font-mono">
                            {Math.round(batch.confidence * 100)}% Match
                          </span>
                        </div>

                        {/* Title */}
                        <h4 className="text-xs sm:text-sm font-bold text-slate-900 mb-1">
                          {batch.title}
                        </h4>

                        {/* Rationale */}
                        <p className="text-xs text-slate-600 leading-relaxed mb-2.5">
                          {batch.rationale}
                        </p>

                        {/* Evidence Badges */}
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[10px] font-bold text-slate-800 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                            {totalCount} messages ({formatBytes(batch.totalBytes)})
                          </span>
                          {batch.readRate < 0.2 && (
                            <span className="text-[10px] text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                              {Math.round(batch.readRate * 100)}% read rate
                            </span>
                          )}
                          {batch.bulkRatio > 0.5 && (
                            <span className="text-[10px] text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                              List-Unsubscribe
                            </span>
                          )}
                          {batch.threadRatio > 0.2 && (
                            <span className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                              2-way dialogues
                            </span>
                          )}
                          {batch.evidence.map((ev, i) => (
                            <span key={i} className="text-[10px] text-slate-600 bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded">
                              ✓ {ev}
                            </span>
                          ))}
                        </div>
                      </div>

                      {/* Right: Actions & Review Trigger */}
                      <div className="flex items-center gap-2 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
                        {/* Inline Review Toggle */}
                        <button
                          onClick={() => setExpandedBatchId(isExpanded ? null : batch.id)}
                          className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-50 border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <span>{isExpanded ? 'Hide' : 'Review'} ({totalCount})</span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>

                        {/* Primary Action Button */}
                        {batch.action === 'trash' && (
                          <button
                            onClick={() => handleExecuteBatch(batch)}
                            disabled={isExecuting || selectedCount === 0}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-rose-700 hover:bg-rose-800 rounded-lg transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                          >
                            {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            <span>Trash {selectedCount} {selectedCount === 1 ? 'msg' : 'msgs'}</span>
                          </button>
                        )}

                        {batch.action === 'archive' && (
                          <button
                            onClick={() => handleExecuteBatch(batch)}
                            disabled={isExecuting || selectedCount === 0}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-amber-700 hover:bg-amber-800 rounded-lg transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                          >
                            {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                            <span>Archive {selectedCount} {selectedCount === 1 ? 'msg' : 'msgs'}</span>
                          </button>
                        )}

                        {batch.action === 'route_to_label' && (
                          <button
                            onClick={() => handleExecuteBatch(batch)}
                            disabled={isExecuting || selectedCount === 0}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors shadow-2xs cursor-pointer disabled:opacity-50"
                          >
                            {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderInput className="w-3.5 h-3.5" />}
                            <span>File {selectedCount} to "{batch.suggestedLabel}"</span>
                          </button>
                        )}

                        {batch.action === 'stay_keep' && (
                          <button
                            onClick={() => handleExecuteBatch(batch)}
                            disabled={isExecuting}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded-lg transition-colors shadow-2xs cursor-pointer"
                          >
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700" />
                            <span>Mark Keep Safe</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Inline Expandable Message Review Accordion */}
                  <AnimatePresence>
                    {isExpanded && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.18 }}
                        className="border-t border-slate-200 bg-slate-50/70 p-4"
                      >
                        <div className="flex items-center justify-between gap-3 mb-2.5 pb-2 border-b border-slate-200">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => handleToggleSelectAllInBatch(batch.id)}
                              className="text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer flex items-center gap-1.5"
                            >
                              <div className={cn(
                                "w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors",
                                selectedCount === totalCount ? "bg-slate-900 border-slate-900 text-white" : "border-slate-300 bg-white"
                              )}>
                                {selectedCount === totalCount && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                              </div>
                              <span>Select All ({totalCount})</span>
                            </button>
                            <span className="text-xs text-slate-400">•</span>
                            <span className="text-xs text-slate-500 font-medium">
                              {selectedCount} of {totalCount} included in action
                            </span>
                          </div>

                          <span className="text-[10px] text-slate-500 font-mono">
                            Query: {batch.query}
                          </span>
                        </div>

                        {/* Email items list */}
                        <div className="flex flex-col gap-1.5 max-h-72 overflow-y-auto pr-1">
                          {batch.emails.map((email: any) => {
                            const isSelected = batch.selectedIds.has(email.id);
                            const isUnread = (email.labelIds || []).includes('UNREAD');

                            return (
                              <div
                                key={email.id}
                                onClick={() => handleToggleEmailInBatch(batch.id, email.id)}
                                className={cn(
                                  "p-2.5 rounded-lg border transition-all cursor-pointer flex items-start gap-2.5 text-left",
                                  isSelected
                                    ? "bg-white border-slate-200 hover:border-slate-300 shadow-2xs"
                                    : "bg-slate-100/70 border-slate-200/60 opacity-50 line-through"
                                )}
                              >
                                <div className="pt-0.5">
                                  <div className={cn(
                                    "w-3.5 h-3.5 rounded border flex items-center justify-center transition-colors shrink-0",
                                    isSelected ? "bg-slate-900 border-slate-900 text-white" : "border-slate-300 bg-white"
                                  )}>
                                    {isSelected && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                                  </div>
                                </div>

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2 mb-0.5">
                                    <span className={cn("text-xs truncate", isUnread ? "font-bold text-slate-900" : "font-medium text-slate-700")}>
                                      {email.sender || 'Unknown'}
                                    </span>
                                    <span className="text-[10px] text-slate-500 shrink-0">
                                      {email.date ? new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                                    </span>
                                  </div>
                                  <p className={cn("text-xs text-slate-800 truncate mb-0.5", isUnread && "font-semibold")}>
                                    {email.subject || '(No Subject)'}
                                  </p>
                                  <p className="text-[11px] text-slate-500 truncate leading-relaxed">
                                    {email.snippet || ''}
                                  </p>
                                </div>

                                {email.sizeEstimate > 0 && (
                                  <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1 py-0.5 rounded shrink-0">
                                    {formatBytes(email.sizeEstimate)}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
