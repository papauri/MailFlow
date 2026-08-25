import React, { useMemo, useState } from 'react';
import { Loader2, SlidersHorizontal, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { RoutingSuggestions } from './RoutingSuggestions';
import { buildRoutingSuggestions } from '../lib/foldingModel';

interface Props {
  isOpen?: boolean;
  onClose?: () => void;
  emails: any[];
  userLabels: any[];
  aiSettings?: any;
  isFetching?: boolean;
  isAiWorking?: boolean;
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
  emails, userLabels, aiSettings, isFetching, onReload, isPage
}: Omit<Props, 'isOpen' | 'onClose'>) {
  const [isExpanded, setIsExpanded] = useState(true);

  const suggestions = useMemo(
    () => buildRoutingSuggestions(emails || [], userLabels || []),
    [emails, userLabels]
  );

  const senderCount = useMemo(
    () => new Set((emails || []).map((e: any) => (e.sender || '').toLowerCase())).size,
    [emails]
  );

  return (
    <div className={cn(
      "bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden shadow-xs relative",
      isPage ? "" : "mt-6 sm:mt-8"
    )}>
      <div
        className={cn(
          "flex flex-col sm:flex-row items-start sm:items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50 gap-3 transition-colors",
          !isPage && "cursor-pointer hover:bg-slate-100/50"
        )}
        onClick={() => { if (!isPage) setIsExpanded(!isExpanded); }}
      >
        <div className="flex items-start sm:items-center gap-3 min-w-0">
          <div className="p-2 rounded-lg bg-slate-100 text-slate-700 shrink-0">
            <SlidersHorizontal className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-slate-800">Folder Optimizer</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Suggests where recurring mail belongs, based on how you already file it.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
          {onReload && (
            <button
              onClick={(e) => { e.stopPropagation(); onReload(); }}
              disabled={isFetching}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh mail sample"
            >
              <RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} />
            </button>
          )}
          {!isPage && (
            <button
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
              onClick={(e) => { e.stopPropagation(); setIsExpanded(!isExpanded); }}
            >
              <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="p-4 sm:p-6 bg-slate-50/40">
          {isFetching && (emails || []).length === 0 ? (
            <div className="py-16 flex flex-col items-center justify-center text-slate-400 gap-3">
              <Loader2 className="w-7 h-7 animate-spin text-slate-500" />
              <p className="text-sm font-medium text-slate-600">Loading your mail…</p>
            </div>
          ) : (
            <RoutingSuggestions
              suggestions={suggestions}
              sendersAnalysed={senderCount}
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
              onApplied={() => { if (onReload) onReload(); }}
              onLabelsChanged={() => { if (onReload) onReload(); }}
            />
          )}
        </div>
      )}
    </div>
  );
}
