import fs from 'fs';
let content = fs.readFileSync('src/components/SmartTriageModal.tsx', 'utf8');
const btnCode = `                      <button
                        onClick={() => {
                          if (onSearchQuery) {
                            onSearchQuery(insight.filterQuery);
                            onClose();
                          }
                        }}`;
console.log(content.includes(btnCode));
