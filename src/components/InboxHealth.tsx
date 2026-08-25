import React, { useState, useEffect } from 'react';
import { countEmails, searchEmails, estimateQuerySize } from '../lib/gmail';
import { Loader2, HardDrive, Trash2, MailOpen, ShieldAlert, SlidersHorizontal, ArrowRight, Target, Filter, ShieldCheck, PieChart, Tag, AlertCircle, User, Clock, Bell, Layers, Download, Calculator, Activity, Sparkles, Folder, ChevronDown, ChevronUp, HelpCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import { WalkthroughTip } from "./WalkthroughTip";
import { TypingLoader } from "./TypingLoader";
import { CategoryDistributionModal } from './CategoryDistributionModal';
import { UnsubscribeManager } from "./UnsubscribeManager";
import { LabelManagerModal } from "./LabelManagerModal";
import { FolderOptimizer } from "./FolderOptimizer";
import { RuleSuggester } from './RuleSuggester';
import { SmartTriageModal } from './SmartTriageModal';
import { HealthScoreModal } from './HealthScoreModal';
import { SenderAnalyticsModal } from './SenderAnalyticsModal';
import { StorageBreakdownBar } from './StorageBreakdownBar';
import { extractSenderDetails, extractRootDomain, GENERIC_FREEMAIL_DOMAINS, computeInboxHealthScore } from '../lib/emailUtils';

export function InboxHealth({ userEmail, onApplyQuery, aiSettings, userLabels, onRefresh, isAiWorking }: { userEmail?: string, onApplyQuery: (q: string, filter?: string, sortOption?: "date" | "size" | "sender", metadata?: any) => void, aiSettings?: any, userLabels?: any[], onRefresh?: () => void, isAiWorking?: boolean }) {
  const [stats, setStats] = useState<any>(null);
  const [sizes, setSizes] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);
  const [isUnsubscribeModalOpen, setIsUnsubscribeModalOpen] = useState(false);
  const [isLabelManagerOpen, setIsLabelManagerOpen] = useState(false);
  const [isSmartTriageOpen, setIsSmartTriageOpen] = useState(false);
  const [isHealthScoreModalOpen, setIsHealthScoreModalOpen] = useState(false);
  const [isSenderAnalyticsOpen, setIsSenderAnalyticsOpen] = useState(false);
  const [topSenders, setTopSenders] = useState<any[]>([]);
  const [topDomains, setTopDomains] = useState<any[]>([]);
  const [recentEmailsState, setRecentEmailsState] = useState<any[]>([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(true);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  const openFilterPage = (
    query: string,
    title: string,
    badge: string,
    subtitle?: string,
    folder: string = 'anywhere',
    sortOption?: "date" | "size" | "sender",
    source: string = 'health'
  ) => {
    const params = new URLSearchParams();
    params.set('q', query);
    params.set('title', title);
    params.set('badge', badge);
    if (subtitle) params.set('sub', subtitle);
    if (folder) params.set('folder', folder);
    if (sortOption) params.set('sort', sortOption);
    params.set('source', source);
    window.location.hash = `#filter-view?${params.toString()}`;
  };

  const scrollToAndFlash = (id: string) => {
    if (id.startsWith('card-')) {
      setShowOverview(true);
    }
    
    // Allow state update to render elements before scrolling
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('animate-flash');
        setTimeout(() => el.classList.remove('animate-flash'), 1200);
      }
    }, 50);
  };


  const [showOverview, setShowOverview] = useState(true);
  const [showQuickFilters, setShowQuickFilters] = useState(true);
  const [showAnalytics, setShowAnalytics] = useState(true);

  useEffect(() => {
    const handleMetricsUpdated = (e: any) => {
      const { type, count, isPartial } = e.detail || {};
      setStats((prev: any) => {
        if (!prev) return prev;
        const next = { ...prev };
        if (type === 'unread') {
          next.unread = isPartial ? Math.max(0, prev.unread - count) : 0;
        } else if (type === 'spam') {
          next.spamAndTrash = isPartial ? Math.max(0, prev.spamAndTrash - count) : 0;
        } else if (type === 'promo') {
          next.oldPromo = isPartial ? Math.max(0, prev.oldPromo - count) : 0;
        } else if (type === 'large') {
          next.large = isPartial ? Math.max(0, prev.large - count) : 0;
        }
        return next;
      });
    };

    window.addEventListener('inbox_metrics_updated', handleMetricsUpdated);
    return () => window.removeEventListener('inbox_metrics_updated', handleMetricsUpdated);
  }, []);

  // Keep Sender Analytics counts in sync after trash/delete actions taken while
  // inspecting a sender/domain, without re-running the full cluster analysis.
  useEffect(() => {
    const handleSenderEmailsRemoved = (e: any) => {
      const { query, count } = e.detail || {};
      if (!query || !count) return;
      const match = query.match(/^from:\(?([^)]+?)\)?$/i);
      if (!match) return;
      const identifier = match[1].toLowerCase();

      setTopSenders(prev => prev
        .map(s => s.email.toLowerCase() === identifier ? { ...s, count: Math.max(0, s.count - count) } : s)
        .filter(s => s.count > 0));
      setTopDomains(prev => prev
        .map(d => d.domain.toLowerCase() === identifier ? { ...d, count: Math.max(0, d.count - count) } : d)
        .filter(d => d.count > 0));
    };

    window.addEventListener('sender_analytics_emails_removed', handleSenderEmailsRemoved);
    return () => window.removeEventListener('sender_analytics_emails_removed', handleSenderEmailsRemoved);
  }, []);

  useEffect(() => {
    async function fetchStats() {
      // Only show full page loader on initial mount
      if (!stats) setLoading(true);
      try {
        const [unread, oldPromo, large, spamAndTrash, importantUnread, updatesAndSocial, withAttachments, oldMail] = await Promise.all([
          countEmails("is:unread in:inbox"),
          countEmails("category:promotions older_than:6m -in:trash"),
          countEmails("larger:5M -in:trash"),
          countEmails("in:spam OR in:trash"),
          countEmails("is:unread is:important -category:promotions -in:trash"),
          countEmails("category:updates OR category:social -in:trash"),
          countEmails("has:attachment -in:trash"),
          countEmails("older_than:1y -in:trash")
        ]);
        setStats({ unread, oldPromo, large, spamAndTrash, importantUnread, updatesAndSocial, withAttachments, oldMail });
        
        // Fetch estimated sizes in background
        Promise.all([
          estimateQuerySize("category:promotions older_than:6m -in:trash", oldPromo),
          estimateQuerySize("larger:5M -in:trash", large),
          estimateQuerySize("in:spam OR in:trash", spamAndTrash),
          estimateQuerySize("has:attachment -in:trash", withAttachments),
          estimateQuerySize("older_than:1y -in:trash", oldMail),
          estimateQuerySize("category:updates OR category:social -in:trash", updatesAndSocial)
        ]).then(([oldPromoSize, largeSize, spamAndTrashSize, attachmentsSize, oldMailSize, updatesAndSocialSize]) => {
          setSizes({ 
            oldPromo: oldPromoSize, 
            large: largeSize, 
            spamAndTrash: spamAndTrashSize,
            withAttachments: attachmentsSize,
            oldMail: oldMailSize,
            updatesAndSocial: updatesAndSocialSize
          });
        });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    
    async function fetchClusters() {
      setIsLoadingEmails(true);
      const normalizedUser = (userEmail || '').toLowerCase().trim();
      const userDomain = normalizedUser.includes('@') ? normalizedUser.split('@')[1] : null;

      try {
        const recentEmails = await searchEmails("in:anywhere -in:trash -in:spam -in:sent -is:draft", 250);
        setRecentEmailsState(recentEmails);
        
        // Local Aggregation
        const senderCounts = new Map();
        const domainCounts = new Map();
        
        recentEmails.forEach(e => {
          const details = extractSenderDetails(e.sender);
          const email = details.emailAddr;
          const rootDomain = details.rootDomain;
          
          if (!senderCounts.has(email)) {
            senderCounts.set(email, { 
              email, 
              name: details.displayName, 
              count: 0 
            });
          }
          senderCounts.get(email).count++;
          
          // Only track organization / company / service domains for Domain Clusters (exclude generic public webmail providers and self)
          if (rootDomain && rootDomain !== 'unknown' && !GENERIC_FREEMAIL_DOMAINS.has(rootDomain) && rootDomain !== userDomain) {
            if (!domainCounts.has(rootDomain)) domainCounts.set(rootDomain, { domain: rootDomain, count: 0 });
            domainCounts.get(rootDomain).count++;
          }
        });
        
        const rawSenders = Array.from(senderCounts.values())
          .filter(s => s.email.includes('@') && (!normalizedUser || s.email !== normalizedUser))
          .sort((a, b) => b.count - a.count).slice(0, 8);
        const exactSenders = await Promise.all(rawSenders.map(async (s) => {
           const exactCount = await countEmails(`from:(${s.email}) -in:trash`);
           return { ...s, count: typeof exactCount === 'number' ? exactCount : s.count };
        }));
        setTopSenders(exactSenders.filter(s => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 6));

        const rawDomains = Array.from(domainCounts.values())
          .filter(d => d.domain !== 'unknown' && !GENERIC_FREEMAIL_DOMAINS.has(d.domain))
          .sort((a, b) => b.count - a.count).slice(0, 8);
        const exactDomains = await Promise.all(rawDomains.map(async (d) => {
           const exactCount = await countEmails(`from:(${d.domain}) -in:trash`);
           return { ...d, count: typeof exactCount === 'number' ? exactCount : d.count };
        }));
        setTopDomains(exactDomains.filter(d => d.count > 0).sort((a, b) => b.count - a.count).slice(0, 6));

      } catch (err: any) {
        console.error("Pattern analysis error:", err);
      } finally {
        setIsLoadingEmails(false);
      }
    }
    
    fetchStats();
    fetchClusters();
  }, [userEmail, reloadTrigger]);

  const exportHealthReport = () => {
    let csv = "Section,Metric,Value\n";
    
    // Stats
    if (stats) {
      csv += `Overview,Important Unread,${stats.importantUnread || 0}\n`;
      csv += `Overview,Updates & Social,${stats.updatesAndSocial || 0}\n`;
      csv += `Overview,With Attachments,${stats.withAttachments || 0}\n`;
      csv += `Overview,Older Than 1 Year,${stats.oldMail || 0}\n`;
    }
    
    // Top Senders
    topSenders.forEach(s => {
      csv += `Top Sender,${s.email},${s.count}\n`;
    });
    
    // Top Domains
    topDomains.forEach(d => {
      csv += `Top Domain,${d.domain},${d.count}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mailflow_health_report_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (loading || isLoadingEmails) {
    return <TypingLoader title="Analyzing Inbox Health" messages={["Scanning folders...", "Calculating storage sizes...", "Running email distribution analysis...", "Identifying large attachments...", "Categorizing subscriptions..."]} />;
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-xs relative overflow-hidden mb-4 sm:mb-6">
        <div className="absolute top-0 right-0 p-4 pointer-events-none opacity-[0.03]">
          <Sparkles className="w-48 h-48 text-blue-900" />
        </div>
        
        <div className="flex items-start gap-4 relative z-10">
          <div className="bg-blue-600/10 text-blue-600 p-2.5 rounded-xl shrink-0 hidden sm:block">
            <HelpCircle className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-bold text-slate-900 text-sm sm:text-base mb-1">Not sure where to start?</h3>
            <p className="text-slate-600 text-xs sm:text-sm mb-4 leading-relaxed max-w-3xl">
              Follow these three proven steps to rescue your inbox. The automated tools below will handle the heavy lifting for you.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="bg-white/80 backdrop-blur-xs border border-blue-100/50 rounded-xl p-3.5 shadow-xs hover:shadow-sm transition-shadow">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-amber-100 text-amber-700 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold">1</div>
                  <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wide">Free up storage</h4>
                </div>
                <div className="text-[11px] text-slate-600 leading-relaxed space-y-1.5">
                  <p><strong className="text-slate-800">Action:</strong> <span onClick={() => scrollToAndFlash('storage-breakdown')} className="cursor-pointer hover:underline text-blue-700 font-semibold transition-colors">Click any colored segment in the Storage Breakdown bar</span> directly below.</p>
                  <p><strong className="text-slate-800">Result:</strong> Instantly isolate huge attachments, old trash, and forgotten promos to delete them in bulk.</p>
                </div>
              </div>

              <div className="bg-white/80 backdrop-blur-xs border border-blue-100/50 rounded-xl p-3.5 shadow-xs hover:shadow-sm transition-shadow">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-blue-100 text-blue-700 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold">2</div>
                  <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wide">Stop future noise</h4>
                </div>
                <div className="text-[11px] text-slate-600 leading-relaxed space-y-1.5">
                  <p><strong className="text-slate-800">Action:</strong> Open <span onClick={() => scrollToAndFlash('card-manage-inbox')} className="cursor-pointer hover:underline text-blue-700 font-semibold transition-colors">Manage Inbox</span> from the Overview tools.</p>
                  <p><strong className="text-slate-800">Result:</strong> Identify who sends you the most emails, bulk-unsubscribe from lists, and manage your labels.</p>
                </div>
              </div>

              <div className="bg-white/80 backdrop-blur-xs border border-blue-100/50 rounded-xl p-3.5 shadow-xs hover:shadow-sm transition-shadow">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-emerald-100 text-emerald-700 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold">3</div>
                  <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wide">Automate your inbox</h4>
                </div>
                <div className="text-[11px] text-slate-600 leading-relaxed space-y-1.5">
                  <p><strong className="text-slate-800">Action:</strong> Run <span onClick={() => scrollToAndFlash('card-smart-automations')} className="cursor-pointer hover:underline text-blue-700 font-semibold transition-colors">Smart Automations</span> from the Overview tools.</p>
                  <p><strong className="text-slate-800">Result:</strong> Automatically group recurring senders, optimize folders, and create rules in a few clicks.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-5">
        <div className="flex items-center gap-3 sm:gap-5">
          
          <div>
            <h2 className="text-lg sm:text-xl font-semibold text-slate-900 mb-0.5">Inbox Health & Tools</h2>
            <p className="text-slate-500 text-xs sm:text-sm font-medium">
              Automated insights to help organize your inbox and free up space.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportHealthReport}
            className="flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium shadow-2xs transition-all shrink-0 hover:shadow-xs cursor-pointer"
            title="Export health data to CSV"
          >
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      <div id="storage-breakdown" className="mb-4 sm:mb-6 rounded-2xl"><StorageBreakdownBar onApplyQuery={onApplyQuery} /></div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs transition-all overflow-hidden mb-4 sm:mb-6">
          <div className="p-4 sm:p-5 border-b border-slate-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">Inbox Health Modules</h3>
                </div>
                <p className="text-xs text-slate-500 hidden sm:block">Deep-dive into specific areas of your inbox to organize and automate.</p>
              </div>
            </div>
          </div>
          
          <div className="p-4 sm:p-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <HealthCard 
                id="card-category-breakdown"
                title="Category Breakdown"
                count="Analyze"
                desc="Visualize what takes up the most space and volume in your inbox."
                actionText="View Breakdown"
                onAction={() => { window.location.hash = '#category-distribution'; }}
              />
              <HealthCard 
                id="card-smart-automations"
                title="Smart Automations"
                count="Automate"
                desc="Batch organize recurring senders, optimize folders, and create rules."
                actionText="Open Automations"
                onAction={() => { window.location.hash = '#smart-automations'; }}
              />
              <HealthCard 
                id="card-manage-inbox"
                title="Manage Inbox"
                count="Manage"
                desc="Manage your newsletters, subscriptions, custom labels, and folders."
                actionText="Open Manager"
                onAction={() => { window.location.hash = '#manage-inbox'; }}
              />
              <HealthCard 
                title="Inbox Score"
                count={stats?.unread}
                desc="See how healthy your inbox is based on unread counts and clutter."
                actionText="Check Score"
                onAction={() => { window.location.hash = '#health-score'; }}
              />
            </div>
          </div>
      </div>




      
      {/* Compact Sender Analytics Card */}
      {topSenders.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs transition-all overflow-hidden mb-4 sm:mb-6">
          <div className="p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
            <div className="flex items-start sm:items-center gap-3">
              <div className="p-2.5 bg-blue-50 text-blue-600 rounded-xl">
                <Target className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm sm:text-base font-bold text-slate-900">Sender Analytics</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  You have <span className="font-semibold text-slate-700">{topSenders.length} frequent senders</span> and <span className="font-semibold text-slate-700">{topDomains.length} domain clusters</span>.
                </p>
              </div>
            </div>
            
            <button
              onClick={() => setIsSenderAnalyticsOpen(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-semibold transition-colors shrink-0 cursor-pointer w-full sm:w-auto justify-center"
            >
              <span>View Analytics</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Analytics Modal */}
      <SenderAnalyticsModal 
        isOpen={isSenderAnalyticsOpen}
        emails={recentEmailsState}
        onClose={() => setIsSenderAnalyticsOpen(false)}
        topSenders={topSenders}
        topDomains={topDomains}
        openFilterPage={openFilterPage}
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6 mb-4 sm:mb-6">
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden p-5 flex flex-col h-full hover:border-slate-300 transition-colors group">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl">
              <Folder className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">AI Folder Optimizer</h3>
          </div>
          <p className="text-sm text-slate-500 mb-6 flex-1">
            Automatically group recurring senders, shopping receipts, and newsletters into smart categorized folders using precision clustering.
          </p>
          <button 
            onClick={() => { window.location.hash = '#folder-optimizer'; }}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
          >
            <span>Optimize Folders</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden p-5 flex flex-col h-full hover:border-slate-300 transition-colors group">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl">
              <Filter className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Automated Sorting Rules</h3>
          </div>
          <p className="text-sm text-slate-500 mb-6 flex-1">
            Discover inbox patterns and generate permanent Gmail filter rules to route future emails instantly without manual effort.
          </p>
          <button 
            onClick={() => { window.location.hash = '#rule-suggester'; }}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
          >
            <span>Create Auto-Rules</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>
      </div>

      <UnsubscribeManager isOpen={isUnsubscribeModalOpen} onClose={() => setIsUnsubscribeModalOpen(false)} onApplyQuery={onApplyQuery} aiSettings={aiSettings} />

      <LabelManagerModal
        isOpen={isLabelManagerOpen}
        onClose={() => setIsLabelManagerOpen(false)}
        userLabels={userLabels || []}
        onLabelsUpdated={() => {
          setReloadTrigger(prev => prev + 1);
          if (onRefresh) onRefresh();
        }}
        onApplyQuery={onApplyQuery}
      />

      <HealthScoreModal
        isOpen={isHealthScoreModalOpen}
        onClose={() => setIsHealthScoreModalOpen(false)}
        onApplyQuery={onApplyQuery}
        onOpenUnsubscribe={() => {
          setIsHealthScoreModalOpen(false);
          setIsUnsubscribeModalOpen(true);
        }}
      />
    </div>
  );
}

function formatSize(bytes: number) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function HealthCard({ id, title, count, desc, actionText, onAction, sizeEstimate }: any) {
  const displayCount = typeof count === 'string' ? count : (count || 0).toLocaleString();
  return (
    <button 
      id={id}
      onClick={onAction}
      className="bg-white rounded-xl border border-slate-200 hover:border-slate-800 p-4 flex flex-col gap-2 transition-all text-left group hover:shadow-xs items-start w-full relative overflow-hidden"
    >
      <div className="flex-1 flex flex-col min-w-0 pr-2 w-full">
        <h3 className="font-bold text-slate-900 text-sm truncate flex items-center gap-2">
          {title}
        </h3>
        <p className="text-xs text-slate-500 leading-snug line-clamp-2 mt-1">{desc}</p>
      </div>
      
      <div className="flex flex-col items-start pt-2 mt-auto shrink-0 w-full">
        <div className="flex items-baseline gap-2">
           <span className="text-xl font-bold text-slate-800 tracking-tight">{displayCount}</span>
           {sizeEstimate > 0 && (
              <span className="text-[10px] font-semibold text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 text-left whitespace-nowrap">
                ~{formatSize(sizeEstimate)}
              </span>
           )}
        </div>
        <div className="flex items-center text-[11px] font-semibold text-slate-500 group-hover:text-slate-900 transition-colors mt-2">
          {actionText}
          <ArrowRight className="w-3.5 h-3.5 sm:group-hover:translate-x-1 transition-transform ml-1" />
        </div>
      </div>
    </button>
  );
}

function PipelineLayer({ step, title, modelName, icon, description, count, actionText, onAction }: any) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col md:flex-row gap-4 items-start md:items-center shadow-sm hover:shadow-md transition-all relative overflow-hidden group">
      <div className="absolute left-0 top-0 bottom-0 w-1 bg-slate-200 group-hover:bg-slate-1000 transition-colors"></div>
      
      <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 shrink-0">
        {icon}
      </div>
      
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-[10px] font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded-full uppercase tracking-wider">{step}</span>
          <h4 className="font-bold text-slate-900 text-base">{title}</h4>
          <span className="hidden sm:inline-block text-xs font-mono text-slate-400 bg-slate-50 px-1.5 py-0.5 rounded ml-1 border border-slate-100">powered by {modelName}</span>
        </div>
        <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">{description}</p>
      </div>
      
      <div className="flex flex-col items-start md:items-end shrink-0 w-full md:w-auto mt-4 md:mt-0 gap-3">
         <div className="text-sm font-medium text-slate-500 bg-slate-50 px-3 py-1 rounded-full border border-slate-100">
           ~{(count || 0).toLocaleString()} Processed
         </div>
         <button 
            onClick={onAction}
            className="text-sm font-medium text-slate-800 hover:text-slate-950 flex items-center gap-1 group-hover:underline"
          >
            {actionText}
            <ArrowRight className="w-4 h-4" />
         </button>
      </div>
    </div>
  );
}
