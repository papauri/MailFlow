import fs from 'fs';

let content = fs.readFileSync('src/components/InboxHealth.tsx', 'utf8');

const scrollToAndFlashStr = `
  const scrollToAndFlash = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('animate-flash');
      setTimeout(() => el.classList.remove('animate-flash'), 1200);
    }
  };
`;

// we will insert this right after "const [reloadTrigger, setReloadTrigger] = useState(0);"
content = content.replace(
  `const [reloadTrigger, setReloadTrigger] = useState(0);`,
  `const [reloadTrigger, setReloadTrigger] = useState(0);\n${scrollToAndFlashStr}`
);

fs.writeFileSync('src/components/InboxHealth.tsx', content);
console.log("Successfully patched InboxHealth.tsx again!");
