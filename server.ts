import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

async function generateAIContent(prompt, schema, settings) {
  const provider = settings?.provider || 'gemini';
  const model = settings?.model || 'gemini-3.6-flash';
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
      const { emails, settings, existingLabels, userEmail } = req.body;
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
      const labelsList = existingLabels ? existingLabels.map((l: any) => l.name).filter(Boolean).join(', ') : 'None';

      const schema = {
        type: Type.OBJECT,
        properties: {
          groups: {
            type: Type.ARRAY,
            description: "Deduplicated, high-impact organization groups for the provided emails.",
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                sender: { type: Type.STRING, description: "Sender name or domain, e.g. 'GitHub', 'Uber', 'LinkedIn'" },
                title: { type: Type.STRING, description: "Clear action title with count (e.g., 'Archive 8 GitHub build notifications', 'Move 3 Uber receipts to Receipts')" },
                emailIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "All matching email IDs from the provided sample" },
                actionType: { type: Type.STRING, description: "One of: 'archive', 'trash', 'move_to_label', 'star_keep'" },
                suggestedLabel: { type: Type.STRING, description: "Exact name of an EXISTING label if actionType is 'move_to_label', otherwise empty string." },
                categoryTag: { type: Type.STRING, description: "Badge, e.g. 'Notifications', 'Receipts', 'Newsletters', 'Important'" },
                reason: { type: Type.STRING, description: "Concise 1-sentence explanation of why this action is recommended." },
                filterQuery: { type: Type.STRING, description: "Gmail search filter query to handle future emails (e.g. from:notifications@github.com)" }
              },
              required: ["id", "sender", "title", "emailIds", "actionType", "categoryTag", "reason", "filterQuery"]
            }
          }
        },
        required: ["groups"]
      };

      const aiPrompt = `You are a practical, highly disciplined Inbox Organizer.
Your task is to analyze these sample emails and group them into 3 to 8 high-impact, non-repetitive action groups.

User's existing custom labels: [${labelsList}].
${userEmail ? `User's email: ${userEmail}` : ''}

RULES:
1. STRICT DEDUPLICATION:
   - Group by sender or domain. NEVER create multiple groups for the same sender or repeat the same email across groups.
   - Each group MUST include ALL email IDs belonging to that sender in the 'emailIds' array.
   - An email ID must appear in at most ONE group.

2. LOGICAL ACTIONS:
   - Routine notifications, automated alerts, stale promotional digests -> actionType: 'archive' or 'trash'
   - Financial receipts, invoices, subscription confirmations -> actionType: 'move_to_label' (using an existing label if present like 'Receipts' or 'Finance', otherwise 'archive')
   - Critical flight tickets, tax forms, security alerts -> actionType: 'star_keep'

3. DO NOT RECOMMEND REDUNDANT ACTIONS:
   - If an email is already in the right folder or already archived (not in Inbox), do not suggest archiving it again.

Sampled emails:
${emailText}
`;

      const result = await generateAIContent(aiPrompt, schema, settings);
      
      // Post-process & strict deduplication
      if (result && result.groups && Array.isArray(result.groups)) {
        const seenEmailIds = new Set<string>();
        const validGroups: any[] = [];

        for (const group of result.groups) {
          if (!group.emailIds || !Array.isArray(group.emailIds) || group.emailIds.length === 0) continue;
          
          // Filter to only valid IDs that haven't been claimed by an earlier group
          const uniqueIds = group.emailIds.filter((id: string) => {
            const emailExists = emails.some((e: any) => e.id === id);
            if (!emailExists || seenEmailIds.has(id)) return false;
            return true;
          });

          if (uniqueIds.length === 0) continue;

          // Check if action is completely redundant for all emails
          const isRedundant = uniqueIds.every((id: string) => {
            const email = emails.find((e: any) => e.id === id);
            if (!email) return true;
            const currentLabels = resolveLabels(email.labelIds).map((l: string) => l.toLowerCase());
            const isArchived = !currentLabels.includes('inbox');
            if (group.actionType === 'archive' && isArchived && !group.suggestedLabel) return true;
            if (group.suggestedLabel && currentLabels.includes(group.suggestedLabel.toLowerCase())) return true;
            return false;
          });

          if (isRedundant) continue;

          uniqueIds.forEach((id: string) => seenEmailIds.add(id));
          
          validGroups.push({
            ...group,
            emailIds: uniqueIds,
            title: group.title.replace(/\d+/, uniqueIds.length.toString()) // adjust count if filtered
          });
        }

        result.groups = validGroups;
      }
      
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

      // Helper to extract clean domain & brand
      const extractDomainAndBrand = (senderStr: string) => {
        const match = (senderStr || '').match(/<([^>]+)>/);
        const emailAddr = (match ? match[1] : senderStr || '').toLowerCase().trim();
        const parts = emailAddr.split('@');
        const domain = parts.length > 1 ? parts[1] : emailAddr;
        const domainParts = domain.split('.');
        const brand = domainParts.length >= 2 ? domainParts[domainParts.length - 2] : domain;
        return { emailAddr, domain, brand };
      };

      const emailLookup = new Map<string, any>();
      const emailListForPrompt = emails.map((e: any) => {
        const { emailAddr, domain, brand } = extractDomainAndBrand(e.sender);
        const cleanItem = {
          id: e.id,
          sender: e.sender,
          emailAddr,
          domain,
          brand,
          subject: e.subject || ''
        };
        emailLookup.set(e.id, cleanItem);
        return `ID: ${e.id} | From: ${e.sender} [Domain: ${domain}] | Subject: ${e.subject}`;
      });

      const emailText = emailListForPrompt.join('\n');
      const existingLabels = userLabels ? userLabels.map((l: any) => l.name).filter(Boolean).join(', ') : 'None';
      
      const schema = {
        type: Type.OBJECT,
        properties: {
          recommendations: {
            type: Type.ARRAY,
            description: "List of precise, verified grouping recommendations for these emails",
            items: {
              type: Type.OBJECT,
              properties: {
                emailIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Exact email IDs from the input that strictly belong to this group" },
                suggestedLabel: { type: Type.STRING, description: "Clear, concise label or folder name (e.g. 'Amazon', 'Receipts', 'GitHub', 'Finance')" },
                title: { type: Type.STRING, description: "Descriptive group title, e.g., 'Amazon Order Confirmations & Tracking'" },
                categoryTag: { type: Type.STRING, description: "Category tag: 'Brand/Merchant', 'Receipts', 'Alerts', 'Newsletters', 'Updates'" },
                targetDomain: { type: Type.STRING, description: "If this group is based on a specific sender/brand, specify the primary domain (e.g. 'amazon.com'), otherwise empty string" },
                reason: { type: Type.STRING, description: "Clear explanation of why these specific emails belong together." },
                filterQuery: { type: Type.STRING, description: "Gmail search operator to match future emails for this group (e.g. 'from:amazon.com')" }
              },
              required: ["emailIds", "suggestedLabel", "title", "categoryTag", "reason"]
            }
          }
        },
        required: ["recommendations"]
      };

      const aiPrompt = `You are a high-precision, strict Email Organization Bot.
Analyze these specific emails and group them into logical, high-impact folders or labels.
User's existing folder names: [${existingLabels}]

CRITICAL ACCURACY RULES:
1. STRICT BRAND INTEGRITY: If you create a group for a specific company or service (e.g., "Amazon", "GitHub", "Uber", "LinkedIn", "Apple", "Spotify", "PayPal", "Stripe", etc.):
   - You MUST ONLY include email IDs whose sender address or domain ACTUALLY belongs to that company (e.g., amazon.com, github.com, etc.).
   - NEVER bundle emails from other senders or unrelated companies into a brand-named group!
   - Set 'targetDomain' to the company's domain (e.g., 'amazon.com').

2. STRICT TOPIC COHESION: If you create a category group (e.g., "Receipts & Invoices", "Security Codes", "Newsletters"):
   - Ensure every included email ID strictly fits that topic.

3. PREFER EXISTING LABELS: If an existing user folder (e.g. [${existingLabels}]) matches the intent, use that exact name for 'suggestedLabel'.

4. DEDUPLICATION: Each email ID should appear in at most one group.

Emails to analyze:
${emailText}
`;
      
      const result = await generateAIContent(aiPrompt, schema, settings);

      // Strict Post-Validation Verification Engine
      if (result && Array.isArray(result.recommendations)) {
        const seenEmailIds = new Set<string>();
        const verifiedRecs: any[] = [];

        for (const rec of result.recommendations) {
          if (!rec.emailIds || !Array.isArray(rec.emailIds) || rec.emailIds.length === 0) continue;

          const targetDomain = (rec.targetDomain || '').toLowerCase().trim();
          const labelLower = (rec.suggestedLabel || '').toLowerCase().trim();
          const titleLower = (rec.title || '').toLowerCase().trim();

          // Filter email IDs strictly to prevent false positives and LLM hallucinations
          const sanitizedEmailIds = rec.emailIds.filter((id: string) => {
            if (seenEmailIds.has(id)) return false;
            const email = emailLookup.get(id);
            if (!email) return false;

            // If this is a brand/domain cluster, verify that the email actually matches the brand/domain
            if (targetDomain) {
              const domainMatch = email.domain.includes(targetDomain) || targetDomain.includes(email.brand);
              const senderMatch = email.sender.toLowerCase().includes(targetDomain.split('.')[0]);
              if (!domainMatch && !senderMatch) {
                return false; // Reject false positive!
              }
            } else if (labelLower.length > 2 && !['receipts', 'purchases', 'finance', 'newsletters', 'updates', 'alerts', 'promotions', 'general'].includes(labelLower)) {
              // If label looks like a brand name (e.g. "Amazon", "Uber", "GitHub")
              const brandWord = labelLower.split(' ')[0];
              const matchesSender = email.sender.toLowerCase().includes(brandWord) || email.domain.includes(brandWord);
              const matchesSubject = email.subject.toLowerCase().includes(brandWord);
              if (!matchesSender && !matchesSubject) {
                return false; // Reject mismatched email!
              }
            }

            return true;
          });

          if (sanitizedEmailIds.length >= 2) {
            sanitizedEmailIds.forEach((id: string) => seenEmailIds.add(id));
            
            // Build accurate filter query if not provided
            let query = rec.filterQuery;
            if (!query || query.trim() === '') {
              const domains = new Set<string>();
              sanitizedEmailIds.forEach(id => {
                const em = emailLookup.get(id);
                if (em?.domain) domains.add(em.domain);
              });
              if (domains.size === 1) {
                query = `from:${Array.from(domains)[0]}`;
              } else if (domains.size > 1) {
                query = `{${Array.from(domains).map(d => `from:${d}`).join(' ')}}`;
              }
            }

            verifiedRecs.push({
              ...rec,
              emailIds: sanitizedEmailIds,
              filterQuery: query
            });
          }
        }

        result.recommendations = verifiedRecs;
      }

      res.json(result);
    } catch (error: any) {
      console.error("AI API Error (Suggest Labels):", error);
      res.status(500).json({ error: error.message || "Failed to suggest labels" });
    }
  });

  app.post("/api/analyze-category-cleanup", async (req, res) => {
    try {
      const { categoryName, estimatedTotal, emails, userLabels, settings } = req.body;
      if (!emails || !Array.isArray(emails)) {
        return res.status(400).json({ error: "Emails array is required" });
      }

      const emailListStr = emails.map((e: any) => `ID: ${e.id} | From: ${e.sender} | Date: ${e.date || ''} | Subject: ${e.subject} | Snippet: ${e.snippet || ''}`).join('\n');
      const userFoldersList = (userLabels || []).map((l: any) => l.name).filter(Boolean).join(', ');

      const schema = {
        type: Type.OBJECT,
        properties: {
          summary: {
            type: Type.OBJECT,
            properties: {
              headline: { type: Type.STRING, description: "Clear, concise summary headline (e.g. 'Updates Category: Mostly automated notifications and receipts')" },
              clutterPercentage: { type: Type.NUMBER, description: "Estimated percentage of clutter or stale notifications (0-100)" },
              importantPercentage: { type: Type.NUMBER, description: "Estimated percentage of important messages to keep (0-100)" },
              relocatablePercentage: { type: Type.NUMBER, description: "Estimated percentage of messages to file into labels (0-100)" },
              overview: { type: Type.STRING, description: "1-2 sentence overview of the messages found and recommendations." },
              practicalAdvice: { type: Type.STRING, description: "Practical advice on managing this category." }
            },
            required: ["headline", "clutterPercentage", "importantPercentage", "relocatablePercentage", "overview", "practicalAdvice"]
          },
          attentionEmails: {
            type: Type.ARRAY,
            description: "Emails hidden in this category that REQUIRE IMMEDIATE ATTENTION or action (e.g. pending bills due, urgent action required, upcoming flights/itinerary, expiring accounts, critical security alerts, or direct inquiries).",
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                sender: { type: Type.STRING },
                subject: { type: Type.STRING },
                reason: { type: Type.STRING, description: "Direct explanation of what requires attention (e.g., 'Payment due date approaching', 'Flight check-in available', 'Account security confirmation needed')" },
                urgencyLevel: { type: Type.STRING, description: "'high' or 'medium'" },
                tag: { type: Type.STRING, description: "Badge: 'Action Required', 'Payment Due', 'Security Alert', 'Travel', 'Deadline', or 'Review Needed'" }
              },
              required: ["id", "sender", "subject", "reason", "urgencyLevel", "tag"]
            }
          },
          actions: {
            type: Type.ARRAY,
            description: "Practical cleanup recommendations",
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: "Unique action ID (e.g. action_1, action_2)" },
                title: { type: Type.STRING, description: "Clear title with count (e.g., 'Trash 14 expired login codes', 'Archive 22 build notifications', 'Move 5 receipts to Receipts')" },
                actionType: { type: Type.STRING, description: "One of: 'trash', 'archive', 'move_to_label', 'star_keep', 'mark_read'" },
                suggestedLabel: { type: Type.STRING, description: "Name of an existing user label if actionType is 'move_to_label', otherwise empty." },
                emailIds: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Matching email IDs from the sample." },
                urgency: { type: Type.STRING, description: "One of: 'safe_to_delete', 'safe_to_archive', 'relocate_to_folder', 'critical_keep'" },
                categoryTag: { type: Type.STRING, description: "Short badge (e.g., 'Expired Codes', 'Receipts', 'Build Alerts', 'Newsletters', 'Important')" },
                description: { type: Type.STRING, description: "Plain, sensible explanation of why these messages can be archived, moved, or deleted." },
                suggestFilterRule: {
                  type: Type.OBJECT,
                  description: "Optional rule for recurring senders",
                  properties: {
                    senderQuery: { type: Type.STRING, description: "Sender query, e.g. from:alerts@github.com" },
                    description: { type: Type.STRING, description: "Rule description, e.g. 'Auto-archive future GitHub notifications'" }
                  },
                  required: ["senderQuery", "description"]
                }
              },
              required: ["id", "title", "actionType", "emailIds", "urgency", "categoryTag", "description"]
            }
          }
        },
        required: ["summary", "actions"]
      };

      const prompt = `You are an autonomous inbox scanner reviewing Gmail category "${categoryName}" (~${estimatedTotal || 'thousands'} total messages).

PRIVACY & SAFETY: Operate on the provided metadata safely with zero data persistence.

User's custom labels: [${userFoldersList || 'None'}].

Sampled messages:
${emailListStr}

Instructions:
1. SPOTTING EMAILS REQUIRING ATTENTION (Autonomous Attention Detector):
   - Scan for emails that might need the user's attention or action: upcoming flight itineraries, pending invoices/bills with due dates, account security notifications, expiration warnings, contract renewals, or direct action requests.
   - Put these in 'attentionEmails' with a helpful, clear 'reason' explaining why it needs attention.

2. CLEANUP & TRIAGE RECOMMENDATIONS:
   - Identify transient emails that are safe to remove or file away (e.g. expired OTP codes, resolved build notifications, marketing newsletters, old delivery tracking).
   - Recommend moving financial receipts/orders to existing user labels if available.

3. Keep wording crisp, professional, and practical.`;

      const result = await generateAIContent(prompt, schema, settings);
      res.json(result);
    } catch (e: any) {
      console.error("AI Category Cleanup Error:", e);
      const isRateLimit = e.message && (e.message.includes("429") || e.message.includes("quota") || e.message.includes("rate limit") || e.message.includes("exhausted"));
      res.status(isRateLimit ? 429 : 500).json({ error: e.message || "Failed to analyze category" });
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

