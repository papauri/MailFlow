import fs from 'fs';

let content = fs.readFileSync('src/lib/gmail.ts', 'utf8');

const oldFetch = `  const response = await fetch(\`\${BASE_URL}\${endpoint}\`, { ...options, headers });
  
  if (response.status === 429 && retries > 0) {
    console.warn(\`Rate limit hit on \${endpoint}. Retrying in \${backoff}ms...\`);
    await new Promise(r => setTimeout(r, backoff));
    return fetchGmailAPI(endpoint, options, retries - 1, backoff * 1.5);
  }`;

const newFetch = `  let response;
  try {
    response = await fetch(\`\${BASE_URL}\${endpoint}\`, { ...options, headers });
  } catch (err) {
    if (retries > 0) {
      console.warn(\`Network error on \${endpoint} (\${err.message || err}). Retrying in \${backoff}ms...\`);
      await new Promise(r => setTimeout(r, backoff));
      return fetchGmailAPI(endpoint, options, retries - 1, backoff * 1.5);
    }
    throw err;
  }
  
  if ((response.status === 429 || response.status >= 500) && retries > 0) {
    console.warn(\`Status \${response.status} hit on \${endpoint}. Retrying in \${backoff}ms...\`);
    await new Promise(r => setTimeout(r, backoff));
    return fetchGmailAPI(endpoint, options, retries - 1, backoff * 1.5);
  }`;

content = content.replace(oldFetch, newFetch);

fs.writeFileSync('src/lib/gmail.ts', content);
