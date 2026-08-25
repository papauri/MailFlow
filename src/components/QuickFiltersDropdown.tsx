import React, { useState, useEffect, useRef } from 'react';
import { Filter, ChevronDown, Loader2, Trash2, Plus, Check } from 'lucide-react';
import { countEmails } from '../lib/gmail';
import { cn } from '../lib/utils';
import {
  CleanupPreset, PRESET_GROUPS, allPresets, readCustomPresets, writeCustomPresets
} from '../lib/cleanupPresets';

interface Props {
  onApplyPreset: (preset: any) => void;
  /** Current view, so it can be saved as a custom preset. */
  currentQuery?: string;
  currentFolders?: string[];
  currentSortBy?: 'date' | 'size' | 'sender';
  currentSortDesc?: boolean;
}

/**
 * Single home for every one-click filter — the four original quick filters and the
 * Smart Cleanup Presets that used to sit in a separate bar below the search box.
 *
 * Counts are fetched when the menu first opens rather than on mount: each one is a
 * real Gmail query, and running ten of them on every dashboard load cost the user
 * requests they had not asked for. Opening the menu is the signal that they want to
 * know, and the result is reused for the rest of the session.
 */
export function QuickFiltersDropdown({
  onApplyPreset, currentQuery, currentFolders, currentSortBy, currentSortDesc
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, number> | null>(null);
  const [countsLoading, setCountsLoading] = useState(false);
  const [presets, setPresets] = useState<CleanupPreset[]>(() => allPresets());
  const [showSave, setShowSave] = useState(false);
  const [newName, setNewName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const fetchedRef = useRef(false);

  useEffect(() => {
    if (!isOpen || fetchedRef.current) return;
    fetchedRef.current = true;

    let cancelled = false;
    setCountsLoading(true);
    (async () => {
      const entries = await Promise.all(
        presets.map(async p => {
          // One bad query must not blank out every other count.
          const n = await countEmails(p.query).catch(() => -1);
          return [p.id, n] as const;
        })
      );
      if (cancelled) return;
      const map: Record<string, number> = {};
      for (const [id, n] of entries) if (n >= 0) map[id] = n;
      setCounts(map);
      setCountsLoading(false);
    })();

    return () => { cancelled = true; };
  }, [isOpen, presets]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setShowSave(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const apply = (preset: CleanupPreset) => {
    onApplyPreset({
      query: preset.query,
      folderFilters: preset.folderFilters || ['anywhere'],
      sortBy: preset.sortBy,
      sortDesc: preset.sortDesc ?? true,
    });
    setIsOpen(false);
  };

  const saveCurrent = () => {
    if (!newName.trim() || !currentQuery?.trim()) return;
    const preset: CleanupPreset = {
      id: `custom_${Date.now()}`,
      name: newName.trim(),
      emoji: '🧹',
      group: 'Clutter',
      query: currentQuery,
      folderFilters: currentFolders,
      sortBy: currentSortBy,
      sortDesc: currentSortDesc,
      description: 'Your saved search',
      isCustom: true,
    };
    const next = [preset, ...readCustomPresets()];
    writeCustomPresets(next);
    setPresets(allPresets());
    setNewName('');
    setShowSave(false);
    fetchedRef.current = false; // recount to include the new preset
  };

  const removeCustom = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    writeCustomPresets(readCustomPresets().filter(p => p.id !== id));
    setPresets(allPresets());
  };

  const renderPreset = (p: CleanupPreset) => {
    const count = counts?.[p.id];
    const isEmpty = count === 0;
    return (
      <button
        key={p.id}
        onClick={() => apply(p)}
        disabled={isEmpty}
        className={cn(
          "w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50 transition-colors text-left group",
          isEmpty && "opacity-45 cursor-not-allowed hover:bg-transparent"
        )}
        title={isEmpty ? `${p.description} — nothing matches right now` : p.description}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-sm shrink-0">{p.emoji}</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-slate-700 truncate">{p.name}</span>
              {p.badge && (
                <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 border border-slate-200 px-1 rounded shrink-0">
                  {p.badge}
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400 truncate">{p.description}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {p.isCustom && (
            <span
              onClick={(e) => removeCustom(p.id, e)}
              className="p-1.5 sm:p-1 rounded text-slate-400 sm:text-slate-300 hover:text-rose-600 hover:bg-rose-50 transition-colors cursor-pointer opacity-100 sm:opacity-0 sm:group-hover:opacity-100 touch-visible"
              title="Delete this preset"
            >
              <Trash2 className="w-3 h-3" />
            </span>
          )}
          {countsLoading && count === undefined ? (
            <Loader2 className="w-3 h-3 animate-spin text-slate-300" />
          ) : count !== undefined ? (
            <span className="text-xs font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded tabular-nums">
              {count.toLocaleString()}
            </span>
          ) : null}
        </div>
      </button>
    );
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 bg-white border border-slate-200 px-3 py-1.5 rounded-full text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-xs cursor-pointer"
      >
        <Filter className="w-3.5 h-3.5" />
        <span>Quick Filters</span>
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", isOpen && "rotate-180")} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-100">
          <div className="max-h-[70vh] overflow-y-auto custom-scrollbar py-1">
            {presets.some(p => p.isCustom) && (
              <div>
                <p className="px-3 pt-2 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">Saved</p>
                {presets.filter(p => p.isCustom).map(renderPreset)}
              </div>
            )}

            {PRESET_GROUPS.map(group => {
              const inGroup = presets.filter(p => !p.isCustom && p.group === group);
              if (inGroup.length === 0) return null;
              return (
                <div key={group}>
                  <p className="px-3 pt-2 pb-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">{group}</p>
                  {inGroup.map(renderPreset)}
                </div>
              );
            })}
          </div>

          {currentQuery?.trim() && (
            <div className="border-t border-slate-100 bg-slate-50 p-2">
              {showSave ? (
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveCurrent(); }}
                    placeholder="Name this filter…"
                    className="flex-1 min-w-0 bg-white border border-slate-200 rounded-lg px-2 py-1 text-xs text-slate-800 focus:outline-none focus:ring-1 focus:ring-slate-500"
                  />
                  <button
                    onClick={saveCurrent}
                    disabled={!newName.trim()}
                    className="p-1.5 rounded-lg bg-slate-900 text-white hover:bg-slate-800 transition-colors cursor-pointer disabled:opacity-40"
                    title="Save preset"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowSave(true)}
                  className="w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 py-1 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Save current search as a filter
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
