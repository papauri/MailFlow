import React, { useState, useEffect, useRef } from 'react';
import { countEmails } from '../lib/gmail';
import { cn } from '../lib/utils';
import { Activity } from 'lucide-react';
import { computeInboxHealthScore, HealthScoreMetrics } from '../lib/emailUtils';

export function HealthScoreWidget({ 
  onApplyQuery, 
  onOpenUnsubscribe,
  compact = false 
}: { 
  onApplyQuery?: (query: string, filter?: string, sortOption?: "date" | "size" | "sender") => void; 
  onOpenUnsubscribe?: () => void;
  compact?: boolean;
}) {
  const [score, setScore] = useState<number | null>(() => {
    try {
      const cached = sessionStorage.getItem('ais_cached_health_score');
      return cached ? parseInt(cached, 10) : null;
    } catch {
      return null;
    }
  });
  const [metrics, setMetrics] = useState<HealthScoreMetrics | null>(null);
  const [loading, setLoading] = useState(score === null);
  const [recentGain, setRecentGain] = useState<number | null>(null);
  const [isPulsing, setIsPulsing] = useState(false);
  const prevScoreRef = useRef<number | null>(score);

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

        const initialMetrics: HealthScoreMetrics = {
          unreadInbox: parseCount(unread),
          spamAndTrash: parseCount(junk),
          oldPromotions: parseCount(promo),
          largeFiles: parseCount(large),
          oldMail: parseCount(oldMail),
          unsubscribedCount,
          activeFiltersCount
        };

        const calculatedScore = computeInboxHealthScore(initialMetrics);
        
        setMetrics(initialMetrics);
        setScore(calculatedScore);
        try {
          sessionStorage.setItem('ais_cached_health_score', String(calculatedScore));
        } catch { }
      } catch (e) {
        console.error("Failed to calculate health score", e);
      } finally {
        setLoading(false);
      }
    }

    calculateScore();
    
    // INSTANT OPTIMISTIC HEALTH SCORE UPDATE LISTENER
    const handleInboxMetricsUpdated = (e: any) => {
      const detail = e?.detail || {};
      const { type, count = 0, isPartial, metrics: directMetrics } = detail;

      setMetrics(prev => {
        let next: HealthScoreMetrics;
        if (directMetrics) {
          next = { ...directMetrics };
        } else if (prev) {
          next = { ...prev };
          if (type === 'unread') {
            next.unreadInbox = isPartial ? Math.max(0, prev.unreadInbox - count) : 0;
          } else if (type === 'spam') {
            next.spamAndTrash = isPartial ? Math.max(0, prev.spamAndTrash - count) : 0;
          } else if (type === 'promo') {
            next.oldPromotions = isPartial ? Math.max(0, prev.oldPromotions - count) : 0;
          } else if (type === 'large') {
            next.largeFiles = isPartial ? Math.max(0, prev.largeFiles - count) : 0;
          } else if (type === 'unsub') {
            next.unsubscribedCount = (prev.unsubscribedCount || 0) + (count || 1);
          } else if (type === 'rule') {
            next.activeFiltersCount = (prev.activeFiltersCount || 0) + (count || 1);
          }
        } else {
          // If metrics haven't loaded yet, trigger background calc
          calculateScore();
          return prev;
        }

        const newScore = computeInboxHealthScore(next);
        const prevScore = prevScoreRef.current ?? newScore;
        const diff = newScore - prevScore;

        if (diff > 0) {
          setRecentGain(diff);
          setIsPulsing(true);
          setTimeout(() => {
            setRecentGain(null);
            setIsPulsing(false);
          }, 3000);
        }

        prevScoreRef.current = newScore;
        setScore(newScore);
        try {
          sessionStorage.setItem('ais_cached_health_score', String(newScore));
        } catch { }

        return next;
      });
    };

    const handleGenericUpdate = () => calculateScore();

    window.addEventListener('inbox_metrics_updated', handleInboxMetricsUpdated);
    window.addEventListener('health-score-update', handleGenericUpdate);
    
    return () => {
      window.removeEventListener('inbox_metrics_updated', handleInboxMetricsUpdated);
      window.removeEventListener('health-score-update', handleGenericUpdate);
    };
  }, []);

  if (loading && score === null) {
    return (
      <div className="flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-slate-100 rounded-full animate-pulse shrink-0">
        <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full border-2 border-slate-300"></div>
        <div className="h-2.5 sm:h-3 w-8 sm:w-12 bg-slate-300 rounded"></div>
      </div>
    );
  }

  // Calculate circle dash array
  const radius = 10;
  const circumference = 2 * Math.PI * radius;
  const displayScore = score ?? 0;
  const strokeDashoffset = circumference - (displayScore / 100) * circumference;

  let colorClass = "text-emerald-500";
  let borderHighlight = "border-slate-200";
  if (displayScore < 40) {
    colorClass = "text-rose-500";
  } else if (displayScore < 70) {
    colorClass = "text-amber-500";
  }

  if (isPulsing) {
    borderHighlight = "border-emerald-400 ring-2 ring-emerald-400/20 bg-emerald-50/50";
  }

  return (
    <button 
      type="button"
      onClick={() => { window.location.hash = '#health-score'; }}
      className={cn(
        "relative flex items-center gap-1.5 sm:gap-2.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-slate-50 hover:bg-slate-100/90 border rounded-full shadow-2xs transition-all duration-300 cursor-pointer text-left group shrink-0",
        borderHighlight
      )} 
      title="Click to view Inbox Health Score breakdown & instant recommendations"
    >
      <div className="relative w-5 h-5 sm:w-7 sm:h-7 flex items-center justify-center shrink-0">
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
          {/* Progress circle with smooth transition */}
          <circle
            cx="12"
            cy="12"
            r={radius}
            stroke="currentColor"
            strokeWidth="3"
            fill="transparent"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            className={cn("transition-all duration-700 ease-out", colorClass)}
            strokeLinecap="round"
          />
        </svg>
        <Activity className={cn("w-2.5 h-2.5 sm:w-3 sm:h-3 absolute z-10 group-hover:scale-110 transition-transform", colorClass)} />
      </div>
      <div className="flex flex-col">
        <span className="text-[9px] sm:text-[10px] font-bold text-slate-500 group-hover:text-slate-700 uppercase tracking-wider leading-none mb-0.5 hidden xs:inline">Health</span>
        <div className="flex items-center gap-1">
          <span className="text-xs font-bold text-slate-800 leading-none transition-all">{displayScore}%</span>
          {recentGain && (
            <span className="text-[10px] font-bold text-emerald-600 animate-bounce leading-none">
              +{recentGain}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}
