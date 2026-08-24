import fs from 'fs';
let content = fs.readFileSync('src/App.tsx', 'utf8');

// Ensure import is there
if (!content.includes('TypingLoader')) {
  content = content.replace("import { Dashboard } from './components/Dashboard';", "import { Dashboard } from './components/Dashboard';\nimport { TypingLoader } from './components/TypingLoader';");
}

const searchBlock = `  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    );
  }`;

const newBlock = `  if (isInitializing) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <TypingLoader 
          title="Initializing Workspace" 
          messages={[
            "Connecting to secure servers...",
            "Loading your preferences...",
            "Preparing MailFlow environment..."
          ]} 
        />
      </div>
    );
  }`;

content = content.replace(searchBlock, newBlock);
fs.writeFileSync('src/App.tsx', content);
