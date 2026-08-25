import re

with open("src/components/FolderOptimizer.tsx", "r") as f:
    content = f.read()

# 1. Add AnimatePresence, motion import if missing
if "AnimatePresence" not in content:
    content = content.replace("import { motion } from 'framer-motion';", "import { motion, AnimatePresence } from 'framer-motion';")
    if "import { motion, AnimatePresence } from 'framer-motion';" not in content:
        # try simple insertion
        content = "import { motion, AnimatePresence } from 'framer-motion';\n" + content
        
# 2. Remove EmailReviewView import
content = content.replace("import { EmailReviewView } from './EmailReviewView';\n", "")

# 3. Replace the review button and add inline list
old_review_block = """                      {/* Toggle inspect contents */}
                      <button 
                        onClick={() => setInspectingRec({ idx, rec })}
                        className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 mb-3 transition-colors mt-1 px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 w-fit"
                      >
                        <Search className="w-3.5 h-3.5" />
                        Review {rec.emailIds.length} verified emails
                      </button>"""

new_review_block = """                      {/* Toggle inspect contents */}
                      <div className="flex flex-col w-full mb-3">
                        <button
                          type="button"
                          onClick={(e) => { 
                            e.preventDefault(); 
                            setExpandedRecs(prev => { 
                              const next = new Set(prev); 
                              if (next.has(idx)) next.delete(idx); 
                              else next.add(idx); 
                              return next; 
                            });
                          }}
                          className="self-start flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors mb-1"
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          <span>{isExpanded ? 'Hide emails' : `Review ${rec.emailIds.length} verified emails`}</span>
                        </button>
                        
                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden w-full"
                            >
                              <div className="flex flex-col gap-1 mt-1 mb-2 max-h-40 overflow-y-auto custom-scrollbar pr-1 border border-slate-100 rounded-lg bg-slate-50/50 p-1">
                                {rec.emailIds.map(id => {
                                  const email = emails.find(e => e.id === id);
                                  if (!email) return null;
                                  const isDeselected = (rec.deselectedEmailIds || []).includes(id);
                                  return (
                                    <div key={id} className={cn("flex items-start gap-2 p-1.5 rounded-md group transition-colors", isDeselected ? "opacity-50" : "bg-white border border-slate-100 shadow-2xs hover:border-slate-200")}>
                                      <button
                                        type="button"
                                        onClick={(e) => { e.preventDefault(); toggleEmailSelection(idx, id); }}
                                        className="mt-0.5 shrink-0 text-slate-400 hover:text-indigo-600 transition-colors"
                                      >
                                        {isDeselected ? <div className="w-3.5 h-3.5 rounded border border-slate-300" /> : <CheckCircle className="w-3.5 h-3.5 text-indigo-600" />}
                                      </button>
                                      <div className="flex-1 min-w-0">
                                        <p className={cn("text-[11px] font-medium truncate", isDeselected ? "text-slate-500 line-through" : "text-slate-700")}>{email.subject || '(No Subject)'}</p>
                                        <p className="text-[10px] text-slate-500 truncate">{email.sender}</p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>"""

content = content.replace(old_review_block, new_review_block)

# Remove inspectingRec state
content = re.sub(r"  const \[inspectingRec, setInspectingRec\] = useState<\{ idx: number, rec: Recommendation \} \| null>\(null\);\n", "", content)

# Remove EmailReviewView block
start_tag = "{inspectingRec && ("
end_tag = "/>\n      )}"
start_idx = content.find(start_tag)
if start_idx != -1:
    end_idx = content.find(end_tag, start_idx) + len(end_tag)
    content = content[:start_idx] + content[end_idx:]

with open("src/components/FolderOptimizer.tsx", "w") as f:
    f.write(content)
