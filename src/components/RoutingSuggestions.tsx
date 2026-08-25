import React, { useState, useEffect } from 'react';
import {
  Loader2, FolderTree, ChevronDown, ChevronUp, Filter, CheckCircle2,
  AlertTriangle, X, Brain
} from 'lucide-react';
import { cn } from '../lib/utils';
import { createLabel, createFilter, batchModifyEmails } from '../lib/gmail';
import { RoutingSuggestion } from '../lib/foldingModel';
import { recordDecision, memoryStats } from '../lib/suggestionMemory';
import { enrichSuggestions, EnrichedText } from '../lib/enrichSuggestions';
import { useActionCompletion } from '../lib/useActionCompletion';

/**
 * The two tools answer different questions about the same analysis:
 *
 *   'folder' — the backlog. "Where should the mail I already have live?"
 *              Files existing messages. Changes nothing about future mail.
 *   'rule'   — the future. "What should happen to mail that arrives from now on?"
 *              Creates a Gmail filter. Leaves the backlog alone unless asked.
 *
 * They previously shared one panel that did both at once, which meant Folder
 * Optimizer and Automated Sorting Rules opened the same screen and a single click
 * silently did two irreversible things.
 */
export type RoutingMode = 'folder' | 'rule';

interface Props {
  mode: RoutingMode;
  suggestions: RoutingSuggestion[];
  sendersAnalysed: number;
  /** Training sample still being fetched. */
  loading?: boolean;
  /** Messages in the sample that carry a user label — the evidence to learn from. */
  filedCount?: number;
  sampleSize?: number;
  aiSettings?: any;
  onInspect: (query: string, title: string) => void;
  onApplied: (suggestion: RoutingSuggestion) => void;
  onLabelsChanged?: () => void;
}

/**
 * Uniform presentation for folder and rule suggestions.
 *
 * Shares its shell with the cleanup panel — same card, same fixed-width action
 * group, same "why this was suggested" disclosure — so every recommendation in the
 * app reads the same way regardless of which model produced it.
 */
export function RoutingSuggestions({
  mode, suggestions, sendersAnalysed, loading = false, filedCount = 0, sampleSize = 0,
  aiSettings, onInspect, onApplied, onLabelsChanged
}: Props) {
  const [enriched, setEnriched] = useState<Map<string, EnrichedText>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const completion = useActionCompletion();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const stats = memoryStats();

  // Wording only — the routing decisions are already made and on screen.
  useEffect(() => {
    let cancelled = false;
    if (suggestions.length === 0) return;
    enrichSuggestions(
      suggestions.slice(0, 12).map(s => ({
        id: s.id,
        kind: s.kind,
        subject: s.senderName,
        destination: s.labelName,
        stats: `${s.filed} of ${s.volume} already filed there, ${Math.round(s.purity * 100)}% consistent, ${s.unfiled} unfiled`,
      })),
      aiSettings
    ).then(map => {
      if (!cancelled && map.size > 0) setEnriched(map);
    });
    return () => { cancelled = true; };
  }, [suggestions, aiSettings]);

  const isEnhanced = enriched.size > 0;

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isFolderMode = mode === 'folder';

  /** AI may improve the name of a folder we're about to create — never an existing one. */
  const displayLabel = (s: RoutingSuggestion) =>
    (s.kind === 'new_folder' ? enriched.get(s.id)?.folderName?.trim() : '') || s.labelName;

  const apply = async (s: RoutingSuggestion) => {
    setBusy(s.id);
    setError(null);
    try {
      // Reuse the existing folder when there is one; only create when genuinely new.
      let labelId = s.labelId;
      if (!labelId) {
        const created = await createLabel(displayLabel(s));
        labelId = created?.id;
        if (!labelId) throw new Error('Could not create the folder.');
        if (onLabelsChanged) onLabelsChanged();
      }

      if (isFolderMode) {
        // Backlog only. Deliberately creates no filter: the user asked to organise
        // what exists, not to change what happens to mail they haven't received.
        if (s.ids.length > 0) {
          await batchModifyEmails(s.ids, [labelId], ['INBOX']);
        }
      } else {
        // Future only, which is what a rule means. The backlog is left alone so this
        // stays reversible — deleting the filter fully undoes it.
        await createFilter(s.query, [labelId], ['INBOX']);
      }

      recordDecision(s.memoryKey, 'accepted');
      completion.complete(s.id, isFolderMode ? `Filed into ${displayLabel(s)}` : 'Rule created');
      onApplied(s);
    } catch (e: any) {
      console.error(e);
      setError(`Couldn't set up "${displayLabel(s)}". ${e?.message || 'Please try again.'}`);
    } finally {
      setBusy(null);
    }
  };

  const dismiss = (s: RoutingSuggestion) => {
    recordDecision(s.memoryKey, 'dismissed');
    setDismissed(prev => new Set(prev).add(s.id));
  };

  /**
   * Foldering only has something to say where mail is actually sitting loose, and
   * ranks by how much — a sender with 200 unfiled messages is the bigger tidy-up.
   * Rules care about recurrence instead, so they keep the model's own ranking and
   * include senders whose backlog is already clean but who keep sending.
   */
  const relevant = isFolderMode
    ? suggestions.filter(s => s.unfiled > 0).sort((a, b) => b.unfiled - a.unfiled)
    : suggestions;

  const visible = completion.visible(relevant).filter(s => !dismissed.has(s.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl shrink-0 hidden sm:block">
            <FolderTree className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-bold text-slate-900 text-sm sm:text-base">
              {isFolderMode ? 'Tidy up the mail you already have' : 'Automate what arrives next'}
            </h3>
              <span className="text-[11px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                {isEnhanced ? 'Enhanced analysis' : 'Pattern analysis'}
              </span>
            </div>
            <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
              {isFolderMode ? (
                <>Files messages sitting loose in your mailbox into folders. Nothing changes about mail that
                arrives later — set up a rule for that. Read from{' '}
                <strong className="text-slate-900">{sendersAnalysed.toLocaleString()} senders</strong>.</>
              ) : (
                <>Creates Gmail filters so future mail files itself. Your existing mail is left where it is —
                use the Folder Optimizer to tidy that up. Learned from{' '}
                <strong className="text-slate-900">{filedCount.toLocaleString()} filed messages</strong>.</>
              )}
            </p>
            {stats.patterns > 0 && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-lg mt-3">
                <Brain className="w-3 h-3" />
                Tuned by your {stats.accepted + stats.dismissed} past decision{stats.accepted + stats.dismissed === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-white border border-amber-200 rounded-xl p-3.5 flex items-start gap-2.5 shadow-2xs">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-700">{error}</p>
        </div>
      )}

      {loading ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-xs flex flex-col items-center text-center gap-2">
          <Loader2 className="w-7 h-7 animate-spin text-slate-500" />
          <p className="text-sm font-semibold text-slate-800">Learning from your mail…</p>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            Reading how you already file things so the suggestions match your habits.
          </p>
        </div>
      ) : sampleSize === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-xs flex flex-col items-center text-center gap-2">
          <AlertTriangle className="w-8 h-8 text-amber-500" />
          <p className="text-sm font-semibold text-slate-800">Couldn't read your mail</p>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            No messages came back, so there is nothing to analyse yet. Try refreshing — if it keeps happening the
            Gmail connection may need reconnecting.
          </p>
        </div>
      ) : visible.length === 0 && filedCount === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-xs flex flex-col items-center text-center gap-2">
          <FolderTree className="w-8 h-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-800">Nothing to learn from yet</p>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            This works by spotting where you already file mail, and none of the {sampleSize.toLocaleString()} messages
            checked are in a folder yet. Label a handful by hand — once a sender goes to the same place a few times,
            the rule will show up here.
          </p>
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-xs flex flex-col items-center text-center gap-2">
          <CheckCircle2 className="w-8 h-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-800">
            {isFolderMode ? 'Nothing loose worth filing' : 'No consistent pattern yet'}
          </p>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            {isFolderMode
              ? `Checked ${sendersAnalysed.toLocaleString()} senders — nothing is sitting loose in large enough
                 numbers to be worth filing in bulk.`
              : `Checked ${filedCount.toLocaleString()} filed messages across ${sendersAnalysed.toLocaleString()}
                 senders. None goes to one folder reliably enough to automate safely — a rule built on a mixed
                 pattern would misfile your mail.`}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visible.map(s => {
            const isOpen = expanded.has(s.id);
            const isBusy = busy === s.id;
            const doneLabel = completion.labelFor(s.id);
            const isDone = !!doneLabel;

            return (
              <div key={s.id} className={cn(
                "bg-white border rounded-xl shadow-2xs transition-colors",
                isDone ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 hover:border-slate-300"
              )}>
                <div className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                      <FolderTree className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-slate-900">
                          {s.senderName} → {displayLabel(s)}
                        </h4>
                        <span className="text-[11px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200 whitespace-nowrap">
                          {s.kind === 'new_folder' ? 'New folder' : 'Existing folder'}
                        </span>
                        {isDone && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                            <CheckCircle2 className="w-3 h-3" />
                            {doneLabel}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{enriched.get(s.id)?.rationale || s.rationale}</p>
                      <button
                        onClick={() => toggle(s.id)}
                        className="mt-1.5 text-[11px] font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                      >
                        {isOpen ? 'Hide evidence' : 'Why this was suggested'}
                        {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between sm:justify-end gap-2 sm:gap-3 shrink-0 w-full sm:w-auto">
                    <span className="text-[11px] font-medium text-slate-500 w-[92px] text-right shrink-0 hidden sm:block">
                      {Math.round(s.confidence * 100)}% confident
                    </span>
                    <div className="flex items-stretch gap-0.5 bg-slate-100 rounded-lg p-0.5 border border-slate-200 w-full sm:w-[184px] shrink-0">
                      <button
                        onClick={() => onInspect(s.query, `${s.senderName} → ${displayLabel(s)}`)}
                        disabled={isBusy}
                        className="flex-1 text-xs font-medium px-2 py-1.5 rounded-md hover:bg-white text-slate-700 transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap"
                      >
                        Inspect
                      </button>
                      <button
                        onClick={() => apply(s)}
                        disabled={isBusy || isDone}
                        className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex items-center justify-center gap-1"
                      >
                        {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                        {isDone
                          ? (isFolderMode ? 'Filed' : 'Rule on')
                          : (isFolderMode ? `File ${s.unfiled}` : 'Create rule')}
                      </button>
                    </div>
                    {!isDone && (
                      <button
                        onClick={() => dismiss(s)}
                        disabled={isBusy}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
                        title="Not useful — stop suggesting this"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                {isOpen && (
                  <div className="px-3.5 pb-3.5 pt-0">
                    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                      <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-2">
                        Signals the model used
                      </p>
                      <ul className="flex flex-col gap-1">
                        {s.evidence.map((line, i) => (
                          <li key={i} className="text-[11px] text-slate-600 flex items-start gap-1.5">
                            <span className="text-slate-400 mt-0.5">•</span>
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                      <div className="mt-2.5 pt-2.5 border-t border-slate-200 flex items-center gap-2 flex-wrap">
                        <Filter className="w-3 h-3 text-slate-400 shrink-0" />
                        <code className="text-[10px] text-slate-600 bg-white border border-slate-200 rounded px-1.5 py-0.5 break-all">
                          {s.query}
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
