const fs = require('fs');
let code = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

code = code.replace(
  `                                   <div className="flex gap-1.5 hidden sm:flex">`,
  `                                   <div className="flex gap-1.5 flex-wrap">`
);

fs.writeFileSync('src/components/Dashboard.tsx', code);
console.log("Patched mobile badges");
