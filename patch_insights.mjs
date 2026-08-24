import fs from 'fs';
let content = fs.readFileSync('src/components/SmartTriageModal.tsx', 'utf8');

// 1. Add state variables
const stateHookTarget = `  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(new Set());`;
const stateHookAddition = `
  const [expandedInsightId, setExpandedInsightId] = useState<string | null>(null);
  const [insightEmails, setInsightEmails] = useState<Record<string, EmailData[]>>({});
  const [loadingInsightId, setLoadingInsightId] = useState<string | null>(null);

  const toggleInsightReview = async (insight: SmartInsight) => {
    if (expandedInsightId === insight.id) {
      setExpandedInsightId(null);
      return;
    }
    setExpandedInsightId(insight.id);
    if (!insightEmails[insight.id]) {
      setLoadingInsightId(insight.id);
      try {
        const emails = await searchEmails(insight.filterQuery, 50);
        setInsightEmails(prev => ({ ...prev, [insight.id]: emails }));
      } catch (err) {
        console.error("Failed to load insight emails:", err);
      } finally {
        setLoadingInsightId(null);
      }
    }
  };
`;
content = content.replace(stateHookTarget, stateHookTarget + stateHookAddition);

// 2. Modify the Insight Card
const insightRegex = /<div key=\{insight\.id\} className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">[\s\S]*?<\/div>\s*<\/div>\s*\);\s*\}\)/;

const newInsightCode = `<div key={insight.id} className="bg-white border border-slate-200 rounded-xl p-3 shadow-xs flex flex-col gap-3">
                  <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-slate-800 text-sm truncate">{insight.title}</h4>
                      <p className="text-xs text-slate-600 mt-0.5 leading-snug break-words">{insight.description}</p>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                      <button
                        onClick={() => toggleInsightReview(insight)}
                        className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium shadow-xs transition-colors"
                      >
                        <Search className="w-3 h-3" /> {expandedInsightId === insight.id ? 'Hide' : 'Review'}
                      </button>
                      <button
                        onClick={() => executeInsightAction(insight)}
                        disabled={isExecuting}
                        className="flex-1 sm:flex-none shrink-0 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-medium shadow-xs transition-colors disabled:opacity-50"
                      >
                        {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                        {insight.actionLabel}
                      </button>
                    </div>
                  </div>
                  
                  {expandedInsightId === insight.id && (
                    <div className="mt-1 bg-slate-50 rounded-lg p-2.5 border border-slate-200/70 flex flex-col gap-1.5 max-h-72 overflow-y-auto w-full">
                      {loadingInsightId === insight.id ? (
                         <div className="p-4 text-center text-xs text-slate-500 flex justify-center items-center gap-2">
                           <Loader2 className="w-4 h-4 animate-spin" /> Loading preview...
                         </div>
                      ) : (insightEmails[insight.id] || []).length === 0 ? (
                         <div className="p-4 text-center text-xs text-slate-500">No emails found.</div>
                      ) : (
                        (insightEmails[insight.id] || []).map(email => (
                            <div key={email.id} className="flex flex-col gap-1.5 p-2 rounded-md hover:bg-white transition-colors border border-transparent hover:border-slate-200">
                              <div className="flex items-start gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="font-semibold text-slate-800 break-words leading-snug">
                                    {email.subject || '(No Subject)'}
                                  </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-[10px] text-slate-400 whitespace-nowrap">
                                    {email.date ? new Date(email.date).toLocaleDateString() : ''}
                                  </span>
                                  <a
                                    href={\`https://mail.google.com/mail/u/0/#all/\${email.threadId || email.id}\`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 transition-colors"
                                    title="Open in Gmail"
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                  </a>
                                </div>
                              </div>
                              <div>
                                <p className="text-[11px] text-slate-500 line-clamp-3 break-words">
                                  <span className="font-medium text-slate-700 mr-1">{email.sender}</span>
                                  {email.snippet}
                                </p>
                              </div>
                            </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })`;

content = content.replace(insightRegex, newInsightCode);

fs.writeFileSync('src/components/SmartTriageModal.tsx', content);
