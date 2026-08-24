import fs from 'fs';
let content = fs.readFileSync('src/components/CategoryDistributionModal.tsx', 'utf8');

if (!content.includes('TypingLoader')) {
  content = content.replace("import { motion } from 'motion/react';", "import { motion } from 'motion/react';\nimport { TypingLoader } from './TypingLoader';");
}

const block1 = `              {loadingDistribution ? (
                <div className="h-80 flex flex-col items-center justify-center gap-2 text-slate-500">
                  <Loader2 className="w-6 h-6 animate-spin text-slate-600" />
                  <p className="text-sm font-medium text-slate-700">Loading category counts...</p>
                </div>
              ) : distributionError ? (`;

const replace1 = `              {loadingDistribution ? (
                <div className="h-80 flex flex-col items-center justify-center gap-2 text-slate-500">
                  <TypingLoader 
                    title="Analyzing Categories" 
                    messages={[
                      "Fetching category counts...",
                      "Calculating total storage...",
                      "Analyzing distribution..."
                    ]} 
                  />
                </div>
              ) : distributionError ? (`;

const block2 = `              {scanLoading ? (
                <div className="bg-white border border-slate-200 rounded-xl p-12 shadow-xs flex flex-col items-center justify-center gap-3 text-center">
                  <Loader2 className="w-7 h-7 animate-spin text-slate-700" />
                  <div>
                    <h3 className="text-sm sm:text-base font-semibold text-slate-800">
                      Reviewing emails in "{currentCategoryConfig.name}"...
                    </h3>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Identifying largest threads and frequent senders.
                    </p>
                  </div>
                </div>
              ) : scanError ? (`;

const replace2 = `              {scanLoading ? (
                <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-12 shadow-xs flex flex-col items-center justify-center gap-3 text-center">
                  <TypingLoader 
                    title={\`Reviewing \${currentCategoryConfig.name}\`} 
                    messages={[
                      "Fetching messages...",
                      "Identifying largest threads...",
                      "Extracting frequent senders...",
                      "Analyzing category data..."
                    ]} 
                  />
                </div>
              ) : scanError ? (`;

content = content.replace(block1, replace1);
content = content.replace(block2, replace2);

fs.writeFileSync('src/components/CategoryDistributionModal.tsx', content);
