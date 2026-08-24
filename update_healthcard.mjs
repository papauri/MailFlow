import fs from 'fs';
let content = fs.readFileSync('src/components/InboxHealth.tsx', 'utf8');

// Replace HealthCard definition
content = content.replace(
  /function HealthCard[^\{]*\{([^]*?)return \([\s\S]*?<\/button>\s*\);\s*\}/,
  `function HealthCard({ title, count, desc, actionText, onAction, sizeEstimate }: any) {
  const displayCount = typeof count === 'string' ? count : (count || 0).toLocaleString();
  return (
    <button 
      onClick={onAction}
      className="bg-white rounded-xl border border-slate-200 hover:border-slate-800 p-4 flex flex-col gap-2 transition-all text-left group hover:shadow-xs items-start w-full relative overflow-hidden"
    >
      <div className="flex-1 flex flex-col min-w-0 pr-2 w-full">
        <h3 className="font-bold text-slate-900 text-sm truncate flex items-center gap-2">
          {title}
        </h3>
        <p className="text-xs text-slate-500 leading-snug line-clamp-2 mt-1">{desc}</p>
      </div>
      
      <div className="flex flex-col items-start pt-2 mt-auto shrink-0 w-full">
        <div className="flex items-baseline gap-2">
           <span className="text-xl font-bold text-slate-800 tracking-tight">{displayCount}</span>
           {sizeEstimate > 0 && (
              <span className="text-[10px] font-semibold text-slate-500 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 text-left whitespace-nowrap">
                ~{formatSize(sizeEstimate)}
              </span>
           )}
        </div>
        <div className="flex items-center text-[11px] font-semibold text-slate-500 group-hover:text-slate-900 transition-colors mt-2">
          {actionText}
          <ArrowRight className="w-3.5 h-3.5 sm:group-hover:translate-x-1 transition-transform ml-1" />
        </div>
      </div>
    </button>
  );
}`
);

// Remove icons passed to HealthCard
content = content.replace(/icon=\{<[^>]+>\}\s*iconBg="[^"]+"\s*/g, '');

// Remove SlidersHorizontal icon and container from InboxHealth top
content = content.replace(/<div className="p-2\.5 sm:p-3\.5 bg-white border border-slate-100 text-slate-700 rounded-xl shadow-2xs shrink-0">\s*<SlidersHorizontal className="w-5 h-5 sm:w-6 sm:h-6" \/>\s*<\/div>/g, '');

// Remove icons from buttons
content = content.replace(/<Download className="w-4 h-4 text-slate-400" \/>/g, '');
content = content.replace(/<PieChart className="w-4 h-4 text-slate-300" \/>/g, '');
content = content.replace(/<Activity className="w-5 h-5 text-slate-500" \/>/g, '');

fs.writeFileSync('src/components/InboxHealth.tsx', content);
