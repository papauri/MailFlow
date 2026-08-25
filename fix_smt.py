import re

with open("src/components/SmartTriageModal.tsx", "r") as f:
    content = f.read()

# 1. Remove EmailReviewView import
content = content.replace("import { EmailReviewView } from './EmailReviewView';\n", "")

# 2. Remove inspectingGroup state
content = re.sub(r"  const \[inspectingGroup, setInspectingGroup\] = useState<SmartGroup \| null>\(null\);\n", "", content)

# 3. Fix Review button (replace onClick setInspectingGroup with toggleExpandGroup)
old_button = """                        <button
                          onClick={() => setInspectingGroup(group)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
                        >
                          <Search className="w-3.5 h-3.5" />
                          <span>Review {sampleEmails.length} messages</span>
                        </button>"""

new_button = """                        <button
                          type="button"
                          onClick={(e) => { e.preventDefault(); toggleExpandGroup(group.id); }}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-100 hover:bg-slate-200 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
                        >
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          <span>{isExpanded ? 'Hide' : 'Review'} {sampleEmails.length} messages</span>
                        </button>"""

content = content.replace(old_button, new_button)

# 4. Remove EmailReviewView rendering block
start_tag = "{inspectingGroup && ("
end_tag = "/>\n        )}"
start_idx = content.find(start_tag)
if start_idx != -1:
    end_idx = content.find(end_tag, start_idx) + len(end_tag)
    content = content[:start_idx] + content[end_idx:]

with open("src/components/SmartTriageModal.tsx", "w") as f:
    f.write(content)
