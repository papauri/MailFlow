const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

// I will fix the schema completely for parse-query.
const correctSchema = `      const schema = {
        type: Type.OBJECT,
        properties: {
          operators: {
            type: Type.OBJECT,
            description: "The structured search operators",
            properties: {
              from: { type: Type.STRING, description: "Sender name or domain" },
              subject: { type: Type.STRING, description: "Subject keywords" },
              after: { type: Type.STRING, description: "YYYY/MM/DD date string" },
              before: { type: Type.STRING, description: "YYYY/MM/DD date string" },
              folder: { type: Type.STRING, description: "Specific folder query, e.g. in:inbox, in:spam, in:trash" },
              general: { type: Type.STRING, description: "Any other keywords or search string, e.g. (otp OR code)" },
              inAnywhere: { type: Type.BOOLEAN, description: "Should be true by default to search all folders unless specific folder requested" }
            }
          },
          explanation: { type: Type.STRING, description: "A brief explanation of what the query does" },
          suggestedFolder: { type: Type.STRING, description: "A human-readable smart folder name like 'Finance', 'Travel', or 'Subscriptions'." },
          suggestedGmailCategory: { type: Type.STRING, description: "The closest Gmail system category ID: CATEGORY_UPDATES, CATEGORY_PROMOTIONS, CATEGORY_SOCIAL, or CATEGORY_PERSONAL." },
          query: { type: Type.STRING, description: "The final constructed Gmail search query string (e.g. 'from:amazon.com subject:receipt')" }
        },
        required: ["operators", "query"]
      };`;

content = content.replace(
  /const schema = \{\s*type: Type\.OBJECT,[\s\S]*?required: \["query", "operators"\]\s*\};\s*const aiPrompt =/m,
  correctSchema + "\n\n      const aiPrompt ="
);

fs.writeFileSync('server.ts', content);
