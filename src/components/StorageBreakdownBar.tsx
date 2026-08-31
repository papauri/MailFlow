import React, { useState, useEffect } from 'react';
import { HardDrive, Trash2, Tag, Bell, Clock, ArrowRight, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import { countEmails, estimateQuerySize } from '../lib/gmail';
import { formatBytes } from '../lib/csvExport';
import { cn } from '../lib/utils';

export interface StorageSegment {
  id: string;
  name: string;
  query: string;
  folder: string;
  sort?: "date" | "size" | "sender";
  colorBg: string;
  colorBorder: string;
  colorText: string;
  colorBar: string;
  icon: React.ReactNode;
  count: number;
  sizeBytes: number;
  description: string;
}

/**
 * The five segments, spelled so that no message can land in two of them.
 *
 * This bar sums its segments into one "cleanable" total and renders each as a share
 * of that sum, which is only meaningful if the segments partition a set. They did
 * not: a two-year-old 8 MB promotional email matched Heavy Files, Stale Promos *and*
 * Old Mail, so it was counted three times. On a mailbox with real history the total
 * ran well above the storage actually in play, and every percentage in the bar was
 * describing a set that does not exist.
 *
 * The order below is the precedence. Each query subtracts the ones above it, so the
 * segments are disjoint, the total is the true size of their union, and a share is a
 * real share. Precedence runs biggest-lever first: junk before weight, weight before
 * age, age before category.
 *
 * The weight exclusion is written `smaller:5M` rather than `-larger:5M`: both express
 * the complement, but `smaller:` is a documented Gmail operator in its own right,
 * whereas negating a numeric operator is not something Gmail states it supports. The
 * two differ only for a message of exactly 5 MB, which lands in neither — an
 * undercount of at most one message, in the safe direction.
 */
export const SEGMENT_QUERIES = {
  /** Already deleted or junked. Everything else excludes it. */
  junk: '(in:spam OR in:trash)',
  /** The heaviest live mail, wherever it sits. */
  large: 'larger:5M -in:trash -in:spam',
  /** Live mail over a year old that is not already counted as heavy. */
  oldMail: 'older_than:1y -in:trash -in:spam smaller:5M',
  /** Stale promos inside the last year — older ones are Old Mail above. */
  promotions: 'category:promotions older_than:6m newer_than:1y -in:trash -in:spam smaller:5M',
  /** Recent automated noise not already claimed by any segment above. */
  updates: '(category:updates OR category:social) newer_than:1y -in:trash -in:spam smaller:5M',
} as const;

export function StorageBreakdownBar({
  onApplyQuery,
  className,
  compact = false
}: {
  onApplyQuery: (query: string, folder?: string, sortOption?: "date" | "size" | "sender", metadata?: { title?: string; badge?: string; subtitle?: string; source?: string }) => void;
  className?: string;
  compact?: boolean;
}) {
  const [segments, setSegments] = useState<StorageSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredSegment, setHoveredSegment] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(!compact);

  useEffect(() => {
    let isMounted = true;

    async function loadStorageBreakdown() {
      setLoading(true);
      try {
        const [largeCount, promoCount, updatesCount, junkCount, oldMailCount] = await Promise.all([
          countEmails(SEGMENT_QUERIES.large).catch(() => 0),
          countEmails(SEGMENT_QUERIES.promotions).catch(() => 0),
          countEmails(SEGMENT_QUERIES.updates).catch(() => 0),
          countEmails(SEGMENT_QUERIES.junk).catch(() => 0),
          countEmails(SEGMENT_QUERIES.oldMail).catch(() => 0),
        ]);

        const parseNum = (v: any) => typeof v === 'number' ? v : (parseInt(String(v).replace(/\D/g, '')) || 0);
        const lCount = parseNum(largeCount);
        const pCount = parseNum(promoCount);
        const uCount = parseNum(updatesCount);
        const jCount = parseNum(junkCount);
        const oCount = parseNum(oldMailCount);

        const [largeSize, promoSize, updatesSize, junkSize, oldMailSize] = await Promise.all([
          estimateQuerySize(SEGMENT_QUERIES.large, lCount).catch(() => 0),
          estimateQuerySize(SEGMENT_QUERIES.promotions, pCount).catch(() => 0),
          estimateQuerySize(SEGMENT_QUERIES.updates, uCount).catch(() => 0),
          estimateQuerySize(SEGMENT_QUERIES.junk, jCount).catch(() => 0),
          estimateQuerySize(SEGMENT_QUERIES.oldMail, oCount).catch(() => 0),
        ]);

        if (!isMounted) return;

        /**
         * `sizeBytes` is whatever the sampler measured, and nothing else.
         *
         * Each of these used to fall back to `count × <a number someone picked>` —
         * 7 MB a message for heavy files, 120 KB for promos — whenever the estimate
         * came back zero. A failed measurement then rendered as a confident figure
         * in the same "~2.3 GB Cleanable" badge as a real one, with nothing to tell
         * them apart. A segment we could not measure now reports zero and drops out
         * of the bar, which is the truthful thing for it to do.
         *
         * Every `query` is the exact string that was counted, so clicking a segment
         * opens the same set the number describes.
         */
        const initialSegments: StorageSegment[] = [
          {
            id: 'large',
            name: 'Heavy Files (>5MB)',
            query: SEGMENT_QUERIES.large,
            folder: 'anywhere',
            sort: 'size',
            colorBg: 'bg-orange-50',
            colorBorder: 'border-orange-200',
            colorText: 'text-orange-700',
            colorBar: 'bg-orange-500',
            icon: <HardDrive className="w-3.5 h-3.5" />,
            count: lCount,
            sizeBytes: largeSize,
            description: 'Large attachments, PDFs, and media files',
          },
          {
            id: 'promotions',
            name: 'Stale Promos (6–12m)',
            query: SEGMENT_QUERIES.promotions,
            folder: 'anywhere',
            sort: 'date',
            colorBg: 'bg-amber-50',
            colorBorder: 'border-amber-200',
            colorText: 'text-amber-700',
            colorBar: 'bg-amber-500',
            icon: <Tag className="w-3.5 h-3.5" />,
            count: pCount,
            sizeBytes: promoSize,
            description: 'Marketing mail past six months. Older promos count as Old Mail.',
          },
          {
            id: 'updates',
            name: 'Updates & Alerts',
            query: SEGMENT_QUERIES.updates,
            folder: 'anywhere',
            sort: 'size',
            colorBg: 'bg-blue-50',
            colorBorder: 'border-blue-200',
            colorText: 'text-blue-700',
            colorBar: 'bg-blue-500',
            icon: <Bell className="w-3.5 h-3.5" />,
            count: uCount,
            sizeBytes: updatesSize,
            description: 'Automated digests, receipts and social pings from the last year',
          },
          {
            id: 'junk',
            name: 'Spam & Trash',
            query: '',
            folder: 'spam+trash',
            sort: 'date',
            colorBg: 'bg-rose-50',
            colorBorder: 'border-rose-200',
            colorText: 'text-rose-700',
            colorBar: 'bg-rose-500',
            icon: <Trash2 className="w-3.5 h-3.5" />,
            count: jCount,
            sizeBytes: junkSize,
            description: 'Deleted messages and flagged junk mail',
          },
          {
            id: 'oldMail',
            name: 'Old Mail (>1yr)',
            query: SEGMENT_QUERIES.oldMail,
            folder: 'anywhere',
            sort: 'size',
            colorBg: 'bg-slate-100',
            colorBorder: 'border-slate-300',
            colorText: 'text-slate-700',
            colorBar: 'bg-slate-500',
            icon: <Clock className="w-3.5 h-3.5" />,
            count: oCount,
            sizeBytes: oldMailSize,
            description: 'Historical mail older than 12 months, under 5MB',
          },
        ];

        setSegments(initialSegments);
      } catch (err) {
        console.error('Failed to load storage breakdown', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    loadStorageBreakdown();

    // Both events, because they mean different things and this bar cares about
    // both. It listened only for `health-score-update`, which unsubscribes and new
    // filter rules fire — but every trash, archive and empty dispatches
    // `inbox_metrics_updated` instead, so the one thing that actually changes the
    // storage picture was the one thing that never refreshed it.
    const handleUpdate = () => loadStorageBreakdown();
    window.addEventListener('health-score-update', handleUpdate);
    window.addEventListener('inbox_metrics_updated', handleUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener('health-score-update', handleUpdate);
      window.removeEventListener('inbox_metrics_updated', handleUpdate);
    };
  }, []);

  const totalBytes = segments.reduce((sum, s) => sum + (s.sizeBytes || 0), 0);

  if (loading) {
    return (
      <div className={cn("bg-white border border-slate-200 rounded-2xl p-4 shadow-xs", className)}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-slate-400 animate-pulse" />
            <div className="h-4 w-36 bg-slate-200 rounded animate-pulse"></div>
          </div>
          <div className="h-4 w-20 bg-slate-200 rounded animate-pulse"></div>
        </div>
        <div className="w-full h-3 bg-slate-100 rounded-full overflow-hidden animate-pulse"></div>
      </div>
    );
  }

  return (
    <div className={cn("bg-white border border-slate-200 rounded-2xl shadow-xs transition-all overflow-hidden", className)}>
      <div className="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2.5">
            
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900">Storage & Cleanup Breakdown</h3>
                <span className="text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                  ~{formatBytes(totalBytes)} Cleanable
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                Categories don't overlap, so the shares add up. Click any bar to review those messages.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-center">
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-slate-100 transition-colors"
            >
              <span>{isExpanded ? "Collapse Details" : "View Breakdown"}</span>
              {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>

        {/* Multi-Segmented Storage Bar */}
        <div className="relative my-3">
          <div className="w-full h-4 sm:h-5 bg-slate-100 rounded-full overflow-hidden flex shadow-inner border border-slate-200/80 p-0.5">
            {segments.map((segment) => {
              const percentage = totalBytes > 0 ? (segment.sizeBytes / totalBytes) * 100 : 0;
              if (percentage <= 0) return null;

              const isHovered = hoveredSegment === segment.id;

              return (
                <button
                  key={segment.id}
                  type="button"
                  onMouseEnter={() => setHoveredSegment(segment.id)}
                  onMouseLeave={() => setHoveredSegment(null)}
                  onClick={() => onApplyQuery(segment.query, segment.folder, segment.sort, {
                    title: segment.name,
                    badge: 'Storage Breakdown',
                    subtitle: segment.description,
                    source: 'health'
                  })}
                  style={{ width: `${Math.max(percentage, 2)}%` }}
                  title={`${segment.name}: ~${formatBytes(segment.sizeBytes)} (${segment.count.toLocaleString()} emails)`}
                  className={cn(
                    "h-full first:rounded-l-full last:rounded-r-full transition-all relative group cursor-pointer focus:outline-none",
                    segment.colorBar,
                    isHovered ? "opacity-100 brightness-110 ring-2 ring-slate-900 ring-offset-1 z-10 scale-y-110" : "opacity-90 hover:opacity-100"
                  )}
                />
              );
            })}
          </div>
        </div>

        {/* Expanded Grid Cards for Interactive 1-Click Jump */}
        {isExpanded && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2.5 mt-4 pt-3 border-t border-slate-100">
            {segments.map((segment) => {
              const percentage = totalBytes > 0 ? Math.round((segment.sizeBytes / totalBytes) * 100) : 0;
              const isHovered = hoveredSegment === segment.id;

              return (
                <button
                  key={segment.id}
                  type="button"
                  onMouseEnter={() => setHoveredSegment(segment.id)}
                  onMouseLeave={() => setHoveredSegment(null)}
                  onClick={() => onApplyQuery(segment.query, segment.folder, segment.sort, {
                    title: segment.name,
                    badge: 'Storage Breakdown',
                    subtitle: segment.description,
                    source: 'health'
                  })}
                  className={cn(
                    "p-3 rounded-xl border text-left transition-all flex flex-col justify-between group cursor-pointer",
                    segment.colorBg,
                    segment.colorBorder,
                    isHovered ? "ring-2 ring-slate-800 -translate-y-0.5 shadow-sm" : "hover:border-slate-400 hover:shadow-xs"
                  )}
                >
                  <div>
                    <div className="flex items-center justify-between gap-1.5 mb-1.5">
                      <div className="flex items-center gap-1.5">
                        
                        <span className={cn("text-xs font-bold truncate", segment.colorText)}>{segment.name}</span>
                      </div>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 bg-white/90 rounded border border-slate-200/60 text-slate-700">
                        {percentage}%
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-600 line-clamp-1 mb-2 font-normal">
                      {segment.description}
                    </p>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-200/50 mt-auto">
                    <div>
                      <div className="text-xs sm:text-sm font-bold text-slate-900">
                        ~{formatBytes(segment.sizeBytes)}
                      </div>
                      <div className="text-[10px] text-slate-500 font-medium">
                        {segment.count.toLocaleString()} emails
                      </div>
                    </div>
                    
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
