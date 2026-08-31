import React, { useState, useEffect, useRef, useTransition } from 'react';
import {
  Search,
  Loader2,
  X,
  Calendar,
  User,
  Paperclip,
  History,
  SlidersHorizontal,
  ArrowRight,
  Zap,
  Tag,
  Clock,
  Inbox,
  Filter,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import {
  SemanticSuggestion,
  fetchSemanticAutocomplete,
  generateLocalSuggestions,
  getRecentSearches,
  saveRecentSearch,
  clearRecentSearches,
  parseNaturalLanguageLocal
} from '../lib/semanticSearch';
import { cn } from '../lib/utils';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSearch: (customQuery?: string, inAnywhere?: boolean) => void;
  isSearching: boolean;
  useAI?: boolean;
  aiSettings?: any;
  topSenders?: string[];
  placeholder?: string;
  className?: string;
}

const QUICK_OPERATORS = [
  { label: 'has:attachment', query: 'has:attachment', icon: Paperclip, desc: 'With files' },
  { label: 'is:unread', query: 'is:unread', icon: Zap, desc: 'Unread mail' },
  { label: 'larger:5M', query: 'larger:5M', icon: SlidersHorizontal, desc: 'Files > 5MB' },
  { label: 'from:2012', query: 'after:2011/12/31 before:2013/01/01', icon: Calendar, desc: 'Year 2012' },
  { label: 'newer_than:7d', query: 'newer_than:7d', icon: Clock, desc: 'Past week' },
  { label: 'in:anywhere', query: 'in:anywhere', icon: Inbox, desc: 'Search all mail' },
];

export function SemanticSearchBox({
  value,
  onChange,
  onSearch,
  isSearching,
  useAI = true,
  aiSettings,
  topSenders,
  placeholder,
  className
}: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<SemanticSuggestion[]>([]);
  const [isLoadingAutocomplete, setIsLoadingAutocomplete] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load recent searches
  useEffect(() => {
    setRecentSearches(getRecentSearches());
  }, [isOpen]);

  // Click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSelectedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Handle predictive semantic autocomplete on input change
  useEffect(() => {
    const text = value.trim();

    if (!text || text.length < 2) {
      setSuggestions([]);
      setIsLoadingAutocomplete(false);
      return;
    }

    // Immediately provide local suggestions for instant feedback
    const local = generateLocalSuggestions(text, recentSearches);
    setSuggestions(local);

    // Debounce remote semantic autocomplete
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    setIsLoadingAutocomplete(true);

    const timer = setTimeout(async () => {
      try {
        const remoteSuggestions = await fetchSemanticAutocomplete(
          text,
          aiSettings,
          { topSenders },
          controller.signal
        );

        if (!controller.signal.aborted) {
          startTransition(() => {
            if (remoteSuggestions.length > 0) {
              setSuggestions(remoteSuggestions);
            } else {
              setSuggestions(local);
            }
            setIsLoadingAutocomplete(false);
          });
        }
      } catch (err: any) {
        if (!controller.signal.aborted) {
          setIsLoadingAutocomplete(false);
        }
      }
    }, 200);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, aiSettings, topSenders]);

  const handleSelectSuggestion = (suggestion: SemanticSuggestion) => {
    onChange(suggestion.query);
    saveRecentSearch(suggestion.title || suggestion.query);
    setRecentSearches(getRecentSearches());
    setIsOpen(false);
    setSelectedIndex(-1);
    onSearch(suggestion.query, suggestion.inAnywhere ?? true);
  };

  const handleFormSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (selectedIndex >= 0 && suggestions[selectedIndex]) {
      handleSelectSuggestion(suggestions[selectedIndex]);
      return;
    }

    const trimmed = value.trim();
    if (trimmed) {
      saveRecentSearch(trimmed);
      setRecentSearches(getRecentSearches());
    }
    setIsOpen(false);
    setSelectedIndex(-1);
    onSearch(trimmed || undefined);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen) {
      if (e.key === 'ArrowDown' || e.key === 'Enter') {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleFormSubmit();
    } else if (e.key === 'Escape') {
      setIsOpen(false);
      setSelectedIndex(-1);
    }
  };

  const handleAppendOperator = (opQuery: string) => {
    const current = value.trim();
    const next = current ? `${current} ${opQuery}` : opQuery;
    onChange(next);
    inputRef.current?.focus();
  };

  const handleClear = () => {
    onChange('');
    setSuggestions([]);
    setSelectedIndex(-1);
    inputRef.current?.focus();
  };

  const getCategoryIcon = (category: SemanticSuggestion['category']) => {
    switch (category) {
      case 'semantic':
        return <Search className="w-4 h-4 text-slate-600 shrink-0" />;
      case 'date':
        return <Calendar className="w-4 h-4 text-emerald-600 shrink-0" />;
      case 'sender':
        return <User className="w-4 h-4 text-sky-600 shrink-0" />;
      case 'attachment':
        return <Paperclip className="w-4 h-4 text-amber-600 shrink-0" />;
      case 'recent':
        return <History className="w-4 h-4 text-slate-400 shrink-0" />;
      default:
        return <Filter className="w-4 h-4 text-slate-500 shrink-0" />;
    }
  };

  const showRecentDropdown = value.trim().length === 0 && recentSearches.length > 0;

  return (
    <div ref={containerRef} className={cn("relative w-full", className)}>
      <form onSubmit={handleFormSubmit} className="flex gap-2 w-full">
        <div className="relative flex-1 min-w-0 flex items-center">
          <Search className="absolute left-3.5 text-slate-400 w-4 h-4 sm:w-5 sm:h-5 pointer-events-none z-10" />

          <input
            ref={inputRef}
            type="text"
            value={value}
            onChange={e => {
              onChange(e.target.value);
              if (!isOpen) setIsOpen(true);
            }}
            onFocus={() => setIsOpen(true)}
            onKeyDown={handleKeyDown}
            placeholder={
              placeholder ||
              "Search or describe what you're looking for (e.g. 'an email from college from 2012', 'tax returns', 'from:boss@company.com')..."
            }
            className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 sm:pl-11 pr-14 sm:pr-16 py-2.5 sm:py-3 text-sm sm:text-base text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-700 focus:bg-white transition-all shadow-inner placeholder:text-slate-400"
            autoComplete="off"
            spellCheck="false"
          />

          {/* Right Action Icons in Input */}
          <div className="absolute right-3 flex items-center gap-1.5 z-10">
            {isLoadingAutocomplete && (
              <Loader2 className="w-4 h-4 text-slate-400 animate-spin mr-1" />
            )}

            {value && (
              <button
                type="button"
                onClick={handleClear}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-md hover:bg-slate-200/60 transition-colors"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              </button>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={isSearching}
          className="bg-slate-800 hover:bg-slate-900 text-white px-4 sm:px-6 py-2.5 sm:py-3 rounded-xl font-medium text-sm sm:text-base transition-all shadow-sm disabled:opacity-70 disabled:cursor-wait flex items-center justify-center shrink-0 min-w-[72px] sm:min-w-[110px]"
        >
          {isSearching ? <Loader2 className="w-4 h-4 sm:w-5 sm:h-5 animate-spin" /> : "Search"}
        </button>
      </form>

      {/* Predictive Autocomplete Dropdown */}
      <AnimatePresence>
        {isOpen && (suggestions.length > 0 || showRecentDropdown) && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.99 }}
            transition={{ duration: 0.15 }}
            className="absolute left-0 right-0 top-full mt-2 bg-white rounded-2xl shadow-xl border border-slate-200 z-50 overflow-hidden text-left divide-y divide-slate-100"
          >
            {/* Header */}
            <div className="px-4 py-2 bg-slate-50 flex items-center justify-between text-xs text-slate-500 font-medium">
              <div className="flex items-center gap-1.5">
                <Search className="w-3.5 h-3.5 text-slate-500" />
                <span className="text-slate-700 font-semibold">Search Suggestions</span>
              </div>
              <span className="text-[11px] text-slate-400">Use ↑↓ keys to navigate, Enter to select</span>
            </div>

            {/* Suggestions List */}
            {suggestions.length > 0 && (
              <div className="max-h-[380px] overflow-y-auto p-1.5 space-y-1">
                {suggestions.map((suggestion, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={suggestion.id || idx}
                      onClick={() => handleSelectSuggestion(suggestion)}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      className={cn(
                        "group flex items-start gap-3 p-2.5 rounded-xl cursor-pointer transition-all border text-left",
                        isSelected
                          ? "bg-slate-100 border-slate-300 shadow-2xs"
                          : "bg-white border-transparent hover:bg-slate-50 hover:border-slate-200"
                      )}
                    >
                      <div className="mt-0.5 p-1.5 rounded-lg bg-slate-100 group-hover:bg-white border border-slate-200 shrink-0 transition-colors">
                        {getCategoryIcon(suggestion.category)}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-slate-800 text-sm leading-tight">
                            {suggestion.title}
                          </span>
                          {suggestion.badge && (
                            <span className="px-2 py-0.5 text-[11px] font-medium bg-slate-100 text-slate-600 rounded-full border border-slate-200">
                              {suggestion.badge}
                            </span>
                          )}
                          {suggestion.inAnywhere && (
                            <span className="px-1.5 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-700 rounded-md border border-slate-200">
                              All Mail
                            </span>
                          )}
                        </div>

                        {suggestion.subtitle && (
                          <p className="text-xs text-slate-500 mt-0.5 line-clamp-1">
                            {suggestion.subtitle}
                          </p>
                        )}

                        {suggestion.query && (
                          <div className="mt-1.5 flex items-center gap-1.5">
                            <span className="text-[11px] font-mono bg-slate-100 text-slate-700 px-2 py-0.5 rounded border border-slate-200 inline-block max-w-full truncate">
                              {suggestion.query}
                            </span>
                          </div>
                        )}
                      </div>

                      <ArrowRight className={cn(
                        "w-4 h-4 text-slate-400 mt-2 shrink-0 transition-transform",
                        isSelected ? "text-slate-800 translate-x-0.5" : "opacity-0 group-hover:opacity-100"
                      )} />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Recent Searches (when query empty) */}
            {showRecentDropdown && suggestions.length === 0 && (
              <div className="p-3">
                <div className="flex items-center justify-between mb-2 px-1">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Recent Searches</span>
                  <button
                    type="button"
                    onClick={() => {
                      clearRecentSearches();
                      setRecentSearches([]);
                    }}
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    Clear history
                  </button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {recentSearches.map((rec, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => {
                        onChange(rec);
                        setIsOpen(false);
                        onSearch(rec);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg text-xs text-slate-700 transition-colors"
                    >
                      <History className="w-3.5 h-3.5 text-slate-400" />
                      <span>{rec}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Search Operators Footer */}
            <div className="p-3 bg-slate-50/80">
              <div className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                Quick Search Filters & Operators
              </div>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_OPERATORS.map((op, idx) => {
                  const Icon = op.icon;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => handleAppendOperator(op.query)}
                      className="flex items-center gap-1 px-2.5 py-1 bg-white hover:bg-slate-100 border border-slate-200 rounded-md text-xs font-mono text-slate-700 transition-colors shadow-2xs"
                      title={op.desc}
                    >
                      <Icon className="w-3 h-3 text-slate-500" />
                      <span>{op.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
