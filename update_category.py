import re

with open("src/components/CategoryDistributionModal.tsx", "r") as f:
    content = f.read()

start_marker = "const bodyContent = ("
end_marker = "    </div>\n  );\n\n  if (isWidget) {"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print("Could not find markers")
    exit(1)

new_bodyContent = """const bodyContent = (
    <div className="flex flex-col gap-6 w-full pb-10">
      {/* Top Bento Grid: Donut + Categories */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 w-full">
        
        {/* Left: Donut Chart */}
        <div className="col-span-1 bg-white border border-slate-200 rounded-2xl p-5 shadow-xs flex flex-col items-center justify-center">
          <h3 className="w-full text-sm font-bold text-slate-900 mb-6 text-center">Volume Distribution</h3>
          {loadingDistribution ? (
            <div className="flex-1 flex flex-col items-center justify-center min-h-[200px]">
              <Loader2 className="w-6 h-6 animate-spin text-slate-400 mb-2" />
              <span className="text-xs text-slate-500">Analyzing...</span>
            </div>
          ) : distributionError ? (
             <div className="flex-1 flex items-center justify-center min-h-[200px] text-center text-xs text-red-500">
               {distributionError}
             </div>
          ) : data.length > 0 ? (
            <div className="w-full aspect-square relative flex items-center justify-center max-w-[220px] mx-auto mb-4">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    innerRadius="65%"
                    outerRadius="85%"
                    paddingAngle={3}
                    dataKey="value"
                    stroke="none"
                    onMouseEnter={(_, index) => setActiveIndex(index)}
                    onMouseLeave={() => setActiveIndex(null)}
                    onClick={(_, index) => {
                      if (data[index]) runCategoryAudit(data[index].id);
                    }}
                  >
                    {data.map((entry, index) => (
                      <Cell key={`cell-${entry.id}`} fill={entry.color} opacity={activeIndex === null || activeIndex === index ? 1 : 0.4} className="cursor-pointer" />
                    ))}
                  </Pie>
                  <Tooltip 
                    content={({ active, payload }) => {
                      if (active && payload && payload.length) {
                        const item = payload[0].payload;
                        const percent = totalCount > 0 ? ((item.value / totalCount) * 100).toFixed(1) : '0';
                        return (
                          <div className="bg-slate-900 text-white px-3 py-2 rounded-lg shadow-lg border border-slate-800 text-xs flex flex-col gap-0.5 pointer-events-none">
                            <div className="flex items-center gap-1.5 font-semibold">
                              <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: item.color }} />
                              <span>{item.name}</span>
                            </div>
                            <div className="text-slate-300 text-[11px]">{item.displayCount} emails ({percent}%)</div>
                          </div>
                        );
                      }
                      return null;
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                {activeIndex !== null && data[activeIndex] ? (
                  <>
                    <span className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{data[activeIndex].displayCount}</span>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">{data[activeIndex].name}</span>
                  </>
                ) : (
                  <>
                    <span className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">{totalCount.toLocaleString()}</span>
                    <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">Total</span>
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Right: Categories List */}
        <div className="col-span-1 lg:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden flex flex-col">
          <div className="p-4 sm:p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50">
            <div>
              <h3 className="text-sm sm:text-base font-bold text-slate-900">Category Scanner</h3>
              <p className="text-xs text-slate-500 mt-0.5">Select a category to audit unneeded emails.</p>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto max-h-[350px] custom-scrollbar">
            {data.map(cat => {
              const isSelected = selectedCategory === cat.id;
              const percent = totalCount > 0 ? Math.round((cat.value / totalCount) * 100) : 0;
              return (
                <div 
                  key={cat.id} 
                  className={cn(
                    "p-3 sm:p-4 border-b border-slate-100 last:border-0 flex items-center justify-between gap-4 cursor-pointer transition-colors group", 
                    isSelected ? "bg-indigo-50/50" : "hover:bg-slate-50"
                  )} 
                  onClick={() => runCategoryAudit(cat.id)}
                >
                   <div className="flex items-center gap-3">
                     <span className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: cat.color }} />
                     <div>
                       <h4 className={cn("font-semibold text-sm transition-colors", isSelected ? "text-indigo-900" : "text-slate-900")}>{cat.name}</h4>
                       <p className="text-xs text-slate-500">{cat.displayCount} emails ({percent}%)</p>
                     </div>
                   </div>
                   <div className="flex items-center gap-2 shrink-0">
                     {onApplyCategory && (
                       <button 
                         onClick={(e) => { e.stopPropagation(); onClose(); onApplyCategory(cat.query, cat.filter); }} 
                         className="p-1.5 text-slate-400 hover:text-slate-800 hover:bg-slate-200 rounded-lg transition-colors" 
                         title={`View emails in ${cat.name}`}
                       >
                         <Search className="w-4 h-4" />
                       </button>
                     )}
                     <button className={cn(
                       "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shadow-xs", 
                       isSelected ? "bg-indigo-600 text-white" : "bg-white border border-slate-200 text-slate-700 group-hover:border-slate-300"
                     )}>
                       {scanLoading && isSelected ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <span>Scan</span>}
                     </button>
                   </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Bottom: Scanner Results */}
      <div id="cleanup-recommendations" className="w-full mt-2">
         {scanLoading ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 shadow-xs flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="w-7 h-7 animate-spin text-slate-700" />
              <div>
                <h3 className="text-sm sm:text-base font-semibold text-slate-800">
                  Reviewing emails in "{currentCategoryConfig.name}"...
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Checking for expired login codes, receipts, and repetitive notifications.
                </p>
              </div>
            </div>
          ) : scanError ? (
            <div className="bg-white border border-red-200 rounded-2xl p-8 shadow-xs flex flex-col items-center justify-center gap-3 text-center">
              <AlertCircle className="w-6 h-6 text-red-500" />
              <p className="text-sm font-medium text-slate-800">{scanError}</p>
              <button
                onClick={() => runCategoryAudit(selectedCategory)}
                className="mt-1 flex items-center gap-1.5 bg-slate-900 text-white text-xs font-medium px-3.5 py-1.5 rounded-lg shadow-xs hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry
              </button>
            </div>
          ) : diagnostic ? (
            <div className="flex flex-col gap-6">
              {/* Priority Review Card */}
              {attentionItems.filter(i => !dismissedAttentionIds.has(i.id)).length > 0 && (
                <div className="bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent border border-amber-200/90 rounded-2xl p-4 sm:p-5 shadow-xs">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-amber-100 text-amber-800 rounded-xl shrink-0 shadow-2xs">
                        <AlertCircle className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="font-semibold text-slate-900 text-sm sm:text-base">
                            Attention Required in {currentCategoryConfig.name} ({attentionItems.filter(i => !dismissedAttentionIds.has(i.id)).length})
                          </h4>
                          <span className="inline-flex items-center gap-1 text-[11px] font-medium bg-white text-slate-700 px-2 py-0.5 rounded-full border border-amber-200 shadow-2xs">
                            <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Zero Data Spills • In-Memory Scanner</span>
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 mt-0.5">
                          Review urgent bills, security notices, flight itineraries, or actionable items detected in this category.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto justify-end">
                      <button
                        onClick={handleProtectAllAttention}
                        disabled={protectingAllAttention || attentionItems.filter(i => !dismissedAttentionIds.has(i.id) && !handledAttentionIds.has(i.id)).length === 0}
                        className="w-full sm:w-auto flex items-center justify-center gap-1.5 bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-2 rounded-lg text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                      >
                        {protectingAllAttention ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Bookmark className="w-3.5 h-3.5 fill-current" />
                        )}
                        <span>Protect All ({attentionItems.filter(i => !dismissedAttentionIds.has(i.id) && !handledAttentionIds.has(i.id)).length})</span>
                      </button>
                    </div>
                  </div>

                  {/* Attention Items Grid */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {attentionItems.filter(i => !dismissedAttentionIds.has(i.id)).map(item => {
                      const isHandled = handledAttentionIds.has(item.id);
                      const isHandling = handlingAttentionId === item.id;

                      return (
                        <div key={item.id} className="bg-white border border-amber-200/60 rounded-xl p-3.5 sm:p-4 flex flex-col justify-between shadow-xs relative overflow-hidden group">
                          {isHandled && (
                            <div className="absolute inset-0 bg-white/80 backdrop-blur-xs flex items-center justify-center z-10">
                              <span className="flex items-center gap-1.5 text-emerald-700 font-semibold text-sm bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200 shadow-xs">
                                <CheckCircle className="w-4 h-4" />
                                Protected
                              </span>
                            </div>
                          )}

                          <div className="flex items-start justify-between gap-3 mb-2">
                            <div className="flex-1 min-w-0 pr-2">
                              <div className="flex items-center gap-2 flex-wrap mb-1">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-100">
                                  {item.tag}
                                </span>
                                {item.date && (
                                  <span className="text-[10px] text-slate-500 font-medium">{item.date}</span>
                                )}
                              </div>
                              <h4 className="font-semibold text-slate-900 text-sm truncate" title={item.subject}>{item.subject}</h4>
                              <p className="text-xs text-slate-500 truncate" title={item.sender}>{item.sender}</p>
                            </div>
                            <button
                              onClick={() => setDismissedAttentionIds(prev => new Set(prev).add(item.id))}
                              className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors shrink-0"
                              title="Dismiss"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          
                          <p className="text-[11px] text-slate-600 bg-amber-50/50 p-2 rounded-lg border border-amber-100/50 mb-3">
                            {item.reason}
                          </p>
                          
                          <div className="flex items-center gap-2 mt-auto">
                            <button
                              onClick={() => handleStarAttention(item)}
                              disabled={isHandling}
                              className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
                            >
                              {isHandling ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bookmark className="w-3 h-3" />}
                              <span>Protect</span>
                            </button>
                            <button
                              onClick={() => handleLabelAttention(item, 'Action Items')}
                              disabled={isHandling}
                              className="flex-1 flex items-center justify-center gap-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors disabled:opacity-50"
                            >
                              {isHandling ? <Loader2 className="w-3 h-3 animate-spin" /> : <FolderPlus className="w-3 h-3" />}
                              <span>To Action</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Action Bundles Card */}
              <div className="bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
                <div className="p-4 sm:p-5 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50">
                  <div className="flex items-center gap-3">
                    <div className="p-2.5 bg-blue-100 text-blue-700 rounded-xl shadow-2xs">
                      <AlertTriangle className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="font-bold text-slate-900 text-base">Suggested Cleanups</h4>
                        <span className="text-[11px] font-semibold bg-white text-slate-700 px-2 py-0.5 rounded-full border border-slate-200 shadow-2xs">
                          {actionBundles.length} Bundles Found
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Bulk actions recommended for {currentCategoryConfig.name}.
                      </p>
                    </div>
                  </div>

                  {actionBundles.filter(b => !completedBundleIds.has(b.id)).length > 0 && (
                    <button
                      onClick={handleExecuteAll}
                      disabled={executingAll}
                      className="flex items-center justify-center gap-1.5 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
                    >
                      {executingAll ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          <span>Executing...</span>
                        </>
                      ) : (
                        <>
                          <span>Apply All Pending</span>
                          <ArrowRight className="w-3.5 h-3.5" />
                        </>
                      )}
                    </button>
                  )}
                </div>
                
                {/* Filters */}
                <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2 overflow-x-auto custom-scrollbar">
                  {[
                    { id: 'all', label: 'All Actions' },
                    { id: 'trash', label: 'Trash' },
                    { id: 'archive', label: 'Archive' },
                    { id: 'move', label: 'Move' }
                  ].map(f => (
                    <button
                      key={f.id}
                      onClick={() => setActionFilter(f.id as any)}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap",
                        actionFilter === f.id
                          ? "bg-slate-800 text-white"
                          : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* Bundle Grid */}
                <div className="p-4 sm:p-5 bg-slate-50/50">
                  {filteredBundles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-center">
                      <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mb-3">
                        <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                      </div>
                      <h4 className="font-semibold text-slate-900 text-sm">No pending cleanups</h4>
                      <p className="text-xs text-slate-500 mt-1">This category is well-maintained.</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {filteredBundles.map(bundle => {
                        const isCompleted = completedBundleIds.has(bundle.id);
                        const isExecuting = executingBundleId === bundle.id;
                        const isFilterCreated = createdFilterIds.has(bundle.id);
                        const isFilterCreating = creatingFilterId === bundle.id;
                        const activeEmailCount = bundle.emailIds.length - (bundle.deselectedEmailIds?.length || 0);

                        return (
                          <div key={bundle.id} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col justify-between shadow-xs transition-all hover:shadow-md hover:border-slate-300">
                            <div>
                              <div className="flex items-center justify-between gap-2 mb-3">
                                <div className="flex items-center gap-2">
                                  <span className={cn(
                                    "p-1.5 rounded-lg border",
                                    bundle.actionType === 'trash' ? "bg-rose-50 border-rose-100 text-rose-600" :
                                    bundle.actionType === 'archive' ? "bg-slate-100 border-slate-200 text-slate-700" :
                                    bundle.actionType === 'move_to_label' ? "bg-blue-50 border-blue-100 text-blue-600" :
                                    "bg-amber-50 border-amber-100 text-amber-600"
                                  )}>
                                    {bundle.actionType === 'trash' ? <Trash2 className="w-4 h-4" /> :
                                     bundle.actionType === 'move_to_label' ? <FolderInput className="w-4 h-4" /> :
                                     bundle.actionType === 'star_keep' ? <Bookmark className="w-4 h-4" /> :
                                     <Archive className="w-4 h-4" />}
                                  </span>
                                  <span className="text-[11px] font-bold tracking-wider uppercase text-slate-500">
                                    {bundle.categoryTag}
                                  </span>
                                </div>
                                {isCompleted ? (
                                  <span className="flex items-center gap-1 text-emerald-600 text-xs font-semibold bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                                    <CheckCircle2 className="w-3 h-3" /> Done
                                  </span>
                                ) : (
                                  <span className="text-[11px] font-semibold bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md border border-slate-200">
                                    {activeEmailCount} items
                                  </span>
                                )}
                              </div>
                              <h4 className="font-bold text-slate-900 text-sm leading-snug">{bundle.title}</h4>
                              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed line-clamp-2">{bundle.description}</p>
                            </div>
                            
                            <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col gap-2">
                              {!isCompleted && (
                                <button
                                  onClick={() => setInspectingBundle(bundle)}
                                  className="self-start flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 transition-colors"
                                >
                                  <Search className="w-3.5 h-3.5" />
                                  <span>Review emails</span>
                                </button>
                              )}
                              {!isCompleted ? (
                                <button
                                  onClick={() => handleExecuteBundle(bundle)}
                                  disabled={isExecuting || activeEmailCount === 0}
                                  className={cn(
                                    "w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-colors disabled:opacity-50 shadow-xs",
                                    bundle.actionType === 'trash' ? "bg-rose-600 hover:bg-rose-700 text-white" :
                                    bundle.actionType === 'move_to_label' ? "bg-blue-600 hover:bg-blue-700 text-white" :
                                    bundle.actionType === 'star_keep' ? "bg-amber-600 hover:bg-amber-700 text-white" :
                                    "bg-slate-800 hover:bg-slate-900 text-white"
                                  )}
                                >
                                  {isExecuting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 
                                   bundle.actionType === 'trash' ? <Trash2 className="w-3.5 h-3.5" /> : 
                                   bundle.actionType === 'move_to_label' ? <FolderInput className="w-3.5 h-3.5" /> : 
                                   bundle.actionType === 'star_keep' ? <Bookmark className="w-3.5 h-3.5" /> : 
                                   <Archive className="w-3.5 h-3.5" />}
                                  <span>
                                    {bundle.actionType === 'trash' ? `Trash ${activeEmailCount}` : 
                                     bundle.actionType === 'move_to_label' ? `Move ${activeEmailCount}` : 
                                     bundle.actionType === 'star_keep' ? `Protect ${activeEmailCount}` : 
                                     `Archive ${activeEmailCount}`}
                                  </span>
                                </button>
                              ) : (
                                bundle.suggestFilterRule && !isFilterCreated ? (
                                  <button
                                    onClick={() => handleCreateRule(bundle)}
                                    disabled={isFilterCreating}
                                    className="w-full flex items-center justify-center gap-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 px-3 py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50"
                                  >
                                    {isFilterCreating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Filter className="w-3.5 h-3.5" />}
                                    <span>Create Filter Rule</span>
                                  </button>
                                ) : isFilterCreated ? (
                                  <div className="w-full flex items-center justify-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-500 px-3 py-2 rounded-lg text-xs font-semibold">
                                    <CheckCircle2 className="w-3.5 h-3.5" /> Filter Active
                                  </div>
                                ) : (
                                  <div className="w-full flex items-center justify-center gap-1.5 bg-slate-50 border border-slate-200 text-slate-400 px-3 py-2 rounded-lg text-xs font-semibold">
                                    Done
                                  </div>
                                )
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : null}
      </div>

      {inspectingBundle && (
        <EmailReviewView
          title={inspectingBundle.title}
          subtitle={inspectingBundle.categoryTag}
          emails={categoryEmails.filter(e => inspectingBundle.emailIds.includes(e.id))}
          selectedEmailIds={new Set(inspectingBundle.emailIds.filter(id => !(inspectingBundle.deselectedEmailIds || []).includes(id)))}
          onToggleSelect={(id) => toggleEmailInBundle(inspectingBundle.id, id)}
          onToggleSelectAll={() => {}}
          onBack={() => setInspectingBundle(null)}
          onExecute={() => { handleExecuteBundle(inspectingBundle); setInspectingBundle(null); }}
          actionLabel={
            inspectingBundle.actionType === 'trash' ? 'Trash' :
            inspectingBundle.actionType === 'move_to_label' ? `Move to ${inspectingBundle.suggestedLabel || 'Folder'}` :
            inspectingBundle.actionType === 'star_keep' ? 'Protect' : 'Archive'
          }
          isExecuting={executingBundleId === inspectingBundle.id}
          isFullModal={false}
        />
      )}
    </div>
  );"""

new_content = content[:start_idx] + new_bodyContent + "\n\n  if (isWidget) {" + content[end_idx+len(end_marker):]

with open("src/components/CategoryDistributionModal.tsx", "w") as f:
    f.write(new_content)

print("Done")
