import React, { useState } from 'react';
import { Loader2, Sparkles, Settings, CheckCircle, BrainCircuit } from 'lucide-react';
import { cn } from '../lib/utils';
import { searchEmails, createFilter } from '../lib/gmail';

interface RuleSuggestion {
  sender: string;
  labelId: string;
  labelName: string;
  count: number;
}

export function RuleSuggester({ userLabels }: { userLabels: any[] }) {
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<RuleSuggestion[]>([]);
  const [createdRules, setCreatedRules] = useState<Set<string>>(new Set());
  const [creatingRule, setCreatingRule] = useState<string | null>(null);

  const fetchSuggestions = async () => {
    setLoading(true);
    setSuggestions([]);
    try {
      const customLabels = userLabels.filter(l => l.type === 'user');
      if (customLabels.length === 0) return;

      const suggestionsPool: RuleSuggestion[] = [];

      for (const label of customLabels) {
        // Fetch up to 50 recent emails in this label that bypass the inbox (archived)
        const emails = await searchEmails(`label:${label.name.replace(/ /g, '-')} -in:inbox`, 50);
        if (!emails || emails.length === 0) continue;

        const senderCounts = new Map<string, number>();
        emails.forEach(e => {
          const match = e.sender.match(/<([^>]+)>/);
          const emailAddress = match ? match[1].toLowerCase() : e.sender.toLowerCase();
          if (emailAddress.includes('@')) {
            senderCounts.set(emailAddress, (senderCounts.get(emailAddress) || 0) + 1);
          }
        });

        // Find senders with high frequency in this label (> 5 occurrences)
        for (const [sender, count] of senderCounts.entries()) {
          if (count > 5) {
            suggestionsPool.push({
              sender,
              labelId: label.id,
              labelName: label.name,
              count
            });
          }
        }
      }

      setSuggestions(suggestionsPool.sort((a, b) => b.count - a.count).slice(0, 4));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateRule = async (sug: RuleSuggestion) => {
    setCreatingRule(sug.sender);
    try {
      const query = `from:${sug.sender}`;
      await createFilter(query, [sug.labelId], ['INBOX']);
      setCreatedRules(prev => new Set(prev).add(sug.sender));
    } catch (e) {
      console.error(e);
      alert("Failed to create rule.");
    } finally {
      setCreatingRule(null);
    }
  };

  if (suggestions.length === 0 && !loading) {
    return (
      <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden shadow-sm mt-6 p-6 text-center">
        <BrainCircuit className="w-8 h-8 text-indigo-400 mx-auto mb-3" />
        <h3 className="text-lg font-bold text-slate-800">Automated Sorting Rules</h3>
        <p className="text-sm text-slate-500 mt-2">
          We analyze your custom folders to suggest automatic routing rules.<br />
          Click below to scan for repeated patterns.
        </p>
        <button
          onClick={fetchSuggestions}
          className="mt-4 mx-auto px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 rounded-lg text-sm font-semibold transition-colors flex items-center gap-2"
        >
          <Sparkles className="w-4 h-4" />
          Scan For Rules
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-slate-200 flex flex-col overflow-hidden shadow-sm mt-6">
      <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-indigo-100">
            <BrainCircuit className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h2 className="text-base sm:text-lg font-bold text-slate-800">Rule Suggestions</h2>
            <p className="text-xs text-slate-500">Based on your historical folder organization</p>
          </div>
        </div>
      </div>

      <div className="p-4 sm:p-6 bg-slate-50/30">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-8 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-indigo-500" />
            <p className="text-sm font-semibold text-slate-700">Analyzing your folder habits...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {suggestions.map((sug, idx) => {
              const isCreated = createdRules.has(sug.sender);
              return (
                <div key={idx} className={cn("bg-white border rounded-xl p-4 sm:p-5 transition-all shadow-sm flex flex-col h-full", isCreated ? "border-emerald-200 bg-emerald-50/30" : "border-slate-200")}>
                  <div className="flex justify-between items-start gap-4 mb-3">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-slate-800 text-sm sm:text-base truncate" title={sug.sender}>
                        {sug.sender}
                      </h4>
                      <p className="text-xs sm:text-sm text-slate-500 mt-1">
                        Consistently moved to <span className="font-semibold text-slate-700">"{sug.labelName}"</span>
                      </p>
                    </div>
                  </div>

                  <div className="mt-auto pt-4 border-t border-slate-100 flex flex-col gap-2">
                    {isCreated ? (
                      <div className="flex items-center justify-center gap-1.5 w-full bg-emerald-100 text-emerald-800 px-3 py-2 rounded-lg text-xs font-bold">
                        <CheckCircle className="w-4 h-4" /> Rule Created
                      </div>
                    ) : (
                      <button
                        onClick={() => handleCreateRule(sug)}
                        disabled={creatingRule === sug.sender}
                        className="flex items-center justify-center gap-1.5 w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 px-3 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50"
                      >
                        {creatingRule === sug.sender ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Settings className="w-3.5 h-3.5" />}
                        Always Route Here
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
