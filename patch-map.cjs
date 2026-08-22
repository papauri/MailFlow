const fs = require('fs');
let code = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

const newMapCode = `                <div className="flex flex-col gap-4 pb-4">
                  {groupedEmails.map((group, groupIdx) => (
                    <div key={groupIdx} className="bg-white">
                      {group.title && (
                        <div className="bg-slate-100/80 px-4 py-2 border-y border-slate-200 font-semibold text-slate-800 text-sm flex items-center justify-between sticky top-[68px] z-10 backdrop-blur-sm shadow-sm">
                          <span>{group.title}</span>
                          <span className="text-xs bg-white px-2 py-0.5 rounded-full border border-slate-200 text-slate-500 font-medium">{group.emails.length}</span>
                        </div>
                      )}
                      <ul className="divide-y divide-slate-100">
                        {group.emails.map(email => {`;

code = code.replace(
  `              <>
                <ul className="divide-y divide-slate-100">
                  {sortedEmails.map(email => {`,
  newMapCode
);

const newBadgeCode = `                              {(() => {
                                 const labels = email.labelIds || [];
                                 const badges = [];
                                 
                                 if (labels.includes('SPAM')) badges.push({ text: 'Spam', color: 'bg-red-50 text-red-700 border-red-100' });
                                 else if (labels.includes('TRASH')) badges.push({ text: 'Trash', color: 'bg-red-50 text-red-700 border-red-100' });
                                 
                                 labels.forEach(l => {
                                   if (l.startsWith('CATEGORY_')) {
                                      if (l === 'CATEGORY_PROMOTIONS') badges.push({ text: 'Promotions', color: 'bg-amber-50 text-amber-700 border-amber-100' });
                                      else if (l === 'CATEGORY_SOCIAL') badges.push({ text: 'Social', color: 'bg-purple-50 text-purple-700 border-purple-100' });
                                      else if (l === 'CATEGORY_UPDATES') badges.push({ text: 'Updates', color: 'bg-green-50 text-green-700 border-green-100' });
                                      else if (l === 'CATEGORY_FORUMS') badges.push({ text: 'Forums', color: 'bg-slate-100 text-slate-700 border-slate-200' });
                                      else if (l === 'CATEGORY_PERSONAL') badges.push({ text: 'Primary', color: 'bg-blue-50 text-blue-700 border-blue-100' });
                                   } else if (l === 'SENT') {
                                      badges.push({ text: 'Sent', color: 'bg-slate-100 text-slate-600 border-slate-200' });
                                   } else if (l === 'INBOX' && !labels.some(x => x.startsWith('CATEGORY_'))) {
                                      badges.push({ text: 'Inbox', color: 'bg-indigo-50 text-indigo-700 border-indigo-100' });
                                   } else if (!['UNREAD', 'STARRED', 'IMPORTANT', 'INBOX', 'SPAM', 'TRASH', 'SENT'].includes(l)) {
                                      // Custom Label
                                      const ul = userLabels.find(ul => ul.id === l);
                                      const name = ul ? ul.name : l.replace('Label_', 'Folder ');
                                      badges.push({ text: name, color: 'bg-teal-50 text-teal-700 border-teal-100' });
                                   }
                                 });
                                 
                                 // Deduplicate badges by text
                                 const uniqueBadges = Array.from(new Map(badges.map(item => [item.text, item])).values());
                                 
                                 return (
                                   <div className="flex gap-1.5 hidden sm:flex">
                                     {uniqueBadges.slice(0, 3).map((b, i) => (
                                       <span key={i} className={\`inline-block text-[10px] sm:text-xs font-semibold border px-1.5 py-0.5 rounded truncate max-w-[100px] \${b.color}\`}>
                                         {b.text}
                                       </span>
                                     ))}
                                     {uniqueBadges.length > 3 && (
                                       <span className="inline-block text-[10px] sm:text-xs font-semibold border px-1.5 py-0.5 rounded bg-slate-50 text-slate-500 border-slate-200">
                                         +{uniqueBadges.length - 3}
                                       </span>
                                     )}
                                   </div>
                                 );
                              })()}`;


// We need to replace the old IIFE badge block
// The easiest way is to use a regex or string replacement that covers the block
const oldBadgeBlock = `                              {(() => {
                                 let badge = '';
                                 let badgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-100';
                                 const labels = email.labelIds || [];
                                 // SPAM and TRASH take highest priority — if it's junk, show it
                                 if (labels.includes('SPAM')) { badge = 'Spam'; badgeColor = 'bg-red-50 text-red-700 border-red-100'; }
                                 else if (labels.includes('TRASH')) { badge = 'Trash'; badgeColor = 'bg-red-50 text-red-700 border-red-100'; }
                                 // Then sub-categories (within Inbox)
                                 else if (labels.includes('CATEGORY_PROMOTIONS')) { badge = 'Promotions'; badgeColor = 'bg-amber-50 text-amber-700 border-amber-100'; }
                                 else if (labels.includes('CATEGORY_SOCIAL')) { badge = 'Social'; badgeColor = 'bg-purple-50 text-purple-700 border-purple-100'; }
                                 else if (labels.includes('CATEGORY_UPDATES')) { badge = 'Updates'; badgeColor = 'bg-green-50 text-green-700 border-green-100'; }
                                 else if (labels.includes('CATEGORY_FORUMS')) { badge = 'Forums'; badgeColor = 'bg-slate-100 text-slate-700 border-slate-200'; }
                                 else if (labels.includes('CATEGORY_PERSONAL')) { badge = 'Primary'; badgeColor = 'bg-blue-50 text-blue-700 border-blue-100'; }
                                 else if (labels.includes('SENT')) { badge = 'Sent'; badgeColor = 'bg-slate-100 text-slate-600 border-slate-200'; }
                                 else if (labels.includes('INBOX')) { badge = 'Inbox'; badgeColor = 'bg-indigo-50 text-indigo-700 border-indigo-100'; }
                                 else {
                                   const custom = labels.find(l => !l.startsWith('CATEGORY_') && l !== 'UNREAD' && l !== 'STARRED' && l !== 'IMPORTANT');
                                   if (custom) badge = custom;
                                 }
                                 
                                 return badge ? (
                                   <span className={\`hidden sm:inline-block text-[10px] sm:text-xs font-semibold border px-1.5 py-0.5 rounded truncate max-w-[100px] \${badgeColor}\`}>
                                     {badge}
                                   </span>
                                 ) : null;
                              })()}`;
                              
code = code.replace(oldBadgeBlock, newBadgeCode);

// Add the closing tags for groupedEmails.map
// We have:
//                   })}
//                 </ul>
//               </>
// Replace with:
//                   })}
//                     </ul>
//                   </div>
//                 ))}
//               </div>
//             </>

code = code.replace(
  `                  })}
                </ul>
              </>`,
  `                  })}
                      </ul>
                    </div>
                  ))}
                </div>
              </>`
);


fs.writeFileSync('src/components/Dashboard.tsx', code);
console.log("Patched list map block and badges");
