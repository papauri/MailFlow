import React, { useState, useEffect } from 'react';
import { countEmails, searchEmails, estimateQuerySize } from '../lib/gmail';
import { Loader2, HardDrive, Trash2, MailOpen, ShieldAlert, Sparkles, ArrowRight, Bot, Target, Filter, ShieldCheck, Network, FileSearch, BrainCircuit, PieChart, Tag, AlertCircle, User, Clock, Bell, Layers, Download } from 'lucide-react';
import { cn } from '../lib/utils';
import { WalkthroughTip } from "./WalkthroughTip";
import { CategoryDistributionModal } from './CategoryDistributionModal';
import { UnsubscribeManager } from "./UnsubscribeManager";
import { LabelManagerModal } from "./LabelManagerModal";
import { FolderOptimizer } from "./FolderOptimizer";
import { RuleSuggester } from './RuleSuggester';
import { SmartTriageModal } from './SmartTriageModal';

const GENERIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.ca',
  'ymail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'outlook.com',
  'live.com',
  'msn.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'protonmail.com',
  'proton.me',
  'zoho.com',
  'yandex.com',
  'yandex.ru',
  'mail.com',
  'gmx.com',
  'gmx.net',
  'fastmail.com'
]);

export function InboxHealth({ userEmail, onApplyQuery, aiSettings, userLabels, onRefresh, isAiWorking }: { userEmail?: string, onApplyQuery: (q: string, filter?: string, sortOption?: "date" | "size" | "sender") => void, aiSettings?: any, userLabels?: any[], onRefresh?: () => void, isAiWorking?: boolean }) {
  const [stats, setStats] = useState<any>(null);
  const [sizes, setSizes] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);
  const [isUnsubscribeModalOpen, setIsUnsubscribeModalOpen] = useState(false);
  const [isLabelManagerOpen, setIsLabelManagerOpen] = useState(false);
  const [isSmartTriageOpen, setIsSmartTriageOpen] = useState(false);
  const [topSenders, setTopSenders] = useState<any[]>([]);
  const [topDomains, setTopDomains] = useState<any[]>([]);
  const [recentEmailsState, setRecentEmailsState] = useState<any[]>([]);
  const [isLoadingEmails, setIsLoadingEmails] = useState(true);
  const [reloadTrigger, setReloadTrigger] = useState(0);

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
        const recentEmails = await searchEmails("in:anywhere -in:trash -in:spam", 250);
        setRecentEmailsState(recentEmails);
        
        // Local Aggregation
        const senderCounts = new Map();
        const domainCounts = new Map();
        
        recentEmails.forEach(e => {
          // Extract plain email address
          const emailMatch = e.sender.match(/<([^>]+)>/);
          const email = emailMatch ? emailMatch[1].toLowerCase() : e.sender.toLowerCase();
          const domain = email.includes('@') ? email.split('@')[1] : 'unknown';
          
          if (!senderCounts.has(email)) {
            senderCounts.set(email, { 
              email, 
              name: e.sender.replace(/<[^>]+>/, '').trim() || email, 
              count: 0 
            });
          }
          senderCounts.get(email).count++;
          
          // Only track organization / company / service domains for Domain Clusters (exclude generic public webmail providers and self)
          if (domain !== 'unknown' && !GENERIC_EMAIL_DOMAINS.has(domain) && domain !== userDomain) {
            if (!domainCounts.has(domain)) domainCounts.set(domain, { domain, count: 0 });
            domainCounts.get(domain).count++;
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
          .filter(d => d.domain !== 'unknown' && !GENERIC_EMAIL_DOMAINS.has(d.domain))
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
        <p className="text-sm">Scanning folders, calculating sizes, and running NLP analysis...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <WalkthroughTip 
        storageKey="tip_health" 
        title="Inbox Health & AI Optimization" 
        description="Check out the Folder Optimizer below! It uses strict statistical anomalies (or Deep AI) to find massive clusters of noise. When you clean them up, the Rule Suggester will offer to automate it for you!"
      />
      <div className="bg-gradient-to-br from-indigo-50/50 to-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-5">
        <div className="flex items-center gap-3 sm:gap-5">
          <div className="p-2.5 sm:p-3.5 bg-white border border-slate-100 text-indigo-600 rounded-xl shadow-sm shrink-0">
            <Sparkles className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div>
            <h2 className="text-lg sm:text-xl font-extrabold text-slate-900 mb-0.5">Smart Cleanup</h2>
            <p className="text-slate-500 text-xs sm:text-sm font-medium">
              Smart insights to help organize your inbox and free up space.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={exportHealthReport}
            className="flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold shadow-sm transition-all shrink-0 hover:shadow"
            title="Export health data to CSV"
          >
            <Download className="w-4 h-4 text-slate-400" />
            <span>Export CSV</span>
          </button>
          
          <button
            onClick={() => setIsChartModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold shadow-sm transition-all shrink-0 hover:shadow"
            title="View email distribution by category"
          >
            <PieChart className="w-4 h-4 text-indigo-300" />
            <span>Category Breakdown</span>
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:grid sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
        <HealthCard 
          icon={<HardDrive className="w-6 h-6 text-orange-500" />}
          title="Storage Hogs"
          count={stats?.large}
          sizeEstimate={sizes?.large}
          desc="Emails larger than 5MB taking up valuable Google Drive space."
          color="border-orange-200 bg-orange-50/50 hover:bg-orange-50"
          actionText="Review Large Emails"
          onAction={() => onApplyQuery("larger:5M", "anywhere", "size")}
        />
        <HealthCard 
          icon={<Trash2 className="w-6 h-6 text-purple-500" />}
          title="Stale Promotions"
          count={stats?.oldPromo}
          sizeEstimate={sizes?.oldPromo}
          desc="Marketing emails and newsletters older than 6 months."
          color="border-slate-300 bg-slate-100/50 hover:bg-slate-100"
          actionText="Clean Up Promotions"
          onAction={() => onApplyQuery("older_than:6m -in:trash", "category:promotions")}
        />
        <HealthCard 
          icon={<ShieldAlert className="w-6 h-6 text-red-500" />}
          title="Spam & Trash"
          count={stats?.spamAndTrash}
          sizeEstimate={sizes?.spamAndTrash}
          desc="Junk accumulating in your Spam and Trash folders."
          color="border-slate-200 bg-slate-100/50 hover:bg-slate-100"
          actionText="Review Junk"
          onAction={() => onApplyQuery("", "spam+trash")}
        />
        <HealthCard 
          icon={<ShieldCheck className="w-6 h-6 text-indigo-500" />}
          title="Subscriptions"
          count="Manage"
          desc="Manage newsletters & promos"
          color="border-indigo-200 bg-indigo-50/50 hover:bg-indigo-50"
          actionText="Open Manager"
          onAction={() => setIsUnsubscribeModalOpen(true)}
        />
        <HealthCard 
          icon={<MailOpen className="w-6 h-6 text-slate-500" />}
          title="Inbox Overload"
          count={stats?.unread}
          desc="Unread emails sitting around demanding your attention."
          color="border-slate-300 bg-slate-100/50 hover:bg-slate-100"
          actionText="Triage Unread"
          onAction={() => onApplyQuery("is:unread", "inbox")}
        />
        <HealthCard 
          icon={<Tag className="w-6 h-6 text-teal-500" />}
          title="Label Manager"
          count="Manage"
          desc="Explore and manage your custom labels"
          color="border-teal-200 bg-teal-50/50 hover:bg-teal-50"
          actionText="Open Labels"
          onAction={() => setIsLabelManagerOpen(true)}
        />
        {isAiWorking && aiSettings?.apiKey && (
          <HealthCard 
            icon={<Layers className="w-6 h-6 text-blue-500" />}
            title="Smart Organizer"
            count="Analyze"
            desc="Intelligently organize your inbox."
            color="border-blue-200 bg-blue-50/50 hover:bg-blue-50"
            actionText="Run Organizer"
            onAction={() => setIsSmartTriageOpen(true)}
          />
        )}
      </div>

      {isLabelManagerOpen && (
        <LabelManagerModal 
          isOpen={isLabelManagerOpen}
          onClose={() => setIsLabelManagerOpen(false)}
          userLabels={userLabels}
          aiSettings={aiSettings}
        />
      )}

      {isSmartTriageOpen && (
        <SmartTriageModal
          isOpen={isSmartTriageOpen}
          onClose={() => {
             setIsSmartTriageOpen(false);
             if (onRefresh) onRefresh();
          }}
          aiSettings={aiSettings}
          userLabels={userLabels}
        />
      )}

      
      
      <div className="mt-2 sm:mt-4">
        <div className="flex items-center gap-2 mb-2 sm:mb-3">
          <Filter className="w-4 h-4 sm:w-5 sm:h-5 text-slate-800" />
          <h3 className="text-base sm:text-lg font-bold text-slate-800">Quick Filters</h3>
        </div>
        <div className="flex flex-nowrap sm:flex-wrap gap-2 overflow-x-auto no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
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
            <FileSearch className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-blue-500" />
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
      </div>


      
      {/* Local Aggregations */}
      {topSenders.length > 0 && (
        <div className="mt-6 sm:mt-8 flex flex-col gap-6 sm:grid sm:grid-cols-2">
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
                <Network className="w-4 h-4 text-slate-700" />
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
                    <div className="bg-indigo-600 h-1.5 rounded-full" style={{ width: `${percent}%` }}></div>
                  </div>
                </div>
              )
              })}
            </div>
          </div>
        </div>
      )}

      <FolderOptimizer 
        emails={recentEmailsState} 
        userLabels={userLabels || []}
        aiSettings={aiSettings}
        isFetching={isLoadingEmails}
        onReload={() => setReloadTrigger(prev => prev + 1)}
      />

      <RuleSuggester userLabels={userLabels || []} />

      <UnsubscribeManager isOpen={isUnsubscribeModalOpen} onClose={() => setIsUnsubscribeModalOpen(false)} onApplyQuery={onApplyQuery} aiSettings={aiSettings} />

      <CategoryDistributionModal
        isOpen={isChartModalOpen}
        onClose={() => setIsChartModalOpen(false)}
        onApplyCategory={onApplyQuery}
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

function HealthCard({ icon, title, count, desc, color, actionText, onAction, sizeEstimate }: any) {
  const displayCount = typeof count === 'string' ? count : (count || 0).toLocaleString();
  return (
    <button 
      onClick={onAction}
      className={cn("rounded-xl sm:rounded-2xl border p-3 sm:p-6 flex flex-row sm:flex-col gap-3 sm:gap-4 shadow-sm transition-all text-left group hover:shadow-md hover:scale-[1.02] items-center sm:items-start relative overflow-hidden", color)}
    >
      <div className="p-2 sm:p-3 bg-white/80 sm:bg-white rounded-lg sm:rounded-xl shadow-sm shrink-0 flex items-center justify-center">
        {icon}
      </div>
      
      <div className="flex-1 flex flex-col sm:block min-w-0">
        <h3 className="font-bold text-slate-900 text-[15px] sm:text-lg sm:mb-1 truncate flex items-center gap-2">
          {title}
        </h3>
        <p className="text-xs sm:text-sm text-slate-600 leading-snug hidden sm:block">{desc}</p>
        <p className="text-[11px] text-slate-500 truncate sm:hidden">{actionText}</p>
      </div>
      
      <div className="flex flex-col items-end sm:w-full sm:flex-row sm:items-center sm:justify-between sm:pt-4 sm:mt-auto shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:gap-2">
           <span className="text-lg sm:text-3xl font-bold text-slate-800 tracking-tight">{displayCount}</span>
           {sizeEstimate > 0 && (
              <span className="text-[10px] sm:text-xs font-bold text-slate-500 bg-white/50 px-1.5 py-0.5 rounded border border-slate-200/50 mt-1 sm:mt-0">
                ~{formatSize(sizeEstimate)}
              </span>
           )}
        </div>
        <div className="hidden sm:flex items-center text-sm font-bold text-slate-800 group-hover:text-black">
          {actionText}
          <ArrowRight className="w-4 h-4 sm:group-hover:translate-x-1 transition-transform ml-1" />
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
            className="text-sm font-bold text-slate-800 hover:text-indigo-800 flex items-center gap-1 group-hover:underline"
          >
            {actionText}
            <ArrowRight className="w-4 h-4" />
         </button>
      </div>
    </div>
  );
}
