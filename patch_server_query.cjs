const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  'required: ["operators"]',
  'query: { type: Type.STRING, description: "The final constructed Gmail search query string (e.g. \'from:amazon.com subject:receipt\')" },\n        },\n        required: ["query", "operators"]'
);

fs.writeFileSync('server.ts', content);
