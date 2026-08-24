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
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-2xl p-4 sm:p-5 shadow-sm relative overflow-hidden mb-4 sm:mb-6">
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
                  <p><strong className="text-slate-800">Action:</strong> Open the <span onClick={() => scrollToAndFlash('card-subscriptions')} className="cursor-pointer hover:underline text-blue-700 font-semibold transition-colors">Subscriptions</span> manager from the Inbox Overview tools.</p>
                  <p><strong className="text-slate-800">Result:</strong> Identify who sends you the most emails and bulk-unsubscribe from lists you never read.</p>
                </div>
              </div>

              <div className="bg-white/80 backdrop-blur-xs border border-blue-100/50 rounded-xl p-3.5 shadow-xs hover:shadow-sm transition-shadow">
                <div className="flex items-center gap-2 mb-2">
                  <div className="bg-emerald-100 text-emerald-700 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold">3</div>
                  <h4 className="font-bold text-slate-800 text-xs uppercase tracking-wide">Organize the mess</h4>
                </div>
                <div className="text-[11px] text-slate-600 leading-relaxed space-y-1.5">
                  <p><strong className="text-slate-800">Action:</strong> Run the <span onClick={() => scrollToAndFlash('card-batch-organizer')} className="cursor-pointer hover:underline text-blue-700 font-semibold transition-colors">Batch Organizer</span> from the Inbox Overview tools.</p>
                  <p><strong className="text-slate-800">Result:</strong> Automatically clusters recurring senders so you can archive thousands of related emails in one click.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-br from-slate-50 to-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 sm:gap-5">
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
            className="flex items-center justify-center gap-2 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium shadow-2xs transition-all shrink-0 hover:shadow-xs"
            title="Export health data to CSV"
          >
            
            <span>Export CSV</span>
          </button>
          
          <button
            onClick={() => setIsChartModalOpen(true)}
            className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-medium shadow-2xs transition-all shrink-0 hover:shadow-xs"
            title="View email distribution by category"
          >
            
            <span>Category Breakdown</span>
          </button>
        </div>
      </div>

      <div id="storage-breakdown" className="mb-4 sm:mb-6 rounded-2xl"><StorageBreakdownBar onApplyQuery={onApplyQuery} /></div>

      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs transition-all overflow-hidden mb-4 sm:mb-6">
          <div className="p-4 sm:p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2.5">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">Inbox Overview</h3>
                </div>
                <p className="text-xs text-slate-500 hidden sm:block">Quickly access and manage other inbox categories and tools.</p>
              </div>
              <div className="flex items-center gap-2 self-end sm:self-center">
                <button
                  onClick={() => setShowOverview(!showOverview)}
                  className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <span>{showOverview ? "Collapse Details" : "View Overview"}</span>
                  {showOverview ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
            
            {showOverview && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 mt-4 pt-4 border-t border-slate-100">
                <HealthCard 
                  id="card-subscriptions"
                  title="Subscriptions"
                  count="Manage"
                  desc="Manage newsletters & promo senders in bulk."
                  actionText="Open Manager"
                  onAction={() => setIsUnsubscribeModalOpen(true)}
                />
                <HealthCard 
                  title="Inbox Overload"
                  count={stats?.unread}
                  desc="Unread emails sitting around demanding your attention."
                  actionText="Triage Unread"
                  onAction={() => onApplyQuery("is:unread", "inbox")}
                />
                <HealthCard 
                  title="Folders & Labels"
                  count="Manage"
                  desc="Create, rename, delete custom labels, and organize emails into folders."
                  actionText="Manage Folders"
                  onAction={() => setIsLabelManagerOpen(true)}
                />
                <HealthCard 
                  id="card-batch-organizer"
                  title="Batch Organizer"
                  count="Group"
                  desc="Cluster recurring senders and organize inbox in bulk."
                  actionText="Run Organizer"
                  onAction={() => setIsSmartTriageOpen(true)}
                />
              </div>
            )}
          </div>
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

      
      
      <div className="bg-white border border-slate-200 rounded-2xl shadow-xs transition-all overflow-hidden mb-4 sm:mb-6">
        <div className="p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900">Quick Filters</h3>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">One-click searches to quickly find specific emails.</p>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center">
              <button
                onClick={() => setShowQuickFilters(!showQuickFilters)}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <span>{showQuickFilters ? "Collapse Details" : "View Filters"}</span>
                {showQuickFilters ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          
          {showQuickFilters && (
            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-slate-100">
              <button 
                onClick={() => onApplyQuery("is:unread is:important -category:promotions -in:trash", "anywhere")}
                className="flex items-center gap-1.5 sm:gap-2 bg-slate-50 border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-700 hover:text-slate-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shadow-xs shrink-0 whitespace-nowrap"
              >
                <AlertCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-amber-500" />
                <span>Important Unread</span>
                <span className="bg-white border border-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] sm:text-xs ml-1 shrink-0">{stats?.importantUnread || 0}</span>
              </button>
              
              <button 
                onClick={() => onApplyQuery("category:updates OR category:social -in:trash", "anywhere", "size")}
                className="flex items-center gap-1.5 sm:gap-2 bg-slate-50 border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-700 hover:text-slate-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shadow-xs shrink-0 whitespace-nowrap"
              >
                <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-slate-500" />
                <span>Updates & Social</span>
                <div className="flex items-center gap-1 ml-1 shrink-0">
                  <span className="bg-white border border-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] sm:text-xs">{stats?.updatesAndSocial || 0}</span>
                  {sizes?.updatesAndSocial > 0 && <span className="text-[10px] bg-slate-200/60 px-1.5 rounded-full text-slate-500 py-0.5">~{formatSize(sizes.updatesAndSocial)}</span>}
                </div>
              </button>
              
              <button 
                onClick={() => onApplyQuery("has:attachment -in:trash", "anywhere", "size")}
                className="flex items-center gap-1.5 sm:gap-2 bg-slate-50 border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-700 hover:text-slate-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shadow-xs shrink-0 whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-slate-500" />
                <span>With Attachments</span>
                <div className="flex items-center gap-1 ml-1 shrink-0">
                  <span className="bg-white border border-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] sm:text-xs">{stats?.withAttachments || 0}</span>
                  {sizes?.withAttachments > 0 && <span className="text-[10px] bg-slate-200/60 px-1.5 rounded-full text-slate-500 py-0.5">~{formatSize(sizes.withAttachments)}</span>}
                </div>
              </button>
              
              <button 
                onClick={() => onApplyQuery("older_than:1y -in:trash", "anywhere", "size")}
                className="flex items-center gap-1.5 sm:gap-2 bg-slate-50 border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-700 hover:text-slate-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shadow-xs shrink-0 whitespace-nowrap"
              >
                <Clock className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0 text-slate-400" />
                <span>Older Than 1 Year</span>
                <div className="flex items-center gap-1 ml-1 shrink-0">
                  <span className="bg-white border border-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] sm:text-xs">{stats?.oldMail || 0}</span>
                  {sizes?.oldMail > 0 && <span className="text-[10px] bg-slate-200/60 px-1.5 rounded-full text-slate-500 py-0.5">~{formatSize(sizes.oldMail)}</span>}
                </div>
              </button>
            </div>
          )}
        </div>
      </div>


      
      {/* Local Aggregations */}
      {topSenders.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs transition-all overflow-hidden mb-4 sm:mb-6">
        <div className="p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2.5">
              <div className="flex items-center gap-2">
                <h3 className="text-sm sm:text-base font-bold text-slate-900">Sender Analytics</h3>
              </div>
              <p className="text-xs text-slate-500 hidden sm:block">Analyze most frequent senders and domain clusters.</p>
            </div>
            <div className="flex items-center gap-2 self-end sm:self-center">
              <button
                onClick={() => setShowAnalytics(!showAnalytics)}
                className="text-xs font-semibold text-slate-600 hover:text-slate-900 flex items-center gap-1 px-2.5 py-1 rounded-lg hover:bg-slate-100 transition-colors"
              >
                <span>{showAnalytics ? "Collapse Details" : "View Analytics"}</span>
                {showAnalytics ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>
          </div>
          
          {showAnalytics && (
            <div className="flex flex-col gap-6 sm:grid sm:grid-cols-2 mt-4 pt-4 border-t border-slate-100">
              {/* Top Senders */}
              <div className="flex flex-col gap-3 sm:gap-4">
                <div className="flex items-center gap-2">
                  <div className="p-1.5 bg-slate-100 border border-slate-200 rounded-lg shrink-0">
                    <Target className="w-4 h-4 text-slate-700" />
                  </div>
                  <div className="flex flex-col">
                    <h3 className="text-sm font-bold text-slate-800">Top Senders</h3>
                    <p className="text-[11px] text-slate-500">Most frequent contacts in recent history</p>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                  {topSenders.map((sender, i) => {
                    const maxCount = Math.max(...topSenders.map(s => s.count), 1);
                    const percent = Math.round((sender.count / maxCount) * 100);
                    return (
                    <div key={i} className="flex flex-col justify-center p-2.5 sm:p-3 border-b border-slate-200/60 last:border-0 hover:bg-white transition-colors">
                      <div className="flex items-center justify-between mb-1.5 sm:mb-2 gap-2">
                        <div className="flex-1 min-w-0 pr-1 sm:pr-3">
                          <p className="font-semibold text-slate-800 text-xs sm:text-sm truncate">{sender.name}</p>
                          <p className="text-[11px] sm:text-xs text-slate-500 truncate">{sender.email}</p>
                        </div>
                        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                          <span className="text-xs sm:text-sm font-bold text-slate-700 bg-white border border-slate-200 px-1.5 sm:px-2 py-0.5 rounded-full">{sender.count}</span>
                          <button 
                            onClick={() => onApplyQuery(`from:${sender.email}`, "anywhere")}
                            className="p-1 sm:p-1.5 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200 bg-white"
                            title="Filter by sender"
                          >
                            <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="w-full bg-slate-200/50 rounded-full h-1.5 mb-1">
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
                  <div className="p-1.5 bg-slate-100 border border-slate-200 rounded-lg shrink-0">
                    <Layers className="w-4 h-4 text-slate-700" />
                  </div>
                  <div className="flex flex-col">
                    <h3 className="text-sm font-bold text-slate-800">Domain Clusters</h3>
                    <p className="text-[11px] text-slate-500">Companies emailing you the most</p>
                  </div>
                </div>
                <div className="bg-slate-50 rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                  {topDomains.map((domainObj, i) => {
                    const maxDomainCount = Math.max(...topDomains.map(d => d.count), 1);
                    const percent = Math.round((domainObj.count / maxDomainCount) * 100);
                    return (
                    <div key={i} className="flex flex-col justify-center p-2.5 sm:p-3 border-b border-slate-200/60 last:border-0 hover:bg-white transition-colors">
                      <div className="flex items-center justify-between mb-1.5 sm:mb-2 gap-2">
                        <div className="flex-1 min-w-0 pr-1 sm:pr-3 flex items-center gap-2 sm:gap-3">
                          <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-xs sm:text-sm font-bold text-slate-600 uppercase shadow-xs shrink-0">
                            {domainObj.domain.charAt(0)}
                          </div>
                          <p className="font-semibold text-slate-800 text-xs sm:text-sm truncate">@{domainObj.domain}</p>
                        </div>
                        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                          <span className="text-xs sm:text-sm font-bold text-slate-700 bg-white border border-slate-200 px-1.5 sm:px-2 py-0.5 rounded-full">{domainObj.count}</span>
                          <button 
                            onClick={() => onApplyQuery(`from:${domainObj.domain}`, "anywhere")}
                            className="p-1 sm:p-1.5 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200 bg-white"
                            title="Filter by domain"
                          >
                            <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="w-full bg-slate-200/50 rounded-full h-1.5 mb-1">
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
