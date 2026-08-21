import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

async function generateAIContent(prompt, schema, settings) {
  const provider = settings?.provider || 'gemini';
  const model = settings?.model || 'gemini-1.5-flash';
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
  } else if (['deepseek', 'openai', 'groq', 'anthropic', 'zhipu', 'mistral'].includes(provider)) {
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

  app.post("/api/analyze-inbox", async (req, res) => {
    try {
      const { emails, settings } = req.body;
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
      } else if (provider === 'zhipu') {
         models = ['glm-4', 'glm-4-flash', 'glm-4-plus'];
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
