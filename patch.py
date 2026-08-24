import re

with open('src/components/HealthScoreModal.tsx', 'r') as f:
    content = f.read()

# 1. Query for unread
content = content.replace(
    'countEmails("is:unread in:inbox")',
    'countEmails("is:unread in:inbox -in:chats")'
)

# 2. Update togglePreview usage to onApplyQuery & Fix Now
unread_ui_old = """                          <button
                            onClick={() => togglePreview('unread', 'is:unread in:inbox')}
                            disabled={metrics.unreadInbox === 0}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <span>Review</span>
                            {expandedMetric === 'unread' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>
                      {renderEmailPreview('unread', unreadPenalty, 'Mark Read')}"""

unread_ui_new = """                          <div className="flex bg-slate-100 rounded-lg p-0.5 shadow-2xs">
                            {onApplyQuery && (
                              <button
                                onClick={() => {
                                  onClose();
                                  onApplyQuery('is:unread in:inbox -in:chats', 'inbox');
                                }}
                                disabled={metrics.unreadInbox === 0}
                                className="text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                              >
                                Inspect
                              </button>
                            )}
                            <button
                              onClick={() => handleFix('unread', unreadPenalty)}
                              disabled={metrics.unreadInbox === 0 || activeAction !== null}
                              className="text-xs font-bold px-3 py-1.5 rounded-md hover:bg-emerald-600 hover:text-white text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                            >
                              {activeAction === 'unread' ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null} Fix Now
                            </button>
                          </div>
                        </div>
                      </div>"""
content = content.replace(unread_ui_old, unread_ui_new)


spam_ui_old = """                          <button
                            onClick={() => togglePreview('spam', 'in:spam OR in:trash')}
                            disabled={metrics.spamAndTrash === 0}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <span>Review</span>
                            {expandedMetric === 'spam' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>
                      {renderEmailPreview('spam', spamPenalty, 'Empty Junk')}"""

spam_ui_new = """                          <div className="flex bg-slate-100 rounded-lg p-0.5 shadow-2xs">
                            {onApplyQuery && (
                              <button
                                onClick={() => {
                                  onClose();
                                  onApplyQuery('in:spam OR in:trash', 'anywhere');
                                }}
                                disabled={metrics.spamAndTrash === 0}
                                className="text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                              >
                                Inspect
                              </button>
                            )}
                            <button
                              onClick={() => handleFix('spam', spamPenalty)}
                              disabled={metrics.spamAndTrash === 0 || activeAction !== null}
                              className="text-xs font-bold px-3 py-1.5 rounded-md hover:bg-red-600 hover:text-white text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                            >
                              {activeAction === 'spam' ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null} Fix Now
                            </button>
                          </div>
                        </div>
                      </div>"""
content = content.replace(spam_ui_old, spam_ui_new)

promo_ui_old = """                          <button
                            onClick={() => togglePreview('promo', 'category:promotions older_than:6m -in:trash')}
                            disabled={metrics.oldPromotions === 0}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
                          >
                            <span>Review</span>
                            {expandedMetric === 'promo' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          </button>
                        </div>
                      </div>
                      {renderEmailPreview('promo', promoPenalty, 'Clean Ads')}"""

promo_ui_new = """                          <div className="flex bg-slate-100 rounded-lg p-0.5 shadow-2xs">
                            {onApplyQuery && (
                              <button
                                onClick={() => {
                                  onClose();
                                  onApplyQuery('category:promotions older_than:6m -in:trash', 'anywhere');
                                }}
                                disabled={metrics.oldPromotions === 0}
                                className="text-xs font-semibold px-3 py-1.5 rounded-md hover:bg-white hover:shadow-xs text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                              >
                                Inspect
                              </button>
                            )}
                            <button
                              onClick={() => handleFix('promo', promoPenalty)}
                              disabled={metrics.oldPromotions === 0 || activeAction !== null}
                              className="text-xs font-bold px-3 py-1.5 rounded-md hover:bg-amber-600 hover:text-white text-slate-700 transition-all cursor-pointer disabled:opacity-50"
                            >
                              {activeAction === 'promo' ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null} Fix Now
                            </button>
                          </div>
                        </div>
                      </div>"""
content = content.replace(promo_ui_old, promo_ui_new)

# 3. Clean up the unused state / methods
content = re.sub(r'const \[expandedMetric, setExpandedMetric\].*?\n', '', content)
content = re.sub(r'const \[previewEmails, setPreviewEmails\].*?\n', '', content)
content = re.sub(r'const \[loadingPreview, setLoadingPreview\].*?\n', '', content)
content = re.sub(r'const togglePreview = async \([^\{]+\{.*?\n  };\n', '', content, flags=re.DOTALL)
content = re.sub(r'const renderEmailPreview = \([^\{]+\{.*?\n  };\n', '', content, flags=re.DOTALL)

with open('src/components/HealthScoreModal.tsx', 'w') as f:
    f.write(content)
