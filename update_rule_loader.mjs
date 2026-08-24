import fs from 'fs';
let content = fs.readFileSync('src/components/RuleSuggester.tsx', 'utf8');

if (!content.includes('TypingLoader')) {
  content = content.replace("import { cn } from '../lib/utils';", "import { cn } from '../lib/utils';\nimport { TypingLoader } from './TypingLoader';");
}

const block = `        {loading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <Loader2 className="w-8 h-8 animate-spin text-slate-700" />
            <div className="text-center">
              <p className="text-sm font-semibold text-slate-700">Analyzing historical folder routing & inflow statistics...</p>
              <p className="text-xs text-slate-500 mt-1">Calculating Bayesian consistency scores and isolating recurring domain patterns.</p>
            </div>
          </div>`;

const replace = `        {loading ? (
          <div className="flex flex-col items-center justify-center py-6 sm:py-12 gap-4">
            <TypingLoader 
              title="Generating Smart Rules" 
              messages={[
                "Analyzing historical folder routing...",
                "Calculating Bayesian consistency scores...",
                "Isolating recurring domain patterns...",
                "Drafting optimal filter rules..."
              ]} 
            />
          </div>`;

content = content.replace(block, replace);
fs.writeFileSync('src/components/RuleSuggester.tsx', content);
