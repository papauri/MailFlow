import React, { useState, useEffect, useCallback } from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import { X, Loader2, RefreshCw, PieChart as PieChartIcon, ArrowRight, AlertCircle } from 'lucide-react';
import { countEmails } from '../lib/gmail';

export interface CategoryItem {
  id: string;
  name: string;
  query: string;
  filter: string;
  color: string;
  value: number;
  displayCount: string;
}

const CATEGORY_CONFIG = [
  { id: 'primary', name: 'Primary', query: 'category:primary in:anywhere', filter: 'category:primary', color: '#3B82F6' },
  { id: 'promotions', name: 'Promotions', query: 'category:promotions in:anywhere', filter: 'category:promotions', color: '#F59E0B' },
  { id: 'updates', name: 'Updates', query: 'category:updates in:anywhere', filter: 'category:updates', color: '#10B981' },
  { id: 'social', name: 'Social', query: 'category:social in:anywhere', filter: 'category:social', color: '#8B5CF6' },
  { id: 'forums', name: 'Forums', query: 'category:forums in:anywhere', filter: 'category:forums', color: '#64748B' },
  { id: 'spam', name: 'Spam & Trash', query: 'in:spam OR in:trash', filter: 'anywhere', color: '#EF4444' },
];

export interface CategoryDistributionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyCategory?: (query: string, filter?: string) => void;
}

export function CategoryDistributionModal({
  isOpen,
  onClose,
  onApplyCategory
}: CategoryDistributionModalProps) {
  const [data, setData] = useState<CategoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [totalCount, setTotalCount] = useState(0);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const fetchCategoryData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const results: CategoryItem[] = await Promise.all(
        CATEGORY_CONFIG.map(async (cat) => {
          const rawCount = await countEmails(cat.query);
          const numValue =
            typeof rawCount === 'number'
              ? rawCount
              : parseInt(String(rawCount).replace(/[^0-9]/g, ''), 10) || 5000;
          return {
            id: cat.id,
            name: cat.name,
            query: cat.query,
            filter: cat.filter,
            color: cat.color,
            value: numValue,
            displayCount: typeof rawCount === 'number' ? rawCount.toLocaleString() : String(rawCount),
          };
        })
      );
      const total = results.reduce((acc, curr) => acc + curr.value, 0);
      setData(results);
      setTotalCount(total);
    } catch (e: any) {
      console.error('Failed to load category counts', e);
      setError(e?.message || 'Failed to calculate category distribution. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Lazy fetch on modal open if not loaded yet
  useEffect(() => {
    if (isOpen && data.length === 0 && !loading) {
      fetchCategoryData();
    }
  }, [isOpen, data.length, loading, fetchCategoryData]);

  // Keyboard navigation (Escape key) & Body scroll lock
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="category-distribution-title"
    >
      <div
        className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] shadow-2xl flex flex-col overflow-hidden border border-slate-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-200 flex justify-between items-center bg-slate-50 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg border border-indigo-100">
              <PieChartIcon className="w-5 h-5" />
            </div>
            <div>
              <h2 id="category-distribution-title" className="font-bold text-slate-800 text-base sm:text-lg">
                Inbox Category Distribution
              </h2>
              <p className="text-xs text-slate-500">
                Breakdown of mailbox volume across Gmail categories
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-200 rounded-lg transition-colors"
            title="Close modal"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex flex-col gap-6">
          {loading ? (
            <div className="h-72 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Loader2 className="w-8 h-8 animate-spin text-slate-800" />
              <p className="text-sm font-medium">Calculating category breakdown...</p>
              <p className="text-xs text-slate-400">Scanning Gmail category indexes</p>
            </div>
          ) : error ? (
            <div className="h-72 flex flex-col items-center justify-center gap-3 text-center p-4">
              <div className="p-3 bg-red-50 text-red-600 rounded-full border border-red-100">
                <AlertCircle className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-slate-800">{error}</p>
              <button
                onClick={fetchCategoryData}
                className="mt-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-semibold rounded-xl transition-all shadow-sm flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          ) : data.length > 0 ? (
            <>
              {/* Donut Chart Area */}
              <div className="w-full h-64 sm:h-72 flex items-center justify-center relative">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={data}
                      cx="50%"
                      cy="50%"
                      innerRadius={65}
                      outerRadius={100}
                      paddingAngle={3}
                      dataKey="value"
                      cursor="pointer"
                      onMouseEnter={(_, index) => setActiveIndex(index)}
                      onMouseLeave={() => setActiveIndex(null)}
                      onClick={(_, index) => {
                        if (onApplyCategory && data[index]) {
                          onClose();
                          onApplyCategory(data[index].query, data[index].filter);
                        }
                      }}
                    >
                      {data.map((entry, index) => (
                        <Cell
                          key={`cell-${entry.id}`}
                          fill={entry.color}
                          opacity={activeIndex === null || activeIndex === index ? 1 : 0.6}
                          stroke="#ffffff"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (active && payload && payload.length) {
                          const item = payload[0].payload as CategoryItem;
                          const percent =
                            totalCount > 0
                              ? ((item.value / totalCount) * 100).toFixed(1)
                              : '0';
                          return (
                            <div className="bg-slate-900/95 text-white px-3.5 py-2.5 rounded-xl shadow-xl border border-slate-700 text-xs flex flex-col gap-1 backdrop-blur-sm pointer-events-none">
                              <div className="flex items-center gap-2">
                                <span
                                  className="w-2.5 h-2.5 rounded-full shrink-0"
                                  style={{ backgroundColor: item.color }}
                                />
                                <span className="font-bold text-slate-100">{item.name}</span>
                              </div>
                              <div className="text-slate-300">
                                <span className="font-semibold text-white">{item.displayCount}</span> emails ({percent}%)
                              </div>
                            </div>
                          );
                        }
                        return null;
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>

                {/* Donut Center Display */}
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  {activeIndex !== null && data[activeIndex] ? (
                    <>
                      <span className="text-2xl font-extrabold text-slate-900 tracking-tight">
                        {data[activeIndex].displayCount}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        {data[activeIndex].name}
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="text-2xl font-extrabold text-slate-900 tracking-tight">
                        {totalCount.toLocaleString()}
                      </span>
                      <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                        Total Emails
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* Breakdown Legend Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {data.map((cat, idx) => {
                  const percent =
                    totalCount > 0 ? Math.round((cat.value / totalCount) * 100) : 0;
                  const isHovered = activeIndex === idx;
                  return (
                    <div
                      key={cat.id}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onMouseLeave={() => setActiveIndex(null)}
                      className={`flex items-center justify-between p-3 rounded-xl border transition-all ${
                        isHovered
                          ? 'border-slate-300 bg-slate-100/80 shadow-sm'
                          : 'border-slate-100 bg-slate-50/60 hover:bg-slate-100/60'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span
                          className="w-3 h-3 rounded-full shrink-0"
                          style={{ backgroundColor: cat.color }}
                        />
                        <span className="text-sm font-semibold text-slate-800 truncate">
                          {cat.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-700">
                          {cat.displayCount}
                        </span>
                        <span className="text-[11px] text-slate-400">({percent}%)</span>
                        {onApplyCategory && (
                          <button
                            onClick={() => {
                              onClose();
                              onApplyCategory(cat.query, cat.filter);
                            }}
                            className="p-1 text-slate-400 hover:text-slate-800 hover:bg-slate-200 rounded transition-colors ml-1"
                            title={`Filter mailbox by ${cat.name}`}
                            aria-label={`Filter by ${cat.name}`}
                          >
                            <ArrowRight className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          ) : null}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between shrink-0">
          <button
            onClick={fetchCategoryData}
            disabled={loading}
            className="flex items-center gap-2 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors disabled:opacity-50"
            title="Refresh category counts"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Counts</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-sm font-semibold rounded-xl transition-all shadow-sm"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
