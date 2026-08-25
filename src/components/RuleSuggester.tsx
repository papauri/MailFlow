import React, { useMemo, useState, useEffect } from 'react';
import { ArrowLeft, Filter, CheckCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { RoutingSuggestions } from './RoutingSuggestions';
import { buildRoutingSuggestions } from '../lib/foldingModel';
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

  const senderCount = useMemo(
    () => new Set(sampleEmails.map((e: any) => (e.sender || '').toLowerCase())).size,
    [sampleEmails]
  );

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

  return (
    <div className={cn("flex flex-col gap-4", isPage ? "w-full animate-in fade-in duration-150" : "mt-6 sm:mt-8")}>
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

      <div className="flex space-x-1 bg-slate-200/60 p-1 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('suggestions')}
          className={cn(
            "px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer",
            activeTab === 'suggestions' ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
          )}
        >
          Suggested ({suggestions.length})
        </button>
        <button
          onClick={() => setActiveTab('active_rules')}
          className={cn(
            "px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer",
            activeTab === 'active_rules' ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
          )}
        >
          Active ({createdRulesLog.length})
        </button>
      </div>

      {activeTab === 'suggestions' ? (
        <RoutingSuggestions
          mode="rule"
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
            params.set('source', isPage ? 'rule-suggester' : 'health');
            window.location.hash = `#filter-view?${params.toString()}`;
          }}
          onApplied={(s) => { recordCreatedRule(s.query, s.labelName); sample.refresh(); }}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          {createdRulesLog.length === 0 ? (
            <div className="p-8 flex flex-col items-center text-center gap-2">
              <CheckCircle className="w-8 h-8 text-slate-300" />
              <p className="text-sm font-semibold text-slate-800">No rules created yet</p>
              <p className="text-xs text-slate-500 max-w-md leading-relaxed">
                Rules you set up from the suggestions tab appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-slate-100">
              {createdRulesLog.map(rule => (
                <li key={rule.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex items-start sm:items-center gap-3 flex-1 min-w-0">
                    <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                      <Filter className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-semibold text-slate-900">Files into "{rule.labelName}"</h4>
                      <code className="text-[10px] text-slate-600 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5 break-all inline-block mt-1">
                        {rule.query}
                      </code>
                    </div>
                  </div>
                  <span className="text-[11px] text-slate-500 shrink-0">
                    {new Date(rule.createdAt).toLocaleDateString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="px-3.5 py-2.5 bg-slate-50 border-t border-slate-100">
            <p className="text-[11px] text-slate-500 leading-relaxed">
              This lists rules created through MailFlow. Gmail's own filter settings remain the source of truth
              and can be edited there.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
