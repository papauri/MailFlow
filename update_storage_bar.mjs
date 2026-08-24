import fs from 'fs';
let content = fs.readFileSync('src/components/StorageBreakdownBar.tsx', 'utf8');

content = content.replace(/<HardDrive className="w-4 h-4 sm:w-5 sm:h-5" \/>/g, '');
content = content.replace(/<div className="p-2 bg-slate-100 rounded-xl text-slate-700">\s*<\/div>/g, '');
content = content.replace(/<span className={segment\.colorText}>{segment\.icon}<\/span>/g, '');
content = content.replace(/<div className="p-1 rounded-md bg-white text-slate-700 group-hover:bg-slate-900 group-hover:text-white transition-colors shadow-2xs">\s*<ArrowRight className="w-3 h-3 group-hover:translate-x-0\.5 transition-transform" \/>\s*<\/div>/g, '');

fs.writeFileSync('src/components/StorageBreakdownBar.tsx', content);
