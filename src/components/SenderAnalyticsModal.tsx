import { motion, AnimatePresence } from 'framer-motion';
import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import React from 'react';
import { Target, Layers, Filter, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  topSenders: any[];
  topDomains: any[];
  emails?: any[];
  openFilterPage: (query: string, name: string, type: string, desc: string, filter: string, sortOption?: "date" | "size" | "sender", source?: string) => void;
}

export function SenderAnalyticsModal({ isOpen, onClose, topSenders, topDomains, openFilterPage, emails = [] }: Props) {
  const [expandedSenders, setExpandedSenders] = useState<Set<number>>(new Set());
  const [expandedDomains, setExpandedDomains] = useState<Set<number>>(new Set());
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col shadow-2xl animate-in fade-in zoom-in-95 duration-200">
        <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Sender Analytics</h2>
            <p className="text-sm text-slate-500">Most frequent contacts and domain clusters</p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-slate-200 rounded-xl transition-colors text-slate-500 hover:text-slate-700 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="p-4 sm:p-6 overflow-y-auto bg-slate-50/30">
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
                    const senderEmails = emails.filter(e => e.sender.includes(sender.email)).slice(0, 15);
                    return (
                    <div 
                      key={i} 
                      className="flex flex-col justify-center p-2.5 sm:p-3 border-b border-slate-200/60 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer group"
                      onClick={(e) => {
                        setExpandedSenders(prev => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        });
                      }}
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
                              {senderEmails.map(email => (
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
                <div className="bg-white rounded-xl shadow-xs border border-slate-200 overflow-hidden">
                  {topDomains.map((domain, i) => {
                    const maxCount = Math.max(...topDomains.map(d => d.count), 1);
                    const percent = Math.round((domain.count / maxCount) * 100);
                    const isExpanded = expandedDomains.has(i);
                    const domainEmails = emails.filter(e => e.sender.includes(`@${domain.domain}`)).slice(0, 15);
                    return (
                    <div 
                      key={i} 
                      className="flex flex-col justify-center p-2.5 sm:p-3 border-b border-slate-200/60 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer group"
                      onClick={(e) => {
                        setExpandedDomains(prev => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i);
                          else next.add(i);
                          return next;
                        });
                      }}
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
                              {domainEmails.map(email => (
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
                  )
                  })}
                </div>
              </div>
            </div>
        </div>
      </div>
    </div>
  );
}
