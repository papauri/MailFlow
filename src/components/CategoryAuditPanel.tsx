import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Loader2, AlertCircle, Trash2, ShieldCheck, ChevronDown, ChevronUp,
  CheckCircle2, Layers, Clock, AlertTriangle, ExternalLink
} from 'lucide-react';
import { cn } from '../lib/utils';
import { batchTrashEmails } from '../lib/gmail';
import { CategoryAudit, TemplateCluster } from '../lib/categoryAudit';
import { formatCleanupBytes } from '../lib/cleanupModel';
import { enrichSuggestions, EnrichedText } from '../lib/enrichSuggestions';
import { useActionCompletion } from '../lib/useActionCompletion';
import { useBackgroundStatus } from '../lib/useBackgroundTask';

interface Props {
  audit: CategoryAudit;
  categoryName: string;
  /** The scanned messages, so a cluster can show its real members inline. */
  emails: any[];
  aiSettings?: any;
  onInspect: (cluster: TemplateCluster) => void;
  onCleared: (cluster: TemplateCluster, count: number) => void;
}

const VERDICT_META: Record<TemplateCluster['verdict'], { label: string; tone: string }> = {
  expired:    { label: 'Expired',    tone: 'bg-rose-50 text-rose-700 border-rose-200' },
  disposable: { label: 'Disposable', tone: 'bg-amber-50 text-amber-800 border-amber-200' },
  review:     { label: 'Review',     tone: 'bg-slate-100 text-slate-700 border-slate-200' },
  keep:       { label: 'Keep',       tone: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

/**
 * Presents the category audit as decisions rather than a message list.
 *
 * Ordering is deliberate: what needs you first, then what can go. A cleanup tool
 * that leads with deletion invites people to bin something that was waiting on them.
 */
export function CategoryAuditPanel({ audit, categoryName, emails, aiSettings, onInspect, onCleared }: Props) {
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [deselectedIds, setDeselectedIds] = useState<Map<string, Set<string>>>(new Map());

  /**
   * Resolve a cluster to the messages it was actually built from.
   *
   * Inspecting used to leave for a filtered page driven by a subject-phrase query,
   * which could match a different set than the cluster — a group of 7 could show 1,
   * because the phrase did not select the same messages. These are the exact members,
   * already in memory, so what is shown is what would be acted on.
   */
  const membersOf = (cluster: TemplateCluster) => {
    const ids = new Set(cluster.ids);
    return emails.filter((e: any) => ids.has(e.id));
  };
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ id: string; done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [enriched, setEnriched] = useState<Map<string, EnrichedText>>(new Map());
  const [showAllAttention, setShowAllAttention] = useState(false);
  const completion = useActionCompletion();
  const backgroundStatus = useBackgroundStatus();

  const actionable = audit.clusters.filter(c => c.verdict !== 'keep');
  const kept = audit.clusters.filter(c => c.verdict === 'keep');

  /**
   * AI names the clusters. The audit decides *what* the groups are and whether they
   * can go — that stays local and identical either way. Naming is the one part a
   * model genuinely does better: it can call a template "one-time login codes" where
   * the local path can only quote an example subject.
   */
  useEffect(() => {
    let cancelled = false;
    if (actionable.length === 0) return;
    enrichSuggestions(
      actionable.slice(0, 12).map(c => ({
        id: c.id,
        kind: `email-cluster-${c.verdict}`,
        subject: c.sampleSubject.slice(0, 80),
        stats: `${c.volume} near-identical messages from ${c.senders} sender(s), median age ${c.medianAgeDays} days, ${Math.round((1 - c.readRate) * 100)}% unread`,
      })),
      aiSettings
    ).then(map => { if (!cancelled && map.size > 0) setEnriched(map); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audit, aiSettings]);

  const toggle = (id: string) => setExpanded(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const toggleEmailSelection = (clusterId: string, emailId: string) => {
    setDeselectedIds(prev => {
      const next = new Map(prev);
      const set = new Set(next.get(clusterId) || []);
      if (set.has(emailId)) {
        set.delete(emailId);
      } else {
        set.add(emailId);
      }
      next.set(clusterId, set);
      return next;
    });
  };

  const toggleSelectAll = (clusterId: string, clusterEmails: any[]) => {
    setDeselectedIds(prev => {
      const next = new Map(prev);
      const set = next.get(clusterId) || new Set();
      if (set.size > 0) {
        next.delete(clusterId);
      } else {
        next.set(clusterId, new Set(clusterEmails.map(e => e.id)));
      }
      return next;
    });
  };

  const clearCluster = async (cluster: TemplateCluster) => {
    setRunning(cluster.id);
    setError(null);
    const clusterExcluded = deselectedIds.get(cluster.id) || new Set();
    const ids = cluster.actionIds.filter(id => !clusterExcluded.has(id));
    if (ids.length === 0) {
      setRunning(null);
      return;
    }
    setProgress({ id: cluster.id, done: 0, total: ids.length });
    try {
      // Chunked so a very large cluster reports progress instead of hanging silently.
      const CHUNK = 200;
      for (let i = 0; i < ids.length; i += CHUNK) {
        await batchTrashEmails(ids.slice(i, i + CHUNK));
        setProgress({ id: cluster.id, done: Math.min(i + CHUNK, ids.length), total: ids.length });
      }
      completion.complete(
        cluster.id,
        `${ids.length.toLocaleString()} moved to trash`,
        { messages: ids.length, bytes: cluster.bytes,
          effect: cluster.verdict === 'expired' ? 'expired mail cleared' : 'clutter removed' }
      );
      onCleared(cluster, ids.length);
    } catch (e: any) {
      console.error(e);
      setError(`Couldn't clear that group. ${e?.message || 'Please try again.'}`);
    } finally {
      setRunning(null);
      setProgress(null);
    }
  };

  const visibleClusters = actionable.filter(c => !completion.isCleared(c.id));
  const attentionShown = showAllAttention ? audit.attention : audit.attention.slice(0, 4);

  return (
    <div className="flex flex-col gap-4">
      {/* Verdict summary */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="p-2.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl shrink-0 hidden sm:block">
            <Layers className="w-5 h-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-slate-900 text-sm sm:text-base mb-1">
              {categoryName} audit
            </h3>
            <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">
              Grouped {audit.totalAnalysed.toLocaleString()} messages by what they actually are —
              not who sent them — so near-identical mail becomes one decision instead of hundreds of rows.
            </p>
            {/* Background work is visible rather than silent: the numbers below move
                on their own as more mail is read, which is confusing unnoticed. */}
            {backgroundStatus && (
              <p className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg mt-2">
                <Loader2 className="w-3 h-3 animate-spin" />
                {backgroundStatus} findings update as it goes.
              </p>
            )}
            {(completion.totalImpact.messages || 0) > 0 && (
              <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg mt-2">
                <CheckCircle2 className="w-3 h-3" />
                Cleared {completion.totalImpact.messages!.toLocaleString()} messages
                {(completion.totalImpact.bytes || 0) > 0 && ` · ${formatCleanupBytes(completion.totalImpact.bytes!)} freed`} so far
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-3">
              {audit.clearableVolume > 0 && (
                <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-1 rounded-lg">
                  {audit.clearableVolume.toLocaleString()} can go
                  {audit.clearableBytes > 0 && ` · ${formatCleanupBytes(audit.clearableBytes)}`}
                </span>
              )}
              {audit.attention.length > 0 && (
                <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-2 py-1 rounded-lg">
                  {audit.attention.length} need{audit.attention.length === 1 ? 's' : ''} attention
                </span>
              )}
              {kept.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600 bg-white border border-slate-200 px-2 py-1 rounded-lg">
                  <ShieldCheck className="w-3 h-3" />
                  {audit.keepVolume.toLocaleString()} protected
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

      {/* Needs attention — before anything destructive */}
      {audit.attention.length > 0 && (
        <div className="bg-white border border-amber-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="px-3.5 py-2.5 bg-amber-50/60 border-b border-amber-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
            <h4 className="text-sm font-bold text-slate-900">Needs your attention</h4>
            <span className="text-[11px] font-medium text-slate-600 bg-white border border-amber-200 px-1.5 py-0.5 rounded">
              {audit.attention.length}
            </span>
          </div>
          <ul className="divide-y divide-slate-100">
            {attentionShown.map(item => (
              <li key={item.id} className="px-3.5 py-2.5 flex items-start gap-3">
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
                  item.urgency === 'high' ? "bg-rose-500" : "bg-amber-500"
                )} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-slate-900 truncate">{item.subject}</p>
                  <p className="text-[11px] text-slate-500 truncate">{item.sender}</p>
                  <p className="text-[11px] text-slate-600 mt-0.5">{item.reason}</p>
                </div>
                <span className="text-[11px] text-slate-400 shrink-0 tabular-nums">
                  {item.ageDays}d
                </span>
              </li>
            ))}
          </ul>
          {audit.attention.length > 4 && (
            <button
              onClick={() => setShowAllAttention(!showAllAttention)}
              className="w-full px-3.5 py-2 text-[11px] font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors cursor-pointer border-t border-slate-100"
            >
              {showAllAttention ? 'Show fewer' : `Show all ${audit.attention.length}`}
            </button>
          )}
        </div>
      )}

      {/* Clusters */}
      {visibleClusters.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-xs flex flex-col items-center text-center gap-2">
          <CheckCircle2 className="w-8 h-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-800">Nothing bulk-clearable here</p>
          <p className="text-xs text-slate-500 max-w-md leading-relaxed">
            No group of near-identical messages is old or ignored enough to clear safely. Anything
            recurring here is either recent or mail you actually read.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          {visibleClusters.map(cluster => {
            const meta = VERDICT_META[cluster.verdict];
            const isOpen = expanded.has(cluster.id);
            const isReviewOpen = inspecting === cluster.id;
            const isRunning = running === cluster.id;
            const doneLabel = completion.labelFor(cluster.id);
            const showProgress = progress?.id === cluster.id;
            const title = enriched.get(cluster.id)?.title || cluster.sampleSubject;
            const clusterEmails = membersOf(cluster);
            const clusterExcluded = deselectedIds.get(cluster.id) || new Set();
            const activeCount = clusterEmails.length > 0
              ? clusterEmails.filter(e => !clusterExcluded.has(e.id)).length
              : cluster.volume;

            return (
              <div key={cluster.id} className={cn(
                "bg-white border rounded-xl shadow-2xs transition-colors overflow-hidden",
                doneLabel ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200 hover:border-slate-300"
              )}>
                <div className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                      {cluster.verdict === 'expired' ? <Clock className="w-4 h-4" /> : <Layers className="w-4 h-4" />}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-sm font-semibold text-slate-900 truncate max-w-full sm:max-w-[320px]">{title}</h4>
                        <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-md border whitespace-nowrap", meta.tone)}>
                          {meta.label}
                        </span>
                        {doneLabel && (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                            <CheckCircle2 className="w-3 h-3" />
                            {doneLabel}
                            {/* What it achieved, not just that it finished. */}
                            {completion.impactFor(cluster.id)?.bytes
                              ? ` · ${formatCleanupBytes(completion.impactFor(cluster.id)!.bytes!)} freed`
                              : ''}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                        {enriched.get(cluster.id)?.rationale || cluster.reason}
                      </p>
                      <div className="flex items-center gap-3 flex-wrap mt-1.5">
                        <button
                          onClick={() => toggle(cluster.id)}
                          className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          {isOpen ? 'Hide detail' : 'Why this was grouped'}
                          {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>
                        <span className="text-slate-300">•</span>
                        <button
                          onClick={() => setInspecting(isReviewOpen ? null : cluster.id)}
                          className={cn(
                            "text-[11px] font-semibold flex items-center gap-1 cursor-pointer transition-colors",
                            isReviewOpen ? "text-slate-900 font-bold" : "text-slate-600 hover:text-slate-900"
                          )}
                        >
                          <span>{isReviewOpen ? 'Hide emails' : `Quick review (${cluster.volume})`}</span>
                          <ChevronDown className={cn("w-3 h-3 transition-transform", isReviewOpen && "rotate-180")} />
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row sm:items-center justify-between sm:justify-end gap-2 sm:gap-3 shrink-0 w-full sm:w-auto">
                    <span className="text-[11px] font-medium text-slate-500 w-[92px] text-right shrink-0 hidden sm:block">
                      {Math.round(cluster.confidence * 100)}% confident
                    </span>
                    <div className="flex items-stretch gap-0.5 bg-slate-100 rounded-lg p-0.5 border border-slate-200 w-full sm:w-[184px] shrink-0">
                      <button
                        onClick={() => setInspecting(isReviewOpen ? null : cluster.id)}
                        disabled={isRunning}
                        className={cn(
                          "flex-1 text-xs font-medium px-2 py-1.5 rounded-md transition-all cursor-pointer disabled:opacity-50 whitespace-nowrap",
                          isReviewOpen ? "bg-white text-slate-900 font-semibold shadow-2xs" : "hover:bg-white text-slate-700"
                        )}
                      >
                        {isReviewOpen ? 'Hide' : `Review ${cluster.volume}`}
                      </button>
                      <button
                        onClick={() => clearCluster(cluster)}
                        disabled={isRunning || running !== null || !!doneLabel || activeCount === 0}
                        className="flex-1 text-xs font-semibold px-2 py-1.5 rounded-md bg-slate-900 text-white hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap flex items-center justify-center gap-1"
                        title={activeCount === 0 ? 'No messages selected' : `Clear ${activeCount.toLocaleString()} messages`}
                      >
                        {isRunning && <Loader2 className="w-3 h-3 animate-spin" />}
                        Clear {activeCount.toLocaleString()}
                      </button>
                    </div>
                  </div>
                </div>

                {showProgress && (
                  <div className="px-3.5 pb-3.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] font-medium text-slate-600">Moving to trash…</span>
                      <span className="text-[11px] font-medium text-slate-600 tabular-nums">
                        {progress!.done.toLocaleString()} / {progress!.total.toLocaleString()}
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-slate-800 rounded-full transition-all duration-300"
                        style={{ width: `${Math.round((progress!.done / Math.max(1, progress!.total)) * 100)}%` }} />
                    </div>
                  </div>
                )}

                {/* Inline Quick Review List */}
                <AnimatePresence>
                  {isReviewOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden border-t border-slate-200 bg-slate-50/50"
                    >
                      <div className="p-3 sm:p-3.5">
                        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
                          <div className="px-3.5 py-2.5 bg-slate-50/90 border-b border-slate-200 flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] font-bold text-slate-800">
                                Messages in this group ({clusterEmails.length.toLocaleString()})
                              </span>
                              {clusterEmails.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => toggleSelectAll(cluster.id, clusterEmails)}
                                  className="text-[10px] font-semibold text-slate-600 hover:text-slate-900 bg-white border border-slate-200 hover:bg-slate-50 px-2 py-0.5 rounded cursor-pointer transition-colors shadow-2xs"
                                >
                                  {clusterExcluded.size > 0 ? `Select all (${clusterEmails.length})` : 'Deselect all'}
                                </button>
                              )}
                            </div>
                            <button
                              onClick={() => onInspect(cluster)}
                              className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 cursor-pointer whitespace-nowrap flex items-center gap-1 hover:underline"
                              title="Open these as a full page"
                            >
                              <span>Open as page</span>
                              <ExternalLink className="w-3 h-3 text-slate-400" />
                            </button>
                          </div>

                          {clusterEmails.length === 0 ? (
                            <p className="px-3.5 py-4 text-xs text-slate-500 text-center">
                              No messages from this cluster currently in the active scan sample.
                            </p>
                          ) : (
                            <ul className="max-h-72 overflow-y-auto divide-y divide-slate-100 custom-scrollbar">
                              {clusterEmails.map((email: any) => {
                                const isExcluded = clusterExcluded.has(email.id);
                                return (
                                  <li
                                    key={email.id}
                                    className={cn(
                                      "px-3.5 py-2.5 flex items-start gap-2.5 transition-all",
                                      isExcluded ? "opacity-45 bg-slate-50/60" : "hover:bg-slate-50/60 bg-white"
                                    )}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={!isExcluded}
                                      onChange={() => toggleEmailSelection(cluster.id, email.id)}
                                      className="w-3.5 h-3.5 rounded border-slate-300 text-slate-900 focus:ring-slate-900 cursor-pointer mt-0.5 shrink-0"
                                      aria-label={`Select email ${email.subject || ''}`}
                                    />
                                    <div
                                      className="min-w-0 flex-1 cursor-pointer"
                                      onClick={() => toggleEmailSelection(cluster.id, email.id)}
                                    >
                                      <p className={cn(
                                        "text-[12px] font-semibold text-slate-800 leading-snug truncate",
                                        isExcluded && "line-through text-slate-400 font-normal"
                                      )}>
                                        {email.subject || '(No Subject)'}
                                      </p>
                                      <p className="text-[11px] text-slate-500 truncate mt-0.5">
                                        <span className="font-medium text-slate-600">{email.sender}</span>
                                        {email.snippet ? ` — ${email.snippet}` : ''}
                                      </p>
                                    </div>
                                    <div className="flex items-center gap-2 shrink-0 ml-1">
                                      <span className="text-[10px] text-slate-400 whitespace-nowrap hidden sm:inline tabular-nums">
                                        {email.date ? new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: '2-digit' }) : ''}
                                      </span>
                                      <a
                                        href={`https://mail.google.com/mail/u/0/#all/${email.threadId || email.id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-slate-300 hover:text-slate-700 p-1 rounded hover:bg-slate-100 transition-colors"
                                        title="Open in Gmail"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                          )}

                          {clusterEmails.length < cluster.volume && (
                            <p className="px-3.5 py-2 text-[10px] text-slate-500 bg-slate-50 border-t border-slate-100">
                              Showing {clusterEmails.length} of {cluster.volume} messages in this cluster.
                            </p>
                          )}
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Evidence / Reason Dropdown */}
                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden border-t border-slate-100"
                    >
                      <div className="px-3.5 pb-3.5 pt-3">
                        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                          <p className="text-[11px] font-semibold text-slate-700 uppercase tracking-wider mb-2">
                            How these were grouped
                          </p>
                          <ul className="flex flex-col gap-1 text-[11px] text-slate-600">
                            <li>• {cluster.volume.toLocaleString()} messages share one subject template</li>
                            <li>• Spanning {cluster.senders.toLocaleString()} sender{cluster.senders === 1 ? '' : 's'}</li>
                            <li>• Median age {cluster.medianAgeDays} days · {Math.round((1 - cluster.readRate) * 100)}% never opened</li>
                            {cluster.hasVariableToken && <li>• Only a number changes between them — generated mail</li>}
                            <li>• Nothing starred, flagged or replied to</li>
                          </ul>
                          <div className="mt-2.5 pt-2.5 border-t border-slate-200">
                            <code className="text-[10px] text-slate-600 bg-white border border-slate-200 rounded px-1.5 py-0.5 break-all">
                              {cluster.query || cluster.template}
                            </code>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
