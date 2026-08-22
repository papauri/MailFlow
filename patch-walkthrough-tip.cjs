const fs = require('fs');
let code = fs.readFileSync('src/components/WalkthroughTip.tsx', 'utf8');

code = code.replace(
  `const [isVisible, setIsVisible] = useState(() => {
    return localStorage.getItem(storageKey) !== 'true';
  });`,
  `const [isVisible, setIsVisible] = useState(() => {
    return localStorage.getItem(storageKey) !== 'true';
  });

  React.useEffect(() => {
    const handleReset = () => {
      localStorage.removeItem(storageKey);
      setIsVisible(true);
    };
    window.addEventListener('reset-walkthroughs', handleReset);
    return () => window.removeEventListener('reset-walkthroughs', handleReset);
  }, [storageKey]);`
);

fs.writeFileSync('src/components/WalkthroughTip.tsx', code);
console.log("Patched WalkthroughTip");
