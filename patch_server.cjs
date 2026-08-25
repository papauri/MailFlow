const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf8');
code = code.replace(/error\.message\.includes\("RESOURCE_EXHAUSTED"\)/g, 'error.message.toLowerCase().includes("resource_exhausted")');
code = code.replace(/error\.message\.includes\("exhausted"\)/g, 'error.message.toLowerCase().includes("exhausted")');
code = code.replace(/error\.message\.includes\("quota"\)/g, 'error.message.toLowerCase().includes("quota")');
code = code.replace(/error\.message\.includes\("rate limit"\)/g, 'error.message.toLowerCase().includes("rate limit")');
code = code.replace(/error\.message\.includes\("UNAVAILABLE"\)/g, 'error.message.toLowerCase().includes("unavailable")');
code = code.replace(/error\.message\.includes\("high demand"\)/g, 'error.message.toLowerCase().includes("high demand")');
fs.writeFileSync('server.ts', code);
