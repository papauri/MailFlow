const fs = require('fs');
let content = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

// 1. Change aiError state
content = content.replace(
  'const [aiError, setAiError] = useState(false);',
  'const [aiError, setAiError] = useState<string | null>(null);'
);

// 2. Clear aiError
content = content.replace(
  'setAiError(false);',
  'setAiError(null);'
);

// 3. Handle 503 and 429
content = content.replace(
  /if \(aiRes\.status === 429\) \{[\s\S]*?\} else if \(aiRes\.ok && data\) \{/,
  `if (aiRes.status === 429) {
           setAiError("rate_limit");
           setUseAI(false);
        } else if (aiRes.status === 503) {
           setAiError("overloaded");
           setUseAI(false);
        } else if (!aiRes.ok) {
           setAiError("error");
           setUseAI(false);
        } else if (aiRes.ok && data) {`
);

// 4. Update the error UI
content = content.replace(
  /\{aiError && \([\s\S]*?<\/div>\s*\)\}/,
  `{aiError && (
             <div className="bg-orange-50 border border-orange-200 text-orange-800 p-3 rounded-xl text-sm flex items-start gap-2">
               <Settings className="w-5 h-5 mt-0.5 shrink-0" />
               <div>
                 <p className="font-bold">
                    {aiError === "rate_limit" ? "Analysis Rate Limit Exceeded" : 
                     aiError === "overloaded" ? "AI Model Overloaded" : 
                     "Smart Search Failed"}
                 </p>
                 <p className="mt-1 opacity-90">
                    {aiError === "rate_limit" ? (
                      <>Your API key reached its quota. Smart features have been disabled for this search, falling back to standard Gmail search. To fix this, you can <button onClick={() => setShowSettings(true)} className="underline font-semibold hover:text-orange-900">update your API Key</button>.</>
                    ) : aiError === "overloaded" ? (
                      "The selected AI model is currently experiencing high demand. Smart features have been disabled for this search. Please try again later."
                    ) : (
                      "An error occurred while communicating with the AI provider. Smart features have been disabled for this search."
                    )}
                 </p>
               </div>
             </div>
          )}`
);

fs.writeFileSync('src/components/Dashboard.tsx', content);
