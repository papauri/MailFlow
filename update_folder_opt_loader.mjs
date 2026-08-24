import fs from 'fs';
let content = fs.readFileSync('src/components/FolderOptimizer.tsx', 'utf8');

if (!content.includes('TypingLoader')) {
  content = content.replace("import { motion } from 'motion/react';", "import { motion } from 'motion/react';\nimport { TypingLoader } from './TypingLoader';");
}

const block = `        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-slate-700" />
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700">Analyzing sender patterns and topics...</p>
              <p className="text-xs text-slate-500 mt-1">Cross-referencing sender authenticity, subject context, and label relationships.</p>
            </div>
          </div>`;

const replace = `        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 gap-4">
            <TypingLoader 
              title="Optimizing Folders" 
              messages={[
                "Analyzing sender patterns...",
                "Extracting topic clusters...",
                "Cross-referencing subject context...",
                "Generating structural recommendations..."
              ]} 
            />
          </div>`;

content = content.replace(block, replace);
fs.writeFileSync('src/components/FolderOptimizer.tsx', content);
