import React, { useState, useEffect, useRef } from 'react';
import { Filter, ChevronDown, AlertCircle, Bell, Download, Clock } from 'lucide-react';
import { countEmails } from '../lib/gmail';

export function QuickFiltersDropdown({ onApplyPreset }: { onApplyPreset: (preset: any) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [stats, setStats] = useState<any>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchStats() {
      try {
        const [importantUnread, updatesAndSocial, withAttachments, oldMail] = await Promise.all([
          countEmails("is:unread is:important -category:promotions -in:trash"),
          countEmails("category:updates OR category:social -in:trash"),
          countEmails("has:attachment -in:trash"),
          countEmails("older_than:1y -in:trash")
        ]);
        setStats({ importantUnread, updatesAndSocial, withAttachments, oldMail });
      } catch (e) {
        console.error(e);
      }
    }
    fetchStats();
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filters = [
    {
      id: "important-unread",
      label: "Important Unread",
      icon: <AlertCircle className="w-4 h-4 text-amber-500" />,
      query: "is:unread is:important -category:promotions -in:trash",
      count: stats?.importantUnread || 0
    },
    {
      id: "updates-social",
      label: "Updates & Social",
      icon: <Bell className="w-4 h-4 text-slate-500" />,
      query: "category:updates OR category:social -in:trash",
      count: stats?.updatesAndSocial || 0,
      sortBy: "size"
    },
    {
      id: "with-attachments",
      label: "With Attachments",
      icon: <Download className="w-4 h-4 text-slate-500" />,
      query: "has:attachment -in:trash",
      count: stats?.withAttachments || 0,
      sortBy: "size"
    },
    {
      id: "older-than-1y",
      label: "Older Than 1 Year",
      icon: <Clock className="w-4 h-4 text-slate-400" />,
      query: "older_than:1y -in:trash",
      count: stats?.oldMail || 0,
      sortBy: "size"
    }
  ];

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-1.5 bg-white border border-slate-200 px-3 py-1.5 rounded-full text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-xs"
      >
        <Filter className="w-3.5 h-3.5" />
        <span>Quick Filters</span>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden py-1 animate-in fade-in zoom-in-95 duration-100">
          {filters.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                onApplyPreset({ query: f.query, folderFilters: ['anywhere'], sortBy: f.sortBy, sortDesc: true });
                setIsOpen(false);
              }}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 transition-colors text-left"
            >
              <div className="flex items-center gap-2.5">
                {f.icon}
                <span className="text-sm font-medium text-slate-700">{f.label}</span>
              </div>
              <span className="text-xs font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                {f.count}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
