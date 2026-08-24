import fs from 'fs';
let content = fs.readFileSync('src/components/LabelManagerModal.tsx', 'utf8');

if (!content.includes('TypingLoader')) {
  content = content.replace("import { motion } from 'motion/react';", "import { motion } from 'motion/react';\nimport { TypingLoader } from './TypingLoader';");
}

const block = `              {loadingEmails ? (
                <div className="h-full flex flex-col items-center justify-center py-12 text-slate-400 gap-3">
                  <Loader2 className="w-8 h-8 animate-spin text-slate-600" />
                  <p className="text-xs font-semibold text-slate-600">Loading messages from "{currentFolder.name}"...</p>
                </div>
              ) : folderEmails.length === 0 ? (`;

const replace = `              {loadingEmails ? (
                <div className="h-full flex flex-col items-center justify-center py-12 text-slate-400 gap-3">
                  <TypingLoader 
                    title={\`Loading \${currentFolder.name}\`} 
                    messages={[
                      "Fetching emails...",
                      "Retrieving sender information...",
                      "Sorting by date..."
                    ]} 
                  />
                </div>
              ) : folderEmails.length === 0 ? (`;

content = content.replace(block, replace);
fs.writeFileSync('src/components/LabelManagerModal.tsx', content);
