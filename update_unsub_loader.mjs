import fs from 'fs';
let content = fs.readFileSync('src/components/UnsubscribeManager.tsx', 'utf8');

if (!content.includes('TypingLoader')) {
  content = content.replace("import { motion } from 'motion/react';", "import { motion } from 'motion/react';\nimport { TypingLoader } from './TypingLoader';");
}

const block = `              {loading ? (
                <div className="flex flex-col items-center justify-center gap-4 text-slate-500 p-16">
                  <Loader2 className="w-8 h-8 animate-spin text-slate-300" />
                  <span className="font-medium text-sm">Scanning inbox for newsletters and tracking lists...</span>
                </div>
              ) : subscriptions.length === 0 ? (`;

const replace = `              {loading ? (
                <div className="flex flex-col items-center justify-center gap-4 text-slate-500 p-4 sm:p-16">
                  <TypingLoader 
                    title="Finding Subscriptions" 
                    messages={[
                      "Scanning inbox for newsletters...",
                      "Identifying tracking lists...",
                      "Extracting unsubscribe links...",
                      "Grouping by sender..."
                    ]} 
                  />
                </div>
              ) : subscriptions.length === 0 ? (`;

content = content.replace(block, replace);
fs.writeFileSync('src/components/UnsubscribeManager.tsx', content);
