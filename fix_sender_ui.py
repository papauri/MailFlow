import re

with open("src/components/SenderAnalyticsModal.tsx", "r") as f:
    content = f.read()

# Add imports
if "AnimatePresence" not in content:
    content = "import { motion, AnimatePresence } from 'framer-motion';\nimport { useState } from 'react';\nimport { ChevronDown, ChevronUp } from 'lucide-react';\n" + content

# Add emails to Props
content = content.replace("topDomains: any[];", "topDomains: any[];\n  emails?: any[];")

# Add state
content = content.replace("export function SenderAnalyticsModal({ isOpen, onClose, topSenders, topDomains, openFilterPage }: Props) {", "export function SenderAnalyticsModal({ isOpen, onClose, topSenders, topDomains, openFilterPage, emails = [] }: Props) {\n  const [expandedSenders, setExpandedSenders] = useState<Set<number>>(new Set());\n  const [expandedDomains, setExpandedDomains] = useState<Set<number>>(new Set());")

# Replace sender map block
old_sender_block = """                  {topSenders.map((sender, i) => {
                    const maxCount = Math.max(...topSenders.map(s => s.count), 1);
                    const percent = Math.round((sender.count / maxCount) * 100);
                    return (
                    <div 
                      key={i} 
                      onClick={() => {
                        onClose();
                        openFilterPage(`from:${sender.email}`, sender.name || sender.email, "Top Sender", `All messages from ${sender.email}`, "anywhere");
                      }}
                      className="flex flex-col justify-center p-2.5 sm:p-3 border-b border-slate-200/60 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer group"
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
                              onClose();
                              openFilterPage(`from:${sender.email}`, sender.name || sender.email, "Top Sender", `All messages from ${sender.email}`, "anywhere");
                            }}
                            className="p-1 sm:p-1.5 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200 bg-white cursor-pointer"
                            title="Inspect messages from sender"
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
                  })}"""

new_sender_block = """                  {topSenders.map((sender, i) => {
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
                              onClose();
                              openFilterPage(`from:${sender.email}`, sender.name || sender.email, "Top Sender", `All messages from ${sender.email}`, "anywhere");
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
                  })}"""

content = content.replace(old_sender_block, new_sender_block)

old_domain_block = """                  {topDomains.map((domain, i) => {
                    const maxCount = Math.max(...topDomains.map(d => d.count), 1);
                    const percent = Math.round((domain.count / maxCount) * 100);
                    return (
                    <div 
                      key={i} 
                      onClick={() => {
                        onClose();
                        openFilterPage(`from:${domain.domain}`, domain.domain, "Top Domain", `All messages from ${domain.domain}`, "anywhere");
                      }}
                      className="flex flex-col justify-center p-2.5 sm:p-3 border-b border-slate-200/60 last:border-0 hover:bg-slate-50 transition-colors cursor-pointer group"
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
                              onClose();
                              openFilterPage(`from:${domain.domain}`, domain.domain, "Top Domain", `All messages from ${domain.domain}`, "anywhere");
                            }}
                            className="p-1 sm:p-1.5 text-slate-700 hover:bg-slate-200 rounded-lg transition-colors border border-slate-200 bg-white cursor-pointer"
                            title="Inspect messages from domain"
                          >
                            <Filter className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                          </button>
                        </div>
                      </div>
                      <div className="w-full bg-slate-100 rounded-full h-1.5 mb-1">
                        <div className="bg-slate-700 h-1.5 rounded-full" style={{ width: `${percent}%` }}></div>
                      </div>
                    </div>
                  )
                  })}"""

new_domain_block = """                  {topDomains.map((domain, i) => {
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
                              onClose();
                              openFilterPage(`from:${domain.domain}`, domain.domain, "Top Domain", `All messages from ${domain.domain}`, "anywhere");
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
                  })}"""

content = content.replace(old_domain_block, new_domain_block)

with open("src/components/SenderAnalyticsModal.tsx", "w") as f:
    f.write(content)
