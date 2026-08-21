const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

const newEndpoint = `
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
        const fetchRes = await fetch(\`https://generativelanguage.googleapis.com/v1beta/models?key=\${apiKey}\`);
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data.models) models = data.models.map(m => m.name.replace('models/', '')).filter(m => m.includes('gemini'));
        }
      } else if (provider === 'openai') {
        const fetchRes = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: \`Bearer \${apiKey}\` }});
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
        const fetchRes = await fetch('https://api.groq.com/openai/v1/models', { headers: { Authorization: \`Bearer \${apiKey}\` }});
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data.data) models = data.data.map(m => m.id);
        }
      } else if (provider === 'deepseek') {
        const fetchRes = await fetch('https://api.deepseek.com/models', { headers: { Authorization: \`Bearer \${apiKey}\` }});
        if (fetchRes.ok) {
          const data = await fetchRes.json();
          if (data.data) models = data.data.map(m => m.id);
        }
      } else if (provider === 'mistral') {
        const fetchRes = await fetch('https://api.mistral.ai/v1/models', { headers: { Authorization: \`Bearer \${apiKey}\` }});
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
`;

content = content.replace('// Vite middleware for development', newEndpoint);
fs.writeFileSync('server.ts', content);
