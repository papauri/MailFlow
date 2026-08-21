const fs = require('fs');
let content = fs.readFileSync('src/components/InboxHealth.tsx', 'utf8');

content = content.replace(
  '<p className="text-sm text-slate-600 mb-2">We ran a natural language clustering model over your recent emails to find hidden patterns and bulk-cleanup opportunities.</p>',
  '<p className="text-sm text-slate-600 mb-2">Our system autonomously learns from your inbox data to identify hidden habits, common themes, and bulk-cleanup opportunities.</p>'
);

fs.writeFileSync('src/components/InboxHealth.tsx', content);
