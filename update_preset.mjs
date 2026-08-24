import fs from 'fs';
let content = fs.readFileSync('src/components/CleanupPresetsBar.tsx', 'utf8');

content = content.replace('<Zap className="w-3.5 h-3.5 text-amber-500" />', '');
content = content.replace('<BookmarkPlus className="w-3.5 h-3.5" />', '');
content = content.replace('<span className="text-sm">{preset.emoji}</span>', '');

fs.writeFileSync('src/components/CleanupPresetsBar.tsx', content);
