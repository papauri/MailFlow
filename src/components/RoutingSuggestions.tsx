import React, { useState } from 'react';
import {
  Loader2, FolderTree, ChevronDown, ChevronUp, Filter, CheckCircle2,
  AlertTriangle, X, Brain
} from 'lucide-react';
import { cn } from '../lib/utils';
import { createLabel, createFilter, batchModifyEmails } from '../lib/gmail';
import { RoutingSuggestion } from '../lib/foldingModel';
import { recordDecision, memoryStats } from '../lib/suggestionMemory';

interface Props {
  suggestions: RoutingSuggestion[];
  sendersAnalysed: number;
  aiAssisted?: boolean;
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
  suggestions, sendersAnalysed, aiAssisted = false, onInspect, onApplied, onLabelsChanged
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Map<string, string>>(new Map());
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const stats = memoryStats();

  const toggle = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const apply = async (s: RoutingSuggestion) => {
    setBusy(s.id);
    setError(null);
    try {
      // Reuse the existing folder when there is one; only create when genuinely new.
      let labelId = s.labelId;
      if (!labelId) {
        const created = await createLabel(s.labelName);
        labelId = created?.id;
        if (!labelId) throw new Error('Could not create the folder.');
        if (onLabelsChanged) onLabelsChanged();
      }

      // File what is already sitting loose, so the result is visible immediately
      // rather than only applying to mail that arrives later.
      if (s.ids.length > 0) {
        await batchModifyEmails(s.ids, [labelId], ['INBOX']);
      }

      // Then make it automatic from here on.
      await createFilter(s.query, [labelId], ['INBOX']);

      recordDecision(s.memoryKey, 'accepted');
      setDone(prev => new Map(prev).set(s.id, s.labelName));
      onApplied(s);
    } catch (e: any) {
      console.error(e);
      setError(`Couldn't set up "${s.labelName}". ${e?.message || 'Please try again.'}`);
    } finally {
      setBusy(null);
    }
  };

  const dismiss = (s: RoutingSuggestion) => {
    recordDecision(s.memoryKey, 'dismissed');
    setDismissed(prev => new Set(prev).add(s.id));
  };

  const visible = suggestions.filter(s => !dismissed.has(s.id));

  return (
    <div className="flex flex-col gap-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl shrink-0 hidden sm:block">
            <FolderTree className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-bold text-slate-900 text-sm sm:text-base">Where your mail should go</h3>
              <span className="text-[11px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                {aiAssisted ? 'AI-assisted' : 'On-device analysis'}
              </span>
            </div>
            <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
              Learned from filing you have already done across{' '}
              <strong className="text-slate-900">{sendersAnalysed.toLocaleString()} senders</strong>. Each rule files
              the mail sitting loose right now, then keeps doing it automatically.
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

      {visible.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-xs flex flex-col items-center text-center gap-2">
          <CheckCircle2 className="w-8 h-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-800">No routing worth automating yet</p>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            No sender shows a consistent enough filing pattern to turn into a rule. File a few more messages by
            hand and this will pick the pattern up.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visible.map(s => {
            const isOpen = expanded.has(s.id);
            const isBusy = busy === s.id;
            const isDone = done.has(s.id);

            return (
              <div key={s.id} className={cn(
                "bg-white border rounded-xl shadow-2xs transition-colors",
                isDone ? "border-slate-200 opacity-70" : "border-slate-200 hover:border-slate-300"
              )}>
                <div className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                      <FolderTree className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-slate-900">
                          {s.senderName} → {s.labelName}
                        </h4>
                        <span className="text-[11px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200 whitespace-nowrap">
                          {s.kind === 'new_folder' ? 'New folder' : 'Existing folder'}
                        </span>
                        {isDone && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                            <CheckCircle2 className="w-3 h-3" /> Rule active
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">{s.rationale}</p>
                      <button
                        onClick={() => toggle(s.id)}
                        className="mt-1.5 text-[11px] font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer"
                      >
                        {isOpen ? 'Hide evidence' : 'Why this was suggested'}
                        {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                    <span className="text-[11px] font-medium text-slate-500 w-[92px] text-right shrink-0 hidden sm:block">
                      {Math.round(s.confidence * 100)}% confident
                    </span>
                    <div className="flex items-stretch gap-0.5 bg-slate-100 rounded-lg p-0.5 border border-slate-200 w-[184px] shrink-0">
                      <button
                        onClick={() => onInspect(s.query, `${s.senderName} → ${s.labelName}`)}
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
                        {isDone ? 'Done' : 'Set up'}
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
