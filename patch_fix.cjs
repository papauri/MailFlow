const fs = require('fs');

// 1. Fix server.ts
let server = fs.readFileSync('server.ts', 'utf8');

// Restore the original parse-query prompt
server = server.replace(
  /const aiPrompt = \`You are a data analysis engine finding common themes in an inbox\.[\s\S]*?\$\{emailText\}\s*\`;/,
  `const aiPrompt = \`You are an expert at translating natural language into Gmail search operators.
        Convert the following user request into a structured JSON query object.
        If the user asks for a specific folder (like inbox, spam, trash), set the 'folder' field to something like "in:inbox".
        If they don't specify a folder, set 'inAnywhere' to true so it searches everywhere.
        Extract senders to 'from', subjects to 'subject', and general keywords to 'general'.
        If they say "larger than 5mb", add "larger:5M" to general.
        Suggest a human-readable folder name (like "Receipts" or "Project Updates") based on the query.
        
        User Request: "\${prompt}"
      \`;`
);

// Apply the intended patch to analyze-inbox
server = server.replace(
  /const aiPrompt = \`You are acting as "Phase 3: The Intelligent Cluster Modeler" in our Inbox Cleanup Pipeline\.[\s\S]*?\$\{emailText\}\s*\`;/,
  `const aiPrompt = \`You are a data analysis engine finding common themes in an inbox.
        I am providing you a sample of email headers. 
        
        Your Goal: Find actionable, high-volume groups that can be managed together (e.g., "Retail Receipts", "Old Project Notifications", "Daily Newsletters").
        Act as an autonomous system that learns from user behavior to detect structural similarities.

        CRITICAL RULES:
        1. Ignore human-to-human conversations. If a subject looks like a real conversation (e.g. "Checking in", "Dinner tonight?"), ignore it entirely.
        2. Focus ONLY on grouping the automated, recurring, or transactional emails into structural clusters.
        3. For 'searchQuery', use highly precise Gmail operators to target the cluster safely (e.g., from:company@alerts.com AND subject:"Your receipt").
        
        Emails:
        \${emailText}
      \`;`
);

fs.writeFileSync('server.ts', server);

// 2. Fix Dashboard.tsx
let dash = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

dash = dash.replace(
  'const [aiSettings, setAiSettings] = useState({ provider: \'gemini\', model: \'gemini-1.5-flash\', apiKey: \'\' });',
  `const [aiSettings, setAiSettings] = useState({ provider: 'gemini', model: 'gemini-1.5-flash', apiKey: '' });
  const [dynamicModels, setDynamicModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);

  useEffect(() => {
    async function fetchModels() {
      if (!aiSettings.provider) return;
      setLoadingModels(true);
      try {
        const res = await fetch('/api/models', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ settings: aiSettings })
        });
        if (res.ok) {
          const data = await res.json();
          if (data.models && data.models.length > 0) {
            setDynamicModels(data.models);
          } else {
            // Fallbacks
            if (aiSettings.provider === 'gemini') setDynamicModels(['gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash', 'gemini-3.6-flash']);
            if (aiSettings.provider === 'openai') setDynamicModels(['gpt-4o-mini', 'gpt-4o', 'o1-mini', 'o1', 'o3-mini']);
            if (aiSettings.provider === 'anthropic') setDynamicModels(['claude-3-7-sonnet-latest', 'claude-3-5-haiku-latest', 'claude-3-opus-latest']);
            if (aiSettings.provider === 'groq') setDynamicModels(['llama-3.1-8b-instant', 'llama-3.3-70b-versatile']);
            if (aiSettings.provider === 'deepseek') setDynamicModels(['deepseek-chat', 'deepseek-reasoner']);
            if (aiSettings.provider === 'mistral') setDynamicModels(['mistral-small-latest', 'mistral-large-latest']);
            if (aiSettings.provider === 'zhipu') setDynamicModels(['glm-4-flash', 'glm-4-plus']);
          }
        }
      } catch (e) {
        console.error(e);
      } finally {
        setLoadingModels(false);
      }
    }
    if (showSettings) {
      fetchModels();
    }
  }, [aiSettings.provider, aiSettings.apiKey, showSettings]);`
);

fs.writeFileSync('src/components/Dashboard.tsx', dash);
