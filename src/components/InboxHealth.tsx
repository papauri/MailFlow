import React, { useState, useEffect } from 'react';
import { countEmails, searchEmails, estimateQuerySize } from '../lib/gmail';
import { Loader2, HardDrive, Trash2, MailOpen, ShieldAlert, SlidersHorizontal, ArrowRight, Target, Filter, ShieldCheck, PieChart, Tag, AlertCircle, User, Clock, Bell, Layers, Download, Calculator, Activity, Sparkles, Folder, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '../lib/utils';
import { WalkthroughTip } from "./WalkthroughTip";
import { CategoryDistributionModal } from './CategoryDistributionModal';
import { UnsubscribeManager } from "./UnsubscribeManager";
import { LabelManagerModal } from "./LabelManagerModal";
import { FolderOptimizer } from "./FolderOptimizer";
import { RuleSuggester } from './RuleSuggester';
import { SmartTriageModal } from './SmartTriageModal';
import { HealthScoreModal } from './HealthScoreModal';
import { StorageBreakdownBar } from './StorageBreakdownBar';
import { extractSenderDetails, extractRootDomain, GENERIC_FREEMAIL_DOMAINS, computeInboxHealthScore } from '../lib/emailUtils';

export function InboxHealth({ userEmail, onApplyQuery, aiSettings, userLabels, onRefresh, isAiWorking }: { userEmail?: string, onApplyQuery: (q: string, filter?: string, sortOption?: "date" | "size" | "sender") => void, aiSettings?: any, userLabels?: any[], onRefresh?: () => void, isAiWorking?: boolean }) {
  const [stats, setStats] = useState<any>(null);
  const [sizes, setSizes] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);
  const [isUnsubscribeModalOpen, setIsUnsubscribeModalOpen] = useState(false);
  const [isLabelManagerOpen, setIsLabelManagerOpen] = useState(false);
  const [isSmartTriageOpen, setIsSmartTriageOpen] = useState(false);
  const [isHealthScoreModalOpen, setIsHealthScoreModalOpen] = useState(false);
  const [topSenders, setTopSenders] = useState<any[]>([]);
  const [topDomains, setTopDomains] = useState<any[]>([]);
  const [recentEmailsState, setRecentEmailsState] = useState<any[]>([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(true);
  const [reloadTrigger, setReloadTrigger] = useState(0);

  const [showOverview, setShowOverview] = useState(true);
  const [showQuickFilters, setShowQuickFilters] = useState(true);
  const [showAnalytics, setShowAnalytics] = useState(true);

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
    return (
      <div className="p-16 flex flex-col items-center justify-center text-slate-500 gap-4 mt-8">
        <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
        <h2 className="text-xl font-semibold text-slate-800">Analyzing Inbox Health</h2>
        <p className="text-sm">Scanning folders, calculating sizes, and running email distribution analysis...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <WalkthroughTip 
        storageKey="tip_health" 
        title="Inbox Health & Cleaners" 
        description="Check out Category Breakdown and top sender clusters to quickly identify large volumes of messages. You can archive, delete, or create filters with one click."
      />

      <div className="bg-gradient-to-br from-slate-50 to-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-5">
        <div className="flex items-center gap-3 sm:gap-5">
          <div className="p-2.5 sm:p-3.5 bg-white border border-slate-100 text-slate-700 rounded-xl shadow-2xs shrink-0">
            <SlidersHorizontal className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 mb-0.5">Inbox Health & Tools</h2>
            <p className="text-slate-500 text-xs sm:text-sm font-medium">
              Automated insights to help organize your inbox and free up space.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportHealthReport}
            className="flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold shadow-2xs transition-all shrink-0 hover:shadow-xs"
            title="Export health data to CSV"
          >
            <Download className="w-4 h-4 text-slate-400" />
            <span>Export CSV</span>
          </button>
          
          <button
            onClick={() => setIsChartModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold shadow-2xs transition-all shrink-0 hover:shadow-xs"
            title="View email distribution by category"
          >
            <PieChart className="w-4 h-4 text-slate-300" />
            <span>Category Breakdown</span>
          </button>
        </div>
      </div>

      <StorageBreakdownBar onApplyQuery={onApplyQuery} className="mb-4 sm:mb-6" />

      <div className="flex flex-col gap-3 mt-2">
        <button 
          onClick={() => setShowOverview(!showOverview)}
          className="flex items-center gap-2 text-slate-800 font-bold hover:text-slate-600 transition-colors w-full text-left"
        >
          <Activity className="w-5 h-5 text-indigo-500" />
          <span className="text-lg">Inbox Overview</span>
          {showOverview ? <ChevronUp className="w-4 h-4 ml-auto text-slate-400" /> : <ChevronDown className="w-4 h-4 ml-auto text-slate-400" />}
        </button>
        {showOverview && (
          <div className="flex flex-col sm:grid sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
        <HealthCard 
          icon={<HardDrive className="w-5 h-5 sm:w-6 sm:h-6 text-orange-600" />}
          iconBg="bg-orange-50"
          title="Storage Hogs"
          count={stats?.large}
          sizeEstimate={sizes?.large}
          desc="Emails larger than 5MB taking up valuable Google Drive space."
          actionText="Review Large Emails"
          onAction={() => onApplyQuery("larger:5M", "anywhere", "size")}
        />
        <HealthCard 
          icon={<Trash2 className="w-5 h-5 sm:w-6 sm:h-6 text-slate-700" />}
          iconBg="bg-slate-100"
          title="Stale Promotions"
          count={stats?.oldPromo}
          sizeEstimate={sizes?.oldPromo}
          desc="Marketing emails and newsletters older than 6 months."
          actionText="Clean Up Promotions"
          onAction={() => onApplyQuery("older_than:6m -in:trash", "category:promotions")}
        />
        <HealthCard 
          icon={<ShieldAlert className="w-5 h-5 sm:w-6 sm:h-6 text-red-600" />}
          iconBg="bg-red-50"
          title="Spam & Trash"
          count={stats?.spamAndTrash}
          sizeEstimate={sizes?.spamAndTrash}
          desc="Junk accumulating in your Spam and Trash folders."
          actionText="Review Junk"
          onAction={() => onApplyQuery("", "spam+trash")}
        />
        <HealthCard 
          icon={<ShieldCheck className="w-5 h-5 sm:w-6 sm:h-6 text-slate-700" />}
          iconBg="bg-slate-100"
          title="Subscriptions"
          count="Manage"
          desc="Manage newsletters & promo senders in bulk."
          actionText="Open Manager"
          onAction={() => setIsUnsubscribeModalOpen(true)}
        />
        <HealthCard 
          icon={<MailOpen className="w-5 h-5 sm:w-6 sm:h-6 text-indigo-600" />}
          iconBg="bg-indigo-50"
          title="Inbox Overload"
          count={stats?.unread}
          desc="Unread emails sitting around demanding your attention."
          actionText="Triage Unread"
          onAction={() => onApplyQuery("is:unread", "inbox")}
        />
        <HealthCard 
          icon={<Folder className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" />}
          iconBg="bg-blue-50"
          title="Folders & Labels"
          count="Manage"
          desc="Create, rename, delete custom labels, and organize emails into folders."
          actionText="Manage Folders"
          onAction={() => setIsLabelManagerOpen(true)}
        />
        <HealthCard 
          icon={<Layers className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600" />}
          iconBg="bg-purple-50"
          title="Batch Organizer"
          count="Group"
          desc="Cluster recurring senders and organize inbox in bulk."
          actionText="Run Organizer"
          onAction={() => setIsSmartTriageOpen(true)}
        />
      </div>
        )}
      </div>

      {isSmartTriageOpen && (
        <SmartTriageModal
          isOpen={isSmartTriageOpen}
          onClose={() => {
             setIsSmartTriageOpen(false);
             if (onRefresh) onRefresh();
          }}
          aiSettings={aiSettings}
          userLabels={userLabels}
          userEmail={userEmail}
          onRefresh={onRefresh}
          onSearchQuery={(q) => onApplyQuery(q)}
        />
      )}

      
      
      <div className="mt-2 sm:mt-4 flex flex-col gap-3">
        <button 
          onClick={() => setShowQuickFilters(!showQuickFilters)}
          className="flex items-center gap-2 text-slate-800 font-bold hover:text-slate-600 transition-colors w-full text-left"
        >
          <Filter className="w-5 h-5 text-indigo-500" />
          <span className="text-lg">Quick Filters</span>
          {showQuickFilters ? <ChevronUp className="w-4 h-4 ml-auto text-slate-400" /> : <ChevronDown className="w-4 h-4 ml-auto text-slate-400" />}
        </button>
        {showQuickFilters && (
        <div className="flex flex-wrap gap-2 pt-1 pb-1">
          <button 
            onClick={() => onApplyQuery("is:unread is:important -category:promotions -in:trash", "anywhere")}
            className="flex items-center gap-1.5 sm:gap-2 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-700 hover:text-slate-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shadow-sm shrink-0 whitespace-nowrap"
          >
            <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-amber-500" />
            <span>Important Unread</span>
            <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] sm:text-xs ml-1 shrink-0">{stats?.importantUnread || 0}</span>
          </button>
          
          <button 
            onClick={() => onApplyQuery("category:updates OR category:social -in:trash", "anywhere", "size")}
            className="flex items-center gap-1.5 sm:gap-2 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-700 hover:text-slate-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shadow-sm shrink-0 whitespace-nowrap"
          >
            <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-indigo-500" />
            <span>Updates & Social</span>
            <div className="flex items-center gap-1 ml-1 shrink-0">
              <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] sm:text-xs">{stats?.updatesAndSocial || 0}</span>
              {sizes?.updatesAndSocial > 0 && <span className="text-[10px] bg-slate-200/60 px-1.5 rounded-full text-slate-500 py-0.5">~{formatSize(sizes.updatesAndSocial)}</span>}
            </div>
          </button>
          
          <button 
            onClick={() => onApplyQuery("has:attachment -in:trash", "anywhere", "size")}
            className="flex items-center gap-1.5 sm:gap-2 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-700 hover:text-slate-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shadow-sm shrink-0 whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-slate-500" />
            <span>With Attachments</span>
            <div className="flex items-center gap-1 ml-1 shrink-0">
              <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] sm:text-xs">{stats?.withAttachments || 0}</span>
              {sizes?.withAttachments > 0 && <span className="text-[10px] bg-slate-200/60 px-1.5 rounded-full text-slate-500 py-0.5">~{formatSize(sizes.withAttachments)}</span>}
            </div>
          </button>

          <button 
            onClick={() => onApplyQuery("older_than:1y -in:trash", "anywhere", "size")}
            className="flex items-center gap-1.5 sm:gap-2 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-700 hover:text-slate-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shadow-sm shrink-0 whitespace-nowrap"
          >
            <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-slate-400" />
            <span>Older Than 1 Year</span>
            <div className="flex items-center gap-1 ml-1 shrink-0">
              <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] sm:text-xs">{stats?.oldMail || 0}</span>
              {sizes?.oldMail > 0 && <span className="text-[10px] bg-slate-200/60 px-1.5 rounded-full text-slate-500 py-0.5">~{formatSize(sizes.oldMail)}</span>}
            </div>
          </button>
        </div>
        )}
      </div>


      
      {/* Local Aggregations */}
      {topSenders.length > 0 && (
        <div className="mt-6 sm:mt-8 flex flex-col gap-3">
          <button 
            onClick={() => setShowAnalytics(!showAnalytics)}
            className="flex items-center gap-2 text-slate-800 font-bold hover:text-slate-600 transition-colors w-full text-left"
          >
            <PieChart className="w-5 h-5 text-indigo-500" />
            <span className="text-lg">Sender Analytics</span>
            {showAnalytics ? <ChevronUp className="w-4 h-4 ml-auto text-slate-400" /> : <ChevronDown className="w-4 h-4 ml-auto text-slate-400" />}
          </button>
          
          {showAnalytics && (
            <div className="flex flex-col gap-6 sm:grid sm:grid-cols-2 mt-2">
              {/* Top Senders */}
          <div className="flex flex-col gap-3 sm:gap-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-slate-200 rounded-lg shrink-0">
                <Target className="w-4 h-4 text-slate-700" />
              </div>
              <div className="flex flex-col">
                  <h3 className="text-base sm:text-lg font-bold text-slate-800">Top Senders</h3>
                  <p className="text-[11px] sm:text-xs text-slate-500">Most frequent contacts in recent history</p>
                </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              {topSenders.map((sender, i) => {
                const maxCount = Math.max(...topSenders.map(s => s.count), 1);
                const percent = Math.round((sender.count / maxCount) * 100);
                return (
                <div key={i} className="flex flex-col justify-center p-2.5 sm:p-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between mb-1.5 sm:mb-2 gap-2">
                    <div className="flex-1 min-w-0 pr-1 sm:pr-3">
                      <p className="font-semibold text-slate-800 text-xs sm:text-sm truncate">{sender.name}</p>
                      <p className="text-[11px] sm:text-xs text-slate-500 truncate">{sender.email}</p>
                    </div>
                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                      <span className="text-xs sm:text-sm font-bold text-slate-700 bg-slate-100 px-1.5 sm:px-2 py-0.5 rounded-full">{sender.count}</span>
                      <button 
                        onClick={() => onApplyQuery(`from:${sender.email}`, "anywhere")}
                        className="p-1 sm:p-1.5 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200"
                        title="Filter by sender"
                      >
                        <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1">
                    <div className="bg-slate-800 h-1.5 rounded-full" style={{ width: `${percent}%` }}></div>
                  </div>
                </div>
              )
              })}
            </div>
          </div>

          {/* Top Domains */}
          <div className="flex flex-col gap-3 sm:gap-4">
            <div className="flex items-center gap-2">
              <div className="p-1.5 bg-slate-200 rounded-lg shrink-0">
                <Layers className="w-4 h-4 text-slate-700" />
              </div>
              <div className="flex flex-col">
                  <h3 className="text-base sm:text-lg font-bold text-slate-800">Domain Clusters</h3>
                  <p className="text-[11px] sm:text-xs text-slate-500">Companies emailing you the most</p>
                </div>
            </div>
            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
              {topDomains.map((domainObj, i) => {
                const maxDomainCount = Math.max(...topDomains.map(d => d.count), 1);
                const percent = Math.round((domainObj.count / maxDomainCount) * 100);
                return (
                <div key={i} className="flex flex-col justify-center p-2.5 sm:p-3 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                  <div className="flex items-center justify-between mb-1.5 sm:mb-2 gap-2">
                    <div className="flex-1 min-w-0 pr-1 sm:pr-3 flex items-center gap-2 sm:gap-3">
                      <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-xs sm:text-sm font-bold text-slate-600 uppercase shadow-sm shrink-0">
                        {domainObj.domain.charAt(0)}
                      </div>
                      <p className="font-semibold text-slate-800 text-xs sm:text-sm truncate">@{domainObj.domain}</p>
                    </div>
                    <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                      <span className="text-xs sm:text-sm font-bold text-slate-700 bg-slate-100 px-1.5 sm:px-2 py-0.5 rounded-full">{domainObj.count}</span>
                      <button 
                        onClick={() => onApplyQuery(`from:${domainObj.domain}`, "anywhere")}
                        className="p-1 sm:p-1.5 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200"
                        title="Filter by domain"
                      >
                        <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1">
                    <div className="bg-slate-700 h-1.5 rounded-full" style={{ width: `${percent}%` }}></div>
                  </div>
                </div>
              )
              })}
            </div>
          </div>
            </div>
          )}
        </div>
      )}

      <FolderOptimizer 
        emails={recentEmailsState} 
        userLabels={userLabels || []}
        aiSettings={aiSettings}
        isFetching={isLoadingEmails}
        isAiWorking={isAiWorking}
        onReload={() => setReloadTrigger(prev => prev + 1)}
      />

      <RuleSuggester 
        userLabels={userLabels || []} 
        recentEmails={recentEmailsState}
        onApplyQuery={onApplyQuery}
        aiSettings={aiSettings}
        isAiWorking={isAiWorking}
      />

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

      <CategoryDistributionModal
        isOpen={isChartModalOpen}
        onClose={() => setIsChartModalOpen(false)}
        onApplyCategory={onApplyQuery}
        userLabels={userLabels || []}
        aiSettings={aiSettings}
        userEmail={userEmail}
        onRefresh={() => {
          setReloadTrigger(prev => prev + 1);
          if (onRefresh) onRefresh();
        }}
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

function HealthCard({ icon, iconBg = "bg-slate-100", title, count, desc, actionText, onAction, sizeEstimate }: any) {
  const displayCount = typeof count === 'string' ? count : (count || 0).toLocaleString();
  return (
    <button 
      onClick={onAction}
      className="bg-white rounded-2xl border border-slate-200 hover:border-slate-300 p-4 sm:p-5 flex flex-row sm:flex-col gap-3.5 sm:gap-4 shadow-sm transition-all text-left group hover:shadow-md hover:-translate-y-0.5 items-center sm:items-start relative overflow-hidden"
    >
      <div className={cn("p-2.5 sm:p-3 rounded-xl shadow-2xs shrink-0 flex items-center justify-center border border-slate-100/80", iconBg)}>
        {icon}
      </div>
      
      <div className="flex-1 flex flex-col sm:block min-w-0 pr-2 sm:pr-0">
        <h3 className="font-bold text-slate-900 text-sm sm:text-base sm:mb-1 truncate flex items-center gap-2">
          {title}
        </h3>
        <p className="text-xs text-slate-500 leading-snug hidden sm:block line-clamp-2">{desc}</p>
        <p className="text-[11px] text-slate-500 truncate sm:hidden">{actionText}</p>
      </div>
      
      <div className="flex flex-col items-end sm:flex-row sm:items-center sm:justify-between sm:pt-3 sm:mt-auto shrink-0 sm:border-t sm:border-slate-100/80 sm:w-full border-t-0">
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
           <span className="text-lg sm:text-2xl font-bold text-slate-800 tracking-tight">{displayCount}</span>
           {sizeEstimate > 0 && (
              <span className="text-[10px] sm:text-xs font-semibold text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 mt-1 sm:mt-0 text-right sm:text-left whitespace-nowrap">
                ~{formatSize(sizeEstimate)}
              </span>
           )}
        </div>
        <div className="hidden sm:flex items-center text-xs font-semibold text-slate-700 group-hover:text-slate-950 transition-colors">
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
            className="text-sm font-bold text-slate-800 hover:text-slate-950 flex items-center gap-1 group-hover:underline"
          >
            {actionText}
            <ArrowRight className="w-4 h-4" />
         </button>
      </div>
    </div>
  );
}
