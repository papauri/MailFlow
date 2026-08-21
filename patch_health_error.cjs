const fs = require('fs');
let content = fs.readFileSync('src/components/InboxHealth.tsx', 'utf8');

content = content.replace(
  /if \(res\.status === 429\) \{[\s\S]*?\}/,
  `if (res.status === 429) {
          throw new Error("AI API rate limit reached. Please try again later or add your own key in Settings.");
        }
        if (res.status === 503) {
          throw new Error("The AI model is currently experiencing high demand. Please try again later, or try a different model in Settings.");
        }`
);

fs.writeFileSync('src/components/InboxHealth.tsx', content);
