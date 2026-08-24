import fs from 'fs';
let content = fs.readFileSync('src/components/SmartTriageModal.tsx', 'utf8');

if (!content.includes('TypingLoader')) {
  content = content.replace("import { motion } from 'motion/react';", "import { motion } from 'motion/react';\nimport { TypingLoader } from './TypingLoader';");
}

const block = `          {loading ? (
            <div className="h-72 flex flex-col items-center justify-center gap-3 text-center">
              <Loader2 className="w-7 h-7 text-slate-700 animate-spin" />
              <div>
                <p className="text-sm font-semibold text-slate-800">Analyzing your inbox...</p>
                <p className="text-xs text-slate-500 mt-0.5">Grouping emails by recurring senders, receipts, and notifications.</p>
              </div>
            </div>`;

const replace = `          {loading ? (
            <div className="h-72 flex flex-col items-center justify-center gap-3 text-center">
              <TypingLoader 
                title="Triaging Inbox" 
                messages={[
                  "Analyzing unorganized emails...",
                  "Grouping by recurring senders...",
                  "Isolating receipts and notifications...",
                  "Preparing smart recommendations..."
                ]} 
              />
            </div>`;

content = content.replace(block, replace);
fs.writeFileSync('src/components/SmartTriageModal.tsx', content);
