const fs = require('fs');
let code = fs.readFileSync('src/components/UnsubscribeManager.tsx', 'utf8');

// 1. Imports
code = code.replace(
  `import { MailMinus, ShieldCheck, Search, Loader2, Skull, BrainCircuit, X, Undo2, CheckCircle2 } from 'lucide-react';`,
  `import { MailMinus, ShieldCheck, Search, Loader2, Skull, BrainCircuit, X, Undo2, CheckCircle2, Trash2, Filter } from 'lucide-react';`
);

// 2. State and Handlers
const newState = `
  const [recommendationFilter, setRecommendationFilter] = useState<string>('all');
  const [selectedLogs, setSelectedLogs] = useState<Set<string>>(new Set());

  useEffect(() => {
    setSelectedLogs(new Set());
  }, [activeTab]);

  const handleDeleteLogs = () => {
    const remainingLogs = actionLog.filter(log => !selectedLogs.has(log.id));
    saveActionLog(remainingLogs);
    setSelectedLogs(new Set());
  };
`;

code = code.replace(
  `const [aiAnalysis, setAiAnalysis] = useState<any[] | null>(null);`,
  `const [aiAnalysis, setAiAnalysis] = useState<any[] | null>(null);\n${newState}`
);

// 3. Filtered Subs logic
code = code.replace(
  `const canUnsubscribeSubs = subscriptions.filter(s => !!s.listUnsubscribe);
  const ghostBlockSubs = subscriptions.filter(s => !s.listUnsubscribe);`,
  `const filteredSubs = recommendationFilter === 'all' 
    ? subscriptions 
    : subscriptions.filter(s => aiAnalysis?.find(a => a.email === s.email)?.recommendation === recommendationFilter);
  const canUnsubscribeSubs = filteredSubs.filter(s => !!s.listUnsubscribe);
  const ghostBlockSubs = filteredSubs.filter(s => !s.listUnsubscribe);`
);

// 4. AI Filter UI
const filterUI = `
                  {aiAnalysis && (
                    <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 bg-slate-50 border border-slate-200 rounded-xl">
                      <div className="flex items-center gap-2">
                        <Filter className="w-4 h-4 text-slate-500" />
                        <span className="text-sm font-semibold text-slate-700">AI Recommendations</span>
                      </div>
                      <select 
                        value={recommendationFilter}
                        onChange={(e) => setRecommendationFilter(e.target.value)}
                        className="text-sm border-slate-300 rounded-lg bg-white px-3 py-1.5 focus:ring-slate-800 focus:border-slate-800 text-slate-700 flex-1 sm:flex-none shadow-sm font-medium"
                      >
                        <option value="all">Show All Senders</option>
                        {Array.from(new Set(aiAnalysis.map(a => a.recommendation))).map(rec => (
                          <option key={rec} value={rec}>Action: {rec}</option>
                        ))}
                      </select>
                    </div>
                  )}
`;

code = code.replace(
  `{canUnsubscribeSubs.length > 0 && (`,
  `${filterUI}\n                  {canUnsubscribeSubs.length > 0 && (`
);

// 5. Checkboxes and Bulk UI in logs
const bulkUI = `
                {logsToDisplay.length > 0 && (
                  <div className="flex items-center justify-between mb-4 bg-slate-50 p-3 rounded-xl border border-slate-200">
                    <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 cursor-pointer">
                      <input 
                        type="checkbox" 
                        checked={selectedLogs.size === logsToDisplay.length && logsToDisplay.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedLogs(new Set(logsToDisplay.map(l => l.id)));
                          } else {
                            setSelectedLogs(new Set());
                          }
                        }}
                        className="rounded border-slate-300 text-slate-800 focus:ring-slate-800 w-4 h-4"
                      />
                      Select All
                    </label>
                    {selectedLogs.size > 0 && (
                      <button
                        onClick={handleDeleteLogs}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 font-semibold text-xs sm:text-sm rounded-lg transition-colors border border-red-200"
                      >
                        <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                        Clear Selected ({selectedLogs.size})
                      </button>
                    )}
                  </div>
                )}
`;

code = code.replace(
  `<div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <ul className="divide-y divide-slate-100">
                    {logsToDisplay.map((log) => {`,
  `${bulkUI}
                <div className="border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                  <ul className="divide-y divide-slate-100">
                    {logsToDisplay.map((log) => {`
);

// Add individual checkbox
code = code.replace(
  `<div className="flex items-center gap-4">
                            <div className="w-9 h-9 rounded-full`,
  `<div className="flex items-center gap-4">
                            <input 
                              type="checkbox"
                              checked={selectedLogs.has(log.id)}
                              onChange={(e) => {
                                const next = new Set(selectedLogs);
                                if (e.target.checked) next.add(log.id);
                                else next.delete(log.id);
                                setSelectedLogs(next);
                              }}
                              className="rounded border-slate-300 text-slate-800 focus:ring-slate-800 w-4 h-4 mr-1 sm:mr-2"
                            />
                            <div className="w-9 h-9 rounded-full`
);

fs.writeFileSync('src/components/UnsubscribeManager.tsx', code);
console.log("Patched features");
