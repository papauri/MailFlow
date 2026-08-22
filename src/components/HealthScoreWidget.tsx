import React, { useState, useEffect } from 'react';
import { searchEmails, countEmails } from '../lib/gmail';
import { cn } from '../lib/utils';
import { Activity } from 'lucide-react';

export function HealthScoreWidget() {
  const [score, setScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function calculateScore() {
      try {
        const [unread, junk, promo] = await Promise.all([
          countEmails("is:unread in:inbox").catch(() => 0),
          countEmails("in:spam OR in:trash").catch(() => 0),
          countEmails("category:promotions older_than:6m").catch(() => 0)
        ]);
        
        const parseCount = (val: any) => typeof val === 'number' ? val : (parseInt(String(val).replace(/\D/g, '')) || 0);
        
        let baseScore = 100;
        
        // Unread penalty: -1 for every 5 unread, up to -40
        baseScore -= Math.min(40, (parseCount(unread) / 5));
        
        // Junk penalty: -1 for every 10 junk, up to -30
        baseScore -= Math.min(30, (parseCount(junk) / 10));
        
        // Stale promo penalty: -1 for every 10 stale promos, up to -20
        baseScore -= Math.min(20, (parseCount(promo) / 10));
        
        setScore(Math.max(12, Math.round(baseScore))); // Give at least 12% so the dial is visible
      } catch (e) {
        console.error("Failed to calculate health score", e);
      } finally {
        setLoading(false);
      }
    }

    calculateScore();
    
    // Listen for updates from UnsubscribeManager
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
    <div className="flex items-center gap-2.5 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-full shadow-sm" title="Inbox Health Score (Curated vs Total Subscriptions)">
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
        <Activity className={cn("w-3 h-3 absolute z-10", colorClass)} />
      </div>
      <div className="flex flex-col">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider leading-none mb-0.5">Health</span>
        <span className="text-xs font-bold text-slate-700 leading-none">{score}%</span>
      </div>
    </div>
  );
}
