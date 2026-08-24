import fs from 'fs';
let content = fs.readFileSync('src/components/InboxHealth.tsx', 'utf8');

const loaderReplacement = `  const [typedText, setTypedText] = useState("");
  const loadingMessages = [
    "Scanning folders...",
    "Calculating storage sizes...",
    "Running email distribution analysis...",
    "Identifying large attachments...",
    "Categorizing subscriptions..."
  ];

  useEffect(() => {
    if (!loading && !isLoadingEmails) return;
    
    let currentMsgIndex = 0;
    let currentCharIndex = 0;
    let currentText = "";
    let isDeleting = false;
    
    const interval = setInterval(() => {
      const fullMsg = loadingMessages[currentMsgIndex];
      
      if (!isDeleting) {
        currentText = fullMsg.substring(0, currentCharIndex + 1);
        setTypedText(currentText);
        currentCharIndex++;
        
        if (currentCharIndex >= fullMsg.length) {
          isDeleting = true;
          clearInterval(interval);
          setTimeout(() => {
            setInterval(typeWriter, 50);
          }, 1500); // Wait before deleting
        }
      } else {
        currentText = fullMsg.substring(0, currentCharIndex - 1);
        setTypedText(currentText);
        currentCharIndex--;
        
        if (currentCharIndex === 0) {
          isDeleting = false;
          currentMsgIndex = (currentMsgIndex + 1) % loadingMessages.length;
          clearInterval(interval);
          setTimeout(() => {
            setInterval(typeWriter, 50);
          }, 300); // Wait before typing next
        }
      }
    }, 50);
    
    function typeWriter() {
      // Need a stable reference or just use a recursive timeout pattern
    }
    
    // Let's rewrite the typing effect to be simpler for React
  }, [loading, isLoadingEmails]);
`;

