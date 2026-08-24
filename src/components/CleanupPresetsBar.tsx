import React, { useState, useEffect } from 'react';
import { Bookmark, BookmarkPlus, Plus, Trash2, X, Check, Sparkles, Filter, SlidersHorizontal, ArrowRight, Zap } from 'lucide-react';
import { cn } from '../lib/utils';

export interface CleanupPreset {
  id: string;
  name: string;
  emoji: string;
  query: string;
  folderFilters: string[];
  sortBy?: "date" | "size" | "sender";
  sortDesc?: boolean;
  isCustom?: boolean;
  badge?: string;
  description?: string;
}

const DEFAULT_PRESETS: CleanupPreset[] = [
  {
    id: 'preset_receipts',
    name: 'Receipts & Billing',
    emoji: '🧾',
    query: 'subject:(receipt OR invoice OR billing OR "order confirmed" OR "payment") older_than:1y -in:trash',
    folderFilters: ['anywhere'],
    sortBy: 'date',
    sortDesc: true,
    badge: '>1y',
    description: 'Find old receipts & invoices older than 1 year',
  },
  {
    id: 'preset_dev_alerts',
    name: 'Dev & CI/CD Alerts',
    emoji: '💻',
    query: 'from:(github.com OR gitlab.com OR bitbucket.org OR vercel.com OR netlify.com) older_than:14d -in:trash',
    folderFilters: ['anywhere'],
    sortBy: 'date',
    sortDesc: true,
    badge: '>14d',
    description: 'Automated GitHub, GitLab, and deployment notifications',
  },
  {
    id: 'preset_stale_promos',
    name: 'Stale Promos',
    emoji: '🛍️',
    query: 'older_than:6m -in:trash',
    folderFilters: ['category:promotions'],
    sortBy: 'date',
    sortDesc: true,
    badge: '>6m',
    description: 'Marketing newsletters older than 6 months',
  },
  {
    id: 'preset_shipping',
    name: 'Shipping & Delivery',
    emoji: '📦',
    query: 'subject:(tracking OR shipped OR delivery OR shipment OR "out for delivery") older_than:30d -in:trash',
    folderFilters: ['anywhere'],
    sortBy: 'date',
    sortDesc: true,
    badge: '>30d',
    description: 'Old order tracking and delivery notices older than 30 days',
  },
  {
    id: 'preset_heavy',
    name: 'Heavy Files (>10MB)',
    emoji: '📎',
    query: 'has:attachment larger:10M -in:trash',
    folderFilters: ['anywhere'],
    sortBy: 'size',
    sortDesc: true,
    badge: '>10MB',
    description: 'Large emails with heavy attachments taking up storage',
  },
  {
    id: 'preset_social',
    name: 'Social Media Alerts',
    emoji: '💬',
    query: 'older_than:3m -in:trash',
    folderFilters: ['category:social'],
    sortBy: 'date',
    sortDesc: true,
    badge: '>3m',
    description: 'LinkedIn, Twitter/X, and social notifications older than 3 months',
  },
];

const EMOJI_OPTIONS = ['🧹', '📑', '🧾', '💻', '🛍️', '📦', '📎', '💬', '⚡', '📁', '🎯', '🚀', '🔥'];

export function CleanupPresetsBar({
  currentQuery,
  currentFolders,
  currentSortBy,
  currentSortDesc,
  onApplyPreset,
  className
}: {
  currentQuery: string;
  currentFolders: string[];
  currentSortBy: "date" | "size" | "sender";
  currentSortDesc: boolean;
  onApplyPreset: (preset: CleanupPreset) => void;
  className?: string;
}) {
  const [customPresets, setCustomPresets] = useState<CleanupPreset[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetEmoji, setPresetEmoji] = useState('🧹');
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('ais_cleanup_custom_presets');
      if (stored) {
        setCustomPresets(JSON.parse(stored));
      }
    } catch (e) {
      console.error(e);
    }
  }, []);

  const saveCustomPresets = (newPresets: CleanupPreset[]) => {
    setCustomPresets(newPresets);
    localStorage.setItem('ais_cleanup_custom_presets', JSON.stringify(newPresets));
  };

  const handleCreatePreset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!presetName.trim()) return;

    const newPreset: CleanupPreset = {
      id: `custom_${Date.now()}`,
      name: presetName.trim(),
      emoji: presetEmoji,
      query: currentQuery,
      folderFilters: currentFolders.length > 0 ? currentFolders : ['anywhere'],
      sortBy: currentSortBy,
      sortDesc: currentSortDesc,
      isCustom: true,
      description: `Custom cleanup rule for ${currentFolders.join(', ')}`,
    };

    const updated = [newPreset, ...customPresets];
    saveCustomPresets(updated);
    setIsModalOpen(false);
    setPresetName('');
    setActivePresetId(newPreset.id);
    onApplyPreset(newPreset);
  };

  const handleDeletePreset = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const updated = customPresets.filter(p => p.id !== id);
    saveCustomPresets(updated);
    if (activePresetId === id) setActivePresetId(null);
  };

  const allPresets = [...customPresets, ...DEFAULT_PRESETS];

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-center justify-between gap-2 px-1">
        <div className="flex items-center gap-2">
          
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Smart Cleanup Presets
          </span>
        </div>

        <button
          type="button"
          onClick={() => {
            setPresetName(currentQuery ? `Filter: ${currentQuery.slice(0, 20)}...` : 'My Custom Filter');
            setIsModalOpen(true);
          }}
          className="text-[11px] font-semibold text-slate-600 hover:text-slate-800 flex items-center gap-1 hover:bg-slate-50 px-2 py-0.5 rounded-md transition-colors"
          title="Save active search & folder rules as a 1-click preset"
        >
          
          <span>Save Current View</span>
        </button>
      </div>

      {/* Preset Chips Carousel */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-1 px-0.5">
        {allPresets.map((preset) => {
          const isActive = activePresetId === preset.id;
          return (
            <div
              key={preset.id}
              className={cn(
                "group flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold whitespace-nowrap transition-all shadow-2xs shrink-0 cursor-pointer",
                isActive 
                  ? "bg-slate-800 text-white border-slate-800 shadow-xs"
                  : preset.isCustom 
                    ? "bg-slate-50/70 border-slate-200 text-slate-900 hover:bg-slate-100/80 hover:border-slate-300"
                    : "bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300"
              )}
              onClick={() => {
                setActivePresetId(preset.id);
                onApplyPreset(preset);
              }}
              title={preset.description || preset.query}
            >
              
              <span>{preset.name}</span>
              {preset.badge && (
                <span className={cn(
                  "text-[10px] font-bold px-1.5 py-0.2 rounded-md",
                  isActive ? "bg-slate-700 text-slate-200" : "bg-slate-100 text-slate-600"
                )}>
                  {preset.badge}
                </span>
              )}
              {preset.isCustom && (
                <button
                  type="button"
                  onClick={(e) => handleDeletePreset(preset.id, e)}
                  className="opacity-60 hover:opacity-100 p-0.5 rounded hover:bg-black/10 ml-0.5 transition-opacity"
                  title="Delete custom preset"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Save Preset Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full p-5 flex flex-col gap-4 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="p-2 bg-slate-50 rounded-xl text-slate-600">
                  <BookmarkPlus className="w-5 h-5" />
                </div>
                <h3 className="text-base font-bold text-slate-900">Save Cleanup Preset</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Save your current search query, folder filters, and sort preference as a quick 1-click button.
            </p>

            <form onSubmit={handleCreatePreset} className="flex flex-col gap-3.5">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Preset Icon</label>
                <div className="flex items-center gap-1.5 flex-wrap">
                  {EMOJI_OPTIONS.map(emoji => (
                    <button
                      key={emoji}
                      type="button"
                      onClick={() => setPresetEmoji(emoji)}
                      className={cn(
                        "w-8 h-8 rounded-lg text-base flex items-center justify-center border transition-all",
                        presetEmoji === emoji 
                          ? "bg-slate-50 border-slate-500 scale-110 shadow-2xs ring-1 ring-slate-500" 
                          : "bg-slate-50 border-slate-200 hover:bg-slate-100"
                      )}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Preset Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Stale Receipts, GitHub Pings..."
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  className="w-full text-sm border border-slate-300 rounded-xl px-3 py-2 focus:ring-2 focus:ring-slate-800 focus:border-slate-800 outline-none"
                  autoFocus
                />
              </div>

              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 text-xs text-slate-600 flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">Captured Query:</span>
                  <span className="font-mono text-[11px] truncate max-w-[200px]">{currentQuery || '(No custom query)'}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">Folders:</span>
                  <span className="truncate max-w-[200px]">{currentFolders.join(', ')}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-700">Sorting:</span>
                  <span>{currentSortBy} ({currentSortDesc ? 'desc' : 'asc'})</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 transition-colors shadow-2xs"
                >
                  Save Preset
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
