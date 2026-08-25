import re

with open("src/components/BulkOrganizeDropdown.tsx", "r") as f:
    content = f.read()

if "AnimatePresence" not in content:
    content = "import { motion, AnimatePresence } from 'framer-motion';\n" + content

# 1. Add expandedIndices state
content = content.replace(
    "const [inspectingRec, setInspectingRec] = useState<any>(null);",
    "const [expandedIndices, setExpandedIndices] = useState<Set<number>>(new Set());\n"
)

# 2. Replace Review button
old_button = """                  <button
                    onClick={() => setInspectingRec(rec)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors self-start mt-1"
                  >
                    <Search className="w-3.5 h-3.5" />
                    Review {rec.emailIds.length} emails
                  </button>"""

new_button = """                  <div className="flex flex-col w-full mt-1 mb-1">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        setExpandedIndices(prev => {
                          const next = new Set(prev);
                          if (next.has(idx)) next.delete(idx);
                          else next.add(idx);
                          return next;
                        });
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors self-start"
                    >
                      {expandedIndices.has(idx) ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      <span>{expandedIndices.has(idx) ? 'Hide emails' : `Review ${rec.emailIds.length} emails`}</span>
                    </button>
                    <AnimatePresence>
                      {expandedIndices.has(idx) && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden w-full mt-2"
                        >
                          <div className="flex flex-col gap-1 max-h-40 overflow-y-auto custom-scrollbar pr-1 border border-slate-200 rounded-lg bg-white p-1">
                            {rec.emailIds.map((id: string) => {
                              const email = emails.find(e => e.id === id);
                              if (!email) return null;
                              const isDeselected = (rec.deselectedEmailIds || []).includes(id);
                              return (
                                <div key={id} className={cn("flex items-start gap-2 p-1.5 rounded-md group transition-colors", isDeselected ? "opacity-50" : "bg-slate-50 border border-slate-100 shadow-2xs hover:border-slate-200")}>
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      setSuggestions(prev => prev.map((r, i) => {
                                        if (i !== idx) return r;
                                        const deselected = new Set(r.deselectedEmailIds || []);
                                        if (deselected.has(id)) deselected.delete(id);
                                        else deselected.add(id);
                                        return { ...r, deselectedEmailIds: Array.from(deselected) };
                                      }));
                                    }}
                                    className="mt-0.5 shrink-0 text-slate-400 hover:text-indigo-600 transition-colors"
                                  >
                                    {isDeselected ? <div className="w-3.5 h-3.5 rounded border border-slate-300" /> : <Check className="w-3.5 h-3.5 text-indigo-600" />}
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

content = content.replace(old_button, new_button)

# Also fix the execution handlers in the suggestion map to filter out deselectedEmailIds
content = content.replace(
    "executeAction('label', rec.emailIds, rec.suggestedLabel)",
    "executeAction('label', rec.emailIds.filter((id: string) => !(rec.deselectedEmailIds || []).includes(id)), rec.suggestedLabel)"
)
content = content.replace(
    "executeAction('trash', rec.emailIds)",
    "executeAction('trash', rec.emailIds.filter((id: string) => !(rec.deselectedEmailIds || []).includes(id)))"
)
content = content.replace(
    "executeAction('archive', rec.emailIds)",
    "executeAction('archive', rec.emailIds.filter((id: string) => !(rec.deselectedEmailIds || []).includes(id)))"
)

# Replace the inspectingRec block with nothing
start_tag = "{inspectingRec && ("
end_tag = "/>\n        </div>\n      )}"
start_idx = content.find(start_tag)
if start_idx != -1:
    end_idx = content.find(end_tag, start_idx) + len(end_tag)
    content = content[:start_idx] + content[end_idx:]

content = content.replace("import { EmailReviewView } from './EmailReviewView';\n", "")

# Fix ChevronDown and ChevronUp import if missing
if "ChevronDown" not in content:
    content = content.replace("Archive, SlidersHorizontal } from 'lucide-react';", "Archive, SlidersHorizontal, ChevronDown, ChevronUp } from 'lucide-react';")

# Fix `{cn("p-3", inspectingRec ? "hidden" : "block")}` -> `className="p-3"`
content = content.replace('className={cn("p-3", inspectingRec ? "hidden" : "block")}', 'className="p-3"')

with open("src/components/BulkOrganizeDropdown.tsx", "w") as f:
    f.write(content)
