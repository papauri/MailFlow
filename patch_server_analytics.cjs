const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  "const emailText = emails.map(e => \`ID: \${e.id} | From: \${e.sender} | Subject: \${e.subject}\`).join('\\n');",
  "const emailText = emails.map(e => \`ID: \${e.id} | From: \${e.sender} | Subject: \${e.subject} | Labels: [\${(e.labelIds || []).join(', ')}]\`).join('\\n');"
);

const newPrompt = `const aiPrompt = \`You are an advanced data analysis engine designed to identify behavioral habits and structural patterns in an inbox.
        I am providing you a sample of email headers, including their current Gmail labels (e.g., UNREAD, CATEGORY_PROMOTIONS). 
        
        Your Goal: Perform a deep pattern analysis to identify actionable, high-volume groups that can be managed together. 
        Go beyond simple sender matching—look for habits, subscription cadences, transactional flows, auto-responses, financial summaries, promotional blasts, calendar invites, and system alerts.
        
        Pay special attention to read/unread habits. If you see high volumes of UNREAD emails from specific categories or senders, group them (e.g. "Ignored Promotions", "Unread Newsletters").
        
        Examples of Behavioral Bundles:
        - "Ignored Promotional Blasts" (Often UNREAD and CATEGORY_PROMOTIONS)
        - "Weekly Financial Summaries"
        - "Food Delivery Receipts"
        - "SaaS Trial Expirations"
        - "Project Management Mentions"
        - "Morning Newsletters" (Often UNREAD)

        CRITICAL RULES:
        1. Ignore human-to-human conversations. If a subject looks like a real conversation (e.g. "Checking in", "Dinner tonight?"), ignore it entirely.
        2. Focus ONLY on grouping the automated, recurring, or transactional emails into structural clusters.
        3. For 'searchQuery', use highly precise Gmail operators to target the cluster safely. If the cluster targets unread emails, include "is:unread" in the searchQuery (e.g., from:alerts@company.com OR subject:"Your weekly summary" is:unread).
        4. Try to find 4 to 8 distinct recurring habits/clusters to help the user clear clutter.
        
        Emails:
        \${emailText}
      \`;`;

content = content.replace(/const aiPrompt = \`You are an advanced data analysis engine[\s\S]*?\$\{emailText\}\s*\`;/, newPrompt);

fs.writeFileSync('server.ts', content);
