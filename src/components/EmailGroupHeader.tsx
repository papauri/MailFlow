import React from 'react';
import {
  ChevronDown, ChevronRight, Inbox, Activity, Tag, Users, MessagesSquare,
  ShieldAlert, Trash2, Archive, HardDrive, Clock, Check
} from 'lucide-react';
import { cn } from '../lib/utils';
import { EmailGroup } from '../lib/emailGrouping';

const ICONS: Record<EmailGroup['icon'], { node: React.ReactNode; tone: string }> = {
  inbox: { node: <Inbox className="w-4 h-4" />, tone: 'text-blue-600' },
  updates: { node: <Activity className="w-4 h-4" />, tone: 'text-emerald-600' },
  promotions: { node: <Tag className="w-4 h-4" />, tone: 'text-amber-600' },
  social: { node: <Users className="w-4 h-4" />, tone: 'text-sky-600' },
  forums: { node: <MessagesSquare className="w-4 h-4" />, tone: 'text-slate-600' },
  spam: { node: <ShieldAlert className="w-4 h-4" />, tone: 'text-rose-600' },
  trash: { node: <Trash2 className="w-4 h-4" />, tone: 'text-slate-600' },
  archive: { node: <Archive className="w-4 h-4" />, tone: 'text-slate-600' },
  size: { node: <HardDrive className="w-4 h-4" />, tone: 'text-slate-700' },
  clock: { node: <Clock className="w-4 h-4" />, tone: 'text-slate-600' },
};

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

interface Props {
  group: EmailGroup;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /** Every message in the group is selected. */
  allSelected: boolean;
  someSelected: boolean;
  onToggleSelectAll: () => void;
  /** Size is only worth showing where storage is the point of the view. */
  showBytes?: boolean;
}

/**
 * Sticky header for a group of message rows.
 *
 * Carries the two controls that make grouping useful rather than decorative:
 * select-the-whole-group, and collapse-the-whole-group.
 */
export function EmailGroupHeader({
  group, collapsed, onToggleCollapse, allSelected, someSelected, onToggleSelectAll, showBytes
}: Props) {
  const icon = ICONS[group.icon] || ICONS.inbox;

  return (
    <div className="sticky top-0 z-10 flex items-center gap-3 px-3 sm:px-4 py-2 bg-slate-50 border-y border-slate-200">
      <button
        onClick={onToggleSelectAll}
        className={cn(
          "w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer shrink-0",
          allSelected ? "bg-slate-900 border-slate-900 text-white"
            : someSelected ? "bg-slate-900/70 border-slate-900 text-white"
            : "border-slate-300 bg-white text-transparent hover:border-slate-400"
        )}
        title={allSelected ? `Deselect all in ${group.title}` : `Select all in ${group.title}`}
        aria-label={allSelected ? `Deselect all in ${group.title}` : `Select all in ${group.title}`}
      >
        <Check className="w-3 h-3" />
      </button>

      <button
        onClick={onToggleCollapse}
        className="p-0.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors cursor-pointer shrink-0"
        title={collapsed ? `Expand ${group.title}` : `Collapse ${group.title}`}
        aria-label={collapsed ? `Expand ${group.title}` : `Collapse ${group.title}`}
        aria-expanded={!collapsed}
      >
        {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>

      <span className={cn("shrink-0", icon.tone)}>{icon.node}</span>

      <button
        onClick={onToggleCollapse}
        className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
      >
        <span className="text-sm font-bold text-slate-900 truncate">{group.title}</span>
        <span className="text-[11px] font-medium text-slate-600 bg-white border border-slate-200 px-1.5 py-0.5 rounded-md shrink-0 tabular-nums">
          {group.emails.length.toLocaleString()}
        </span>
        {showBytes && group.bytes > 0 && (
          <span className="text-[11px] font-medium text-slate-500 shrink-0 tabular-nums hidden sm:inline">
            {formatBytes(group.bytes)}
          </span>
        )}
      </button>
    </div>
  );
}
