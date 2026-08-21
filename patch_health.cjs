const fs = require('fs');
let content = fs.readFileSync('src/components/InboxHealth.tsx', 'utf8');

// Change searchEmails("", 250) to searchEmails("in:anywhere", 250)
content = content.replace(
  'const recentEmails = await searchEmails("", 250);',
  'const recentEmails = await searchEmails("in:anywhere", 250);'
);

// Fix the domain cluster filter to use from:domain.com instead of from:*domain.com
content = content.replace(
  /onClick=\{\(\) => onApplyQuery\(\`from:\*\$\{domainObj\.domain\}\`, "anywhere"\)\}/,
  'onClick={() => onApplyQuery(`from:${domainObj.domain}`, "anywhere")}'
);

fs.writeFileSync('src/components/InboxHealth.tsx', content);
