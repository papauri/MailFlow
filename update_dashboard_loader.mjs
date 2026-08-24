import fs from 'fs';
let content = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

if (!content.includes('TypingLoader')) {
  content = content.replace('import { InboxHealth } from "./InboxHealth";', 'import { InboxHealth } from "./InboxHealth";\nimport { TypingLoader } from "./TypingLoader";');
}

const searchBlock = `                <div className="flex flex-col items-center justify-center h-96 text-slate-400 px-4 text-center">
                  <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6">
                    <Loader2 className="w-8 h-8 text-slate-400 animate-spin" />
                  </div>
                  <h3 className="text-lg font-bold text-slate-700 mb-2">Loading messages...</h3>
                  <p className="text-sm text-slate-500 max-w-sm mb-6">
                    Fetching your emails from Gmail.
                  </p>
                </div>`;

const newBlock = `                <div className="flex flex-col items-center justify-center h-96 text-slate-400 px-4 text-center">
                  <TypingLoader 
                    title="Loading Messages" 
                    messages={[
                      "Fetching emails from Gmail...",
                      "Applying current filters...",
                      "Sorting inbox...",
                      "Preparing view..."
                    ]} 
                  />
                </div>`;

content = content.replace(searchBlock, newBlock);
fs.writeFileSync('src/components/Dashboard.tsx', content);
