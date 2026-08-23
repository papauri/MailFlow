import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

async function generateAIContent(prompt, schema, settings) {
  const provider = settings?.provider || 'gemini';
  const model = settings?.model || 'gemini-2.5-flash';
  const apiKey = settings?.apiKey || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(`Missing API Key for ${provider}`);
  }

  if (provider === 'gemini') {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: model,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });
    return JSON.parse(response.text);
  } else if (['deepseek', 'openai', 'groq', 'anthropic', 'zhipu', 'mistral', 'grok'].includes(provider)) {
    const enrichedPrompt = prompt + `\n\nIMPORTANT: You MUST respond in pure JSON format matching this exact schema: \n${JSON.stringify(schema, null, 2)}`;
    
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: model,
          max_tokens: 4096,
          messages: [{ role: 'user', content: enrichedPrompt }]
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `${provider} API Error`);
      let content = data.content[0].text;
      content = content.replace(/^\s*\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`\s*$/i, '').trim();
      return JSON.parse(content);
    } else {
      const baseUrl = provider === 'deepseek' ? 'https://api.deepseek.com' 
        : provider === 'groq' ? 'https://api.groq.com/openai/v1' 
        : provider === 'zhipu' ? 'https://open.bigmodel.cn/api/paas/v4'
        : provider === 'mistral' ? 'https://api.mistral.ai/v1'
        : provider === 'grok' ? 'https://api.x.ai/v1'
        : 'https://api.openai.com/v1';
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: 'user', content: enrichedPrompt }],
          response_format: { type: "json_object" }
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || `${provider} API Error`);
      let content = data.choices[0].message.content;
      content = content.replace(/^\s*\`\`\`(?:json)?\s*/i, '').replace(/\s*\`\`\`\s*$/i, '').trim();
      return JSON.parse(content);
    }
  } else {
    throw new Error("Unsupported provider: " + provider);
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.use(express.json());

  // API Route to parse natural language to Gmail search query
  app.post("/api/parse-query", async (req, res) => {
    try {
      const { prompt, settings } = req.body;
      if (!prompt) {
        return res.status(400).json({ error: "Prompt is required" });
      }

            const schema = {
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
      };

      const aiPrompt = `You are an expert at translating natural language into Gmail search operators.
        Convert the following user request into a structured JSON query object.
        If the user asks for a specific folder (like inbox, spam, trash), set the 'folder' field to something like "in:inbox".
        If they don't specify a folder, set 'inAnywhere' to true so it searches everywhere.
        Extract senders to 'from', subjects to 'subject', and general keywords to 'general'.
        If they say "larger than 5mb", add "larger:5M" to general.
        Suggest a human-readable folder name (like "Receipts" or "Project Updates") based on the query.
        
        User Request: "${prompt}"
      `;

      const result = await generateAIContent(aiPrompt, schema, settings);
      res.json(result);
    } catch (error) {
      console.error("AI API Error (Parse):", error);
      const isRateLimit = error.message && (error.message.includes("429") || error.message.includes("quota") || error.message.includes("rate limit") || error.message.includes("exhausted"));
      const isOverloaded = error.message && (error.message.includes("503") || error.message.includes("high demand") || error.message.includes("UNAVAILABLE"));
      res.status(isRateLimit ? 429 : isOverloaded ? 503 : 500).json({ error: error.message || "Failed to parse query" });
    }
  });

  app.post("/api/smart-triage", async (req, res) => {
    try {
      const { emails, settings, existingLabels } = req.body;
      if (!emails || !Array.isArray(emails)) {
        return res.status(400).json({ error: "Emails array is required" });
      }

      const standardMap: Record<string, string> = {
        'INBOX': 'Inbox',
        'CATEGORY_PERSONAL': 'Primary',
        'CATEGORY_UPDATES': 'Updates',
        'CATEGORY_PROMOTIONS': 'Promotions',
        'CATEGORY_SOCIAL': 'Social',
        'STARRED': 'Starred'
      };

      const resolveLabels = (ids: string[]) => {
        if (!ids) return [];
        return ids
          .filter(id => id !== 'UNREAD' && id !== 'IMPORTANT')
          .map(id => {
            if (standardMap[id]) return standardMap[id];
            const userLabel = existingLabels?.find((l: any) => l.id === id);
            return userLabel ? userLabel.name : id;
          });
      };

      const emailText = emails.map(e => `ID: ${e.id} | From: ${e.sender} | Subject: ${e.subject} | Current Location: [${resolveLabels(e.labelIds).join(', ')}]`).join('\n');
      const labelsText = existingLabels ? existingLabels.map((l: any) => l.name).join(', ') : 'None';

      const schema = {
        type: Type.OBJECT,
        properties: {
          suggestions: {
            type: Type.ARRAY,
            description: "List of actionable triage suggestions for specific emails.",
            items: {
              type: Type.OBJECT,
              properties: {
                emailId: { type: Type.STRING },
                sender: { type: Type.STRING },
                subject: { type: Type.STRING },
                suggestedAction: { type: Type.STRING, description: "Base action: 'move_to_primary', 'move_to_updates', 'archive', 'star', or 'keep_in_inbox'" },
                suggestedLabel: { type: Type.STRING, description: "(Optional) A label to apply IN ADDITION to the base action. Recommend an existing folder or propose a NEW folder (e.g., 'Invoices')." },
                applyToAllFuture: { type: Type.BOOLEAN, description: "Set to true if this combination should automatically apply to all future emails from this exact sender." },
                reason: { type: Type.STRING, description: "Brief reason (e.g., 'Moving to Updates and applying Alerts label will keep your primary inbox clean.')" }
              },
              required: ["emailId", "sender", "subject", "suggestedAction", "applyToAllFuture", "reason"]
            }
          }
        },
        required: ["suggestions"]
      };

      const aiPrompt = `You are a meticulous, highly intelligent Inbox Organizer.
        I am giving you a deep sample of recent emails across my entire mailbox.
        My current custom folders (labels) are: [${labelsText}].
        
        CRITICAL GOAL: Your primary job is to PROTECT important emails and ORGANIZE clutter. Be incredibly smart.
        1. If an email is HIGHLY IMPORTANT (e.g., an upcoming exam, a flight ticket, legal documents, a message from a boss/real human) and it is currently hiding in Updates or Promotions, you MUST suggest 'move_to_primary' (and optionally star it) so the user does not miss it! DO NOT archive important upcoming events.
        2. If an email is useful but not urgent (e.g., receipts, project logs), apply a logical label (new or existing) and 'archive' it out of the inbox. 
        3. Only suggest 'archive' for items that are truly dealt with, useless clutter, or non-actionable logs.
        4. CRITICAL: I have provided the 'Current Location' for each email (e.g., [Inbox, Receipts]). If an email is ALREADY correctly categorized in its current location, do NOT suggest applying that exact same label again!
        
        You can combine actions! For example, suggest 'archive' AND suggestedLabel 'Receipts & Billing' (with applyToAllFuture = true).
        Or suggest 'move_to_primary' AND suggestedLabel 'University'.
        
        Provide up to 15 of the highest-value, smartest organization suggestions.
        
        Emails:
        ${emailText}
      `;

      const result = await generateAIContent(aiPrompt, schema, settings);
      res.json(result);
    } catch (e: any) {
      console.error(e);
      res.status(500).json({ error: e.message || "Failed to generate triage suggestions" });
    }
  });

  app.post("/api/analyze-inbox", async (req, res) => {
    try {
      const { emails, userEmail, settings } = req.body;
      if (!emails || !Array.isArray(emails)) {
        return res.status(400).json({ error: "Emails array is required" });
      }

      const emailText = emails.map(e => `ID: ${e.id} | From: ${e.sender} | Subject: ${e.subject} | Labels: [${(e.labelIds || []).join(', ')}]`).join('\n');

      const schema = {
        type: Type.OBJECT,
        properties: {
          clusters: {
            type: Type.ARRAY,
            description: "List of identified email clusters",
            items: {
              type: Type.OBJECT,
              properties: {
                title: { type: Type.STRING, description: "Short title for the cluster, e.g. 'Stripe Notifications' or 'Medium Newsletters'" },
                description: { type: Type.STRING, description: "Why these emails were grouped and what they represent." },
                suggestedAction: { type: Type.STRING, description: "Suggested action, e.g., 'Delete' or 'Archive'" },
                searchQuery: { type: Type.STRING, description: "A precise Gmail search query to find ALL these specific emails, e.g., 'from:updates@medium.com' or 'subject:\"Stripe Payment\"'" },
                estimatedCount: { type: Type.INTEGER, description: "Number of emails found in the sample for this cluster." },
                patternDetected: { type: Type.STRING, description: "What behavior or pattern caused these to be grouped? Focus on habits, frequency, or topics." }
              },
              required: ["title", "description", "suggestedAction", "searchQuery", "estimatedCount", "patternDetected"]
            }
          }
        },
        required: ["clusters"]
      };

      const aiPrompt = `You are an advanced data analysis engine designed to identify behavioral habits and structural patterns in an inbox.
        I am providing you a sample of email headers, including their current Gmail labels (e.g., UNREAD, CATEGORY_PROMOTIONS). 
        ${userEmail ? `The current user's email is: "${userEmail}". Do NOT create clusters or groups of emails sent from the user themselves.` : ''}
        
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
        1. Ignore human-to-human personal conversations and generic consumer webmail domains. Never create a cluster solely titled or scoped to "@gmail.com", "@yahoo.com", or "@hotmail.com" unless it's a specific recognized automated service or topic.
        2. Focus ONLY on grouping automated, recurring, promotional, or transactional emails into structural clusters.
        3. For 'searchQuery', use highly precise Gmail operators to target the cluster safely. If the cluster targets unread emails, include "is:unread" in the searchQuery (e.g., from:alerts@company.com OR subject:"Your weekly summary" is:unread).
        4. Try to find 4 to 8 distinct recurring habits/clusters to help the user clear clutter.
        
        Emails:
        ${emailText}
      `;

      const result = await generateAIContent(aiPrompt, schema, settings);
      res.json(result);
    } catch (error) {
      console.error("AI API Error (Analyze):", error);
      const isRateLimit = error.message && (error.message.includes("429") || error.message.includes("quota") || error.message.includes("rate limit") || error.message.includes("exhausted"));
      const isOverloaded = error.message && (error.message.includes("503") || error.message.includes("high demand") || error.message.includes("UNAVAILABLE"));
      res.status(isRateLimit ? 429 : isOverloaded ? 503 : 500).json({ error: error.message || "Failed to analyze inbox" });
    }
  });

  app.post("/api/analyze-subscriptions", async (req, res) => {
    try {
      const { subscriptions, settings } = req.body;
      if (!subscriptions || !Array.isArray(subscriptions)) {
        return res.status(400).json({ error: "Subscriptions array is required" });
      }

      const subsText = subscriptions.map((s: any) => `Sender: ${s.name} (${s.email}) | Count: ${s.count} | Example: ${s.exampleSubject}`).join('\n');

      const schema = {
        type: Type.OBJECT,
        properties: {
          analysis: {
            type: Type.ARRAY,
            description: "Analysis of each subscription",
            items: {
              type: Type.OBJECT,
              properties: {
                email: { type: Type.STRING, description: "The exact email address of the sender" },
                category: { type: Type.STRING, description: "One of: 'Marketing & Promo', 'Newsletter & Content', 'Transactional/Alerts', 'Cold Outreach', 'Unknown'" },
                intent: { type: Type.STRING, description: "A very brief 3-5 word description of what they send." },
                spamScore: { type: Type.NUMBER, description: "A score from 1-100 indicating how likely this is considered spam or aggressive noise." },
                recommendation: { type: Type.STRING, description: "One of: 'Unsubscribe', 'Ghost Block', 'Keep'" }
              },
              required: ["email", "category", "intent", "spamScore", "recommendation"]
            }
          }
        },
        required: ["analysis"]
      };

      const prompt = `Analyze the following list of frequent email senders (subscriptions/newsletters/promos).
Determine their category, their underlying intent, assign a spam/noise score (1-100), and recommend an action (Unsubscribe, Ghost Block, or Keep).

Ghost Block is recommended for aggressive cold outreach or high-noise spam.
Unsubscribe is recommended for standard marketing/newsletters that are no longer needed.
Keep is recommended for important transactional alerts or high-value content.

Senders:
${subsText}
`;

      const parsed = await generateAIContent(prompt, schema, settings);
      res.json(parsed);
    } catch (e: any) {
      console.error("Analyze Subscriptions Error:", e);
      res.status(500).json({ error: e.message || "Failed to analyze subscriptions" });
    }
  });

  app.post("/api/suggest-labels", async (req, res) => {
    try {
      const { emails, userLabels, settings } = req.body;
      if (!emails || !Array.isArray(emails)) {
        return res.status(400).json({ error: "Emails array is required" });
      }
      const emailText = emails.map((e: any) => `ID: ${e.id} | From: ${e.sender} | Subject: ${e.subject}`).join('\n');
      const existingLabels = userLabels ? userLabels.map((l: any) => l.name).join(', ') : '';
      
      const schema = {
        type: Type.OBJECT,
        properties: {
          recommendations: {
            type: Type.ARRAY,
            description: "List of recommended actions to organize these specific emails",
            items: {
              type: Type.OBJECT,
              properties: {
                emailIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "The specific email IDs from the provided list that belong in this group." },
                suggestedLabel: { type: Type.STRING, description: "The name of the label/folder to move them to (can be an existing one or a new one)." },
                reason: { type: Type.STRING, description: "Brief explanation of why these go together, or if they are outliers/anomalies." }
              },
              required: ["emailIds", "suggestedLabel", "reason"]
            }
          }
        },
        required: ["recommendations"]
      };

      const aiPrompt = `You are an AI email assistant helping a user organize a batch of selected emails.
        Here are the existing folder/label names they have: [${existingLabels}]
        
        Here are the selected emails:
        ${emailText}
        
        Analyze these specific emails. Group them together by topic, sender, or purpose.
        Spot what goes together, and if there are anomalies or outliers, group them appropriately.
        For each group, suggest a label (either one of their existing labels, or a new clear, concise label name) and provide the exact email IDs that belong in that group.
        Every email ID provided in the input must be assigned to exactly one recommendation group.
      `;
      
      const result = await generateAIContent(aiPrompt, schema, settings);
      res.json(result);
    } catch (error: any) {
      console.error("AI API Error (Suggest Labels):", error);
      res.status(500).json({ error: error.message || "Failed to suggest labels" });
    }
  });
  
  app.post("/api/check-quota", async (req, res) => {
    try {
      const { settings } = req.body;
      const schema = { type: Type.STRING };
      // Lightweight prompt just to verify limits
      await generateAIContent("Reply OK", schema, settings);
      res.json({ ok: true });
    } catch (err: any) {
      const isRateLimit = err.message && (err.message.includes("429") || err.message.includes("quota") || err.message.includes("rate limit") || err.message.includes("exhausted"));
      res.status(isRateLimit ? 429 : 500).json({ error: err.message });
    }
  });

  app.post("/api/models", async (req, res) => {
    try {
      const { settings } = req.body;
      const provider = settings?.provider || 'gemini';
      const apiKey = settings?.apiKey || process.env.GEMINI_API_KEY;
      
      if (!apiKey) {
        return res.json({ models: [] });
      }

      let models = [];
      
      if (provider === 'gemini') {
        const fetchRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data.models) models = data.models.map(m => m.name.replace('models/', '')).filter(m => m.includes('gemini'));
        }
      } else if (provider === 'openai') {
        const fetchRes = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${apiKey}` }});
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data.data) models = data.data.map(m => m.id).filter(m => m.includes('gpt') || m.includes('o1') || m.includes('o3'));
        }
      } else if (provider === 'anthropic') {
        const fetchRes = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }});
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data.data) models = data.data.map(m => m.id);
        }
        if (models.length === 0) models = ['claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-5-sonnet-latest', 'claude-3-opus-latest'];
      } else if (provider === 'groq') {
        const fetchRes = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${apiKey}` }});
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data.data) models = data.data.map(m => m.id);
        }
      } else if (provider === 'deepseek') {
        const fetchRes = await fetch('https://api.deepseek.com/models', { headers: { Authorization: `Bearer ${apiKey}` }});
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data.data) models = data.data.map(m => m.id);
        }
      } else if (provider === 'mistral') {
        const fetchRes = await fetch('https://api.mistral.ai/v1/models', { headers: { Authorization: `Bearer ${apiKey}` }});
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data.data) models = data.data.map(m => m.id);
        }
      } else if (provider === 'grok') {
        const fetchRes = await fetch('https://api.x.ai/v1/models', { headers: { Authorization: `Bearer ${apiKey}` }});
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data.data) models = data.data.map(m => m.id);
        }
      } else if (provider === 'zhipu') {
        try {
          const fetchRes = await fetch('https://open.bigmodel.cn/api/paas/v4/models', { headers: { Authorization: `Bearer ${apiKey}` }});
          if (fetchRes.ok) {
            const data = await fetchRes.json();
            if (data.data) models = data.data.map(m => m.id);
          }
        } catch(e) {
          // ignore
        }
        if (models.length === 0) models = ['glm-4', 'glm-4-flash', 'glm-4-plus'];
      }
      
      // Sort models descending or alphabetically
      models.sort();
      res.json({ models });
    } catch (error) {
       console.error("Error fetching models:", error);
       res.json({ models: [] });
    }
  });

  // Vite middleware for development

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();

