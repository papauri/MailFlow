import React, { useMemo, useState, useEffect } from 'react';
import { Filter, RefreshCw } from 'lucide-react';
import { cn } from '../lib/utils';
import { RoutingSuggestions } from './RoutingSuggestions';
import { AutomationToolbar, AutomationGrid, AutomationCard, AutomationState } from './AutomationShell';
import { buildRoutingSuggestions, countDistinctSenders } from '../lib/foldingModel';
import { PageHeader } from './PageHeader';
import { useCachedResource } from '../lib/useCachedResource';
import { fetchRoutingSample, routingSampleKey, RoutingSample } from '../lib/inboxAnalytics';

export interface CreatedRuleRecord {
  id: string;
  query: string;
  labelName: string;
  actionType: 'move_archive' | 'label_only';
  markRead: boolean;
  createdAt: string;
}

interface RuleSuggesterProps {
  userLabels: any[];
  userEmail?: string;
  recentEmails?: any[];
  onApplyQuery?: (query: string, filter?: string) => void;
  aiSettings?: any;
  isAiWorking?: boolean;
  isPage?: boolean;
  /** False when shown as a tab inside another page, which supplies its own header. */
  showHeader?: boolean;
  /** Rendered inside a panel the parent already drew — so draw no panel of our own. */
  embedded?: boolean;
  onClose?: () => void;
}

const SAVED_RULES_STORAGE_KEY = 'inbox_created_rules_log_v1';

/**
 * Automated Sorting Rules.
 *
 * The previous discovery engine issued up to 15 sequential per-label searches on
 * every scan, and scored senders with an inverted conditional — it measured how much
 * of a folder came from a sender rather than how much of that sender's mail belongs
 * in the folder, which misfiles high-volume senders. Both it and its separate card
 * layout are gone; suggestions come from the shared routing model and render in the
 * same view used everywhere else in the app.
 */
export function RuleSuggester({
  userLabels,
  userEmail,
  aiSettings,
  isPage = false,
  showHeader = true,
  embedded = false,
  onClose
}: RuleSuggesterProps) {
  const [createdRulesLog, setCreatedRulesLog] = useState<CreatedRuleRecord[]>([]);
  const [activeTab, setActiveTab] = useState<'suggestions' | 'active_rules'>('suggestions');

  // Same cache key as Folder Optimizer: one background fetch serves both tools.
  const sample = useCachedResource<RoutingSample>(
    routingSampleKey(userEmail),
    () => fetchRoutingSample()
  );

  const sampleEmails = sample.data?.emails ?? [];

  const suggestions = useMemo(
    () => buildRoutingSuggestions(sampleEmails, userLabels || []),
    [sampleEmails, userLabels]
  );

  const senderCount = useMemo(() => countDistinctSenders(sampleEmails), [sampleEmails]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem(SAVED_RULES_STORAGE_KEY);
      const parsed = saved ? JSON.parse(saved) : [];
      if (Array.isArray(parsed)) setCreatedRulesLog(parsed);
    } catch (e) {
      console.error(e);
    }
  }, []);

  const recordCreatedRule = (query: string, labelName: string) => {
    try {
      const record: CreatedRuleRecord = {
        id: `${query}|${labelName}`,
        query,
        labelName,
        actionType: 'move_archive',
        markRead: false,
        createdAt: new Date().toISOString(),
      };
      const next = [record, ...createdRulesLog.filter(r => r.id !== record.id)].slice(0, 50);
      setCreatedRulesLog(next);
      localStorage.setItem(SAVED_RULES_STORAGE_KEY, JSON.stringify(next));
      // Feeds the Health Score's automation bonus.
      window.dispatchEvent(new Event('health-score-update'));
      window.dispatchEvent(new CustomEvent('inbox_metrics_updated', {
        detail: { type: 'rule', count: 1, isPartial: true }
      }));
    } catch (e) {
      console.error(e);
    }
  };

  /**
   * Suggested / Active is a switch between two views of the same tool, so it uses the
   * shared toolbar chips rather than a third style of pill tab. Before this, the page
   * carried its own tab strip that looked nothing like the portal's above it or the
   * filter chips below.
   *
   * On the Suggested view it is handed to `RoutingSuggestions` to render as the
   * leading group of its one toolbar; the Active view has no suggestion filters of its
   * own, so it renders the switch itself.
   */
  const viewChips = [
    { id: 'suggestions', label: 'Suggested', count: suggestions.length },
    { id: 'active_rules', label: 'Active', count: createdRulesLog.length },
  ];

  const selectView = (id: string) => setActiveTab(id as typeof activeTab);

  const refreshButton = (
    <button
      onClick={() => sample.refresh()}
      disabled={sample.loading || sample.refreshing}
      className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50 shrink-0"
      title="Refresh mail sample"
      aria-label="Refresh mail sample"
    >
      <RefreshCw className={cn("w-4 h-4", (sample.loading || sample.refreshing) && "animate-spin")} />
    </button>
  );

  const activeRulesView = (
    <>
    <AutomationToolbar
      leadingChips={viewChips}
      activeLeadingChip={activeTab}
      onLeadingChipSelect={selectView}
      actions={refreshButton}
    />
    <div className="flex-1 bg-slate-50/50 overflow-y-auto">
      {createdRulesLog.length === 0 ? (
        <AutomationState
          kind="empty"
          title="No rules created yet"
          body="Rules you set up from the Suggested tab appear here."
        />
      ) : (
        <div className="p-3 sm:p-4">
          <AutomationGrid>
            {createdRulesLog.map(rule => (
              <AutomationCard
                key={rule.id}
                icon={<Filter className="w-3.5 h-3.5" />}
                title={`Files into "${rule.labelName}"`}
                tags={[
                  { label: 'Active', tone: 'good' },
                  { label: new Date(rule.createdAt).toLocaleDateString() },
                ]}
                description={
                  <code className="text-[10px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 break-all inline-block">
                    {rule.query}
                  </code>
                }
              />
            ))}
          </AutomationGrid>
          <p className="text-[10px] text-slate-500 leading-relaxed mt-3 px-1">
            This lists rules created through MailFlow. Gmail's own filter settings remain the source of truth
            and can be edited there.
          </p>
        </div>
      )}
    </div>
    </>
  );

  const suggestionsView = (
    <RoutingSuggestions
      embedded
      mode="rule"
      suggestions={suggestions}
      sendersAnalysed={senderCount}
      loading={sample.loading}
      filedCount={sample.data?.filedCount ?? 0}
      sampleSize={sampleEmails.length}
      sampleEmails={sampleEmails}
      aiSettings={aiSettings}
      toolbarActions={refreshButton}
      leadingChips={viewChips}
      activeLeadingChip={activeTab}
      onLeadingChipSelect={selectView}
      onApplied={(s) => { recordCreatedRule(s.query, s.labelName); sample.refresh(); }}
    />
  );

  const inner = activeTab === 'suggestions' ? suggestionsView : activeRulesView;

  // The portal draws the panel; standalone, this draws its own.
  if (embedded) return <div className="flex flex-col flex-1 min-h-0">{inner}</div>;

  return (
    <div className={cn("flex flex-col", isPage ? "w-full animate-in fade-in duration-150" : "mt-6 sm:mt-8")}>
      {isPage && showHeader && (
        <PageHeader
          title="Automated Sorting Rules"
          subtitle="Filters that sort future mail. Use Folder Optimizer for existing mail."
          icon={<Filter className="w-4 h-4" />}
          onBack={() => {
            if (onClose) onClose();
            else window.location.hash = '#health';
          }}
          backLabel="Back to Inbox Health"
        />
      )}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs overflow-hidden flex flex-col min-h-[480px]">
        {inner}
      </div>
    </div>
  );
}
