import React, { useState } from 'react';
import { UnsubscribeManager } from './UnsubscribeManager';
import { LabelManagerModal } from './LabelManagerModal';
import { Layers, Folder, ArrowLeft } from 'lucide-react';
import { cn } from '../lib/utils';

export function ManageInboxPortal({ 
  userLabels, 
  aiSettings, 
  onRefreshLabels,
  onApplyQuery,
  onClose
}: { 
  userLabels: any[], 
  aiSettings: any,
  onRefreshLabels: () => void,
  onApplyQuery: (q: string, filter?: string, sortOption?: "date" | "size" | "sender") => void,
  onClose: () => void
}) {
  const [activeTab, setActiveTab] = useState<'subscriptions' | 'labels'>('subscriptions');

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
            <span>Back</span>
          </button>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-900 leading-tight">Manage Inbox</h2>
            <p className="text-xs text-slate-500 mt-0.5">Manage your newsletters, subscriptions, custom labels, and folders</p>
          </div>
        </div>
        
        <div className="flex bg-slate-100 p-1 rounded-xl">
          <button
            onClick={() => setActiveTab('subscriptions')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === 'subscriptions' ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
            )}
          >
            <Layers className="w-4 h-4" />
            Subscriptions
          </button>
          <button
            onClick={() => setActiveTab('labels')}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors",
              activeTab === 'labels' ? "bg-white text-slate-900 shadow-xs" : "text-slate-600 hover:text-slate-900"
            )}
          >
            <Folder className="w-4 h-4" />
            Labels & Folders
          </button>
        </div>
      </div>

      <div className="w-full flex flex-col gap-4">
        {activeTab === 'subscriptions' && (
          <UnsubscribeManager
            isPage={true}
            isOpen={true}
            onClose={onClose}
            aiSettings={aiSettings}
            onApplyQuery={onApplyQuery}
          />
        )}
        
        {activeTab === 'labels' && (
          <LabelManagerModal
            isPage={true}
            isOpen={true}
            onClose={onClose}
            aiSettings={aiSettings}
            userLabels={userLabels}
            onRefresh={onRefreshLabels}
            onApplyQuery={onApplyQuery}
          />
        )}
      </div>
    </div>
  );
}
