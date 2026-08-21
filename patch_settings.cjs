const fs = require('fs');
let content = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

// Replace auto-select logic
content = content.replace(
  /const p = aiSettings\.provider;[\s\S]*?if \(p === 'mistral'\) saveSettings\(\{\.\.\.aiSettings, model: 'mistral-small-latest'\}\);/,
  `const p = aiSettings.provider;
                       if (p === 'gemini') saveSettings({...aiSettings, model: 'gemini-1.5-flash'});
                       if (p === 'openai') saveSettings({...aiSettings, model: 'gpt-4o-mini'});
                       if (p === 'anthropic') saveSettings({...aiSettings, model: 'claude-3-5-haiku-20241022'});
                       if (p === 'groq') saveSettings({...aiSettings, model: 'llama-3.1-8b-instant'});
                       if (p === 'deepseek') saveSettings({...aiSettings, model: 'deepseek-chat'});
                       if (p === 'zhipu') saveSettings({...aiSettings, model: 'glm-4-flash'});
                       if (p === 'mistral') saveSettings({...aiSettings, model: 'mistral-small-latest'});`
);

// Replace datalist
content = content.replace(
  /<datalist id="model-suggestions">[\s\S]*?<\/datalist>/,
  `<datalist id="model-suggestions">
                    {aiSettings.provider === 'gemini' && <option value="gemini-1.5-flash"/>}
                    {aiSettings.provider === 'openai' && <option value="gpt-4o-mini"/>}
                    {aiSettings.provider === 'anthropic' && <option value="claude-3-5-haiku-20241022"/>}
                    {aiSettings.provider === 'groq' && <option value="llama-3.1-8b-instant"/>}
                    {aiSettings.provider === 'deepseek' && <option value="deepseek-chat"/>}
                    {aiSettings.provider === 'zhipu' && <option value="glm-4-flash"/>}
                    {aiSettings.provider === 'mistral' && <option value="mistral-small-latest"/>}
                  </datalist>`
);

fs.writeFileSync('src/components/Dashboard.tsx', content);
