const fs = require('fs');
let content = fs.readFileSync('src/components/InboxHealth.tsx', 'utf8');

content = content.replace(
  '<div key={i} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-3 shadow-sm hover:shadow-md transition-shadow">',
  '<div key={i} className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col gap-4 shadow-sm hover:shadow-md transition-shadow h-full">'
);

content = content.replace(
  'className="mt-2 w-full py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"',
  'className="mt-auto w-full py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-2"'
);

fs.writeFileSync('src/components/InboxHealth.tsx', content);
