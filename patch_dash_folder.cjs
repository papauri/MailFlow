const fs = require('fs');
let content = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

content = content.replace(
  /if \(\!actualFolderFilter\.includes\('anywhere'\)\) \{[\s\S]*?if \(folderQueries\.length > 0\) \{\s*parts\.push\(\`\(\$\{folderQueries\.join\(' OR '\)\}\)\`\);\s*\}\s*\}/,
  `if (!actualFolderFilter.includes('anywhere')) {
      const folderQueries = actualFolderFilter.map(f => {
        if (f.startsWith('category:')) return f;
        if (f === 'inbox') return 'in:inbox';
        if (f === 'spam') return 'in:spam';
        if (f === 'trash') return 'in:trash';
        return \`label:\${f.replace(/ /g, '-')}\`;
      });
      if (folderQueries.length > 0) {
        parts.push(\`(\${folderQueries.join(' OR ')})\`);
      }
    } else {
      parts.push('in:anywhere');
    }`
);

fs.writeFileSync('src/components/Dashboard.tsx', content);
