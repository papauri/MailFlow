import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';

interface Props {
  title: string;
  subtitle?: string;
  badge?: string;
  icon?: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
  /** Right-aligned controls: refresh, filters, and so on. */
  actions?: React.ReactNode;
  className?: string;
}

/**
 * One header for every full-page view.
 *
 * These were hand-written per page and had drifted into a tall stack: a large Back
 * pill, then the title on its own line, then a subtitle wrapping to two lines — three
 * rows of chrome before any content, repeated on a dozen pages and worst on mobile
 * where vertical space is scarcest.
 *
 * This keeps everything on one line from `sm` up, with the subtitle beside the title
 * rather than beneath it and truncated instead of wrapped. On mobile the Back control
 * drops to an icon so the title keeps the width it needs.
 */
export function PageHeader({
  title, subtitle, badge, icon, onBack, backLabel = 'Back', actions, className
}: Props) {
  return (
    <div className={cn(
      "bg-white border border-slate-200 rounded-xl shadow-2xs px-3 py-2.5 sm:px-4 sm:py-3 flex items-center gap-2 sm:gap-3 mb-3",
      className
    )}>
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 px-2 sm:px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer shrink-0"
          title={backLabel}
          aria-label={backLabel}
        >
          <ArrowLeft className="w-4 h-4 shrink-0" />
          {/* Label is the first thing to go when width is tight — the arrow and the
              breadcrumb above already say where this leads. */}
          <span className="hidden md:inline whitespace-nowrap">{backLabel}</span>
        </button>
      )}

      {icon && (
        <div className="w-7 h-7 rounded-lg bg-slate-900 text-white hidden sm:flex items-center justify-center shrink-0">
          {icon}
        </div>
      )}

      <div className="min-w-0 flex-1 flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-sm sm:text-base font-bold text-slate-900 truncate">{title}</h1>
          {badge && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200 shrink-0 whitespace-nowrap">
              {badge}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-[11px] sm:text-xs text-slate-500 truncate min-w-0 sm:flex-1">
            {subtitle}
          </p>
        )}
      </div>

      {actions && <div className="flex items-center gap-1.5 shrink-0">{actions}</div>}
    </div>
  );
}
