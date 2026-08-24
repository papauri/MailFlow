import fs from 'fs';

let content = fs.readFileSync('src/components/HealthScoreModal.tsx', 'utf8');

const unreadOld = `{onApplyQuery && (
                          <button
                            onClick={() => {
                              onClose();
                              onApplyQuery('is:unread', 'inbox');
                            }}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <span>Triage</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}`;

const unreadNew = `<button
                          onClick={() => handleFix('unread', unreadPenalty)}
                          disabled={metrics.unreadInbox === 0 || activeAction !== null}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {activeAction === 'unread' ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>Mark Read</span>}
                        </button>`;
                        
const spamOld = `{onApplyQuery && (
                          <button
                            onClick={() => {
                              onClose();
                              onApplyQuery('', 'spam+trash');
                            }}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <span>Empty Junk</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}`;

const spamNew = `<button
                          onClick={() => handleFix('spam', spamPenalty)}
                          disabled={metrics.spamAndTrash === 0 || activeAction !== null}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {activeAction === 'spam' ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>Empty Junk</span>}
                        </button>`;

const promoOld = `{onApplyQuery && (
                          <button
                            onClick={() => {
                              onClose();
                              onApplyQuery('older_than:6m -in:trash', 'category:promotions');
                            }}
                            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1 transition-colors cursor-pointer"
                          >
                            <span>Clean Ads</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}`;

const promoNew = `<button
                          onClick={() => handleFix('promo', promoPenalty)}
                          disabled={metrics.oldPromotions === 0 || activeAction !== null}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-white flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
                        >
                          {activeAction === 'promo' ? <Loader2 className="w-3 h-3 animate-spin" /> : <span>Clean Ads</span>}
                        </button>`;


content = content.replace(unreadOld, unreadNew);
content = content.replace(spamOld, spamNew);
content = content.replace(promoOld, promoNew);

fs.writeFileSync('src/components/HealthScoreModal.tsx', content);
console.log("Patched buttons!");
