const fs = require('fs');
let content = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

content = content.replace(
  'const handleSearch = async (e?: FormEvent, customQuery?: string, customFilters?: string[]) => {',
  'const handleSearch = async (e?: FormEvent, customQuery?: string, customFilters?: string[], bypassAI: boolean = false) => {'
);

content = content.replace(
  'if (useAI && textQuery.trim()) {',
  'if (useAI && textQuery.trim() && !bypassAI) {'
);

content = content.replace(
  'setTimeout(() => handleSearch(undefined, q, newFilters), 0);',
  'setTimeout(() => handleSearch(undefined, q, newFilters, true), 0);'
);

// We need to also add in:anywhere when 'anywhere' is selected, so it searches the WHOLE inbox (spam, trash, etc.) if needed.
// Wait, the prompt says "make sure these top senders and domain clusters etc check the whole inbox,even personal folders"
// "in:anywhere" does that.
// Let's modify handleSearch folder filter logic to push "in:anywhere" if it is 'anywhere'.
content = content.replace(
  /if \(!actualFolderFilter\.includes\('anywhere'\)\) \{[\s\S]*?parts\.push\(\`\(\$\{folderQueries\.join\(' OR '\)\}\)\`\);\n    \} else \{/,
  `if (!actualFolderFilter.includes('anywhere')) {
      const folderQueries = actualFolderFilter.map(f => {
        if (f.startsWith('category:')) return f;
        if (f === 'inbox') return 'in:inbox';
        if (f === 'spam') return 'in:spam';
        if (f === 'trash') return 'in:trash';
        return \`label:\${f}\`;
      });
      parts.push(\`(\${folderQueries.join(' OR ')})\`);
    } else {
      parts.push('in:anywhere');
`
);

fs.writeFileSync('src/components/Dashboard.tsx', content);
