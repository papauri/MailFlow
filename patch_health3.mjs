import fs from 'fs';

let content = fs.readFileSync('src/components/InboxHealth.tsx', 'utf8');

const oldFunc = `  const scrollToAndFlash = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('animate-flash');
      setTimeout(() => el.classList.remove('animate-flash'), 1200);
    }
  };`;

const newFunc = `  const scrollToAndFlash = (id: string) => {
    if (id.startsWith('card-')) {
      setShowOverview(true);
    }
    
    // Allow state update to render elements before scrolling
    setTimeout(() => {
      const el = document.getElementById(id);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('animate-flash');
        setTimeout(() => el.classList.remove('animate-flash'), 1200);
      }
    }, 50);
  };`;

content = content.replace(oldFunc, newFunc);
fs.writeFileSync('src/components/InboxHealth.tsx', content);
console.log("Successfully patched InboxHealth.tsx with scroll fix!");
