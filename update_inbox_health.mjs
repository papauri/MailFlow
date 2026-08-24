import fs from 'fs';
let content = fs.readFileSync('src/components/InboxHealth.tsx', 'utf8');

// Add import
if (!content.includes('TypingLoader')) {
  content = content.replace("import { WalkthroughTip } from './WalkthroughTip';", "import { WalkthroughTip } from './WalkthroughTip';\nimport { TypingLoader } from './TypingLoader';");
}

// Replace loading block
const searchBlock = `  if (loading || isLoadingEmails) {
    return (
      <div className="p-16 flex flex-col items-center justify-center text-slate-500 gap-4 mt-8">
        <Loader2 className="w-8 h-8 animate-spin text-slate-500" />
        <h2 className="text-xl font-semibold text-slate-800">Analyzing Inbox Health</h2>
        <p className="text-sm">Scanning folders, calculating sizes, and running email distribution analysis...</p>
      </div>
    );
  }`;

const newBlock = `  if (loading || isLoadingEmails) {
    return <TypingLoader />;
  }`;

content = content.replace(searchBlock, newBlock);

fs.writeFileSync('src/components/InboxHealth.tsx', content);
