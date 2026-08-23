import React, { useState, useEffect } from 'react';
import { countEmails } from '../lib/gmail';
import { cn } from '../lib/utils';
import { Activity } from 'lucide-react';
import { computeInboxHealthScore } from '../lib/emailUtils';
import { HealthScoreModal } from './HealthScoreModal';

export function HealthScoreWidget({ onApplyQuery, onOpenUnsubscribe }: { onApplyQuery?: (query: string, filter?: string, sortOption?: "date" | "size" | "sender") => void; onOpenUnsubscribe?: () => void }) {
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  useEffect(() => {
    async function calculateScore() {
      try {
        const [unread, junk, promo, large, oldMail] = await Promise.all([
          countEmails("is:unread in:inbox").catch(() => 0),
          countEmails("in:spam OR in:trash").catch(() => 0),
          countEmails("category:promotions older_than:6m").catch(() => 0),
          countEmails("larger:5M -in:trash").catch(() => 0),
          countEmails("older_than:1y -in:trash").catch(() => 0)
        ]);
        
        const parseCount = (val: any) => typeof val === 'number' ? val : (parseInt(String(val).replace(/\D/g, '')) || 0);
        
        // Get user management actions
        let unsubscribedCount = 0;
        let activeFiltersCount = 0;
        try {
          const storedUnsubs = localStorage.getItem('ais_unsub_log') || localStorage.getItem('unsubscribed_senders_v1');
          if (storedUnsubs) unsubscribedCount = JSON.parse(storedUnsubs).length;
          const storedRules = localStorage.getItem('inbox_created_rules_log_v1') || localStorage.getItem('ais_saved_rules_history');
          if (storedRules) activeFiltersCount = JSON.parse(storedRules).length;
        } catch { }

        const calculatedScore = computeInboxHealthScore({
          unreadInbox: parseCount(unread),
          spamAndTrash: parseCount(junk),
          oldPromotions: parseCount(promo),
          largeFiles: parseCount(large),
          oldMail: parseCount(oldMail),
          unsubscribedCount,
          activeFiltersCount
        });
        
        setScore(calculatedScore);
      } catch (e) {
        console.error("Failed to calculate health score", e);
      } finally {
        setLoading(false);
      }
    }

    calculateScore();
    
    // Listen for updates from UnsubscribeManager or Rule Creator
    const handleUpdate = () => calculateScore();
    window.addEventListener('health-score-update', handleUpdate);
    return () => window.removeEventListener('health-score-update', handleUpdate);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-full animate-pulse">
        <div className="w-6 h-6 rounded-full border-2 border-slate-300"></div>
        <div className="h-3 w-16 bg-slate-300 rounded"></div>
      </div>
    );
  }

  // Calculate circle dash array
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - ((score || 0) / 100) * circumference;

  let colorClass = "text-emerald-500";
  if ((score || 0) < 40) colorClass = "text-rose-500";
  else if ((score || 0) < 70) colorClass = "text-amber-500";

  return (
    <>
      <button 
        type="button"
        onClick={() => setIsModalOpen(true)}
        className="flex items-center gap-2.5 px-3 py-1.5 bg-slate-50 hover:bg-slate-100/90 border border-slate-200 hover:border-slate-300 rounded-full shadow-2xs transition-all cursor-pointer text-left group" 
        title="Click to view Inbox Health Score breakdown"
      >
        <div className="relative w-7 h-7 flex items-center justify-center">
          {/* Background circle */}
          <svg className="absolute inset-0 w-full h-full -rotate-90 transform" viewBox="0 0 24 24">
            <circle
              cx="12"
              cy="12"
              r={radius}
              stroke="currentColor"
              strokeWidth="3"
              fill="transparent"
              className="text-slate-200"
            />
            {/* Progress circle */}
            <circle
              cx="12"
              cy="12"
              r={radius}
              stroke="currentColor"
              strokeWidth="3"
              fill="transparent"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className={cn("transition-all duration-1000 ease-out", colorClass)}
              strokeLinecap="round"
            />
          </svg>
          <Activity className={cn("w-3 h-3 absolute z-10 group-hover:scale-110 transition-transform", colorClass)} />
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] font-bold text-slate-500 group-hover:text-slate-700 uppercase tracking-wider leading-none mb-0.5">Health</span>
          <span className="text-xs font-bold text-slate-800 leading-none">{score}%</span>
        </div>
      </button>

      {isModalOpen && (
        <HealthScoreModal
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          onApplyQuery={onApplyQuery}
          onOpenUnsubscribe={onOpenUnsubscribe}
        />
      )}
    </>
  );
}

