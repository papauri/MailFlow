import re

with open('src/components/HealthScoreModal.tsx', 'r') as f:
    content = f.read()

large_ui_old = """                      <div className="flex items-center gap-3 self-end sm:self-center">
                        <span className="text-sm font-bold text-rose-600 min-w-[55px] text-right">-{Math.round(largePenalty)} pts</span>
                        {onApplyQuery && (
                          <button
                            onClick={() => {
                              onClose();
                              onApplyQuery('larger:5M', 'anywhere', 'size');
                            }}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <span>Inspect</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </div>"""

large_ui_new = """                      <div className="flex items-center gap-3 self-end sm:self-center">
                        <span className="text-sm font-bold text-rose-600 min-w-[55px] text-right">-{Math.round(largePenalty)} pts</span>
                        <div className="flex bg-slate-100 rounded-lg p-0.5 shadow-2xs">
                          {onApplyQuery && (
                            <button
                              onClick={() => {
                                onClose();
                                onApplyQuery('larger:5M', 'anywhere', 'size');
                              }}
                              className="text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs text-slate-700 transition-all cursor-pointer flex items-center gap-1"
                            >
                              <span>Inspect</span>
                              <ArrowRight className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>"""

content = content.replace(large_ui_old, large_ui_new)

with open('src/components/HealthScoreModal.tsx', 'w') as f:
    f.write(content)
