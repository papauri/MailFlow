import re

with open("src/components/InboxHealth.tsx", "r") as f:
    content = f.read()

# Replace AI Folder Optimizer card
old_folder_optimizer = """        <div className="bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 rounded-2xl shadow-xs overflow-hidden p-5 flex flex-col h-full hover:shadow-md transition-all group">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-indigo-100 text-indigo-700 rounded-xl">
              <Folder className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-indigo-950">AI Folder Optimizer</h3>
          </div>
          <p className="text-sm text-indigo-700/80 mb-6 flex-1">
            Automatically group recurring senders, shopping receipts, and newsletters into smart categorized folders using precision clustering.
          </p>
          <button 
            onClick={() => { window.location.hash = '#folder-optimizer'; }}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold transition-colors cursor-pointer"
          >
            <span>Optimize Folders</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>"""

new_folder_optimizer = """        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden p-5 flex flex-col h-full hover:border-slate-300 transition-colors group">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl">
              <Folder className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">AI Folder Optimizer</h3>
          </div>
          <p className="text-sm text-slate-500 mb-6 flex-1">
            Automatically group recurring senders, shopping receipts, and newsletters into smart categorized folders using precision clustering.
          </p>
          <button 
            onClick={() => { window.location.hash = '#folder-optimizer'; }}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
          >
            <span>Optimize Folders</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>"""

content = content.replace(old_folder_optimizer, new_folder_optimizer)

# Replace Automated Sorting Rules card
old_sorting_rules = """        <div className="bg-gradient-to-br from-emerald-50 to-white border border-emerald-100 rounded-2xl shadow-xs overflow-hidden p-5 flex flex-col h-full hover:shadow-md transition-all group">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-emerald-100 text-emerald-700 rounded-xl">
              <Filter className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-emerald-950">Automated Sorting Rules</h3>
          </div>
          <p className="text-sm text-emerald-700/80 mb-6 flex-1">
            Discover inbox patterns and generate permanent Gmail filter rules to route future emails instantly without manual effort.
          </p>
          <button 
            onClick={() => { window.location.hash = '#rule-suggester'; }}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition-colors cursor-pointer"
          >
            <span>Create Auto-Rules</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>"""

new_sorting_rules = """        <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden p-5 flex flex-col h-full hover:border-slate-300 transition-colors group">
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2.5 bg-slate-50 text-slate-700 border border-slate-200 rounded-xl">
              <Filter className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900">Automated Sorting Rules</h3>
          </div>
          <p className="text-sm text-slate-500 mb-6 flex-1">
            Discover inbox patterns and generate permanent Gmail filter rules to route future emails instantly without manual effort.
          </p>
          <button 
            onClick={() => { window.location.hash = '#rule-suggester'; }}
            className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-800 rounded-xl text-sm font-semibold transition-colors cursor-pointer"
          >
            <span>Create Auto-Rules</span>
            <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
          </button>
        </div>"""

content = content.replace(old_sorting_rules, new_sorting_rules)

with open("src/components/InboxHealth.tsx", "w") as f:
    f.write(content)
