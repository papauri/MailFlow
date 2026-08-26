import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

function parseApiErrorMessage(data: any, status: number, provider: string): string {
  if (!data) return `${provider} API request failed (${status})`;
  if (typeof data === 'string') return data;
  if (data.error?.message) return data.error.message;
  if (typeof data.error === 'string') return data.error;
  if (data.message) return data.message;
  if (Array.isArray(data.detail)) {
    return data.detail.map((d: any) => (typeof d === 'object' ? d.msg || d.message || JSON.stringify(d) : String(d))).join(', ');
  }
  if (typeof data.detail === 'string') return data.detail;
  return `${provider} API Error (${status})`;
}

function extractJsonFromText(rawText: string): any {
  let content = rawText.trim();
  // Strip markdown code fences if present
  content = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  
  try {
    return JSON.parse(content);
  } catch {
    // Attempt to locate outer JSON block if extra commentary was included
    const firstBrace = content.indexOf('{');
    const lastBrace = content.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      try {
        return JSON.parse(content.substring(firstBrace, lastBrace + 1));
      } catch {}
    }
    const firstBracket = content.indexOf('[');
    const lastBracket = content.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      try {
        return JSON.parse(content.substring(firstBracket, lastBracket + 1));
      } catch {}
    }
    throw new Error("Failed to parse JSON response from AI model");
  }
}

async function callGemini(prompt: string, schema: any, model = 'gemini-3.7-flash', apiKey?: string) {
  const key = apiKey || process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error("Missing Gemini API Key");
  }
  const ai = new GoogleGenAI({
    apiKey: key,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      }
    }
  });

  const targetModel = model || 'gemini-3.7-flash';

  try {
    const response = await ai.models.generateContent({
      model: targetModel,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: schema
      }
    });
    return JSON.parse(response.text || '{}');
  } catch (error: any) {
    const isRateLimitOrOverload = error.message && (
      error.message.includes("429") || 
      error.message.toLowerCase().includes("quota") || 
      error.message.toLowerCase().includes("rate limit") || 
      error.message.toLowerCase().includes("resource_exhausted") ||
      error.message.includes("503") ||
      error.message.toLowerCase().includes("unavailable")
    );

    // If primary model hit quota/overload and wasn't already flash-lite, try gemini-3.1-flash-lite
    if (isRateLimitOrOverload && targetModel !== 'gemini-3.1-flash-lite') {
      try {
        console.info(`[AI] Primary model ${targetModel} busy or rate-limited. Falling back to gemini-3.1-flash-lite.`);
        const retryRes = await ai.models.generateContent({
          model: 'gemini-3.1-flash-lite',
          contents: prompt,
          config: {
            responseMimeType: "application/json",
            responseSchema: schema
          }
        });
        return JSON.parse(retryRes.text || '{}');
      } catch (retryErr: any) {
        throw retryErr;
      }
    }
    throw error;
  }
}

async function generateAIContent(
  prompt: string, 
  schema: any, 
  settings: any, 
  options: { strictUserKeyOnly?: boolean } = {}
) {
  const provider = settings?.provider || 'gemini';
  const model = settings?.model || (
    provider === 'gemini' ? 'gemini-3.7-flash' :
    provider === 'mistral' ? 'mistral-small-latest' :
    provider === 'openai' ? 'gpt-4o-mini' :
    provider === 'anthropic' ? 'claude-3-5-haiku-20241022' :
    provider === 'groq' ? 'llama-3.1-8b-instant' :
    provider === 'deepseek' ? 'deepseek-chat' :
    provider === 'zhipu' ? 'glm-4-flash' :
    provider === 'grok' ? 'grok-2-latest' : 'gemini-3.7-flash'
  );
  
  const userApiKey = settings?.apiKey?.trim();

  // If using default Gemini provider
  if (provider === 'gemini') {
    return await callGemini(prompt, schema, model, userApiKey);
  }

  // If using third-party provider but no API key was provided
  if (!userApiKey) {
    if (!options.strictUserKeyOnly && process.env.GEMINI_API_KEY) {
      console.info(`[AI] No API key provided for ${provider}. Seamlessly using default Gemini service.`);
      return await callGemini(prompt, schema, 'gemini-3.7-flash');
    }
    throw new Error(`Missing API Key for ${provider}. Please enter your ${provider} API key in AI Settings or choose Gemini.`);
  }

  if (['deepseek', 'openai', 'groq', 'anthropic', 'zhipu', 'mistral', 'grok'].includes(provider)) {
    const enrichedPrompt = prompt + `\n\nIMPORTANT: You MUST respond in pure JSON format matching this exact schema: \n${JSON.stringify(schema, null, 2)}`;
    
    try {
      if (provider === 'anthropic') {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': userApiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: model,
            max_tokens: 4096,
            messages: [{ role: 'user', content: enrichedPrompt }]
          })
        });
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(parseApiErrorMessage(data, res.status, provider));
        }
        const content = data?.content?.[0]?.text || '';
        return extractJsonFromText(content);
      } else {
        const baseUrl = provider === 'deepseek' ? 'https://api.deepseek.com' 
          : provider === 'groq' ? 'https://api.groq.com/openai/v1' 
          : provider === 'zhipu' ? 'https://open.bigmodel.cn/api/paas/v4'
          : provider === 'mistral' ? 'https://api.mistral.ai/v1'
          : provider === 'grok' ? 'https://api.x.ai/v1'
          : 'https://api.openai.com/v1';

        const requestBody: any = {
          model: model,
          messages: [{ role: 'user', content: enrichedPrompt }]
        };

        // Most OpenAI-compatible providers support json_object mode
        if (['openai', 'groq', 'deepseek', 'mistral'].includes(provider)) {
          requestBody.response_format = { type: "json_object" };
        }

        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${userApiKey}`
          },
          body: JSON.stringify(requestBody)
        });

        const data = await res.json().catch(() => null);
        if (!res.ok) {
          throw new Error(parseApiErrorMessage(data, res.status, provider));
        }
        const content = data?.choices?.[0]?.message?.content || '';
        return extractJsonFromText(content);
      }
    } catch (providerError: any) {
      if (options.strictUserKeyOnly) {
        throw providerError;
      }
      // In general operations, gracefully fallback so user flows do not break
      if (process.env.GEMINI_API_KEY) {
        console.info(`[AI] ${provider} request issue (${providerError.message}). Utilizing resilient Gemini fallback.`);
        return await callGemini(prompt, schema, 'gemini-3.7-flash');
      }
      throw providerError;
    }
  } else {
    throw new Error("Unsupported AI provider: " + provider);
  }
}

function generateHeuristicCategoryCleanup(categoryName: string, estimatedTotal: any, emails: any[], userLabels: any[]) {
  const actions: any[] = [];
  const attentionEmails: any[] = [];
  const availableFolderNames = (userLabels || []).map((f: any) => f.name).filter(Boolean);

  const otpIds: string[] = [];
  const receiptIds: string[] = [];
  const buildAlertIds: string[] = [];
  const marketingIds: string[] = [];
  const importantIds: string[] = [];
  const socialIds: string[] = [];
  const securityIds: string[] = [];

  const urgentKeywords = [
    'due date', 'past due', 'payment failed', 'action required', 'immediate attention', 
    'flight confirmation', 'check-in', 'boarding pass', 'itinerary', 'security alert', 
    'password reset', 'unauthorized', 'verification code', 'otp', 'two-factor', 'expire'
  ];

  for (const e of emails) {
    const text = `${e.subject || ''} ${e.snippet || ''} ${e.sender || ''}`.toLowerCase();
    
    // Check for attention emails
    const isUrgent = urgentKeywords.some(kw => text.includes(kw));
    if (isUrgent && attentionEmails.length < 8) {
      const isSecurity = text.includes('security') || text.includes('unauthorized') || text.includes('password');
      const isBill = text.includes('due') || text.includes('bill') || text.includes('invoice') || text.includes('failed');
      const isTravel = text.includes('flight') || text.includes('itinerary') || text.includes('booking');
      
      attentionEmails.push({
        id: e.id,
        sender: e.sender || 'Sender',
        subject: e.subject || '(No Subject)',
        reason: isSecurity ? 'Account security verification or alert' : isBill ? 'Pending bill or invoice requirement' : isTravel ? 'Upcoming travel itinerary or check-in' : 'Requires direct review or action',
        urgencyLevel: isSecurity || isBill ? 'high' : 'medium',
        tag: isSecurity ? 'Security Alert' : isBill ? 'Payment Due' : isTravel ? 'Travel' : 'Action Required'
      });
    }

    if (text.includes('verification code') || text.includes('one-time passcode') || text.includes('otp') || text.includes('security code')) {
      otpIds.push(e.id);
    } else if (text.includes('receipt') || text.includes('order confirmation') || text.includes('invoice') || text.includes('payment received') || text.includes('your order')) {
      receiptIds.push(e.id);
    } else if (text.includes('build') || text.includes('deployment') || text.includes('pipeline') || text.includes('ci/cd') || text.includes('pull request') || text.includes('commit') || text.includes('github') || text.includes('gitlab')) {
      buildAlertIds.push(e.id);
    } else if (text.includes('unsubscribe') || text.includes('sale') || text.includes('discount') || text.includes('% off') || text.includes('deal') || text.includes('newsletter') || text.includes('digest')) {
      marketingIds.push(e.id);
    } else if (text.includes('security alert') || text.includes('new login') || text.includes('suspicious activity')) {
      securityIds.push(e.id);
    } else if (text.includes('commented') || text.includes('mentioned you') || text.includes('new connection') || text.includes('invitation') || text.includes('liked your')) {
      socialIds.push(e.id);
    } else {
      importantIds.push(e.id);
    }
  }

  let actionCounter = 1;

  if (otpIds.length > 0) {
    actions.push({
      id: `action_otp_${actionCounter++}`,
      title: `Trash ${otpIds.length} expired security & verification codes`,
      actionType: 'trash',
      emailIds: otpIds,
      urgency: 'safe_to_delete',
      categoryTag: 'Expired Codes',
      description: 'One-time verification passcodes and login tokens have already expired and can be safely deleted.'
    });
  }

  if (buildAlertIds.length > 0) {
    actions.push({
      id: `action_build_${actionCounter++}`,
      title: `Archive ${buildAlertIds.length} automated CI/CD & developer alerts`,
      actionType: 'archive',
      emailIds: buildAlertIds,
      urgency: 'safe_to_archive',
      categoryTag: 'Build Alerts',
      description: 'Automated notification feeds from developer workflows and repository builds.',
      suggestFilterRule: {
        senderQuery: 'from:(github.com OR gitlab.com OR vercel.com)',
        description: 'Auto-archive automated system alerts'
      }
    });
  }

  if (receiptIds.length > 0) {
    const matchingReceiptFolder = availableFolderNames.find((f: string) => f.toLowerCase().includes('receipt') || f.toLowerCase().includes('finance') || f.toLowerCase().includes('order')) || (availableFolderNames.length > 0 ? availableFolderNames[0] : '');
    actions.push({
      id: `action_receipts_${actionCounter++}`,
      title: `${matchingReceiptFolder ? `File ${receiptIds.length} receipts into "${matchingReceiptFolder}"` : `Archive ${receiptIds.length} order receipts & invoices`}`,
      actionType: matchingReceiptFolder ? 'move_to_label' : 'archive',
      suggestedLabel: matchingReceiptFolder || '',
      emailIds: receiptIds,
      urgency: 'relocate_to_folder',
      categoryTag: 'Receipts & Orders',
      description: 'Keep transactional purchase records accessible without clogging active inbox views.'
    });
  }

  if (marketingIds.length > 0) {
    actions.push({
      id: `action_mktg_${actionCounter++}`,
      title: `Trash or archive ${marketingIds.length} newsletters & promotional digests`,
      actionType: 'trash',
      emailIds: marketingIds,
      urgency: 'safe_to_delete',
      categoryTag: 'Promotions',
      description: 'Stale commercial offers and newsletters that no longer need active inbox attention.'
    });
  }

  if (socialIds.length > 0) {
    actions.push({
      id: `action_social_${actionCounter++}`,
      title: `Archive ${socialIds.length} social activity & invitation updates`,
      actionType: 'archive',
      emailIds: socialIds,
      urgency: 'safe_to_archive',
      categoryTag: 'Social Activity',
      description: 'Social networking notifications and connection activity.'
    });
  }

  if (securityIds.length > 0) {
    actions.push({
      id: `action_sec_${actionCounter++}`,
      title: `Star & keep ${securityIds.length} critical security notifications`,
      actionType: 'star_keep',
      emailIds: securityIds,
      urgency: 'critical_keep',
      categoryTag: 'Security Alerts',
      description: 'Important login and security records preserved for reference.'
    });
  }

  const totalActionable = otpIds.length + buildAlertIds.length + marketingIds.length + socialIds.length;
  const clutterPct = emails.length > 0 ? Math.min(100, Math.round((totalActionable / emails.length) * 100)) : 40;
  const relocPct = emails.length > 0 ? Math.min(100, Math.round((receiptIds.length / emails.length) * 100)) : 20;
  const impPct = Math.max(0, 100 - clutterPct - relocPct);

  const summary = {
    headline: `${categoryName} Category: ${clutterPct}% removable clutter and background notifications`,
    clutterPercentage: clutterPct,
    importantPercentage: impPct,
    relocatablePercentage: relocPct,
    overview: `Analyzed ${emails.length} sample emails from ${categoryName}. Identified ${actions.length} high-impact cleanup actions.`,
    practicalAdvice: `Regularly archiving automated notifications keeps your ${categoryName} category lightweight.`
  };

  return {
    summary,
    actions,
    attentionEmails: attentionEmails.slice(0, 10)
  };
}

function generateHeuristicSmartTriage(emails: any[], existingLabels: any[], userEmail?: string) {
  const groups: any[] = [];
  const senderMap: Record<string, any[]> = {};

  for (const e of emails) {
    const sender = e.sender || 'Unknown Sender';
    const cleanSender = sender.replace(/<.*?>/, '').replace(/["']/g, '').trim();
    if (!senderMap[cleanSender]) {
      senderMap[cleanSender] = [];
    }
    senderMap[cleanSender].push(e);
  }

  let groupIdx = 1;
  for (const [senderName, items] of Object.entries(senderMap)) {
    if (items.length >= 2) {
      const emailIds = items.map(i => i.id);
      const isPromo = items.some(i => (i.subject || '').toLowerCase().includes('sale') || (i.subject || '').toLowerCase().includes('newsletter'));
      const isReceipt = items.some(i => (i.subject || '').toLowerCase().includes('receipt') || (i.subject || '').toLowerCase().includes('order'));
      
      groups.push({
        id: `triage_group_${groupIdx++}`,
        sender: senderName,
        title: isReceipt ? `Archive ${items.length} ${senderName} receipts` : isPromo ? `Trash ${items.length} ${senderName} marketing emails` : `Archive ${items.length} emails from ${senderName}`,
        actionType: isPromo ? 'trash' : 'archive',
        emailIds,
        categoryTag: isReceipt ? 'Receipts' : isPromo ? 'Marketing' : 'Notifications',
        confidenceScore: 0.9,
        reason: `${items.length} messages from ${senderName} with consistent patterns.`,
        suggestFilterRule: {
          senderQuery: `from:${senderName.toLowerCase().replace(/\s+/g, '')}`,
          description: `Auto-${isPromo ? 'trash' : 'archive'} recurring messages from ${senderName}`
        }
      });
    }
  }

  const macroInsights = [
    {
      id: "macro_calendar_spam",
      title: "Calendar Invitations & Updates",
      actionType: "trash",
      filterQuery: "filename:invite.ics OR subject:\"invitation\" is:unread",
      estimatedImpact: "Cleans unread meeting alerts and calendar clutter",
      categoryTag: "Calendar Spambox",
      description: "Bulk review stale meeting invites that were already accepted or passed."
    },
    {
      id: "macro_stale_promotions",
      title: "Old Promotional Newsletters (>6 months)",
      actionType: "trash_promotions",
      filterQuery: "category:promotions older_than:6m",
      estimatedImpact: "Purges obsolete marketing blasts older than 6 months",
      categoryTag: "Stale Marketing",
      description: "Expired discounts and old newsletters taking up space without active value."
    }
  ];

  return {
    groups: groups.slice(0, 15),
    macroInsights
  };
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
      const isRateLimit = error.message && (error.message.includes("429") || error.message.toLowerCase().includes("quota") || error.message.toLowerCase().includes("rate limit") || error.message.toLowerCase().includes("exhausted"));
      const isOverloaded = error.message && (error.message.includes("503") || error.message.toLowerCase().includes("high demand") || error.message.toLowerCase().includes("unavailable"));
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
          },
          insights: {
            type: Type.ARRAY,
            description: "1-2 overarching macro-level recommendations or observations based on the overall data (e.g., massive unread backlog, too many newsletters).",
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING },
                title: { type: Type.STRING, description: "Catchy title for the insight, e.g., 'Newsletter Overload', 'Unread Alert'" },
                description: { type: Type.STRING, description: "A conversational, personal note from the smart organizer explaining the insight." },
                actionType: { type: Type.STRING, description: "One of: 'mark_read', 'trash_promotions', 'archive_old'" },
                actionLabel: { type: Type.STRING, description: "Text for the 1-click button, e.g., 'Mark 50+ as Read'" },
                filterQuery: { type: Type.STRING, description: "Gmail search filter to execute this macro action (e.g., 'is:unread category:updates')" }
              },
              required: ["id", "title", "description", "actionType", "actionLabel", "filterQuery"]
            }
          }
        },
        required: ["groups", "insights"]
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

4. MACRO INSIGHTS (Be a hyper-intelligent, proactive personal assistant):
   - Provide 1 to 3 brilliant, overarching insights to massively declutter the inbox.
   - Look for calendar invite spam (e.g., actionType: 'trash', filterQuery: 'filename:invite.ics OR subject:"invitation" is:unread').
   - Look for heavy attachment bloat (e.g., actionType: 'archive_old', filterQuery: 'has:attachment larger:5M').
   - Look for stale folders/categories that have thousands of unread emails that can just go (e.g., filterQuery: 'category:promotions older_than:6m').
   - For 'description', explicitly explain the "WHY" and "HOW" (e.g., "I noticed you have 400 unread calendar invites taking up space. Let's bulk delete them to clean up your search results.").
   - ActionTypes: 'mark_read', 'trash', 'archive_old', 'trash_promotions'.

Sampled emails:
${emailText}
`;

      let result: any = null;
      try {
        result = await generateAIContent(aiPrompt, schema, settings);
      } catch (aiErr: any) {
        console.warn("[AI] Smart triage fallback triggered due to AI error/rate limit:", aiErr.message || aiErr);
        result = generateHeuristicSmartTriage(emails, existingLabels, userEmail);
      }

      if (!result || !result.groups) {
        result = generateHeuristicSmartTriage(emails, existingLabels, userEmail);
      }
      
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
      const isRateLimit = error.message && (error.message.includes("429") || error.message.toLowerCase().includes("quota") || error.message.toLowerCase().includes("rate limit") || error.message.toLowerCase().includes("exhausted"));
      const isOverloaded = error.message && (error.message.includes("503") || error.message.toLowerCase().includes("high demand") || error.message.toLowerCase().includes("unavailable"));
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

      let result: any = null;
      try {
        result = await generateAIContent(prompt, schema, settings);
      } catch (aiErr: any) {
        console.warn("[AI] Category cleanup analysis fallback triggered due to AI error/rate limit:", aiErr.message || aiErr);
        result = generateHeuristicCategoryCleanup(categoryName, estimatedTotal, emails, userLabels);
      }

      if (!result || !result.summary || !result.actions) {
        result = generateHeuristicCategoryCleanup(categoryName, estimatedTotal, emails, userLabels);
      }

      res.json(result);
    } catch (e: any) {
      console.error("AI Category Cleanup Error:", e);
      try {
        const { categoryName, estimatedTotal, emails, userLabels } = req.body || {};
        if (emails && Array.isArray(emails)) {
          const fallback = generateHeuristicCategoryCleanup(categoryName || 'Category', estimatedTotal, emails, userLabels);
          return res.json(fallback);
        }
      } catch {}
      res.status(500).json({ error: e.message || "Failed to analyze category" });
    }
  });
  
  /**
   * Rewords findings the client has already computed locally.
   *
   * Takes aggregate statistics only — sender name, counts, ratios — and never
   * subjects, snippets or message bodies, so enabling AI does not start shipping
   * mail contents to a model provider.
   *
   * It cannot add, remove or re-rank findings: it returns wording keyed by the ids
   * it was given, and anything unrecognised is dropped by the caller. If the model
   * is unavailable, rate limited or misbehaves, the client keeps its own wording and
   * the feature is unchanged apart from the label.
   */
  app.post("/api/enrich-suggestions", async (req, res) => {
    try {
      const { findings, settings } = req.body;
      if (!Array.isArray(findings) || findings.length === 0) {
        return res.status(400).json({ error: "findings array is required" });
      }

      // Hard cap: bounded prompt regardless of how much the client sends.
      const capped = findings.slice(0, 25).map((f: any) => ({
        id: String(f.id || ''),
        kind: String(f.kind || ''),
        subject: String(f.subject || ''),
        destination: String(f.destination || ''),
        stats: String(f.stats || ''),
      }));

      const schema = {
        type: Type.OBJECT,
        properties: {
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                id: { type: Type.STRING, description: "Echo the id exactly as supplied." },
                title: { type: Type.STRING, description: "Short, concrete title, max 60 chars. No invented numbers." },
                rationale: { type: Type.STRING, description: "One or two plain sentences explaining the recommendation using ONLY the supplied statistics." },
                folderName: { type: Type.STRING, description: "For new-folder items only, a concise folder name (1-2 words). Empty otherwise." }
              },
              required: ["id", "title", "rationale"]
            }
          }
        },
        required: ["items"]
      };

      const lines = capped.map(f =>
        `id=${f.id} | type=${f.kind} | subject=${f.subject}` +
        (f.destination ? ` | destination=${f.destination}` : '') +
        ` | stats: ${f.stats}`
      ).join('\n');

      const prompt = `You are rewording inbox cleanup findings that have ALREADY been decided by a local statistical model. You are a copywriter here, not an analyst.

STRICT RULES:
- Do NOT invent, add, remove, merge or reorder findings. Return exactly one item per id supplied.
- Do NOT invent numbers. Use only the statistics given for that id.
- Do NOT speculate about message contents; you have not been shown any.
- Keep it plain and specific. No marketing tone, no exclamation marks.

Findings:
${lines}

For each id, write a clearer title and a rationale that explains, in plain language, why this is worth doing based on its statistics.`;

      let result: any = null;
      try {
        result = await generateAIContent(prompt, schema, settings);
      } catch (aiErr: any) {
        console.warn("[AI] Suggestion enrichment unavailable, client keeps local wording:", aiErr.message || aiErr);
        return res.status(503).json({ error: "enrichment_unavailable" });
      }

      if (!result || !Array.isArray(result.items)) {
        return res.status(503).json({ error: "enrichment_unavailable" });
      }

      // Only pass back wording for ids we actually sent — never let the model
      // introduce entries the local model did not produce.
      const allowed = new Set(capped.map(f => f.id));
      const items = result.items
        .filter((i: any) => i && allowed.has(String(i.id)))
        .map((i: any) => ({
          id: String(i.id),
          title: String(i.title || '').slice(0, 120),
          rationale: String(i.rationale || '').slice(0, 400),
          folderName: String(i.folderName || '').slice(0, 40),
        }));

      res.json({ items });
    } catch (e: any) {
      console.error("Suggestion enrichment error:", e);
      res.status(503).json({ error: "enrichment_unavailable" });
    }
  });

  app.post("/api/check-quota", async (req, res) => {
    try {
      const { settings } = req.body;
      const schema = { type: Type.STRING };
      // Lightweight prompt strictly to verify user's chosen provider & key
      await generateAIContent("Reply OK", schema, settings, { strictUserKeyOnly: true });
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

