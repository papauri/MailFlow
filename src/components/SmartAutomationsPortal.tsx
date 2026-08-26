import React, { useState } from 'react';
import { SmartTriageModal } from './SmartTriageModal';
import { FolderOptimizer } from './FolderOptimizer';
import { RuleSuggester } from './RuleSuggester';
import { Zap, SlidersHorizontal, Settings, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { EmailData } from '../lib/gmail';

/**
 * Smart Automations.
 *
 * The three tools answer three different questions about the same mailbox:
 *
 *   Batch Organizer  — "what is sitting in front of me right now?"
 *   Folder Optimizer — "where should the mail I already have live?"
 *   Automated Rules  — "what should happen to mail that arrives next?"
 *
 * Each used to render its own page furniture inside this one, so switching tabs
 * changed the container, the card shape and the toolbar all at once. The portal now
 * owns the frame — one panel, one description line, one scroll context — and each tab
 * supplies only its content, built from the shared pieces in `AutomationShell`.
 *
 * It is also wider than it was. The cards are laid out in a grid now, and a `max-w-5xl`
 * column could only ever show two of them.
 */

const TABS = [
  {
    id: 'batch' as const,
    label: 'Batch Organizer',
    icon: Zap,
    blurb: 'Groups what is in your mailbox now into one-click actions. Review every message inside the card before it runs.',
  },
  {
    id: 'optimizer' as const,
    label: 'Folder Optimizer',
    icon: SlidersHorizontal,
    blurb: 'Files mail you already have into folders. Nothing changes about mail that arrives later.',
  },
  {
    id: 'rules' as const,
    label: 'Automated Rules',
    icon: Settings,
    blurb: 'Creates Gmail filters so future mail files itself. Your existing mail is left where it is.',
  },
];

export function SmartAutomationsPortal({
  userEmail,
  userLabels,
  emails,
  aiSettings,
  isSearching,
  connectionStatus,
  onRefresh,
  onClose
}: {
  userEmail?: string;
  userLabels: any[];
  emails: EmailData[];
  aiSettings: any;
  isSearching: boolean;
  connectionStatus: string;
  onRefresh: () => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'batch' | 'optimizer' | 'rules'>('batch');
  const active = TABS.find(t => t.id === activeTab)!;

  return (
    <div className="w-full flex flex-col animate-in fade-in duration-150">
      {/* Header: back, title, and the tab switcher on one line from sm up. */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3 sm:p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs mb-3 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold transition-colors cursor-pointer shrink-0"
            title="Back to Inbox Health"
            aria-label="Back to Inbox Health"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden md:inline whitespace-nowrap">Back to Inbox Health</span>
          </button>
          <div className="min-w-0">
            <h2 className="text-sm sm:text-base font-bold text-slate-900 leading-tight">Smart Automations</h2>
            {/* The blurb tracks the tab, so the page always says what the visible tool
                does rather than summarising all three at once. */}
            <p className="text-[11px] text-slate-500 mt-0.5 line-clamp-1" title={active.blurb}>
              {active.blurb}
            </p>
          </div>
        </div>

        <div
          className="flex bg-slate-100 p-0.5 rounded-xl shrink-0 self-start lg:self-auto"
          role="tablist"
          aria-label="Smart Automations tools"
        >
          {TABS.map(tab => {
            const Icon = tab.icon;
            const selected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer",
                  selected ? "bg-white text-slate-900 shadow-2xs" : "text-slate-600 hover:text-slate-900"
                )}
              >
                <Icon className="w-3.5 h-3.5 shrink-0" />
                <span className="whitespace-nowrap">{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* One panel for every tab, so the frame never changes underneath the content. */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs overflow-hidden flex flex-col min-h-[560px]">
        {activeTab === 'batch' && (
          <SmartTriageModal
            isPage={true}
            isOpen={true}
            showHeader={false}
            embedded={true}
            onClose={onClose}
            aiSettings={aiSettings}
            userLabels={userLabels}
            userEmail={userEmail}
            onRefresh={onRefresh}
          />
        )}

        {activeTab === 'optimizer' && (
          <FolderOptimizer
            embedded={true}
            userEmail={userEmail}
            userLabels={userLabels}
            aiSettings={aiSettings}
            isFetching={isSearching}
            isAiWorking={connectionStatus === 'success'}
            onReload={onRefresh}
          />
        )}

        {activeTab === 'rules' && (
          <RuleSuggester
            isPage={true}
            showHeader={false}
            embedded={true}
            userEmail={userEmail}
            userLabels={userLabels}
            recentEmails={emails}
            aiSettings={aiSettings}
            isAiWorking={connectionStatus === 'success'}
          />
        )}
      </div>
    </div>
  );
}
