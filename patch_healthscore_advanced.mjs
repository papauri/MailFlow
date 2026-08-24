import fs from 'fs';

let content = fs.readFileSync('src/components/HealthScoreModal.tsx', 'utf8');

// 1. Imports
if (!content.includes('ChevronDown')) {
  content = content.replace('X,', 'X,\\n  ChevronDown,\\n  ChevronUp,');
}
content = content.replace(
  `batchTrashEmails } from '../lib/gmail';`,
  `batchTrashEmails, EmailData } from '../lib/gmail';`
);

// 2. States
const stateAnchor = `  const [activeAction, setActiveAction] = useState<string | null>(null);`;
const additionalStates = `  const [expandedMetric, setExpandedMetric] = useState<'unread' | 'spam' | 'promo' | null>(null);
  const [previewEmails, setPreviewEmails] = useState<EmailData[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
`;
if (!content.includes('expandedMetric')) {
  content = content.replace(stateAnchor, additionalStates + '\\n' + stateAnchor);
}

// 3. togglePreview function
const functionAnchor = `  const handleFix = async (type: 'unread' | 'spam' | 'promo', currentPts: number) => {`;
const togglePreviewFunc = `  const togglePreview = async (metric: 'unread' | 'spam' | 'promo', query: string) => {
    if (expandedMetric === metric) {
      setExpandedMetric(null);
      return;
    }
    setExpandedMetric(metric);
    setLoadingPreview(true);
    setPreviewEmails([]);
    try {
      const emails = await searchEmails(query, 50);
      setPreviewEmails(emails);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingPreview(false);
    }
  };

  const renderEmailPreview = (type: 'unread' | 'spam' | 'promo', actionPenalty: number, actionName: string) => {
    if (expandedMetric !== type) return null;
    
    // Quick grouping by sender
    const groups: Record<string, any[]> = {};
    previewEmails.forEach(e => {
      let name = e.sender.split('<')[0].replace(/"/g, '').trim() || 'Unknown';
      if (!groups[name]) groups[name] = [];
      groups[name].push(e);
    });
    
    const sortedGroups = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);

    return (
      <div className="mt-3 pt-3 border-t border-slate-100 flex flex-col gap-3 animate-in slide-in-from-top-2 duration-150">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">Previewing top {previewEmails.length} messages</span>
          <button
            onClick={() => handleFix(type, actionPenalty)}
            disabled={activeAction !== null}
            className="text-xs font-bold px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs disabled:opacity-50"
          >
            {activeAction === type ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>Confirm: {actionName}</span>}
          </button>
        </div>
        
        {loadingPreview ? (
          <div className="py-6 flex justify-center text-slate-400">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : previewEmails.length === 0 ? (
          <div className="py-4 text-center text-xs text-slate-500">No emails found.</div>
        ) : (
          <div className="max-h-[220px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
            {sortedGroups.map(([sender, emails]) => (
              <div key={sender} className="bg-slate-50/70 border border-slate-100 rounded-lg p-2.5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                 <div className="flex flex-col min-w-0 pr-3">
                    <span className="text-xs font-bold text-slate-800 truncate">{sender}</span>
                    <span className="text-[10px] text-slate-500 truncate mt-0.5">{emails[0].subject || 'No subject'}</span>
                 </div>
                 <span className="text-[10px] font-bold bg-white border border-slate-200 text-slate-700 px-2 py-0.5 rounded-md whitespace-nowrap shrink-0 shadow-2xs">
                    {emails.length}
                 </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

`;
if (!content.includes('togglePreview')) {
  content = content.replace(functionAnchor, togglePreviewFunc + functionAnchor);
}

// 4. Update the buttons in the UI
// Replace Unread Button
const unreadBtnPattern = /<button[\s\S]*?onClick=\{\(\) => handleFix\('unread', unreadPenalty\)\}[\s\S]*?<\/button>/;
const unreadNewBtn = `<button
                          onClick={() => togglePreview('unread', 'is:unread in:inbox')}
                          disabled={metrics.unreadInbox === 0}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <span>Review</span>
                          {expandedMetric === 'unread' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>`;
content = content.replace(unreadBtnPattern, unreadNewBtn);

// Replace Spam Button
const spamBtnPattern = /<button[\s\S]*?onClick=\{\(\) => handleFix\('spam', spamPenalty\)\}[\s\S]*?<\/button>/;
const spamNewBtn = `<button
                          onClick={() => togglePreview('spam', 'in:spam OR in:trash')}
                          disabled={metrics.spamAndTrash === 0}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <span>Review</span>
                          {expandedMetric === 'spam' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>`;
content = content.replace(spamBtnPattern, spamNewBtn);

// Replace Promo Button
const promoBtnPattern = /<button[\s\S]*?onClick=\{\(\) => handleFix\('promo', promoPenalty\)\}[\s\S]*?<\/button>/;
const promoNewBtn = `<button
                          onClick={() => togglePreview('promo', 'category:promotions older_than:6m -in:trash')}
                          disabled={metrics.oldPromotions === 0}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          <span>Review</span>
                          {expandedMetric === 'promo' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </button>`;
content = content.replace(promoBtnPattern, promoNewBtn);

// 5. Inject the preview panels after the flex row of each item
// We need to inject `{renderEmailPreview('unread', unreadPenalty, 'Mark Read')}`
const unreadEndDiv = `</button>
                      </div>
                    </div>`;
content = content.replace(
  unreadNewBtn + `
                      </div>
                    </div>`,
  unreadNewBtn + `
                      </div>
                      {renderEmailPreview('unread', unreadPenalty, 'Mark Read')}
                    </div>`
);

const spamEndDiv = `</button>
                      </div>
                    </div>`;
content = content.replace(
  spamNewBtn + `
                      </div>
                    </div>`,
  spamNewBtn + `
                      </div>
                      {renderEmailPreview('spam', spamPenalty, 'Empty Junk')}
                    </div>`
);

const promoEndDiv = `</button>
                      </div>
                    </div>`;
content = content.replace(
  promoNewBtn + `
                      </div>
                    </div>`,
  promoNewBtn + `
                      </div>
                      {renderEmailPreview('promo', promoPenalty, 'Clean Ads')}
                    </div>`
);


// 6. Wrap items in block so it's a block flex flex-col instead of fixed height row.
// The existing items are already flex flex-col sm:flex-row sm:items-center. 
// We want the inner row to be the header and the preview to be underneath. 
// So we need to restructure:
/*
<div className="p-3.5 bg-white border... rounded-xl shadow-2xs transition-colors flex flex-col">
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
    ... (content & buttons)
  </div>
  {renderEmailPreview(...)}
</div>
*/

fs.writeFileSync('patch_healthscore_fix.mjs', `
import fs from 'fs';
let content = fs.readFileSync('src/components/HealthScoreModal.tsx', 'utf8');

const regexUnread = /<div className="p-3\\.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">([\\s\\S]*?)(?:\\{\\/\\* Item 2)/;
const matchUnread = content.match(regexUnread);
if (matchUnread) {
  content = content.replace(regexUnread, \`<div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col shadow-2xs transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
\${matchUnread[1]}
    {/* Item 2\`);
}

const regexSpam = /<div className="p-3\\.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">([\\s\\S]*?)(?:\\{\\/\\* Item 3)/;
const matchSpam = content.match(regexSpam);
if (matchSpam) {
  content = content.replace(regexSpam, \`<div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col shadow-2xs transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
\${matchSpam[1]}
    {/* Item 3\`);
}

const regexPromo = /<div className="p-3\\.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">([\\s\\S]*?)(?:\\{\\/\\* Item 4)/;
const matchPromo = content.match(regexPromo);
if (matchPromo) {
  content = content.replace(regexPromo, \`<div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col shadow-2xs transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
\${matchPromo[1]}
    {/* Item 4\`);
}

fs.writeFileSync('src/components/HealthScoreModal.tsx', content);
`);

fs.writeFileSync('src/components/HealthScoreModal.tsx', content);
console.log("Patched advanced structure.");
