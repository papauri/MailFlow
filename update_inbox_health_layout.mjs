import fs from 'fs';
let content = fs.readFileSync('src/components/InboxHealth.tsx', 'utf8');

// 1. Rewrite Inbox Overview
const overviewRegex = /<div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-6 shadow-xs flex flex-col gap-4">\s*<button[\s\S]*?onClick=\{\(\) => setShowOverview\(!showOverview\)\}[\s\S]*?<\/button>\s*\{showOverview && \([\s\S]*?<div className="flex flex-col sm:grid sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">[\s\S]*?<\/div>\s*\)\}\s*<\/div>/g;

const newOverview = `<div className="bg-white border border-slate-200 rounded-2xl shadow-xs transition-all overflow-hidden mb-4 sm:mb-6">
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
                  title="Batch Organizer"
                  count="Group"
                  desc="Cluster recurring senders and organize inbox in bulk."
                  actionText="Run Organizer"
                  onAction={() => setIsSmartTriageOpen(true)}
                />
              </div>
            )}
          </div>
        </div>`;

content = content.replace(overviewRegex, newOverview);

// 2. Rewrite Quick Filters
const quickFiltersRegex = /<div className="mt-2 sm:mt-4 flex flex-col gap-3">\s*<button[\s\S]*?onClick=\{\(\) => setShowQuickFilters\(!showQuickFilters\)\}[\s\S]*?<\/button>\s*\{showQuickFilters && \(\s*<div className="flex flex-wrap gap-2 pt-1 pb-1">[\s\S]*?<\/div>\s*\)\}\s*<\/div>/g;

const newQuickFilters = `<div className="bg-white border border-slate-200 rounded-2xl shadow-xs transition-all overflow-hidden mb-4 sm:mb-6">
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
      </div>`;

content = content.replace(quickFiltersRegex, newQuickFilters);


// 3. Rewrite Sender Analytics
const analyticsRegex = /<div className="mt-6 sm:mt-8 flex flex-col gap-3">\s*<button[\s\S]*?onClick=\{\(\) => setShowAnalytics\(!showAnalytics\)\}[\s\S]*?<\/button>\s*\{showAnalytics && \([\s\S]*?<div className="flex flex-col gap-6 sm:grid sm:grid-cols-2 mt-2">[\s\S]*?<\/div>\s*\)\}\s*<\/div>/g;

const newAnalytics = `<div className="bg-white border border-slate-200 rounded-2xl shadow-xs transition-all overflow-hidden mb-4 sm:mb-6">
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
                            onClick={() => onApplyQuery(\`from:\${sender.email}\`, "anywhere")}
                            className="p-1 sm:p-1.5 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200 bg-white"
                            title="Filter by sender"
                          >
                            <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="w-full bg-slate-200/50 rounded-full h-1.5 mb-1">
                        <div className="bg-slate-800 h-1.5 rounded-full" style={{ width: \`\${percent}%\` }}></div>
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
                            onClick={() => onApplyQuery(\`from:\${domainObj.domain}\`, "anywhere")}
                            className="p-1 sm:p-1.5 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200 bg-white"
                            title="Filter by domain"
                          >
                            <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="w-full bg-slate-200/50 rounded-full h-1.5 mb-1">
                        <div className="bg-slate-700 h-1.5 rounded-full" style={{ width: \`\${percent}%\` }}></div>
                      </div>
                    </div>
                  )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>`;

content = content.replace(analyticsRegex, newAnalytics);

fs.writeFileSync('src/components/InboxHealth.tsx', content);
