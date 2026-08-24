import fs from 'fs';
let content = fs.readFileSync('src/index.css', 'utf8');

const themeBlock = `
@theme {
  --font-sans: "Google Sans Flex", ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji";
}
`;

content = content.replace('@import "tailwindcss";', '@import "tailwindcss";\n' + themeBlock);

fs.writeFileSync('src/index.css', content);
