import fs from 'fs';
let content = fs.readFileSync('src/components/InboxHealth.tsx', 'utf8');

const startIndex = content.indexOf('<div className="flex flex-col gap-3 mt-2">');
const endIndexStr = '<HealthCard \n          title="Batch Organizer"';
const nextDivIndex = content.indexOf('</div>', content.indexOf(endIndexStr));

if (startIndex !== -1) {
  // Find the exact end of the showOverview block
  // Just find where isSmartTriageOpen starts.
  const endBlock = content.indexOf('{isSmartTriageOpen && (');
  
  if (endBlock !== -1) {
    const sectionToReplace = content.substring(startIndex, endBlock);
    const newSection = `<div className="bg-white border border-slate-200 rounded-2xl shadow-xs transition-all overflow-hidden mb-4 sm:mb-6">
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
        </div>
      `;
    
    content = content.replace(sectionToReplace, newSection);
    fs.writeFileSync('src/components/InboxHealth.tsx', content);
    console.log("Success");
  }
}
