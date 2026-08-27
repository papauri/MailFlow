import { motion, AnimatePresence } from 'framer-motion';
import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Target, Layers, Filter, ArrowLeft, RefreshCw, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';
import { useCachedResource } from '../lib/useCachedResource';
import { fetchSenderClusters, senderClustersKey, SenderClusters } from '../lib/inboxAnalytics';
import { PageHeader } from './PageHeader';
import { SketchLoadingState } from './SketchLoader';

interface Props {
  userEmail?: string;
  onBack: () => void;
  openFilterPage: (
    query: string,
    title: string,
    badge: string,
    subtitle?: string,
    folder?: string,
    sortOption?: "date" | "size" | "sender",
    source?: string
  ) => void;
}

/**
 * Full page (not a modal) so drilling into a sender's messages can carry a real
 * breadcrumb trail — Inbox Health › Sender Analytics › <sender> — and so browser
 * back/forward behaves the way the user expects.
 *
 * Reads its clusters from the shared cache, so arriving here from Inbox Health is
 * instant and costs no extra Gmail requests.
 */
export function SenderAnalyticsPage({ userEmail, onBack, openFilterPage }: Props) {
  const [expandedSenders, setExpandedSenders] = useState<Set<number>>(new Set());
  const [expandedDomains, setExpandedDomains] = useState<Set<number>>(new Set());

  const clusters = useCachedResource<SenderClusters>(
    senderClustersKey(userEmail),
    () => fetchSenderClusters(userEmail)
  );

  const topSenders = clusters.data?.topSenders ?? [];
  const topDomains = clusters.data?.topDomains ?? [];
  const emails = clusters.data?.recentEmails ?? [];

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<number>>>, i: number) => {
    setter(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  return (
    <div className="w-full max-w-5xl mx-auto flex flex-col animate-in fade-in duration-150">
      <PageHeader
        title="Sender Analytics"
        subtitle="Most frequent contacts and domain clusters."
        icon={<Target className="w-4 h-4" />}
        onBack={onBack}
        backLabel="Back to Inbox Health"
        actions={
          <button
            onClick={clusters.refresh}
            disabled={clusters.loading || clusters.refreshing}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50"
            title="Refresh analytics"
          >
            <RefreshCw className={cn("w-4 h-4", (clusters.loading || clusters.refreshing) && "animate-spin")} />
          </button>
        }
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs min-h-[400px] p-4 sm:p-6">
        {clusters.loading ? (
          <div className="flex flex-col items-center justify-center min-h-[320px]">
            <SketchLoadingState 
              scene="searching"
              title="Analyzing Sender & Domain History"
              messages={[
                "Scanning recent messages across all folders...",
                "Extracting and normalizing sender addresses...",
                "Clustering organization domains...",
                "Calculating exact contact engagement metrics..."
              ]}
              progressLabel="Auditing contacts"
            />
          </div>
        ) : topSenders.length === 0 && topDomains.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[320px] text-center">
            <Target className="w-9 h-9 text-slate-300 mb-2.5" />
            <p className="text-sm font-medium text-slate-700">No sender patterns found</p>
            <p className="text-xs text-slate-500 mt-0.5">There isn't enough recent mail to cluster yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-6 sm:grid sm:grid-cols-2">
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
              <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                {topSenders.map((sender, i) => {
                  const maxCount = Math.max(...topSenders.map(s => s.count), 1);
                  const percent = Math.round((sender.count / maxCount) * 100);
                  const isExpanded = expandedSenders.has(i);
                  const senderEmails = emails.filter((e: any) => e.sender.includes(sender.email)).slice(0, 15);
                  return (
                    <div
                      key={sender.email}
                      className="flex flex-col justify-center p-2.5 sm:p-3 border-b border-slate-200/60 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer group"
                      onClick={() => toggle(setExpandedSenders, i)}
                    >
                      <div className="flex items-center justify-between mb-1.5 sm:mb-2 gap-2">
                        <div className="flex-1 min-w-0 pr-1 sm:pr-3">
                          <p className="font-semibold text-slate-800 text-xs sm:text-sm truncate group-hover:text-blue-600 transition-colors">{sender.name}</p>
                          <p className="text-[11px] sm:text-xs text-slate-500 truncate">{sender.email}</p>
                        </div>
                        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                          <span className="text-xs sm:text-sm font-bold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 sm:px-2 py-0.5 rounded-full">{sender.count}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openFilterPage(`from:${sender.email}`, sender.name || sender.email, "Top Sender", `All messages from ${sender.email}`, "anywhere", undefined, "sender-analytics");
                            }}
                            className="p-1 sm:p-1.5 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200 bg-white cursor-pointer"
                            title="Inspect messages from sender"
                          >
                            <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          </button>
                          <div className="p-1 sm:p-1.5 text-slate-500 rounded-lg">
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1">
                        <div className="bg-slate-800 h-1.5 rounded-full" style={{ width: `${percent}%` }}></div>
                      </div>
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="flex flex-col gap-1 mt-3 mb-1 max-h-40 overflow-y-auto custom-scrollbar pr-1" onClick={(e) => e.stopPropagation()}>
                              {senderEmails.map((email: any) => (
                                <div key={email.id} className="flex flex-col bg-white border border-slate-100 rounded p-1.5">
                                  <p className="text-[11px] font-medium text-slate-700 truncate">{email.subject || '(No Subject)'}</p>
                                  <p className="text-[10px] text-slate-500 truncate">{new Date(email.date).toLocaleDateString()}</p>
                                </div>
                              ))}
                              {sender.count > senderEmails.length && (
                                <p className="text-[10px] text-slate-400 text-center mt-1">+{sender.count - senderEmails.length} more</p>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
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
              <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                {topDomains.map((domain: any, i) => {
                  const maxCount = Math.max(...topDomains.map(d => d.count), 1);
                  const percent = Math.round((domain.count / maxCount) * 100);
                  const isExpanded = expandedDomains.has(i);
                  const domainEmails = emails.filter((e: any) => e.sender.includes(`@${domain.domain}`)).slice(0, 15);
                  return (
                    <div
                      key={domain.domain}
                      className="flex flex-col justify-center p-2.5 sm:p-3 border-b border-slate-200/60 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer group"
                      onClick={() => toggle(setExpandedDomains, i)}
                    >
                      <div className="flex items-center justify-between mb-1.5 sm:mb-2 gap-2">
                        <div className="flex-1 min-w-0 pr-1 sm:pr-3 flex flex-col justify-center">
                          <p className="font-semibold text-slate-800 text-xs sm:text-sm truncate group-hover:text-blue-600 transition-colors">@{domain.domain}</p>
                          {domain.senders > 1 && (
                            <p className="text-[10px] sm:text-[11px] font-medium text-slate-500 mt-0.5">{domain.senders} unique senders</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                          <span className="text-xs sm:text-sm font-bold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 sm:px-2 py-0.5 rounded-full">{domain.count}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              openFilterPage(`from:${domain.domain}`, domain.domain, "Top Domain", `All messages from ${domain.domain}`, "anywhere", undefined, "sender-analytics");
                            }}
                            className="p-1 sm:p-1.5 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200 bg-white cursor-pointer"
                            title="Inspect messages from domain"
                          >
                            <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          </button>
                          <div className="p-1 sm:p-1.5 text-slate-500 rounded-lg">
                            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                          </div>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1">
                        <div className="bg-slate-700 h-1.5 rounded-full" style={{ width: `${percent}%` }}></div>
                      </div>
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            className="overflow-hidden"
                          >
                            <div className="flex flex-col gap-1 mt-3 mb-1 max-h-40 overflow-y-auto custom-scrollbar pr-1" onClick={(e) => e.stopPropagation()}>
                              {domainEmails.map((email: any) => (
                                <div key={email.id} className="flex flex-col bg-white border border-slate-100 rounded p-1.5">
                                  <p className="text-[11px] font-medium text-slate-700 truncate">{email.subject || '(No Subject)'}</p>
                                  <p className="text-[10px] text-slate-500 truncate">{email.sender}</p>
                                </div>
                              ))}
                              {domain.count > domainEmails.length && (
                                <p className="text-[10px] text-slate-400 text-center mt-1">+{domain.count - domainEmails.length} more</p>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
