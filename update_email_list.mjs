import fs from 'fs';
let content = fs.readFileSync('src/components/SmartTriageModal.tsx', 'utf8');

const oldRender = `<label
                              key={email.id}
                              className="flex items-start gap-2 p-1.5 rounded-md hover:bg-white transition-colors cursor-pointer text-xs"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleEmailInGroup(group.id, email.id)}
                                disabled={isCompleted}
                                className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-0 cursor-pointer"
                              />
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-slate-800 truncate">
                                  {email.subject || '(No Subject)'}
                                </p>
                                <p className="text-[11px] text-slate-500 truncate">
                                  {email.snippet || email.sender}
                                </p>
                              </div>
                              <span className="text-[10px] text-slate-400 shrink-0 whitespace-nowrap ml-2">
                                {email.date ? new Date(email.date).toLocaleDateString() : ''}
                              </span>
                            </label>`;

const newRender = `<div key={email.id} className="flex flex-col gap-1.5 p-2 rounded-md hover:bg-white transition-colors border border-transparent hover:border-slate-200">
                              <div className="flex items-start gap-2">
                                <label className="flex items-start gap-2 cursor-pointer flex-1 min-w-0">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleEmailInGroup(group.id, email.id)}
                                    disabled={isCompleted}
                                    className="mt-0.5 rounded border-slate-300 text-slate-900 focus:ring-0 cursor-pointer"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p className="font-semibold text-slate-800 break-words leading-snug">
                                      {email.subject || '(No Subject)'}
                                    </p>
                                  </div>
                                </label>
                                <div className="flex items-center gap-2 shrink-0">
                                  <span className="text-[10px] text-slate-400 whitespace-nowrap">
                                    {email.date ? new Date(email.date).toLocaleDateString() : ''}
                                  </span>
                                  <a
                                    href={\`https://mail.google.com/mail/u/0/#all/\${email.threadId || email.id}\`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-slate-400 hover:text-slate-700 p-1 rounded hover:bg-slate-100 transition-colors"
                                    title="Open in Gmail"
                                    onClick={(e) => e.stopPropagation()}
                                  >
                                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
                                  </a>
                                </div>
                              </div>
                              <div className="pl-6">
                                <p className="text-[11px] text-slate-500 line-clamp-3 break-words">
                                  <span className="font-medium text-slate-700 mr-1">{email.sender}</span>
                                  {email.snippet}
                                </p>
                              </div>
                            </div>`;

content = content.replace(oldRender, newRender);

// Let's also increase max-h of the list so it can fit taller emails
content = content.replace('max-h-48 overflow-y-auto', 'max-h-72 overflow-y-auto');

fs.writeFileSync('src/components/SmartTriageModal.tsx', content);
