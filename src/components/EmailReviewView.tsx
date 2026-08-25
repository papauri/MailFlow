import React, { useState, useMemo } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, Search, Filter } from 'lucide-react';
import { cn } from '../lib/utils';
import { EmailData } from '../lib/gmail';

interface EmailReviewViewProps {
  title: string;
  subtitle?: string;
  emails: EmailData[];
  selectedEmailIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onToggleSelectAll: () => void;
  onBack: () => void;
  onExecute: () => void;
  actionLabel: string;
  isExecuting?: boolean;
  isFullModal?: boolean;
}

export function EmailReviewView({
  title,
  subtitle,
  emails,
  selectedEmailIds,
  onToggleSelect,
  onToggleSelectAll,
  onBack,
  onExecute,
  actionLabel,
  isExecuting = false,
  isFullModal = false
}: EmailReviewViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const categories = useMemo(() => {
    const cats = new Set<string>();
    emails.forEach(e => {
      if (e.labelIds) {
         e.labelIds.forEach(l => {
           if (l.startsWith('CATEGORY_')) {
             cats.add(l.replace('CATEGORY_', ''));
           }
         });
      }
    });
    return Array.from(cats);
  }, [emails]);

  const filteredEmails = useMemo(() => {
    return emails.filter(e => {
      // Search
      const text = `${e.sender} ${e.subject} ${e.snippet}`.toLowerCase();
      if (searchQuery && !text.includes(searchQuery.toLowerCase())) return false;
      
      // Category
      if (categoryFilter !== 'all') {
        const hasCategory = e.labelIds?.some(l => l === `CATEGORY_${categoryFilter.toUpperCase()}`);
        if (!hasCategory) return false;
      }
      
      return true;
    });
  }, [emails, searchQuery, categoryFilter]);

  const allSelected = filteredEmails.length > 0 && filteredEmails.every(e => selectedEmailIds.has(e.id));

  const content = (
    <div className={cn("flex flex-col h-full bg-white", isFullModal ? "rounded-xl overflow-hidden shadow-2xl ring-1 ring-slate-200" : "animate-in slide-in-from-right-4 duration-300")}>
      <div className="px-4 sm:px-6 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white shrink-0">
        <div className="flex items-center gap-3">
          <button 
            onClick={onBack}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-600 transition-colors cursor-pointer shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              Inspecting: {title}
              {subtitle && <span className="text-[10px] font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full truncate max-w-[150px] sm:max-w-none">{subtitle}</span>}
            </h3>
            <p className="text-xs font-semibold text-emerald-600 mt-0.5">
              {selectedEmailIds.size} of {emails.length} selected
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 self-end sm:self-center">
          <button
            onClick={onExecute}
            disabled={isExecuting || selectedEmailIds.size === 0}
            className="text-xs font-bold px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50 whitespace-nowrap"
          >
            {isExecuting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
            {actionLabel} ({selectedEmailIds.size})
          </button>
        </div>
      </div>

      <div className="px-4 sm:px-6 py-2 border-b border-slate-100 bg-slate-50/50 flex items-center gap-3 overflow-x-auto custom-scrollbar">
        <div className="relative shrink-0 w-48 sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Filter emails..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs focus:outline-hidden focus:ring-1 focus:ring-slate-300"
          />
        </div>
        
        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 shrink-0">
            <Filter className="w-3.5 h-3.5 text-slate-400 ml-1" />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className="px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white text-slate-700 focus:outline-hidden focus:ring-1 focus:ring-slate-300"
            >
              <option value="all">All Categories</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-slate-50/30">
        {filteredEmails.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[250px] text-slate-400">
             <CheckCircle2 className="w-10 h-10 text-emerald-400 mb-3" />
             <p className="text-sm font-medium text-slate-600">No matching emails found.</p>
          </div>
        ) : (
          <div className="flex-1 flex flex-col p-0 sm:p-4 mx-auto w-full max-w-full">
             <div className="bg-white border-y sm:border sm:border-slate-200 sm:rounded-xl sm:shadow-xs overflow-hidden">
                <div className="px-3 sm:px-4 py-2 border-b border-slate-100 bg-slate-50 flex items-center gap-3">
                  <button 
                    onClick={() => {
                      if (allSelected) {
                        // Deselect all filtered
                        filteredEmails.forEach(e => {
                          if (selectedEmailIds.has(e.id)) {
                             onToggleSelect(e.id);
                          }
                        });
                      } else {
                        // Select all filtered
                        filteredEmails.forEach(e => {
                          if (!selectedEmailIds.has(e.id)) {
                             onToggleSelect(e.id);
                          }
                        });
                      }
                    }}
                    className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors cursor-pointer", allSelected ? "bg-slate-800 border-slate-800 text-white" : "border-slate-300 bg-white text-transparent")}
                  >
                    <CheckCircle2 className="w-3 h-3" />
                  </button>
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Select All</span>
                </div>
                <ul className="divide-y divide-slate-100">
                  {filteredEmails.map((email) => {
                     const isUnread = email.labelIds?.includes('UNREAD');
                     const isSelected = selectedEmailIds.has(email.id);
                     return (
                        <li 
                           key={email.id} 
                           onClick={() => onToggleSelect(email.id)}
                           className={cn("px-3 sm:px-4 py-2.5 sm:py-3 hover:bg-slate-50 transition-colors group flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 border-b border-slate-100 last:border-b-0 cursor-pointer", isSelected && "bg-slate-50/80")}
                        >
                           <div className="flex items-center gap-2.5 sm:gap-3 sm:w-1/3 shrink-0 min-w-0">
                              <div className={cn("w-4 h-4 rounded border flex items-center justify-center transition-colors shrink-0", isSelected ? "bg-slate-800 border-slate-800 text-white" : "border-slate-300 bg-white text-transparent")}>
                                <CheckCircle2 className="w-3 h-3" />
                              </div>
                              <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0 border border-slate-200 text-xs font-bold uppercase hidden sm:flex">
                                 {(email.sender.replace(/<.*>/, "").trim() || '?')[0]}
                              </div>
                              <span 
                                 className={cn("text-xs sm:text-sm truncate", isUnread ? "font-bold text-slate-900" : "font-medium text-slate-700")}
                                 title={email.sender}
                              >
                                 {email.sender.replace(/<.*>/, "").trim() || email.sender}
                              </span>
                           </div>
                           <div className="flex-1 min-w-0 flex flex-col pl-7 sm:pl-0">
                              <span className={cn("text-xs sm:text-sm truncate", isUnread ? "font-bold text-slate-900" : "text-slate-800")}>
                                 {email.subject || '(No Subject)'}
                              </span>
                              <span className="text-[11px] sm:text-xs text-slate-500 truncate mt-0.5">
                                 {email.snippet}
                              </span>
                           </div>
                           <div className="hidden sm:flex shrink-0">
                              <span className="text-[10px] sm:text-xs text-slate-400 whitespace-nowrap">
                                 {email.date ? email.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
                              </span>
                           </div>
                        </li>
                     );
                  })}
                </ul>
             </div>
          </div>
        )}
      </div>
    </div>
  );

  if (isFullModal) {
    return (
      <div className="fixed inset-0 z-[120] flex items-center justify-center p-2 sm:p-4 md:p-6 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200" onClick={onBack}>
        <div className="w-full max-w-5xl h-full max-h-[92vh] flex flex-col" onClick={e => e.stopPropagation()}>
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-50 bg-white">
      {content}
    </div>
  );
}
