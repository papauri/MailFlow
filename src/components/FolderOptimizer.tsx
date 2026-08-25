import React, { useMemo, useState } from 'react';
import { Loader2, SlidersHorizontal, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { RoutingSuggestions } from './RoutingSuggestions';
import { buildRoutingSuggestions } from '../lib/foldingModel';
import { PageHeader } from './PageHeader';
import { useCachedResource } from '../lib/useCachedResource';
import { fetchRoutingSample, routingSampleKey, RoutingSample } from '../lib/inboxAnalytics';

interface Props {
  isOpen?: boolean;
  onClose?: () => void;
  userLabels: any[];
  aiSettings?: any;
  isFetching?: boolean;
  isAiWorking?: boolean;
  userEmail?: string;
  onReload?: () => void;
  isPage?: boolean;
}

/**
 * Folder Optimizer.
 *
 * Previously carried its own clustering engine: a seeded table of ~30 known brand
 * domains plus TF-IDF cosine clustering over subject text, behind a manual scan.
 * It produced a second, differently-worded set of suggestions alongside the routing
 * model, which duplicated the job and disagreed with it at the edges.
 *
 * Now a thin shell over the shared routing model, so folder suggestions come from
 * one place, read identically wherever they appear, and are on screen as soon as the
 * page opens rather than after a scan.
 */
export function FolderOptimizer({
  userLabels, aiSettings, userEmail, onReload, isPage
}: Omit<Props, 'isOpen' | 'onClose'>) {
  const [isExpanded, setIsExpanded] = useState(true);

  /**
   * Fetches its own sample rather than relying on whatever the dashboard last
   * searched — these routes never trigger a search, so the prop was routinely empty
   * and the tool reported "nothing to automate" from no data at all. Shares a cache
   * key with Automated Sorting Rules, so the two cost one background fetch between
   * them and it is already warm on the second visit.
   */
  const sample = useCachedResource<RoutingSample>(
    routingSampleKey(userEmail),
    () => fetchRoutingSample()
  );

  const sampleEmails = sample.data?.emails ?? [];

  const suggestions = useMemo(
    () => buildRoutingSuggestions(sampleEmails, userLabels || []),
    [sampleEmails, userLabels]
  );

  const senderCount = useMemo(
    () => new Set(sampleEmails.map((e: any) => (e.sender || '').toLowerCase())).size,
    [sampleEmails]
  );

  return (
    <div className={cn(
      "bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden shadow-xs relative",
      isPage ? "" : "mt-6 sm:mt-8"
    )}>
      {isPage ? (
        <PageHeader
          title="Folder Optimizer"
          subtitle="Files mail you already have. Use Sorting Rules to automate future mail."
          icon={<SlidersHorizontal className="w-4 h-4" />}
          onBack={() => { window.location.hash = '#health'; }}
          backLabel="Back to Inbox Health"
          className="mb-0 rounded-b-none border-b-0"
          actions={
            <button
              onClick={() => { sample.refresh(); if (onReload) onReload(); }}
              disabled={sample.loading || sample.refreshing}
              className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh mail sample"
            >
              <RefreshCw className={cn("w-4 h-4", (sample.loading || sample.refreshing) && "animate-spin")} />
            </button>
          }
        />
      ) : (
        <div
          className="flex items-center justify-between p-3 sm:p-4 border-b border-slate-100 bg-slate-50/50 gap-3 cursor-pointer hover:bg-slate-100/50 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-1.5 rounded-lg bg-slate-100 text-slate-700 shrink-0">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-800 truncate">Folder Optimizer</h2>
              <p className="text-[11px] text-slate-500 truncate">Files mail you already have.</p>
            </div>
          </div>
          <button
            className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer shrink-0"
            onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      )}

      {isExpanded && (
        <div className="p-4 sm:p-6 bg-slate-50/40">
          {(
            <RoutingSuggestions
              mode="folder"
              suggestions={suggestions}
              sendersAnalysed={senderCount}
              loading={sample.loading}
              filedCount={sample.data?.filedCount ?? 0}
              sampleSize={sampleEmails.length}
              aiSettings={aiSettings}
              onInspect={(query, title) => {
                const params = new URLSearchParams();
                params.set('q', query);
                params.set('title', title);
                params.set('badge', 'Suggested routing');
                params.set('sub', 'Messages this rule would file');
                params.set('source', 'folder-optimizer');
                window.location.hash = `#filter-view?${params.toString()}`;
              }}
              onApplied={() => { sample.refresh(); if (onReload) onReload(); }}
              onLabelsChanged={() => { sample.refresh(); if (onReload) onReload(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}
