import React, { useState } from 'react';
import { SmartTriageModal } from './SmartTriageModal';
import { FolderOptimizer } from './FolderOptimizer';
import { RuleSuggester } from './RuleSuggester';
import { Zap, SlidersHorizontal, Settings, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';
import { EmailData } from '../lib/gmail';

export function SmartAutomationsPortal({
  userEmail,
  userLabels,
  emails,
  aiSettings,
  isSearching,
  connectionStatus,
  onRefresh,
  onSearchQuery,
  onClose
}: {
  userEmail?: string;
  userLabels: any[];
  emails: EmailData[];
  aiSettings: any;
  isSearching: boolean;
  connectionStatus: string;
  onRefresh: () => void;
  onSearchQuery: (q: string) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<'batch' | 'optimizer' | 'rules'>('batch');

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col animate-in fade-in duration-150">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 sm:p-5 rounded-2xl bg-white border border-slate-200 shadow-2xs gap-4 mb-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs sm:text-sm font-semibold transition-colors cursor-pointer shrink-0"
            title="Back to Inbox Health"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Inbox Health</span>
          </button>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">Smart Automations</h2>
            <p className="text-xs text-slate-500 mt-0.5">Batch organize recurring senders, optimize folders, and create rules</p>
          </div>
        </div>
        
        <div className="flex bg-slate-100 p-1 rounded-xl flex-wrap overflow-x-auto">
          <button
            onClick={() => setActiveTab('batch')}
            className={cn(
              "flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0",
              activeTab === 'batch' ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
            )}
          >
            <Zap className="w-4 h-4" />
            Batch Organizer
          </button>
          <button
            onClick={() => setActiveTab('optimizer')}
            className={cn(
              "flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0",
              activeTab === 'optimizer' ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
            )}
          >
            <SlidersHorizontal className="w-4 h-4" />
            Folder Optimizer
          </button>
          <button
            onClick={() => setActiveTab('rules')}
            className={cn(
              "flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0",
              activeTab === 'rules' ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
            )}
          >
            <Settings className="w-4 h-4" />
            Automated Rules
          </button>
        </div>
      </div>

      <div className="w-full flex flex-col gap-4">
        {activeTab === 'batch' && (
          <SmartTriageModal
            isPage={true}
            isOpen={true}
            showHeader={false}
            reviewSource="smart-automations"
            onClose={onClose}
            aiSettings={aiSettings}
            userLabels={userLabels}
            userEmail={userEmail}
            onRefresh={onRefresh}
            onSearchQuery={onSearchQuery}
          />
        )}
        
        {activeTab === 'optimizer' && (
          <FolderOptimizer
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
