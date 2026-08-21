import React, { useState, useEffect } from 'react';
import { countEmails, searchEmails } from '../lib/gmail';
import { Loader2, HardDrive, Trash2, MailOpen, ShieldAlert, Sparkles, ArrowRight, Bot, Target, Filter, ShieldCheck, Network, FileSearch, BrainCircuit, PieChart } from 'lucide-react';
import { cn } from '../lib/utils';
import { CategoryDistributionModal } from './CategoryDistributionModal';

export function InboxHealth({ onApplyQuery, aiSettings }: { onApplyQuery: (q: string, filter?: string) => void, aiSettings?: any }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isChartModalOpen, setIsChartModalOpen] = useState(false);
  const [clusters, setClusters] = useState<any[]>([]);
  const [topSenders, setTopSenders] = useState<any[]>([]);
  const [topDomains, setTopDomains] = useState<any[]>([]);
  const [loadingClusters, setLoadingClusters] = useState(true);
  const [patternError, setPatternError] = useState<string|null>(null);

  useEffect(() => {
    async function fetchStats() {
      setLoading(true);
      try {
        const [unread, oldPromo, large, spamAndTrash, gatekeeper, trust, content, learner] = await Promise.all([
          countEmails("is:unread in:inbox"),
          countEmails("category:promotions older_than:6m"),
          countEmails("larger:5M -in:trash"),
          countEmails("in:spam OR in:trash"),
          countEmails("category:promotions OR in:spam"), // Gatekeeper
          countEmails("is:important -category:promotions -in:trash"), // Trust
          countEmails("has:attachment -in:trash"), // Content
          countEmails("(is:starred OR label:personal) -in:trash") // Learner
        ]);
        setStats({ unread, oldPromo, large, spamAndTrash, gatekeeper, trust, content, learner });
      } catch (e) {
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    
    async function fetchClusters() {
      setLoadingClusters(true);
      setPatternError(null);
      try {
        const recentEmails = await searchEmails("in:anywhere", 250);
        
        // Local Aggregation
        const senderCounts = new Map();
        const domainCounts = new Map();
        
        recentEmails.forEach(e => {
          let email = e.sender;
          const match = e.sender.match(/<([^>]+)>/);
          if (match) email = match[1];
          email = email.toLowerCase().trim();
          
          const domain = email.includes('@') ? email.split('@')[1] : 'unknown';
          
          if (!senderCounts.has(email)) senderCounts.set(email, { email, name: e.sender.replace(/<[^>]+>/, '').trim() || email, count: 0 });
          senderCounts.get(email).count++;
          
          if (!domainCounts.has(domain)) domainCounts.set(domain, { domain, count: 0 });
          domainCounts.get(domain).count++;
        });
        
        const rawSenders = Array.from(senderCounts.values())
          .filter(s => s.email.includes('@')) // Only keep valid email addresses
          .sort((a, b) => b.count - a.count).slice(0, 8);
        const exactSenders = await Promise.all(rawSenders.map(async (s) => {
           const exactCount = await countEmails(`from:(${s.email}) -in:trash`);
           return { ...s, count: typeof exactCount === 'number' ? exactCount : s.count };
        }));
        setTopSenders(exactSenders.filter(s => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 6));

        const rawDomains = Array.from(domainCounts.values())
          .filter(d => d.domain !== 'unknown')
          .sort((a, b) => b.count - a.count).slice(0, 8);
        const exactDomains = await Promise.all(rawDomains.map(async (d) => {
           const exactCount = await countEmails(`from:(${d.domain}) -in:trash`);
           return { ...d, count: typeof exactCount === 'number' ? exactCount : d.count };
        }));
        setTopDomains(exactDomains.filter(d => d.count > 0).sort((a, b) => b.count - a.count).slice(0, 6));

        const res = await fetch('/api/analyze-inbox', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ emails: recentEmails.map(e => ({ id: e.id, sender: e.sender, subject: e.subject })), settings: aiSettings })
        });
        
        if (res.status === 429) {
          throw new Error("AI API rate limit reached. Please try again later or add your own key in Settings.");
        }
        if (res.status === 503) {
          throw new Error("The AI model is currently experiencing high demand. Please try again later, or try a different model in Settings.");
        }
        
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to analyze inbox");
        setClusters(data.clusters || []);
      } catch (err: any) {
        console.error("Pattern analysis error:", err);
        setPatternError(err.message || "Failed to analyze");
      } finally {
        setLoadingClusters(false);
      }
    }
    
    fetchStats();
    fetchClusters();
  }, []);

  if (loading) {
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

        <button
          onClick={() => setIsChartModalOpen(true)}
          className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold shadow-sm transition-all shrink-0 hover:shadow"
          title="View email distribution by category"
        >
          <PieChart className="w-4 h-4 text-indigo-300" />
          <span>Category Breakdown</span>
        </button>
      </div>

      <div className="flex flex-col sm:grid sm:grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4">
        <HealthCard 
          icon={<HardDrive className="w-6 h-6 text-orange-500" />}
          title="Storage Hogs"
          count={stats?.large}
          desc="Emails larger than 5MB taking up valuable Google Drive space."
          color="border-orange-200 bg-orange-50/50 hover:bg-orange-50"
          actionText="Review Large Emails"
          onAction={() => onApplyQuery("larger:5M", "anywhere")}
        />
        <HealthCard 
          icon={<Trash2 className="w-6 h-6 text-purple-500" />}
          title="Stale Promotions"
          count={stats?.oldPromo}
          desc="Marketing emails and newsletters older than 6 months."
          color="border-slate-300 bg-slate-100/50 hover:bg-slate-100"
          actionText="Clean Up Promotions"
          onAction={() => onApplyQuery("older_than:6m", "category:promotions")}
        />
        <HealthCard 
          icon={<ShieldAlert className="w-6 h-6 text-red-500" />}
          title="Spam & Trash"
          count={stats?.spamAndTrash}
          desc="Junk accumulating in your Spam and Trash folders."
          color="border-slate-200 bg-slate-100/50 hover:bg-slate-100"
          actionText="Review Junk"
          onAction={() => onApplyQuery("in:spam OR in:trash", "anywhere")}
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
      </div>

      
      
      <div className="mt-2 sm:mt-4">
        <div className="flex items-center gap-2 mb-2 sm:mb-3">
          <Filter className="w-4 h-4 sm:w-5 sm:h-5 text-slate-800" />
          <h3 className="text-base sm:text-lg font-bold text-slate-800">Quick Filters</h3>
        </div>
        <div className="flex flex-nowrap sm:flex-wrap gap-2 overflow-x-auto no-scrollbar pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          <button 
            onClick={() => onApplyQuery("category:promotions OR in:spam", "anywhere")}
            className="flex items-center gap-1.5 sm:gap-2 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-700 hover:text-slate-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shadow-sm shrink-0 whitespace-nowrap"
          >
            <ShieldCheck className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span>Newsletters & Spam</span>
            <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] sm:text-xs ml-1 shrink-0">{stats?.gatekeeper || 0}</span>
          </button>
          
          <button 
            onClick={() => onApplyQuery("is:important -category:promotions", "anywhere")}
            className="flex items-center gap-1.5 sm:gap-2 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-700 hover:text-slate-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shadow-sm shrink-0 whitespace-nowrap"
          >
            <Network className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span>Important & Trusted</span>
            <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] sm:text-xs ml-1 shrink-0">{stats?.trust || 0}</span>
          </button>

          <button 
            onClick={() => onApplyQuery("has:attachment", "anywhere")}
            className="flex items-center gap-1.5 sm:gap-2 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-700 hover:text-slate-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shadow-sm shrink-0 whitespace-nowrap"
          >
            <FileSearch className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span>With Attachments</span>
            <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] sm:text-xs ml-1 shrink-0">{stats?.content || 0}</span>
          </button>

          <button 
            onClick={() => onApplyQuery("is:starred OR label:personal", "anywhere")}
            className="flex items-center gap-1.5 sm:gap-2 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-100 text-slate-700 hover:text-slate-700 px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs sm:text-sm font-medium transition-all shadow-sm shrink-0 whitespace-nowrap"
          >
            <Sparkles className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />
            <span>Starred & Personal</span>
            <span className="bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded text-[10px] sm:text-xs ml-1 shrink-0">{stats?.learner || 0}</span>
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

      <div className="mt-6 sm:mt-8 flex flex-col gap-3 sm:gap-4">
        <div className="flex items-center gap-2">
          <Bot className="w-5 h-5 sm:w-6 sm:h-6 text-slate-800 shrink-0" />
          <h3 className="text-lg sm:text-xl font-bold text-slate-800">Recurring Inbox Patterns</h3>
        </div>
        <p className="text-xs sm:text-sm text-slate-600 mb-1 sm:mb-2">Our system autonomously learns from your inbox data to identify hidden habits, common themes, and bulk-cleanup opportunities.</p>
        
        {loadingClusters ? (
          <div className="flex items-center gap-3 text-slate-500 p-4 sm:p-6 bg-slate-100/50 rounded-xl border border-slate-200">
            <Loader2 className="w-5 h-5 animate-spin text-slate-800 shrink-0" />
            <span className="text-xs sm:text-sm font-medium">Analyzing your recent messages for patterns...</span>
          </div>
        ) : patternError ? (
          <div className="p-3.5 sm:p-4 bg-slate-100 text-slate-700 rounded-xl text-xs sm:text-sm border border-slate-200">
            {patternError}
          </div>
        ) : clusters.length === 0 ? (
          <div className="p-3.5 sm:p-4 bg-slate-50 text-slate-600 rounded-xl text-xs sm:text-sm border border-slate-200">
            Your recent inbox looks very clean. No significant clutter clusters found!
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
            {clusters.map((cluster, i) => (
              <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 flex flex-col gap-3 sm:gap-4 shadow-sm hover:shadow-md transition-shadow h-full">
                <div className="flex items-start justify-between gap-3 sm:gap-4">
                  <div className="flex-1 min-w-0">
                    <h4 className="font-bold text-slate-900 text-base sm:text-lg">{cluster.title}</h4>
                    <p className="text-xs sm:text-sm text-slate-500 mt-1 leading-snug">{cluster.description}</p>
                  </div>
                  <div className="bg-slate-100 text-slate-700 px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full text-xs font-bold whitespace-nowrap shrink-0">
                    ~{cluster.estimatedCount} found
                  </div>
                </div>
                
                <div className="bg-slate-50 rounded-lg p-2.5 sm:p-3 text-xs text-slate-600 border border-slate-100 italic">
                  <span className="font-semibold text-slate-700 not-italic block mb-1">Pattern Detected:</span>
                  {cluster.patternDetected}
                </div>
                
                <button
                  onClick={() => onApplyQuery(cluster.searchQuery, "anywhere")}
                  className="mt-auto w-full py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs sm:text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  <Target className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  Find & {cluster.suggestedAction}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <CategoryDistributionModal
        isOpen={isChartModalOpen}
        onClose={() => setIsChartModalOpen(false)}
        onApplyCategory={onApplyQuery}
      />
    </div>
  );
}

function HealthCard({ icon, title, count, desc, color, actionText, onAction }: any) {
  const displayCount = typeof count === 'string' ? count : (count || 0).toLocaleString();
  return (
    <button 
      onClick={onAction}
      className={cn("rounded-xl sm:rounded-2xl border p-3 sm:p-6 flex flex-row sm:flex-col gap-3 sm:gap-4 shadow-sm transition-all text-left group hover:shadow-md hover:scale-[1.02] items-center sm:items-start", color)}
    >
      <div className="p-2 sm:p-3 bg-white/80 sm:bg-white rounded-lg sm:rounded-xl shadow-sm shrink-0 flex items-center justify-center">
        {icon}
      </div>
      
      <div className="flex-1 flex flex-col sm:block min-w-0">
        <h3 className="font-bold text-slate-900 text-[15px] sm:text-lg sm:mb-1 truncate">{title}</h3>
        <p className="text-xs sm:text-sm text-slate-600 leading-snug hidden sm:block">{desc}</p>
        <p className="text-[11px] text-slate-500 truncate sm:hidden">{actionText}</p>
      </div>
      
      <div className="flex flex-col items-end sm:w-full sm:flex-row sm:items-center sm:justify-between sm:pt-4 sm:mt-auto shrink-0">
        <span className="text-lg sm:text-3xl font-bold text-slate-800 tracking-tight">{displayCount}</span>
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
