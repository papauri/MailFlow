import React, { useState, useEffect } from 'react';
import {
  Loader2, Sparkles, ShieldCheck, Archive, Trash2, ChevronDown, ChevronUp,
  Filter, TrendingUp, CheckCircle2, AlertTriangle
} from 'lucide-react';
import { cn } from '../lib/utils';
import { trashAllByQuery, archiveAllByQuery } from '../lib/gmail';
import { CleanupAnalysis, CleanupRecommendation, formatCleanupBytes } from '../lib/cleanupModel';
import { enrichSuggestions, EnrichedText } from '../lib/enrichSuggestions';
import { useActionCompletion } from '../lib/useActionCompletion';

interface Props {
  analysis: CleanupAnalysis;
  categoryName: string;
  /** Opens the matching messages as a full page so the user can check before acting. */
  onInspect: (query: string, title: string) => void;
  onCompleted: (rec: CleanupRecommendation, processed: number) => void;
  aiSettings?: any;
}

const KIND_META: Record<CleanupRecommendation['kind'], { label: string; icon: React.ReactNode }> = {
  unsubscribe_purge: { label: 'Unwanted mail', icon: <Trash2 className="w-4 h-4" /> },
  dormant_purge: { label: 'Dormant', icon: <Trash2 className="w-4 h-4" /> },
  storage_purge: { label: 'Storage', icon: <TrendingUp className="w-4 h-4" /> },
  auto_archive: { label: 'Inbox noise', icon: <Archive className="w-4 h-4" /> },
};

function confidenceLabel(c: number): string {
  if (c >= 0.85) return 'High confidence';
  if (c >= 0.65) return 'Good confidence';
  return 'Worth a look';
}

/**
 * Presents the behavioural cleanup model's findings.
 *
 * Every card states the reasoning and the numbers behind it, because the user is
 * being asked to delete mail in bulk and deserves to see why it was suggested.
 * Inspect always precedes acting, and each card reports live progress.
 */
export function CleanupRecommendations({
  analysis, categoryName, onInspect, onCompleted, aiSettings
}: Props) {
  const [enriched, setEnriched] = useState<Map<string, EnrichedText>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ id: string; done: number; total: number } | null>(null);
  const completion = useActionCompletion();
  const [error, setError] = useState<string | null>(null);

  const { recommendations, pareto, reclaimableBytes, reclaimableVolume, protectedSenders } = analysis;

  // Wording only. Findings are already final and rendered before this resolves, so a
  // missing key, spent quota or slow model changes nothing except the phrasing.
  useEffect(() => {
    let cancelled = false;
    if (recommendations.length === 0) return;
    enrichSuggestions(
      recommendations.slice(0, 12).map(r => ({
        id: r.id,
        kind: r.kind,
        subject: r.title,
        stats: `${r.volume} messages, ${formatCleanupBytes(r.bytes)}, confidence ${Math.round(r.confidence * 100)}%`,
      })),
      aiSettings
    ).then(map => {
      if (!cancelled && map.size > 0) setEnriched(map);
    });
    return () => { cancelled = true; };
  }, [recommendations, aiSettings]);

  const isEnhanced = enriched.size > 0;

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const execute = async (rec: CleanupRecommendation) => {
    setRunning(rec.id);
    setError(null);
    setProgress({ id: rec.id, done: 0, total: rec.volume });
    try {
      const report = (done: number) => setProgress({ id: rec.id, done, total: rec.volume });
      const processed = rec.action === 'archive'
        ? await archiveAllByQuery(rec.query, report)
        : await trashAllByQuery(rec.query, report);

      // Confirm, then take it off the list — the work is done and the row is no
      // longer actionable, so leaving it there only makes the list longer.
      completion.complete(
        rec.id,
        `${processed.toLocaleString()} ${rec.action === 'archive' ? 'archived' : 'cleared'}`,
        { messages: processed, bytes: rec.bytes }
      );
      onCompleted(rec, processed);
    } catch (e: any) {
      console.error(e);
      setError(`Couldn't complete "${rec.title}". ${e?.message || 'Please try again.'}`);
    } finally {
      setRunning(null);
      setProgress(null);
    }
  };

  const pending = completion.visible(recommendations);

  return (
    <div className="flex flex-col gap-4">
      {/* What the model concluded about this category */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl shrink-0 hidden sm:block">
            <Sparkles className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-bold text-slate-900 text-sm sm:text-base">
                What's driving your {categoryName}
              </h3>
              <span className="text-[11px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                {isEnhanced ? 'Enhanced analysis' : 'Pattern analysis'}
              </span>
            </div>

            {pareto && pareto.totalSenders > 1 ? (
              <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                <strong className="text-slate-900">{pareto.senderCount} of {pareto.totalSenders} senders</strong> account for{' '}
                <strong className="text-slate-900">{Math.round(pareto.coveredShare * 100)}%</strong> of these{' '}
                {pareto.totalVolume.toLocaleString()} messages. Handling those few settles most of the category.
              </p>
            ) : (
              <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
                Analysed {analysis.cohorts.length.toLocaleString()} senders in this category.
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-3">
              {reclaimableVolume > 0 && (
                <span className="text-[11px] font-semibold text-slate-800 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg">
                  {reclaimableVolume.toLocaleString()} messages · {formatCleanupBytes(reclaimableBytes)} reclaimable
                </span>
              )}
              {protectedSenders > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-lg">
                  <ShieldCheck className="w-3 h-3" />
                  {protectedSenders} sender{protectedSenders === 1 ? '' : 's'} protected — you star or reply to them
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-white border border-amber-200 rounded-xl p-3.5 flex items-start gap-2.5 shadow-2xs">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-700">{error}</p>
        </div>
      )}

      {pending.length === 0 && completion.clearedCount === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-xs flex flex-col items-center text-center gap-2">
          <ShieldCheck className="w-8 h-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-800">Nothing worth bulk-cleaning here</p>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            No sender in this category shows the pattern of high volume with low engagement. Anything left is
            mail you read, reply to, or have flagged.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {completion.visible(recommendations).map(rec => {
            const meta = KIND_META[rec.kind];
            const isOpen = expanded.has(rec.id);
            const isRunning = running === rec.id;
            const doneLabel = completion.labelFor(rec.id);
            const showProgress = progress && progress.id === rec.id;

            return (
              <div
                key={rec.id}
                className={cn(
                  "bg-white border rounded-xl shadow-2xs transition-colors",
                  doneLabel ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 hover:border-slate-300"
                )}
              >
                <div className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                      {meta.icon}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-slate-900">{enriched.get(rec.id)?.title || rec.title}</h4>
                        <span className="text-[11px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200 whitespace-nowrap">
                          {meta.label}
                        </span>
                        {doneLabel && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                            <CheckCircle2 className="w-3 h-3" />
                            {doneLabel}
                            {completion.impactFor(rec.id)?.bytes
                              ? ` · ${formatCleanupBytes(completion.impactFor(rec.id)!.bytes!)} freed`
                              : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{enriched.get(rec.id)?.rationale || rec.rationale}</p>
                      <button
                        onClick={() => toggle(rec.id)}
                        className="mt-1.5 text-[11px] font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                      >
                        {isOpen ? 'Hide evidence' : 'Why this was suggested'}
                        {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between sm:justify-end gap-2 sm:gap-3 shrink-0 w-full sm:w-auto">
                    <span className="text-[11px] font-medium text-slate-500 w-[92px] text-right shrink-0 hidden sm:block">
                      {confidenceLabel(rec.confidence)}
                    </span>
                    <div className="flex items-stretch gap-0.5 bg-slate-100 rounded-lg p-0.5 border border-slate-200 w-full sm:w-[184px] shrink-0">
                      <button
                        onClick={() => onInspect(rec.query, rec.title)}
                        disabled={isRunning}
                        className="flex-1 text-xs font-medium px-2 py-1.5 rounded-md hover:bg-white text-slate-700 transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        Inspect
                      </button>
                      <button
                        onClick={() => execute(rec)}
                        disabled={isRunning || running !== null || !!doneLabel}
                        className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex items-center justify-center gap-1"
                      >
                        {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
                        {rec.action === 'archive' ? 'Archive' : 'Clean up'}
                      </button>
                    </div>
                  </div>
                </div>

                {showProgress && (
                  <div className="px-3.5 pb-3.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium text-slate-600">
                        {rec.action === 'archive' ? 'Archiving' : 'Moving to trash'}…
                      </span>
                      <span className="text-[11px] font-medium text-slate-600 tabular-nums">
                        {progress!.done.toLocaleString()} / {progress!.total.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-slate-800 rounded-full transition-all duration-300"
                        style={{ width: `${progress!.total > 0 ? Math.min(100, Math.round((progress!.done / progress!.total) * 100)) : 100}%` }}
                      />
                    </div>
                  </div>
                )}

                {isOpen && (
                  <div className="px-3.5 pb-3.5 pt-0">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-2">
                        Why this was suggested
                      </p>
                      <ul className="flex flex-col gap-1">
                        {rec.evidence.map((line, i) => (
                          <li key={i} className="text-[11px] text-slate-600 flex items-start gap-1.5">
                            <span className="text-slate-400 mt-0.5">•</span>
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2.5 pt-2.5 border-t border-slate-200 flex items-center gap-2 flex-wrap">
                        <Filter className="w-3 h-3 text-slate-400 shrink-0" />
                        <code className="text-[10px] text-slate-600 bg-white border border-slate-200 rounded px-1.5 py-0.5 break-all">
                          {rec.query}
                        </code>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
