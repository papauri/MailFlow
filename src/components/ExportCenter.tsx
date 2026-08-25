import React, { useState } from 'react';
import {
  ArrowLeft, Download, Loader2, CheckCircle2, Users, Layers, Mail, HardDrive,
  Trash2, AlertTriangle, Clock, Tag, ShieldCheck, Filter, Activity, Inbox, Package
} from 'lucide-react';
import { cn } from '../lib/utils';
import { PageHeader } from './PageHeader';
import { searchEmails } from '../lib/gmail';
import { useCachedResource } from '../lib/useCachedResource';
import {
  fetchInboxStats, fetchSenderClusters, inboxStatsKey, senderClustersKey,
  InboxStatsResult, SenderClusters
} from '../lib/inboxAnalytics';
import {
  buildCsv, downloadCsv, timestampedFilename, formatBytes,
  MESSAGE_HEADERS, messageToRow
} from '../lib/csvExport';
import {
  extractSenderDetails, computeInboxHealthBreakdown, getUserManagementCounts,
  HEALTH_SCORE_QUERIES
} from '../lib/emailUtils';

interface Props {
  userEmail?: string;
  userLabels?: any[];
  onBack: () => void;
}

type DatasetGroup = 'Summary' | 'Senders' | 'Messages' | 'Account';

interface Dataset {
  id: string;
  group: DatasetGroup;
  title: string;
  description: string;
  icon: React.ReactNode;
  /** Row count when known ahead of time; undefined means "fetched on demand". */
  knownRows?: number;
  build: () => Promise<{ headers: string[]; rows: unknown[][] } | null>;
}

/** How many messages a query-backed export will pull at most. */
const MESSAGE_EXPORT_LIMIT = 500;

async function messageDataset(query: string) {
  const emails = await searchEmails(query, MESSAGE_EXPORT_LIMIT);
  return {
    headers: MESSAGE_HEADERS,
    rows: emails.map((e: any) => messageToRow(e, extractSenderDetails(e.sender))),
  };
}

/**
 * One place to pull any dataset MailFlow can see out as a CSV.
 *
 * Replaces a single "Export CSV" button that emitted three hardcoded sections in a
 * Section/Metric/Value shape too narrow to be useful in a spreadsheet.
 */
export function ExportCenter({ userEmail, userLabels = [], onBack }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  const statsResource = useCachedResource<InboxStatsResult>(inboxStatsKey(userEmail), () => fetchInboxStats());
  const clustersResource = useCachedResource<SenderClusters>(senderClustersKey(userEmail), () => fetchSenderClusters(userEmail));

  const stats = statsResource.data?.stats ?? null;
  const sizes = statsResource.data?.sizes ?? {};
  const topSenders = clustersResource.data?.topSenders ?? [];
  const topDomains = clustersResource.data?.topDomains ?? [];
  const recentEmails = clustersResource.data?.recentEmails ?? [];

  const datasets: Dataset[] = [
    {
      id: 'summary',
      group: 'Summary',
      title: 'Inbox Health Summary',
      description: 'Every headline metric with its storage estimate, plus the full health score breakdown.',
      icon: <Activity className="w-4 h-4" />,
      knownRows: stats ? 20 : undefined,
      build: async () => {
        if (!stats) return null;
        const { unsubscribedCount, activeFiltersCount } = getUserManagementCounts();
        const breakdown = computeInboxHealthBreakdown({
          unreadInbox: stats.unread,
          spamAndTrash: stats.spamAndTrash,
          oldPromotions: stats.oldPromo,
          largeFiles: stats.large,
          oldMail: stats.oldMail,
          unsubscribedCount,
          activeFiltersCount,
        });
        const rows: unknown[][] = [
          ['Volume', 'Unread in inbox', stats.unread, ''],
          ['Volume', 'Important unread', stats.importantUnread, ''],
          ['Volume', 'Updates & social', stats.updatesAndSocial, formatBytes(sizes.updatesAndSocial || 0)],
          ['Volume', 'With attachments', stats.withAttachments, formatBytes(sizes.withAttachments || 0)],
          ['Clutter', 'Spam & trash', stats.spamAndTrash, formatBytes(sizes.spamAndTrash || 0)],
          ['Clutter', 'Stale promotions (>6m)', stats.oldPromo, formatBytes(sizes.oldPromo || 0)],
          ['Storage', 'Large attachments (>5MB)', stats.large, formatBytes(sizes.large || 0)],
          ['Storage', 'Mail older than 1 year', stats.oldMail, formatBytes(sizes.oldMail || 0)],
          ['Score', 'Health score', breakdown.score, 'out of 100'],
          ['Score', 'Total deductions', -breakdown.totalDeductions, 'points'],
          ['Score', 'Unread penalty', -breakdown.unreadPenalty, 'points'],
          ['Score', 'Spam & trash penalty', -breakdown.spamPenalty, 'points'],
          ['Score', 'Stale promotions penalty', -breakdown.promoPenalty, 'points'],
          ['Score', 'Large attachments penalty', -breakdown.largeFilesPenalty, 'points'],
          ['Score', 'Old mail penalty', -breakdown.oldMailPenalty, 'points'],
          ['Score', 'Hygiene bonus', breakdown.totalBonus, 'points'],
          ['Score', 'Unsubscribe bonus', breakdown.unsubBonus, `${unsubscribedCount} unsubscribes`],
          ['Score', 'Filter rule bonus', breakdown.filterBonus, `${activeFiltersCount} rules`],
        ];
        return { headers: ['Section', 'Metric', 'Value', 'Detail'], rows };
      },
    },
    {
      id: 'senders',
      group: 'Senders',
      title: 'Top Senders',
      description: 'Who emails you most, with exact message counts.',
      icon: <Users className="w-4 h-4" />,
      knownRows: topSenders.length,
      build: async () => ({
        headers: ['Sender Name', 'Email Address', 'Message Count'],
        rows: topSenders.map(s => [s.name, s.email, s.count]),
      }),
    },
    {
      id: 'domains',
      group: 'Senders',
      title: 'Domain Clusters',
      description: 'Which organisations account for the most mail in your inbox.',
      icon: <Layers className="w-4 h-4" />,
      knownRows: topDomains.length,
      build: async () => ({
        headers: ['Domain', 'Message Count'],
        rows: topDomains.map(d => [d.domain, d.count]),
      }),
    },
    {
      id: 'recent',
      group: 'Messages',
      title: 'Recent Messages',
      description: 'The sample MailFlow analyses, with full metadata for every message.',
      icon: <Mail className="w-4 h-4" />,
      knownRows: recentEmails.length,
      build: async () => ({
        headers: MESSAGE_HEADERS,
        rows: recentEmails.map((e: any) => messageToRow(e, extractSenderDetails(e.sender))),
      }),
    },
    {
      id: 'unread',
      group: 'Messages',
      title: 'Unread Inbox',
      description: 'Everything still unread in your inbox.',
      icon: <Inbox className="w-4 h-4" />,
      knownRows: stats?.unread,
      build: () => messageDataset(HEALTH_SCORE_QUERIES.unread),
    },
    {
      id: 'large',
      group: 'Messages',
      title: 'Large Attachments',
      description: 'Messages carrying more than 5MB — sorted out for storage cleanup.',
      icon: <HardDrive className="w-4 h-4" />,
      knownRows: stats?.large,
      build: () => messageDataset(HEALTH_SCORE_QUERIES.largeFiles),
    },
    {
      id: 'promos',
      group: 'Messages',
      title: 'Stale Promotions',
      description: 'Marketing mail older than six months.',
      icon: <AlertTriangle className="w-4 h-4" />,
      knownRows: stats?.oldPromo,
      build: () => messageDataset(HEALTH_SCORE_QUERIES.oldPromotions),
    },
    {
      id: 'oldmail',
      group: 'Messages',
      title: 'Old Mail (>1 Year)',
      description: 'Anything you have not touched in over a year.',
      icon: <Clock className="w-4 h-4" />,
      knownRows: stats?.oldMail,
      build: () => messageDataset(HEALTH_SCORE_QUERIES.oldMail),
    },
    {
      id: 'junk',
      group: 'Messages',
      title: 'Spam & Trash',
      description: 'Everything queued for deletion — worth a look before you empty it.',
      icon: <Trash2 className="w-4 h-4" />,
      knownRows: stats?.spamAndTrash,
      build: () => messageDataset(HEALTH_SCORE_QUERIES.spamAndTrash),
    },
    {
      id: 'attachments',
      group: 'Messages',
      title: 'All Attachments',
      description: 'Every message with a file attached, whatever its size.',
      icon: <Package className="w-4 h-4" />,
      knownRows: stats?.withAttachments,
      build: () => messageDataset('has:attachment -in:trash'),
    },
    {
      id: 'labels',
      group: 'Account',
      title: 'Gmail Labels',
      description: 'Your full label list, including system folders and message counts.',
      icon: <Tag className="w-4 h-4" />,
      knownRows: userLabels.length,
      build: async () => ({
        headers: ['Label Name', 'Label ID', 'Type', 'Total Messages', 'Unread Messages'],
        rows: userLabels.map((l: any) => [
          l.name, l.id, l.type || '', l.messagesTotal ?? '', l.messagesUnread ?? '',
        ]),
      }),
    },
    {
      id: 'unsubs',
      group: 'Account',
      title: 'Unsubscribe History',
      description: 'Every sender you have unsubscribed from through MailFlow.',
      icon: <ShieldCheck className="w-4 h-4" />,
      build: async () => {
        let log: any[] = [];
        try {
          const raw = localStorage.getItem('ais_unsub_log');
          const parsed = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed)) log = parsed;
        } catch { }
        return {
          headers: ['Sender', 'Email', 'Method', 'Date'],
          rows: log.map((entry: any) => [
            entry.name || entry.sender || '',
            entry.email || entry.emailAddr || '',
            entry.method || entry.type || '',
            entry.date || entry.timestamp || '',
          ]),
        };
      },
    },
    {
      id: 'rules',
      group: 'Account',
      title: 'Filter Rules Created',
      description: 'The automation rules MailFlow has created in your Gmail account.',
      icon: <Filter className="w-4 h-4" />,
      build: async () => {
        let log: any[] = [];
        try {
          const raw = localStorage.getItem('inbox_created_rules_log_v1');
          const parsed = raw ? JSON.parse(raw) : [];
          if (Array.isArray(parsed)) log = parsed;
        } catch { }
        return {
          headers: ['Rule ID', 'Criteria', 'Action', 'Label', 'Date Created'],
          rows: log.map((r: any) => [
            r.id || '',
            r.criteria ? JSON.stringify(r.criteria) : (r.from || ''),
            r.action ? JSON.stringify(r.action) : '',
            r.labelName || '',
            r.createdAt || r.date || '',
          ]),
        };
      },
    },
  ];

  const runExport = async (dataset: Dataset) => {
    setBusyId(dataset.id);
    setError(null);
    try {
      const result = await dataset.build();
      if (!result) {
        setError(`${dataset.title} isn't ready yet — the inbox analysis is still loading.`);
        return;
      }
      if (result.rows.length === 0) {
        setError(`${dataset.title} has no rows to export.`);
        return;
      }
      downloadCsv(timestampedFilename(dataset.id), buildCsv(result.headers, result.rows));
      setDoneIds(prev => new Set(prev).add(dataset.id));
    } catch (e: any) {
      console.error(e);
      setError(`Couldn't export ${dataset.title}. ${e?.message || 'Please try again.'}`);
    } finally {
      setBusyId(null);
    }
  };

  const groups: DatasetGroup[] = ['Summary', 'Senders', 'Messages', 'Account'];
  const isPreparing = statsResource.loading || clustersResource.loading;

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col animate-in fade-in duration-150">
      <PageHeader
        title="Export Center"
        subtitle="Download any dataset MailFlow can see as a CSV."
        icon={<Download className="w-4 h-4" />}
        onBack={onBack}
        backLabel="Back to Inbox Health"
      />

      {error && (
        <div className="bg-white border border-amber-200 rounded-xl p-3.5 mb-4 flex items-start gap-2.5 shadow-2xs">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-slate-700">{error}</p>
        </div>
      )}

      {isPreparing && (
        <div className="bg-white border border-slate-200 rounded-xl p-3.5 mb-4 flex items-center gap-2.5 shadow-2xs">
          <Loader2 className="w-4 h-4 text-slate-500 animate-spin shrink-0" />
          <p className="text-xs text-slate-600">Analysing your inbox — row counts will fill in shortly. Message exports already work.</p>
        </div>
      )}

      <div className="flex flex-col gap-5">
        {groups.map(group => (
          <div key={group}>
            <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2.5">{group}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {datasets.filter(d => d.group === group).map(dataset => {
                const isBusy = busyId === dataset.id;
                const isDone = doneIds.has(dataset.id);
                const rows = dataset.knownRows;
                const isEmpty = rows === 0;
                return (
                  <div
                    key={dataset.id}
                    className="bg-white border border-slate-200 hover:border-slate-300 rounded-xl p-3.5 shadow-2xs transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
                        {dataset.icon}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-semibold text-slate-900">{dataset.title}</h4>
                          {rows !== undefined && (
                            <span className="text-[11px] font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md border border-slate-200">
                              {rows.toLocaleString()} rows
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{dataset.description}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => runExport(dataset)}
                      disabled={isBusy || isEmpty}
                      className={cn(
                        "flex items-center justify-center gap-1.5 px-3 py-2 sm:py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer shrink-0 w-full sm:w-auto self-stretch sm:self-center disabled:opacity-50 disabled:cursor-not-allowed",
                        isDone
                          ? "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200"
                          : "bg-slate-900 text-white hover:bg-slate-800"
                      )}
                      title={isEmpty ? 'Nothing to export' : `Download ${dataset.title} as CSV`}
                    >
                      {isBusy ? (
                        <><Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Preparing</span></>
                      ) : isDone ? (
                        <><CheckCircle2 className="w-3.5 h-3.5" /><span>Download again</span></>
                      ) : (
                        <><Download className="w-3.5 h-3.5" /><span>{isEmpty ? 'Empty' : 'Download'}</span></>
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-slate-400 mt-5 leading-relaxed">
        Message exports include up to {MESSAGE_EXPORT_LIMIT.toLocaleString()} rows each and are generated in your
        browser — nothing is uploaded anywhere. Files open directly in Excel, Numbers, or Google Sheets.
      </p>
    </div>
  );
}
