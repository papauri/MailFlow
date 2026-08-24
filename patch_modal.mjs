import fs from 'fs';

let content = fs.readFileSync('src/components/HealthScoreModal.tsx', 'utf8');

// 1. Update the unread query
content = content.replace(
  'countEmails("is:unread in:inbox")',
  'countEmails("is:unread in:inbox -in:chats")'
);

// 2. Remove preview states and renderEmailPreview
content = content.replace(/const \[expandedMetric, setExpandedMetric\].*?\n/g, '');
content = content.replace(/const \[previewEmails, setPreviewEmails\].*?\n/g, '');
content = content.replace(/const \[loadingPreview, setLoadingPreview\].*?\n/g, '');

const togglePreviewRegex = /const togglePreview = async \[\s\S]*?};\n/s;
// Let's just manually replace the UI blocks instead of doing complex regex for functions, because it's easier to just overwrite the specific blocks.
