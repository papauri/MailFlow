const fs = require('fs');
let content = fs.readFileSync('src/components/InboxHealth.tsx', 'utf8');

content = content.replace(
  'setTopSenders(Array.from(senderCounts.values()).sort((a, b) => b.count - a.count).slice(0, 6));\n        setTopDomains(Array.from(domainCounts.values()).sort((a, b) => b.count - a.count).slice(0, 6));',
  `const rawSenders = Array.from(senderCounts.values()).sort((a, b) => b.count - a.count).slice(0, 6);
        const exactSenders = await Promise.all(rawSenders.map(async (s) => {
           const exactCount = await countEmails(\`from:\${s.email} in:anywhere\`);
           return { ...s, count: typeof exactCount === 'number' ? exactCount : s.count };
        }));
        setTopSenders(exactSenders.sort((a, b) => b.count - a.count));

        const rawDomains = Array.from(domainCounts.values()).sort((a, b) => b.count - a.count).slice(0, 6);
        const exactDomains = await Promise.all(rawDomains.map(async (d) => {
           const exactCount = await countEmails(\`from:\${d.domain} in:anywhere\`);
           return { ...d, count: typeof exactCount === 'number' ? exactCount : d.count };
        }));
        setTopDomains(exactDomains.sort((a, b) => b.count - a.count));`
);

fs.writeFileSync('src/components/InboxHealth.tsx', content);
