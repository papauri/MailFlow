import React from 'react';
import { motion } from 'motion/react';
import { Loader2, Search, Inbox, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { SketchLoadingState } from './SketchLoader';

/**
 * The shared shell for every Smart Automations module.
 *
 * Batch Organizer, Folder Optimizer and Automated Rules each grew their own layout:
 * one rendered a full-bleed white panel with its own scroll container, one nested a
 * bordered box inside another bordered box, and one sat bare on the page with a
 * different set of pill tabs. Their cards disagreed too — different paddings, three
 * different ways to show a count, two different "why this was suggested" affordances.
 * Switching tabs looked like switching apps.
 *
 * Everything here is presentational, so the modules keep their own logic and only
 * agree on how the result reads:
 *
 *  - `AutomationToolbar` — filter chips, a search box, and the module's primary action.
 *  - `AutomationGrid`    — the responsive card grid. Cards were single-column and
 *                          full-width, so four suggestions filled the viewport and the
 *                          rest were below the fold; they are compact and tiled now.
 *  - `AutomationCard`    — one recommendation, in one shape, whatever produced it.
 *  - `AutomationState`   — loading, empty, and error, worded per module but laid out
 *                          identically.
 */

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

export interface ToolbarChip {
  id: string;
  label: string;
  count: number;
}

export function AutomationToolbar({
  chips, activeChip, onChipSelect,
  leadingChips, activeLeadingChip, onLeadingChipSelect,
  search, onSearchChange, searchPlaceholder = 'Filter cards…', actions,
}: {
  chips?: ToolbarChip[];
  activeChip?: string;
  onChipSelect?: (id: string) => void;
  /**
   * A second, higher-level switch shown ahead of the filter chips — which *view* of
   * the tool you are in, as opposed to which subset of it. Automated Rules has both
   * (Suggested vs Active, then the kind of suggestion) and rendered them as two
   * stacked chip bars, one of which repeated the other's label.
   */
  leadingChips?: ToolbarChip[];
  activeLeadingChip?: string;
  onLeadingChipSelect?: (id: string) => void;
  search?: string;
  onSearchChange?: (value: string) => void;
  searchPlaceholder?: string;
  actions?: React.ReactNode;
}) {
  const hasChips = !!chips && chips.length > 0;
  const hasLeading = !!leadingChips && leadingChips.length > 0;
  if (!hasChips && !hasLeading && onSearchChange === undefined && !actions) return null;

  const chipButton = (
    chip: ToolbarChip,
    isActive: boolean,
    onSelect?: (id: string) => void,
    emphasis: 'primary' | 'secondary' = 'secondary'
  ) => (
    <button
      key={chip.id}
      onClick={() => onSelect?.(chip.id)}
      aria-pressed={isActive}
      className={cn(
        "px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors shrink-0 cursor-pointer",
        isActive
          ? emphasis === 'primary'
            ? "bg-slate-900 text-white shadow-2xs"
            : "bg-slate-700 text-white shadow-2xs"
          : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
      )}
    >
      {chip.label}
      <span className={cn("ml-1 tabular-nums", isActive ? "text-white/70" : "text-slate-400")}>
        {chip.count}
      </span>
    </button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 sm:px-4 bg-slate-50/80 border-b border-slate-200">
      {hasLeading && (
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {leadingChips!.map(chip =>
            chipButton(chip, activeLeadingChip === chip.id, onLeadingChipSelect, 'primary')
          )}
        </div>
      )}

      {hasLeading && hasChips && <div className="w-px h-4 bg-slate-300 shrink-0 hidden sm:block" />}

      {hasChips && (
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          {chips!.map(chip => chipButton(chip, activeChip === chip.id, onChipSelect))}
        </div>
      )}

      <div className="flex items-center gap-2 ml-auto shrink-0">
        {onSearchChange && (
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              placeholder={searchPlaceholder}
              value={search ?? ''}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-8 pr-3 py-1.5 w-36 sm:w-48 text-xs bg-white border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-slate-900/10 focus:border-slate-400 transition-shadow"
            />
          </div>
        )}
        {actions}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

/**
 * Three columns at desktop width, one on mobile.
 *
 * `items-start` matters: without it grid stretches every card in a row to the height
 * of the tallest, so one long reason inflates its neighbours into mostly whitespace.
 */
export function AutomationGrid({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn(
      "grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-2.5 items-start",
      className
    )}>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export interface AutomationCardProps {
  icon?: React.ReactNode;
  title: string;
  /** Short badges under the title: category, destination, count. */
  tags?: { label: string; tone?: 'neutral' | 'good' | 'warn' }[];
  /** One or two lines of "why". Clamped — the full text lives in the expansion. */
  description?: React.ReactNode;
  /** The review toggle and any secondary link. */
  footerLeft?: React.ReactNode;
  /** The primary action, and any overflow menu. */
  footerRight?: React.ReactNode;
  /** Dismiss control, top-right. */
  onDismiss?: () => void;
  dismissTitle?: string;
  /** Inline review content. Rendered inside the card — never on another page. */
  children?: React.ReactNode;
  /**
   * Expanded cards take the full row. A review list squeezed into a third of the
   * width is unreadable, and letting one card grow tall in place leaves a ragged hole
   * beside it.
   */
  expanded?: boolean;
  done?: boolean;
  doneLabel?: string;
}

const TAG_TONES = {
  neutral: 'bg-slate-100 text-slate-600 border-slate-200',
  good: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warn: 'bg-amber-50 text-amber-700 border-amber-200',
};

export function AutomationCard({
  icon, title, tags, description, footerLeft, footerRight,
  onDismiss, dismissTitle = 'Dismiss this recommendation',
  children, expanded = false, done = false, doneLabel,
}: AutomationCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: done ? 0.7 : 1, y: 0 }}
      transition={{ duration: 0.22, ease: 'easeOut' }}
      className={cn(
        "rounded-xl border bg-white shadow-2xs flex flex-col transition-colors overflow-hidden",
        done ? "border-emerald-200 bg-emerald-50/40" : "border-slate-200 hover:border-slate-300",
        expanded && "lg:col-span-2 2xl:col-span-3 ring-1 ring-slate-900/5"
      )}
    >
      <div className="p-3 flex flex-col gap-2">
        <div className="flex items-start gap-2">
          {icon && (
            <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-700 shrink-0">
              {icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h4 className={cn(
              "text-[13px] font-semibold text-slate-900 leading-snug",
              expanded ? "" : "line-clamp-2"
            )}>
              {title}
            </h4>
            {(tags?.length || done) && (
              <div className="flex flex-wrap items-center gap-1 mt-1">
                {done && doneLabel && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md border bg-emerald-50 text-emerald-700 border-emerald-200">
                    <CheckCircle2 className="w-2.5 h-2.5" />
                    {doneLabel}
                  </span>
                )}
                {tags?.map((tag, i) => (
                  <span
                    key={i}
                    className={cn(
                      "text-[10px] font-medium px-1.5 py-0.5 rounded-md border whitespace-nowrap",
                      TAG_TONES[tag.tone || 'neutral']
                    )}
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          {onDismiss && !done && (
            <button
              onClick={onDismiss}
              className="p-1 -m-0.5 shrink-0 text-slate-300 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors cursor-pointer"
              title={dismissTitle}
              aria-label={dismissTitle}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
            </button>
          )}
        </div>

        {description && (
          <p className={cn(
            "text-[11px] text-slate-500 leading-relaxed",
            expanded ? "" : "line-clamp-2"
          )}>
            {description}
          </p>
        )}
      </div>

      {(footerLeft || footerRight) && (
        <div className="px-3 pb-3 pt-2 mt-auto border-t border-slate-100 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-2 min-w-0">{footerLeft}</div>
          <div className="flex items-center gap-1.5 ml-auto shrink-0">{footerRight}</div>
        </div>
      )}

      {children}
    </motion.div>
  );
}

/**
 * The review toggle every card uses, so the affordance is identical everywhere.
 *
 * Deliberately terse — "Review 12", not "Review 12 messages". At three columns a card
 * is about 360px, and the longer label pushed the primary action onto a second row,
 * making every card taller than its content needed.
 */
export function ReviewToggle({
  open, onClick, count, loading = false,
}: {
  open: boolean;
  onClick: () => void;
  count: number;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1 px-2 py-1 rounded-md bg-slate-100 hover:bg-slate-200 text-[11px] font-semibold text-slate-600 hover:text-slate-900 transition-colors cursor-pointer shrink-0"
    >
      {loading
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            className={cn("transition-transform", open && "rotate-180")}>
            <path d="m6 9 6 6 6-6" />
          </svg>
        )}
      <span className="whitespace-nowrap">
        {open ? 'Hide' : 'Review'}{count > 0 ? ` ${count.toLocaleString()}` : ''}
      </span>
    </button>
  );
}

/** Scroll container for an inline review list, sized so the card stays a card. */
export function ReviewPanel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-3 mb-3 rounded-lg border border-slate-200 bg-slate-50/70 overflow-hidden">
      <div className="max-h-80 overflow-y-auto divide-y divide-slate-200/70">
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// States
// ---------------------------------------------------------------------------

export function AutomationState({
  kind, title, body, action, progress, progressLabel,
}: {
  kind: 'loading' | 'empty' | 'error' | 'done';
  title: string;
  body?: React.ReactNode;
  action?: React.ReactNode;
  progress?: { done: number; total: number } | null;
  progressLabel?: string;
}) {
  if (kind === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center text-center py-10 px-6">
        <SketchLoadingState
          scene="sorting"
          title={title}
          messages={
            typeof body === 'string'
              ? [body, "Streaming message headers and labels...", "Calculating optimal grouping strategies..."]
              : ["Reading and learning from email history...", "Structuring smart recommendations..."]
          }
          progress={progress}
          progressLabel={progressLabel}
        />
        {action && <div className="mt-3">{action}</div>}
      </div>
    );
  }

  const ICONS = {
    empty: <Inbox className="w-7 h-7 text-slate-300" />,
    error: <AlertTriangle className="w-7 h-7 text-amber-500" />,
    done: <CheckCircle2 className="w-7 h-7 text-emerald-500" />,
  };

  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-14 px-6">
      {ICONS[kind]}
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {body && <p className="text-xs text-slate-500 max-w-md leading-relaxed">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
