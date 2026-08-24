import fs from 'fs';
let content = fs.readFileSync('src/components/SmartTriageModal.tsx', 'utf8');

const oldRenderBlock = `                  <div
                    key={group.id}
                    className={cn(
                      "bg-white border rounded-xl p-4 shadow-xs transition-all flex flex-col gap-3",
                      isCompleted ? "border-slate-200 opacity-60 bg-slate-50/50" : "border-slate-200 hover:border-slate-300"
                    )}
                  >
                    {/* Top Row: Sender Info & Actions */}
                    <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                      <div className="min-w-0 flex-1 w-full">
                        <div className="flex items-center gap-2 flex-wrap mb-1.5">
                          <span className="font-semibold text-slate-900 text-sm truncate max-w-[200px] sm:max-w-xs">
                            {group.sender}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-slate-100 text-slate-600 shrink-0">
                            {group.categoryTag}
                          </span>
                          <span className="text-xs text-slate-400 shrink-0">
                            • {activeEmailIds.length} {activeEmailIds.length === 1 ? 'email' : 'emails'}
                          </span>
                        </div>
                        <h4 className="text-xs sm:text-sm font-bold text-slate-800 break-words leading-snug">
                          {group.title}
                        </h4>
                        <p className="text-xs text-slate-500 mt-1 leading-relaxed break-words">
                          {group.reason}
                        </p>
                      </div>

                      {/* Right Action Buttons */}
                      <div className="shrink-0 flex flex-row sm:flex-col items-stretch sm:items-end gap-2 w-full sm:w-auto mt-2 sm:mt-0">
                        {isCompleted ? (
                          <div className="flex items-center justify-center gap-1.5 text-emerald-600 text-xs font-semibold px-4 py-2 bg-emerald-50 rounded-lg border border-emerald-100 w-full sm:w-auto">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Done</span>
                          </div>
                        ) : (
                          <div className="flex flex-wrap flex-1 sm:flex-initial gap-2 items-center">
                            {group.actionType === 'trash' && (
                              <button
                                onClick={() => executeGroupAction(group)}
                                disabled={isExecuting || activeEmailIds.length === 0}
                                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-3 sm:px-4 py-2 rounded-lg text-xs font-medium shadow-xs transition-colors disabled:opacity-50"
                              >
                                {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                <span>Trash ({activeEmailIds.length})</span>
                              </button>
                            )}

                            {group.actionType === 'archive' && (
                              <button
                                onClick={() => executeGroupAction(group)}
                                disabled={isExecuting || activeEmailIds.length === 0}
                                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-3 sm:px-4 py-2 rounded-lg text-xs font-medium shadow-xs transition-colors disabled:opacity-50"
                              >
                                {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                                <span>Archive ({activeEmailIds.length})</span>
                              </button>
                            )}

                            {group.actionType === 'move_to_label' && (
                              <button
                                onClick={() => executeGroupAction(group, !labelExists)}
                                disabled={isExecuting || activeEmailIds.length === 0}
                                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white px-3 sm:px-4 py-2 rounded-lg text-xs font-medium shadow-xs transition-colors disabled:opacity-50 min-w-[140px]"
                              >
                                {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderInput className="w-3.5 h-3.5 shrink-0" />}
                                <span className="truncate max-w-[120px] sm:max-w-[150px]">Move to {group.suggestedLabel || 'Label'}</span>
                              </button>
                            )}

                            {group.actionType === 'star_keep' && (
                              <button
                                onClick={() => executeGroupAction(group)}
                                disabled={isExecuting || activeEmailIds.length === 0}
                                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-3 sm:px-4 py-2 rounded-lg text-xs font-medium shadow-xs transition-colors disabled:opacity-50"
                              >
                                {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bookmark className="w-3.5 h-3.5 fill-current shrink-0" />}
                                <span className="whitespace-nowrap">Protect & Keep</span>
                              </button>
                            )}

                            <button
                              onClick={() => handleDismissGroup(group)}
                              disabled={isExecuting}
                              className="p-2 sm:p-1.5 shrink-0 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200 sm:border-transparent flex items-center justify-center"
                              title="Dismiss this sender from future recommendations"
                            >
                              <X className="w-4 h-4 sm:w-5 sm:h-5" />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Bottom Metadata & Expandable Emails */}
                    <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between text-xs gap-2">
                      <button
                        onClick={() => toggleExpandGroup(group.id)}
                        className="text-slate-600 hover:text-slate-900 font-medium flex items-center gap-1"
                      >
                        <span>{isExpanded ? 'Hide' : 'Review'} {sampleEmails.length} messages</span>
                        {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                      </button>

                      {group.filterQuery && !isCompleted && (
                        <div className="flex items-center gap-2">
                          {isFilterCreated ? (
                            <span className="text-[11px] text-emerald-600 flex items-center gap-1 font-medium">
                              <CheckCircle2 className="w-3 h-3" />
                              Rule Created
                            </span>
                          ) : (
                            <button
                              onClick={() => handleCreateRule(group)}
                              disabled={isCreatingFilter}
                              className="text-[11px] text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1 hover:underline disabled:opacity-50"
                            >
                              {isCreatingFilter ? <Loader2 className="w-3 h-3 animate-spin" /> : <Filter className="w-3 h-3" />}
                              <span>Auto-apply to future</span>
                            </button>
                          )}
                        </div>
                      )}
                    </div>`;

const newRenderBlock = `                  <div
                    key={group.id}
                    className={cn(
                      "bg-white border rounded-xl p-4 shadow-xs transition-all flex flex-col gap-0",
                      isCompleted ? "border-slate-200 opacity-60 bg-slate-50/50" : "border-slate-200 hover:border-slate-300"
                    )}
                  >
                    {/* Header Row: Sender Info & Dismiss */}
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 flex-wrap min-w-0">
                        <span className="font-semibold text-slate-900 text-sm truncate max-w-[200px] sm:max-w-xs">
                          {group.sender}
                        </span>
                        <span className="text-[11px] px-2 py-0.5 rounded-md font-medium bg-slate-100 text-slate-600 shrink-0">
                          {group.categoryTag}
                        </span>
                        <span className="text-xs text-slate-400 shrink-0">
                          • {activeEmailIds.length} {activeEmailIds.length === 1 ? 'email' : 'emails'}
                        </span>
                      </div>
                      
                      {!isCompleted && (
                        <button
                          onClick={() => handleDismissGroup(group)}
                          disabled={isExecuting}
                          className="p-1.5 shrink-0 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors -mt-1 -mr-1"
                          title="Dismiss this recommendation"
                        >
                          <X className="w-4 h-4 sm:w-5 sm:h-5" />
                        </button>
                      )}
                    </div>

                    {/* Title & Description */}
                    <div className="mb-4">
                      <h4 className="text-sm font-bold text-slate-800 leading-snug break-words">
                        {group.title}
                      </h4>
                      <p className="text-xs text-slate-500 mt-1.5 leading-relaxed break-words">
                        {group.reason}
                      </p>
                    </div>

                    {/* Footer Row: Metadata & Actions */}
                    <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      
                      {/* Left: Review & Rule */}
                      <div className="flex flex-wrap items-center gap-3 text-xs">
                        <button
                          onClick={() => toggleExpandGroup(group.id)}
                          className="text-slate-600 hover:text-slate-900 font-medium flex items-center gap-1"
                        >
                          <span>{isExpanded ? 'Hide' : 'Review'} {sampleEmails.length} messages</span>
                          {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>

                        {group.filterQuery && !isCompleted && (
                          <div className="hidden sm:block w-px h-3.5 bg-slate-200"></div>
                        )}

                        {group.filterQuery && !isCompleted && (
                          <div className="flex items-center">
                            {isFilterCreated ? (
                              <span className="text-[11px] text-emerald-600 flex items-center gap-1 font-medium">
                                <CheckCircle2 className="w-3 h-3" />
                                Rule Created
                              </span>
                            ) : (
                              <button
                                onClick={() => handleCreateRule(group)}
                                disabled={isCreatingFilter}
                                className="text-[11px] text-slate-500 hover:text-slate-800 font-medium flex items-center gap-1 hover:underline disabled:opacity-50"
                              >
                                {isCreatingFilter ? <Loader2 className="w-3 h-3 animate-spin" /> : <Filter className="w-3 h-3" />}
                                <span>Auto-apply to future</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Right: Primary Action Button */}
                      <div className="shrink-0 w-full sm:w-auto">
                        {isCompleted ? (
                          <div className="flex items-center justify-center gap-1.5 text-emerald-600 text-xs font-semibold px-4 py-2 bg-emerald-50 rounded-lg border border-emerald-100 w-full">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Done</span>
                          </div>
                        ) : (
                          <div className="flex w-full">
                            {group.actionType === 'trash' && (
                              <button
                                onClick={() => executeGroupAction(group)}
                                disabled={isExecuting || activeEmailIds.length === 0}
                                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-rose-600 hover:bg-rose-700 text-white px-4 py-2 rounded-lg text-xs font-medium shadow-xs transition-colors disabled:opacity-50"
                              >
                                {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                                <span>Trash ({activeEmailIds.length})</span>
                              </button>
                            )}

                            {group.actionType === 'archive' && (
                              <button
                                onClick={() => executeGroupAction(group)}
                                disabled={isExecuting || activeEmailIds.length === 0}
                                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-xs font-medium shadow-xs transition-colors disabled:opacity-50"
                              >
                                {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Archive className="w-3.5 h-3.5" />}
                                <span>Archive ({activeEmailIds.length})</span>
                              </button>
                            )}

                            {group.actionType === 'move_to_label' && (
                              <button
                                onClick={() => executeGroupAction(group, !labelExists)}
                                disabled={isExecuting || activeEmailIds.length === 0}
                                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 rounded-lg text-xs font-medium shadow-xs transition-colors disabled:opacity-50"
                              >
                                {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FolderInput className="w-3.5 h-3.5 shrink-0" />}
                                <span className="truncate max-w-[150px]">Move to {group.suggestedLabel || 'Label'}</span>
                              </button>
                            )}

                            {group.actionType === 'star_keep' && (
                              <button
                                onClick={() => executeGroupAction(group)}
                                disabled={isExecuting || activeEmailIds.length === 0}
                                className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-4 py-2 rounded-lg text-xs font-medium shadow-xs transition-colors disabled:opacity-50"
                              >
                                {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Bookmark className="w-3.5 h-3.5 fill-current shrink-0" />}
                                <span className="whitespace-nowrap">Protect & Keep</span>
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>`;

if (!content.includes(oldRenderBlock)) {
  console.log("Could not find old render block");
} else {
  content = content.replace(oldRenderBlock, newRenderBlock);
  fs.writeFileSync('src/components/SmartTriageModal.tsx', content);
  console.log("Successfully patched SmartTriageModal layout");
}
