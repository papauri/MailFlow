import React, { useState, useEffect } from 'react';
import { HardDrive, Trash2, Tag, Bell, Clock, ArrowRight, Sparkles, ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react';
import { countEmails, estimateQuerySize } from '../lib/gmail';
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

function formatSize(bytes: number) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

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
          countEmails("larger:5M -in:trash").catch(() => 0),
          countEmails("category:promotions older_than:6m -in:trash").catch(() => 0),
          countEmails("category:updates OR category:social -in:trash").catch(() => 0),
          countEmails("in:spam OR in:trash").catch(() => 0),
          countEmails("older_than:1y -in:trash").catch(() => 0),
        ]);

        const parseNum = (v: any) => typeof v === 'number' ? v : (parseInt(String(v).replace(/\D/g, '')) || 0);
        const lCount = parseNum(largeCount);
        const pCount = parseNum(promoCount);
        const uCount = parseNum(updatesCount);
        const jCount = parseNum(junkCount);
        const oCount = parseNum(oldMailCount);

        const [largeSize, promoSize, updatesSize, junkSize, oldMailSize] = await Promise.all([
          estimateQuerySize("larger:5M -in:trash", lCount).catch(() => 0),
          estimateQuerySize("category:promotions older_than:6m -in:trash", pCount).catch(() => 0),
          estimateQuerySize("category:updates OR category:social -in:trash", uCount).catch(() => 0),
          estimateQuerySize("in:spam OR in:trash", jCount).catch(() => 0),
          estimateQuerySize("older_than:1y -in:trash", oCount).catch(() => 0),
        ]);

        if (!isMounted) return;

        const initialSegments: StorageSegment[] = [
          {
            id: 'large',
            name: 'Heavy Files (>5MB)',
            query: 'larger:5M',
            folder: 'anywhere',
            sort: 'size',
            colorBg: 'bg-orange-50',
            colorBorder: 'border-orange-200',
            colorText: 'text-orange-700',
            colorBar: 'bg-orange-500',
            icon: <HardDrive className="w-3.5 h-3.5" />,
            count: lCount,
            sizeBytes: largeSize || (lCount * 7 * 1024 * 1024),
            description: 'Large attachments, PDFs, and media files',
          },
          {
            id: 'promotions',
            name: 'Stale Promos (>6m)',
            query: 'older_than:6m -in:trash',
            folder: 'category:promotions',
            sort: 'date',
            colorBg: 'bg-amber-50',
            colorBorder: 'border-amber-200',
            colorText: 'text-amber-700',
            colorBar: 'bg-amber-500',
            icon: <Tag className="w-3.5 h-3.5" />,
            count: pCount,
            sizeBytes: promoSize || (pCount * 120 * 1024),
            description: 'Old sales newsletters & marketing campaigns',
          },
          {
            id: 'updates',
            name: 'Updates & Alerts',
            query: 'category:updates OR category:social -in:trash',
            folder: 'anywhere',
            sort: 'size',
            colorBg: 'bg-blue-50',
            colorBorder: 'border-blue-200',
            colorText: 'text-blue-700',
            colorBar: 'bg-blue-500',
            icon: <Bell className="w-3.5 h-3.5" />,
            count: uCount,
            sizeBytes: updatesSize || (uCount * 80 * 1024),
            description: 'Automated system digests, receipts, and social pings',
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
            sizeBytes: junkSize || (jCount * 90 * 1024),
            description: 'Deleted messages and flagged junk mail',
          },
          {
            id: 'oldMail',
            name: 'Old Mail (>1yr)',
            query: 'older_than:1y -in:trash',
            folder: 'anywhere',
            sort: 'size',
            colorBg: 'bg-slate-100',
            colorBorder: 'border-slate-300',
            colorText: 'text-slate-700',
            colorBar: 'bg-slate-500',
            icon: <Clock className="w-3.5 h-3.5" />,
            count: oCount,
            sizeBytes: oldMailSize || (oCount * 100 * 1024),
            description: 'Historical archive messages older than 12 months',
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

    const handleUpdate = () => loadStorageBreakdown();
    window.addEventListener('health-score-update', handleUpdate);
    return () => {
      isMounted = false;
      window.removeEventListener('health-score-update', handleUpdate);
    };
  }, []);

  const totalBytes = segments.reduce((sum, s) => sum + (s.sizeBytes || 0), 0);
  const totalCount = segments.reduce((sum, s) => sum + (s.count || 0), 0);

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
                  ~{formatSize(totalBytes)} Cleanable
                </span>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">
                Click any category bar to immediately review and purge those messages.
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
                  title={`${segment.name}: ~${formatSize(segment.sizeBytes)} (${segment.count.toLocaleString()} emails)`}
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
                        ~{formatSize(segment.sizeBytes)}
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
