import React, { useState, useMemo } from 'react';
import { 
  ArrowLeft, CheckCircle, CheckCircle2, Loader2, Trash2, Archive, 
  Mail, Star, Tag, Folder, RefreshCw, Download, Filter, 
  ChevronDown, Layers, Target, AlertCircle, Clock, HardDrive, 
  SlidersHorizontal, Check, Eye
} from 'lucide-react';
import { cn } from '../lib/utils';
import { EmailData } from '../lib/gmail';
import { routeLabel } from '../lib/routes';

export interface FilterPageParams {
  title: string;
  query: string;
  badge?: string;
  subtitle?: string;
  folder?: string;
  sort?: "date" | "size" | "sender";
  source?: string;
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
  onDeleteSelected: () => void;
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
  actionLoading
}: FilteredEmailPageProps) {
  const [localSearch, setLocalSearch] = useState('');
  const [selectedFolderForMove, setSelectedFolderForMove] = useState('');

  const filteredEmails = useMemo(() => {
    if (!localSearch.trim()) return emails;
    const term = localSearch.toLowerCase();
    return emails.filter(e => 
      e.sender.toLowerCase().includes(term) ||
      e.subject.toLowerCase().includes(term) ||
      e.snippet.toLowerCase().includes(term)
    );
  }, [emails, localSearch]);

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
          </div>

          {/* Bulk Actions when selected */}
          {selectedIds.size > 0 ? (
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <button
                onClick={onDeleteSelected}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                title="Move selected to Trash"
              >
                {actionLoading === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                <span>Trash ({selectedIds.size})</span>
              </button>

              <button
                onClick={onArchiveSelected}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                title="Archive selected messages"
              >
                {actionLoading === 'archive' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                <span>Archive</span>
              </button>

              <button
                onClick={onMarkReadSelected}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                title="Mark selected as read"
              >
                <Mail className="w-3.5 h-3.5" />
                <span>Mark Read</span>
              </button>

              <button
                onClick={onStarSelected}
                disabled={actionLoading !== null}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                title="Star selected messages"
              >
                <Star className="w-3.5 h-3.5" />
                <span>Star</span>
              </button>
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
          {isSearching ? (
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
            filteredEmails.map(email => {
              const isSelected = selectedIds.has(email.id);
              const isUnread = email.labelIds?.includes('UNREAD');

              return (
                <div
                  key={email.id}
                  onClick={() => onToggleSelect(email.id)}
                  className={cn(
                    "flex items-start sm:items-center gap-3 p-3 sm:px-4 hover:bg-slate-50/80 transition-colors cursor-pointer group",
                    isSelected ? "bg-blue-50/40" : "",
                    isUnread ? "bg-white font-medium" : "text-slate-600",
                    viewDensity === 'compact' ? "py-2 sm:py-2" : "py-3 sm:py-3.5"
                  )}
                >
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleSelect(email.id);
                    }}
                    className="mt-0.5 sm:mt-0 flex items-center justify-center w-5 h-5 rounded hover:bg-slate-200 text-slate-400 transition-colors shrink-0 cursor-pointer"
                  >
                    <div className={cn(
                      "w-4 h-4 rounded border flex items-center justify-center transition-colors shadow-2xs",
                      isSelected ? "bg-slate-900 border-slate-900 text-white" : "border-slate-300 bg-white text-transparent"
                    )}>
                      <Check className="w-3 h-3" />
                    </div>
                  </button>

                  <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-12 gap-1 sm:gap-4 items-baseline sm:items-center">
                    {/* Sender */}
                    <div className="sm:col-span-3 truncate text-xs sm:text-sm font-semibold text-slate-800">
                      {email.sender}
                    </div>

                    {/* Subject & Snippet */}
                    <div className="sm:col-span-7 min-w-0 flex items-baseline gap-2 truncate text-xs sm:text-sm">
                      <span className={cn("truncate", isUnread ? "font-bold text-slate-900" : "text-slate-700")}>
                        {email.subject || '(No Subject)'}
                      </span>
                      <span className="text-slate-400 text-xs truncate hidden sm:inline">
                        — {email.snippet}
                      </span>
                    </div>

                    {/* Date & Size */}
                    <div className="sm:col-span-2 flex items-center justify-between sm:justify-end gap-2 text-[11px] text-slate-400 shrink-0">
                      {email.sizeEstimate && email.sizeEstimate > 1024 * 1024 && (
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-mono text-[10px]">
                          {formatSize(email.sizeEstimate)}
                        </span>
                      )}
                      <span>
                        {email.date ? new Date(email.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}
                      </span>
                    </div>
                  </div>
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
