import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'motion/react';
import {
  Loader2, FolderTree, Filter, CheckCircle2, AlertTriangle, Brain, Search,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { createLabel, createFilter, batchModifyEmails } from '../lib/gmail';
import { RoutingSuggestion } from '../lib/foldingModel';
import { recordDecision, memoryStats } from '../lib/suggestionMemory';
import { enrichSuggestions, EnrichedText } from '../lib/enrichSuggestions';
import { useActionCompletion } from '../lib/useActionCompletion';
import {
  AutomationToolbar, AutomationGrid, AutomationCard, AutomationState,
  ReviewToggle, ReviewPanel,
} from './AutomationShell';

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
  refreshing?: boolean;
  progress?: { done: number; total: number; phase: string } | null;
  /** Messages in the sample that carry a user label — the evidence to learn from. */
  filedCount?: number;
  sampleSize?: number;
  /**
   * The messages the suggestions were built from.
   *
   * Reviewing used to navigate to a separate filtered page, which both left the tool
   * and re-ran the query against Gmail. Every message a suggestion refers to is
   * already in this sample by id, so the inline review costs nothing and is instant —
   * and it matches how the rest of the app reviews a batch.
   */
  sampleEmails?: any[];
  aiSettings?: any;
  onApplied: (suggestion: RoutingSuggestion) => void;
  onLabelsChanged?: () => void;
  /** Rendered by a parent that already drew the panel. */
  embedded?: boolean;
  /** Right-hand controls for the shared toolbar, e.g. refresh. */
  toolbarActions?: React.ReactNode;
  /**
   * A parent-level view switch to show ahead of the filter chips, so a tool with both
   * (Automated Rules: Suggested vs Active) gets one toolbar rather than two.
   */
  leadingChips?: { id: string; label: string; count: number }[];
  activeLeadingChip?: string;
  onLeadingChipSelect?: (id: string) => void;
}

/**
 * Uniform presentation for folder and rule suggestions.
 *
 * Built from the same `AutomationShell` pieces as the Batch Organizer, so a
 * recommendation reads identically whichever of the three tools produced it: same
 * card, same review toggle, same inline message list, same confirmation.
 */
export function RoutingSuggestions({
  mode, suggestions, sendersAnalysed, loading = false, refreshing = false, progress, filedCount = 0, sampleSize = 0,
  sampleEmails = [], aiSettings, onApplied, onLabelsChanged, embedded = false, toolbarActions,
  leadingChips, activeLeadingChip, onLeadingChipSelect,
}: Props) {
  const [enriched, setEnriched] = useState<Map<string, EnrichedText>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const completion = useActionCompletion();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const stats = memoryStats();

  /** Message lookup for the inline review, built once per sample. */
  const emailsById = useMemo(() => {
    const map = new Map<string, any>();
    for (const e of sampleEmails) {
      if (e?.id) map.set(e.id, e);
    }
    return map;
  }, [sampleEmails]);

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
        // `actionIds` and not `ids`: batchModify is a messages endpoint, and `ids`
        // holds thread ids from the sample.
        if (s.actionIds.length > 0) {
          await batchModifyEmails(s.actionIds, [labelId], ['INBOX']);
        }
      } else {
        // Future only, which is what a rule means. The backlog is left alone so this
        // stays reversible — deleting the filter fully undoes it.
        await createFilter(s.query, [labelId], ['INBOX']);
      }

      recordDecision(s.memoryKey, 'accepted');
      completion.complete(
        s.id,
        isFolderMode ? `Filed ${s.unfiled.toLocaleString()} into ${displayLabel(s)}` : 'Rule created',
        isFolderMode
          ? { messages: s.unfiled, effect: `out of your inbox` }
          : { effect: `future mail files itself into ${displayLabel(s)}` }
      );
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
    : suggestions.sort((a, b) => b.volume - a.volume);

  const visible = completion.visible(relevant)
    .filter(s => !dismissed.has(s.id))
    .filter(s => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return s.senderName.toLowerCase().includes(q)
        || displayLabel(s).toLowerCase().includes(q)
        || (s.rationale || '').toLowerCase().includes(q);
    });

  const chips = useMemo(() => {
    const pool = completion.visible(relevant).filter(s => !dismissed.has(s.id));
    return [
      // Deliberately "All", not "Suggested": Automated Rules already has a Suggested
      // chip for its view switch, and two chips reading the same word in one toolbar
      // is worse than a slightly duller label.
      { id: 'all', label: 'All', count: pool.length, loading },
      { id: 'new', label: 'New folders', count: pool.filter(s => s.kind === 'new_folder').length, loading },
      { id: 'existing', label: 'Existing', count: pool.filter(s => s.kind === 'route_existing').length, loading },
    ].filter(c => c.count > 0 || c.id === 'all');
  }, [relevant, dismissed, completion, loading]);

  const [chip, setChip] = useState('all');
  const shown = visible.filter(s =>
    chip === 'all' ? true : chip === 'new' ? s.kind === 'new_folder' : s.kind === 'route_existing'
  );

  /** The explanation banner. Identical structure in both modes, different words. */
  const intro = (
    <div className="px-3 sm:px-4 py-3 bg-white border-b border-slate-200 shrink-0">
      <div className="flex items-start gap-2.5">
        <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
          <FolderTree className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-slate-900 text-[13px]">
              {isFolderMode ? 'Tidy up the mail you already have' : 'Automate what arrives next'}
            </h3>
            <span className="text-[10px] font-medium bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded-md border border-slate-200">
              {isEnhanced ? 'Enhanced analysis' : 'Pattern analysis'}
            </span>
            {stats.patterns > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded-md">
                <Brain className="w-2.5 h-2.5" />
                Tuned by {stats.accepted + stats.dismissed} past decision{stats.accepted + stats.dismissed === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <p className="text-slate-500 text-[11px] leading-relaxed mt-0.5">
            {isFolderMode ? (
              <>Files messages sitting loose in your mailbox into folders. Nothing changes about mail that
              arrives later — set up a rule for that. Read from{' '}
              <strong className="text-slate-700">{sendersAnalysed.toLocaleString()} senders</strong>.</>
            ) : (
              <>Creates Gmail filters so future mail files itself. Your existing mail is left where it is —
              use the Folder Optimizer to tidy that up. Learned from{' '}
              <strong className="text-slate-700">{filedCount.toLocaleString()} filed messages</strong>.</>
            )}
          </p>
        </div>
      </div>
    </div>
  );

  let content: React.ReactNode;

  if (loading) {
    content = (
      <AutomationState
        kind="loading"
        title="Learning from your mail…"
        body="Reading how you already file things so the suggestions match your habits."
        progress={progress}
      />
    );
  } else if (sampleSize === 0) {
    content = (
      <AutomationState
        kind="error"
        title="Couldn't read your mail"
        body="No messages came back, so there is nothing to analyse yet. Try refreshing — if it keeps happening the Gmail connection may need reconnecting."
      />
    );
  } else if (shown.length === 0 && filedCount === 0) {
    content = (
      <AutomationState
        kind="empty"
        title="Nothing to learn from yet"
        body={`This works by spotting where you already file mail, and none of the ${sampleSize.toLocaleString()} messages checked are in a folder yet. Label a handful by hand — once a sender goes to the same place a few times, the rule will show up here.`}
      />
    );
  } else if (shown.length === 0) {
    content = (
      <AutomationState
        kind={search.trim() ? 'empty' : 'done'}
        title={
          search.trim()
            ? 'No suggestions match that filter'
            : isFolderMode ? 'Nothing loose worth filing' : 'No consistent pattern yet'
        }
        body={
          search.trim()
            ? 'Clear the filter to see everything again.'
            : isFolderMode
              ? `Checked ${sendersAnalysed.toLocaleString()} senders — nothing is sitting loose in large enough numbers to be worth filing in bulk.`
              : `Checked ${filedCount.toLocaleString()} filed messages across ${sendersAnalysed.toLocaleString()} senders. None goes to one folder reliably enough to automate safely — a rule built on a mixed pattern would misfile your mail.`
        }
      />
    );
  } else {
    content = (
      <AutomationGrid>
        {shown.map(s => {
          const isOpen = expanded.has(s.id);
          const isBusy = busy === s.id;
          const doneLabel = completion.labelFor(s.id);
          const isDone = !!doneLabel;
          const reviewable = s.ids.map(id => emailsById.get(id)).filter(Boolean);

          return (
            <AutomationCard
              key={s.id}
              icon={<FolderTree className="w-3.5 h-3.5" />}
              title={`${s.senderName} → ${displayLabel(s)}`}
              done={isDone}
              doneLabel={doneLabel}
              expanded={isOpen}
              onDismiss={isBusy ? undefined : () => dismiss(s)}
              dismissTitle="Not useful — stop suggesting this"
              tags={[
                { label: s.kind === 'new_folder' ? 'New folder' : 'Existing folder' },
                { label: `${Math.round(s.confidence * 100)}% confident`, tone: s.confidence >= 0.75 ? 'good' : 'neutral' },
                ...(isFolderMode ? [{ label: `${s.unfiled.toLocaleString()} unfiled` as string }] : []),
              ]}
              description={enriched.get(s.id)?.rationale || s.rationale}
              footerLeft={
                <ReviewToggle
                  open={isOpen}
                  count={reviewable.length}
                  onClick={() => toggle(s.id)}
                />
              }
              footerRight={
                <button
                  onClick={() => apply(s)}
                  disabled={isBusy || isDone}
                  title={isDone ? (isFolderMode ? 'Filed' : 'Rule created') : (isFolderMode ? `File ${s.unfiled.toLocaleString()} messages to ${displayLabel(s)}` : `Create a rule to file future mail in ${displayLabel(s)}`)}
                  className="flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 text-[11px] font-semibold shadow-2xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {isBusy && <Loader2 className="w-3 h-3 animate-spin" />}
                  <span className="whitespace-nowrap">
                    {isDone
                      ? (isFolderMode ? 'Filed' : 'Rule on')
                      : (isFolderMode ? `File ${s.unfiled.toLocaleString()}` : 'Create rule')}
                  </span>
                </button>
              }
            >
              {isOpen && (
                <ReviewPanel>
                  {/* Why the model suggested this… */}
                  <div className="px-3 py-2.5 bg-white/70">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-1.5">
                      Why this was suggested
                    </p>
                    <ul className="flex flex-col gap-1">
                      {s.evidence.map((line, i) => (
                        <li key={i} className="text-[11px] text-slate-600 flex items-start gap-1.5">
                          <span className="text-slate-300 mt-0.5">•</span>
                          <span>{line}</span>
                        </li>
                      ))}
                    </ul>
                    <div className="mt-2 pt-2 border-t border-slate-200 flex items-center gap-1.5 flex-wrap">
                      <Filter className="w-3 h-3 text-slate-400 shrink-0" />
                      <code className="text-[10px] text-slate-600 bg-white border border-slate-200 rounded px-1.5 py-0.5 break-all">
                        {s.query}
                      </code>
                    </div>
                  </div>

                  {/* …and exactly which messages it means. */}
                  <div className="px-3 py-1.5 bg-slate-100/70">
                    <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                      {isFolderMode
                        ? `Messages this would file (${reviewable.length.toLocaleString()})`
                        : `Mail like this (${reviewable.length.toLocaleString()} in the sample)`}
                    </p>
                  </div>
                  {reviewable.length === 0 ? (
                    <p className="px-3 py-3 text-[11px] text-slate-500 text-center bg-white/60">
                      {isFolderMode
                        ? 'Nothing from this sender is currently unfiled.'
                        : 'No matching messages in the current sample.'}
                    </p>
                  ) : (
                    reviewable.map((email: any) => (
                      <div key={email.id} className="flex items-start gap-2 px-3 py-2 bg-white/60 hover:bg-white transition-colors">
                        <div className="min-w-0 flex-1">
                          <p className="text-[12px] font-semibold text-slate-800 leading-snug truncate">
                            {email.subject || '(No Subject)'}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate">
                            <span className="font-medium text-slate-600">{email.sender}</span>
                            {email.snippet ? ` — ${email.snippet}` : ''}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] text-slate-400 whitespace-nowrap hidden sm:inline">
                            {email.date ? new Date(email.date).toLocaleDateString() : ''}
                          </span>
                          <a
                            href={`https://mail.google.com/mail/u/0/#all/${email.threadId || email.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-slate-300 hover:text-slate-700 p-1 rounded hover:bg-slate-100 transition-colors"
                            title="Open in Gmail"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></svg>
                          </a>
                        </div>
                      </div>
                    ))
                  )}
                </ReviewPanel>
              )}
            </AutomationCard>
          );
        })}
      </AutomationGrid>
    );
  }

  const inner = (
    <>
      {refreshing && progress && (
        <div className="absolute top-0 left-0 z-50 h-1 bg-slate-100 w-full overflow-hidden">
          <motion.div 
            className="h-full bg-blue-500"
            initial={{ width: 0 }}
            animate={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }}
            transition={{ ease: "linear" }}
          />
        </div>
      )}
      {intro}

      {error && (
        <div className="px-3 sm:px-4 py-2.5 bg-amber-50 border-b border-amber-200 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-[11px] text-slate-700">{error}</p>
        </div>
      )}

      {!loading && sampleSize > 0 && (
        <AutomationToolbar
          leadingChips={leadingChips}
          activeLeadingChip={activeLeadingChip}
          onLeadingChipSelect={onLeadingChipSelect}
          chips={chips}
          activeChip={chip}
          onChipSelect={setChip}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Filter senders…"
          actions={toolbarActions}
        />
      )}

      <div className="flex-1 bg-slate-50/50 p-3 sm:p-4 overflow-y-auto">
        {content}
      </div>
    </>
  );

  if (embedded) return <div className="flex flex-col flex-1 min-h-0 relative">{inner}</div>;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs overflow-hidden flex flex-col min-h-[480px] relative">
      {inner}
    </div>
  );
}
