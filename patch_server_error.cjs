const fs = require('fs');
let content = fs.readFileSync('server.ts', 'utf8');

content = content.replace(
  /const isRateLimit = error\.message && \(error\.message\.includes\("429"\) \|\| error\.message\.includes\("quota"\) \|\| error\.message\.includes\("rate limit"\) \|\| error\.message\.includes\("exhausted"\)\);/g,
  `const isRateLimit = error.message && (error.message.includes("429") || error.message.includes("quota") || error.message.includes("rate limit") || error.message.includes("exhausted"));
      const isOverloaded = error.message && (error.message.includes("503") || error.message.includes("high demand") || error.message.includes("UNAVAILABLE"));`
);

content = content.replace(
  /res\.status\(isRateLimit \? 429 : 500\)\.json\(\{ error: error\.message \|\| "Failed to parse query" \}\);/g,
  `res.status(isRateLimit ? 429 : isOverloaded ? 503 : 500).json({ error: error.message || "Failed to parse query" });`
);

content = content.replace(
  /res\.status\(isRateLimit \? 429 : 500\)\.json\(\{ error: error\.message \|\| "Failed to analyze inbox" \}\);/g,
  `res.status(isRateLimit ? 429 : isOverloaded ? 503 : 500).json({ error: error.message || "Failed to analyze inbox" });`
);

fs.writeFileSync('server.ts', content);
