import fs from 'fs';

let content = fs.readFileSync('src/components/SmartTriageModal.tsx', 'utf8');

const oldStr = `<div className="flex-1 bg-slate-50/50 p-4 sm:p-6">`;
const newStr = `<div className="flex-1 bg-slate-50/50 p-4 sm:p-6 overflow-y-auto">`;

if (content.includes(oldStr)) {
  content = content.replace(oldStr, newStr);
  fs.writeFileSync('src/components/SmartTriageModal.tsx', content);
  console.log("Successfully added overflow-y-auto to main list");
} else {
  console.log("Could not find the target string for overflow.");
}
