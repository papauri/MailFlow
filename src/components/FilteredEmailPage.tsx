import React, { useState, useMemo, useEffect } from 'react';
import { 
  ArrowLeft, CheckCircle, CheckCircle2, Loader2, Trash2, Archive, 
  Mail, Star, Tag, Folder, RefreshCw, Download, Filter, 
  ChevronDown, Layers, Target, AlertCircle, Clock, HardDrive, 
  SlidersHorizontal, Check, Eye, ArrowUpDown
} from 'lucide-react';
import { cn } from '../lib/utils';
import { EmailData } from '../lib/gmail';
import { routeLabel } from '../lib/routes';
import { EmailGroupHeader } from './EmailGroupHeader';
import {
  chooseGrouping, groupEmails, sortForGrouping, readGroupingPref, writeGroupingPref
} from '../lib/emailGrouping';

export interface FilterPageParams {
  title: string;
  query: string;
  badge?: string;
  subtitle?: string;
  folder?: string;
  sort?: "date" | "size" | "sender";
  source?: string;
  /** The operation this page exists to perform, emphasised in the toolbar. */
  action?: 'markRead' | 'trash' | 'deleteForever';
}

interface FilteredEmailPageProps {
  params: FilterPageParams;
  emails: EmailData[];
  isSearching: boolean;
  totalCount: number | string | null;
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  /** Permanent, unrecoverable delete. Must never be labelled "Trash". */
  onDeleteSelected: () => void;
  /** Recoverable move to Trash. */
  onTrashSelected: () => void;
  onArchiveSelected: () => void;
  onMarkReadSelected: () => void;
  onStarSelected: () => void;
  onMoveToFolderSelected?: (folderId: string) => void;
  userLabels: any[];
  viewDensity: "comfortable" | "compact";
  setViewDensity: (d: "comfortable" | "compact") => void;
  onLoadMore: () => void;
  hasMore: boolean;
  isLoadingMore: boolean;
  onRefresh: () => void;
  onBack: () => void;
  actionLoading: string | null;
  sortBy: "date" | "size" | "sender";
  sortDesc: boolean;
  onSortChange: (field: "date" | "size" | "sender", desc: boolean) => void;
  onInspectEmail?: (email: EmailData) => void;
}

function formatSize(bytes: number) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getBadgeIcon(badge?: string) {
  switch (badge?.toLowerCase()) {
    case 'top sender':
      return <Target className="w-4 h-4 text-blue-500" />;
    case 'domain cluster':
      return <Layers className="w-4 h-4 text-indigo-500" />;
    case 'storage breakdown':
    case 'storage':
      return <HardDrive className="w-4 h-4 text-orange-500" />;
    case 'quick filter':
      return <Filter className="w-4 h-4 text-emerald-500" />;
    case 'unread triage':
      return <AlertCircle className="w-4 h-4 text-amber-500" />;
    case 'rule inspection':
      return <SlidersHorizontal className="w-4 h-4 text-purple-500" />;
    default:
      return <Filter className="w-4 h-4 text-slate-500" />;
  }
}

export function FilteredEmailPage({
  params,
  emails,
  isSearching,
  totalCount,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearSelection,
  onDeleteSelected,
  onTrashSelected,
  onArchiveSelected,
  onMarkReadSelected,
  onStarSelected,
  onMoveToFolderSelected,
  userLabels,
  viewDensity,
  setViewDensity,
  onLoadMore,
  hasMore,
  isLoadingMore,
  onRefresh,
  onBack,
  actionLoading,
  sortBy,
  sortDesc,
  onSortChange,
  onInspectEmail
}: FilteredEmailPageProps) {
  const [localSearch, setLocalSearch] = useState('');
  const [selectedFolderForMove, setSelectedFolderForMove] = useState('');
  const [groupingEnabled, setGroupingEnabled] = useState(readGroupingPref);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  /**
   * The grouping dimension follows the job this page was opened for — size bands for
   * storage work, Spam vs Trash for junk, age bands for stale sweeps. Turning
   * grouping off gives the plain single list.
   */
  const strategy = useMemo(
    () => groupingEnabled
      ? chooseGrouping({ query: params.query, folder: params.folder, action: params.action, sortBy })
      : 'none',
    [groupingEnabled, params.query, params.folder, params.action, sortBy]
  );

  // Apply the ordering the task implies, once, unless the user has since chosen
  // their own sort. Storage pages arrive sorted biggest-first without being asked.
  const appliedIntentSort = React.useRef(false);
  useEffect(() => {
    if (appliedIntentSort.current) return;
    const intent = sortForGrouping(chooseGrouping({
      query: params.query, folder: params.folder, action: params.action, sortBy: params.sort
    }));
    if (intent && (intent.sortBy !== sortBy || intent.sortDesc !== sortDesc)) {
      onSortChange(intent.sortBy, intent.sortDesc);
    }
    appliedIntentSort.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.query, params.folder, params.action]);

  const toggleGroupCollapse = (id: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroupSelection = (ids: string[]) => {
    const allSelected = ids.every(id => selectedIds.has(id));
    // Reuses the per-row toggle so selection stays consistent with the parent's model.
    ids.forEach(id => {
      const selected = selectedIds.has(id);
      if (allSelected && selected) onToggleSelect(id);
      else if (!allSelected && !selected) onToggleSelect(id);
    });
  };

  const filteredEmails = useMemo(() => {
    if (!localSearch.trim()) return emails;
    const term = localSearch.toLowerCase();
    return emails.filter(e => 
      e.sender.toLowerCase().includes(term) ||
      e.subject.toLowerCase().includes(term) ||
      e.snippet.toLowerCase().includes(term)
    );
  }, [emails, localSearch]);

  const groups = useMemo(
    () => groupEmails(filteredEmails, strategy),
    [filteredEmails, strategy]
  );
  // A single group is just a list with an extra bar over it — don't show the header.
  const showGroupHeaders = strategy !== 'none' && groups.length > 1;

  const isAllSelected = filteredEmails.length > 0 && filteredEmails.every(e => selectedIds.has(e.id));
  const isSomeSelected = selectedIds.size > 0 && !isAllSelected;

  const exportFilteredCSV = () => {
    let csv = "Sender,Subject,Date,Size,Snippet\n";
    filteredEmails.forEach(e => {
      const cleanSender = (e.sender || '').replace(/"/g, '""');
      const cleanSub = (e.subject || '').replace(/"/g, '""');
      const cleanDate = e.date ? new Date(e.date).toISOString() : '';
      const cleanSize = e.sizeEstimate ? formatSize(e.sizeEstimate) : '';
      const cleanSnippet = (e.snippet || '').replace(/"/g, '""').replace(/\n/g, ' ');
      csv += `"${cleanSender}","${cleanSub}","${cleanDate}","${cleanSize}","${cleanSnippet}"\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mailflow_${params.title.toLowerCase().replace(/[^a-z0-9]/g, '_')}_export.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Derived from the route the user actually arrived from, so the label always
  // matches where the button sends them.
  const backLabel = `Back to ${routeLabel(params.source)}`;

  /**
   * Bulk actions are ordered by the job this page was opened for: the task's own
   * action leads as the single filled button, the rest stay available but quiet.
   *
   * Naming here is deliberate. onDeleteSelected calls Gmail's batchDelete, which is
   * permanent and unrecoverable, so it is only ever labelled "Delete forever" — it
   * used to be shown as "Trash", which promised a recoverable move it did not do.
   * "Trash" now genuinely moves to Trash via onTrashSelected.
   */
  type BulkAction = {
    key: string;
    label: string;
    title: string;
    icon: React.ReactNode;
    onClick: () => void;
    loadingKey: string;
    destructive?: boolean;
  };

  const trashAction: BulkAction = {
    key: 'trash',
    label: 'Move to Trash',
    title: 'Move selected messages to Trash (recoverable for 30 days)',
    icon: <Trash2 className="w-3.5 h-3.5" />,
    onClick: onTrashSelected,
    loadingKey: 'trash',
  };

  const deleteForeverAction: BulkAction = {
    key: 'deleteForever',
    label: 'Delete forever',
    title: 'Permanently delete selected messages — this cannot be undone',
    icon: <Trash2 className="w-3.5 h-3.5" />,
    onClick: onDeleteSelected,
    loadingKey: 'delete',
    destructive: true,
  };

  const markReadAction: BulkAction = {
    key: 'markRead',
    label: 'Mark Read',
    title: 'Mark selected messages as read',
    icon: <Mail className="w-3.5 h-3.5" />,
    onClick: onMarkReadSelected,
    loadingKey: 'read',
  };

  const archiveAction: BulkAction = {
    key: 'archive',
    label: 'Archive',
    title: 'Archive selected messages',
    icon: <Archive className="w-3.5 h-3.5" />,
    onClick: onArchiveSelected,
    loadingKey: 'archive',
  };

  // Only offer permanent deletion where it makes sense — on spam/trash scoped views,
  // or when the task explicitly asks for it. Elsewhere Trash is the safe default.
  const isJunkScope = params.action === 'deleteForever'
    || params.folder === 'spam+trash'
    || params.folder === 'trash'
    || params.folder === 'spam';

  const allActions: BulkAction[] = isJunkScope
    ? [deleteForeverAction, trashAction, markReadAction, archiveAction]
    : [trashAction, archiveAction, markReadAction];

  const primaryKey = params.action === 'markRead' ? 'markRead'
    : params.action === 'deleteForever' ? 'deleteForever'
    : params.action === 'trash' ? 'trash'
    : allActions[0].key;

  const primaryAction = allActions.find(a => a.key === primaryKey) || allActions[0];
  const secondaryActions = allActions.filter(a => a.key !== primaryAction.key);

  return (
    <div className="w-full flex flex-col gap-4 animate-in fade-in duration-150">
      
      {/* Top Header Card */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-2xs flex flex-col gap-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start sm:items-center gap-3">
            <button
              onClick={onBack}
              className="flex items-center gap-1.5 px-3 py-1.5 sm:py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold transition-colors cursor-pointer shrink-0 shadow-2xs"
              title={backLabel}
            >
              <ArrowLeft className="w-4 h-4" />
              <span>{backLabel}</span>
            </button>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="p-2 rounded-xl bg-slate-100 border border-slate-200/80 shrink-0">
                {getBadgeIcon(params.badge)}
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">
                    {params.title}
                  </h2>
                  {params.badge && (
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-slate-100 text-slate-600 border border-slate-200">
                      {params.badge}
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5 max-w-2xl leading-relaxed">
                  {params.subtitle || `Inspecting search results matching the active filter query`}
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center flex-wrap">
            <button
              onClick={exportFilteredCSV}
              disabled={filteredEmails.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
              title="Export current view to CSV"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" />
              <span>Export CSV</span>
            </button>

            <button
              onClick={onRefresh}
              disabled={isSearching}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
              title="Refresh messages"
            >
              <RefreshCw className={cn("w-3.5 h-3.5", isSearching && "animate-spin")} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

        {/* Filter Details & Query Chip */}
        <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-slate-500 font-medium">Filter Query:</span>
            <code className="bg-slate-100 border border-slate-200 text-slate-800 px-2.5 py-1 rounded-lg font-mono text-[11px] select-all max-w-full truncate">
              {params.query}
            </code>
          </div>

          <div className="flex items-center gap-3 text-slate-500 shrink-0">
            <span>
              Matches: <strong className="text-slate-800">{totalCount !== null ? totalCount : emails.length}</strong>
            </span>
            {emails.length > 0 && (
              <span>
                Est. Size: <strong className="text-slate-800">~{formatSize(emails.reduce((s, e) => s + (e.sizeEstimate || 0), 0))}</strong>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Main Email Table Container */}
      <div className="bg-white rounded-2xl shadow-xs border border-slate-200 flex flex-col flex-1 overflow-hidden">
        
        {/* Table Toolbar */}
        <div className="p-3 sm:p-4 border-b border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (filteredEmails.length === 0) return;
                if (isAllSelected) {
                  onClearSelection();
                } else {
                  onSelectAll();
                }
              }}
              disabled={filteredEmails.length === 0}
              className="flex items-center justify-center w-7 h-7 sm:w-8 sm:h-8 rounded-lg hover:bg-slate-200/80 text-slate-600 transition-colors shrink-0 cursor-pointer disabled:opacity-50"
              title={isAllSelected ? "Deselect all" : "Select all in view"}
            >
              <div className={cn(
                "w-4 h-4 rounded border flex items-center justify-center transition-colors shadow-2xs",
                isAllSelected ? "bg-slate-900 border-slate-900" : isSomeSelected ? "bg-slate-900/80 border-slate-900" : "border-slate-300 bg-white"
              )}>
                {selectedIds.size > 0 && <Check className="w-3 h-3 text-white" />}
              </div>
            </button>

            <span className="text-xs sm:text-sm font-semibold text-slate-700">
              {selectedIds.size > 0 ? (
                <span className="text-emerald-700 font-bold">{selectedIds.size} Selected</span>
              ) : (
                <span>Showing {filteredEmails.length} {filteredEmails.length === 1 ? 'thread' : 'threads'}</span>
              )}
            </span>

            {/* Quick Search within this filtered list */}
            <div className="relative ml-2 max-w-xs hidden sm:block">
              <input
                type="text"
                value={localSearch}
                onChange={e => setLocalSearch(e.target.value)}
                placeholder="Filter these results..."
                className="bg-white border border-slate-200 rounded-lg px-2.5 py-1 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-1 focus:ring-slate-500 w-44"
              />
              {localSearch && (
                <button
                  onClick={() => setLocalSearch('')}
                  className="absolute right-2 top-1.5 text-slate-400 hover:text-slate-600 text-[11px]"
                >
                  ×
                </button>
              )}
            </div>

            {/* Sort controls — a storage cleanup view is useless without size ordering */}
            <div className="flex items-center gap-1.5 ml-1">
              <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 shrink-0 hidden sm:block" />
              <select
                value={sortBy}
                onChange={e => onSortChange(e.target.value as "date" | "size" | "sender", sortDesc)}
                className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs font-medium text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-500 cursor-pointer"
                title="Sort these results"
              >
                <option value="date">Date</option>
                <option value="size">Size</option>
                <option value="sender">Sender</option>
              </select>
              <button
                onClick={() => {
                  const next = !groupingEnabled;
                  setGroupingEnabled(next);
                  writeGroupingPref(next);
                }}
                className={cn(
                  "px-2 py-1 rounded-lg border text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1",
                  groupingEnabled
                    ? "bg-slate-900 text-white border-slate-900 hover:bg-slate-800"
                    : "bg-white text-slate-700 border-slate-200 hover:bg-slate-100"
                )}
                title={groupingEnabled ? 'Grouped — click for one long list' : 'One long list — click to group'}
              >
                <Layers className="w-3 h-3" />
                <span className="hidden sm:inline">{groupingEnabled ? 'Grouped' : 'Flat'}</span>
              </button>
              <button
                onClick={() => onSortChange(sortBy, !sortDesc)}
                className="px-2 py-1 rounded-lg bg-white border border-slate-200 hover:bg-slate-100 text-[11px] font-semibold text-slate-700 transition-colors cursor-pointer whitespace-nowrap"
                title={sortDesc ? 'Sorted descending — click for ascending' : 'Sorted ascending — click for descending'}
              >
                {sortDesc ? 'Desc' : 'Asc'}
              </button>
            </div>
          </div>

          {/* Bulk Actions when selected */}
          {selectedIds.size > 0 ? (
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              {/* The task's own action leads and is the only filled button, so the
                  right move is obvious on a page opened for a specific job. */}
              {primaryAction && (
                <button
                  onClick={primaryAction.onClick}
                  disabled={actionLoading !== null}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50 min-h-[32px]",
                    primaryAction.destructive
                      ? "bg-rose-600 text-white hover:bg-rose-700"
                      : "bg-slate-900 text-white hover:bg-slate-800"
                  )}
                  title={primaryAction.title}
                >
                  {actionLoading === primaryAction.loadingKey
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : primaryAction.icon}
                  <span>{primaryAction.label} ({selectedIds.size})</span>
                </button>
              )}

              {secondaryActions.map(action => (
                <button
                  key={action.key}
                  onClick={action.onClick}
                  disabled={actionLoading !== null}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50 min-h-[32px]",
                    action.destructive
                      ? "bg-white border border-rose-200 text-rose-700 hover:bg-rose-50"
                      : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                  )}
                  title={action.title}
                >
                  {actionLoading === action.loadingKey
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    : action.icon}
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex items-center bg-slate-200/60 p-0.5 rounded-lg text-xs font-medium text-slate-600">
                <button
                  onClick={() => setViewDensity('comfortable')}
                  className={cn("px-2.5 py-1 rounded-md transition-colors cursor-pointer", viewDensity === 'comfortable' ? "bg-white text-slate-900 shadow-2xs font-semibold" : "hover:text-slate-900")}
                >
                  Comfortable
                </button>
                <button
                  onClick={() => setViewDensity('compact')}
                  className={cn("px-2.5 py-1 rounded-md transition-colors cursor-pointer", viewDensity === 'compact' ? "bg-white text-slate-900 shadow-2xs font-semibold" : "hover:text-slate-900")}
                >
                  Compact
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Email Rows */}
        <div className="flex-1 divide-y divide-slate-100 overflow-y-auto">
          {/* Only block on the loader when there is genuinely nothing to show. If a
              cached list is already on screen it stays put and is replaced in place,
              so moving between pages doesn't flash empty. */}
          {isSearching && filteredEmails.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
              <p className="text-sm font-medium text-slate-600">Loading messages matching filter...</p>
            </div>
          ) : filteredEmails.length === 0 ? (
            <div className="py-20 flex flex-col items-center justify-center text-slate-400 gap-2">
              <CheckCircle2 className="w-10 h-10 text-slate-300" />
              <p className="text-sm font-medium text-slate-700">No matching emails found</p>
              <p className="text-xs text-slate-400">All messages matching this criteria have been cleared or organized.</p>
            </div>
          ) : (
            groups.map(group => {
              const collapsed = collapsedGroups.has(group.id);
              const groupIds = group.emails.map((e: any) => e.id);
              const selectedInGroup = groupIds.filter((id: string) => selectedIds.has(id)).length;

              return (
                <div key={group.id}>
                  {showGroupHeaders && (
                    <EmailGroupHeader
                      group={group}
                      collapsed={collapsed}
                      onToggleCollapse={() => toggleGroupCollapse(group.id)}
                      allSelected={selectedInGroup === groupIds.length && groupIds.length > 0}
                      someSelected={selectedInGroup > 0 && selectedInGroup < groupIds.length}
                      onToggleSelectAll={() => toggleGroupSelection(groupIds)}
                      showBytes={strategy === 'size'}
                    />
                  )}
                  {!collapsed && group.emails.map((email: any) => {
                    const isSelected = selectedIds.has(email.id);
                    const isUnread = email.labelIds?.includes('UNREAD');
                    const bigEnough = (email.sizeEstimate || 0) > 1024 * 1024;

                    return (
                      <div
                        key={email.id}
                        onClick={() => onToggleSelect(email.id)}
                        className={cn(
                          "flex items-center gap-3 px-3 sm:px-4 border-b border-slate-100 last:border-b-0 hover:bg-slate-50/80 transition-colors cursor-pointer group",
                          isSelected ? "bg-blue-50/40" : "",
                          isUnread ? "bg-white" : "text-slate-600",
                          viewDensity === 'compact' ? "py-2" : "py-3"
                        )}
                      >
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onToggleSelect(email.id); }}
                          className="flex items-center justify-center w-5 h-5 rounded hover:bg-slate-200 text-slate-400 transition-colors shrink-0 cursor-pointer"
                          aria-label={isSelected ? 'Deselect message' : 'Select message'}
                        >
                          <div className={cn(
                            "w-4 h-4 rounded border flex items-center justify-center transition-colors shadow-2xs",
                            isSelected ? "bg-slate-900 border-slate-900 text-white" : "border-slate-300 bg-white text-transparent"
                          )}>
                            <Check className="w-3 h-3" />
                          </div>
                        </button>

                        {/* Fixed columns so sender, subject, size and date line up on
                            every row regardless of which optional parts are present. */}
                        <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-center gap-0.5 sm:gap-4">
                          <div className={cn(
                            "sm:w-[190px] shrink-0 truncate text-xs sm:text-sm",
                            isUnread ? "font-bold text-slate-900" : "font-semibold text-slate-700"
                          )}>
                            {email.sender}
                          </div>

                          <div className="flex-1 min-w-0 flex items-baseline gap-2 text-xs sm:text-sm">
                            <span className={cn("truncate shrink-0 max-w-full", isUnread ? "font-bold text-slate-900" : "text-slate-700")}>
                              {email.subject || '(No Subject)'}
                            </span>
                            <span className="text-slate-400 text-xs truncate hidden sm:inline">
                              — {email.snippet}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="w-[58px] text-right text-[10px] font-mono text-slate-600 tabular-nums hidden sm:block">
                            {bigEnough ? formatSize(email.sizeEstimate) : ''}
                          </span>
                          <span className="w-[52px] text-right text-[11px] text-slate-400 tabular-nums">
                            {email.date ? new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); onInspectEmail?.(email); }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-200/70 transition-colors cursor-pointer shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
                            title="Preview message"
                            aria-label="Preview message"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        {/* Load More Footer */}
        {hasMore && (
          <div className="p-3 sm:p-4 border-t border-slate-100 bg-slate-50/50 flex justify-center">
            <button
              onClick={onLoadMore}
              disabled={isLoadingMore}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 text-xs sm:text-sm font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {isLoadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChevronDown className="w-4 h-4" />}
              <span>Load More Results</span>
            </button>
          </div>
        )}
      </div>

    </div>
  );
}
