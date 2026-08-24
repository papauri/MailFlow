
import fs from 'fs';
let content = fs.readFileSync('src/components/HealthScoreModal.tsx', 'utf8');

const regexUnread = /<div className="p-3\.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">([\s\S]*?)(?:\{\/\* Item 2)/;
const matchUnread = content.match(regexUnread);
if (matchUnread) {
  content = content.replace(regexUnread, `<div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col shadow-2xs transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
${matchUnread[1]}
    {/* Item 2`);
}

const regexSpam = /<div className="p-3\.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">([\s\S]*?)(?:\{\/\* Item 3)/;
const matchSpam = content.match(regexSpam);
if (matchSpam) {
  content = content.replace(regexSpam, `<div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col shadow-2xs transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
${matchSpam[1]}
    {/* Item 3`);
}

const regexPromo = /<div className="p-3\.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs transition-colors">([\s\S]*?)(?:\{\/\* Item 4)/;
const matchPromo = content.match(regexPromo);
if (matchPromo) {
  content = content.replace(regexPromo, `<div className="p-3.5 bg-white border border-slate-200 hover:border-slate-300 rounded-xl flex flex-col shadow-2xs transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
${matchPromo[1]}
    {/* Item 4`);
}

fs.writeFileSync('src/components/HealthScoreModal.tsx', content);
