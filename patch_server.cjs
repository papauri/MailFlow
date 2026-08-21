const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const newPrompt = `const aiPrompt = \`You are an advanced data analysis engine designed to identify behavioral habits and structural patterns in an inbox.
        I am providing you a sample of email headers. 
        
        Your Goal: Perform a deep pattern analysis to identify actionable, high-volume groups that can be managed together. 
        Go beyond simple sender matching—look for habits, subscription cadences, transactional flows, auto-responses, financial summaries, promotional blasts, calendar invites, and system alerts.
        
        Examples of Behavioral Bundles:
        - "Weekly Financial Summaries"
        - "Food Delivery Receipts"
        - "SaaS Trial Expirations"
        - "Project Management Mentions"
        - "Morning Newsletters"
        - "E-commerce Promotional Blasts"

        CRITICAL RULES:
        1. Ignore human-to-human conversations. If a subject looks like a real conversation (e.g. "Checking in", "Dinner tonight?"), ignore it entirely.
        2. Focus ONLY on grouping the automated, recurring, or transactional emails into structural clusters.
        3. For 'searchQuery', use highly precise Gmail operators to target the cluster safely (e.g., from:alerts@company.com OR subject:"Your weekly summary").
        4. Try to find 4 to 8 distinct recurring habits/clusters to help the user clear clutter.
        
        Emails:
        \${emailText}
      \`;`;

content = content.replace(/const aiPrompt = `You are a data analysis engine finding common themes in an inbox\.[\s\S]*?\$\{emailText\}\s*`;/, newPrompt);

fs.writeFileSync('server.ts', content);
