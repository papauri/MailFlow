const fs = require('fs');
let code = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

code = code.replace(
  `          setConnectionStatus('success');
          setConnectionMessage('Connection successful!');`,
  `          setConnectionStatus('success');
          setConnectionMessage('Connection successful! AI features enabled.');
          setUseAI(true);
          setAiError(null);`
);

fs.writeFileSync('src/components/Dashboard.tsx', code);
console.log("Patched AI auto-enable.");
