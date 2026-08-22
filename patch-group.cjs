const fs = require('fs');

let code = fs.readFileSync('src/components/Dashboard.tsx', 'utf8');

const groupedEmailsCode = `
  const groupedEmails = useMemo(() => {
    if (!onlyUnread) {
      return [{ title: null, emails: sortedEmails }];
    }
    const groups = {};
    
    const getPrimaryFolder = (email) => {
      const labels = email.labelIds || [];
      const customLabel = labels.find(l => !l.startsWith('CATEGORY_') && l !== 'UNREAD' && l !== 'STARRED' && l !== 'IMPORTANT' && l !== 'INBOX' && l !== 'SENT' && l !== 'SPAM' && l !== 'TRASH');
      
      if (customLabel) {
        const userLabel = userLabels.find(ul => ul.id === customLabel);
        return userLabel ? userLabel.name : customLabel.replace('Label_', 'Folder ');
      }
      
      if (labels.includes('CATEGORY_PROMOTIONS')) return 'Promotions';
      if (labels.includes('CATEGORY_SOCIAL')) return 'Social';
      if (labels.includes('CATEGORY_UPDATES')) return 'Updates';
      if (labels.includes('CATEGORY_FORUMS')) return 'Forums';
      if (labels.includes('SPAM')) return 'Spam';
      if (labels.includes('TRASH')) return 'Trash';
      
      return 'Primary Inbox';
    };

    sortedEmails.forEach(email => {
      const folder = getPrimaryFolder(email);
      if (!groups[folder]) groups[folder] = [];
      groups[folder].push(email);
    });

    // Sort groups alphabetically, but keep Primary Inbox first
    return Object.entries(groups)
      .map(([title, emails]) => ({ title, emails }))
      .sort((a, b) => {
        if (a.title === 'Primary Inbox') return -1;
        if (b.title === 'Primary Inbox') return 1;
        return a.title.localeCompare(b.title);
      });
  }, [sortedEmails, onlyUnread, userLabels]);

  return (
`;

code = code.replace(
  `  return (\n    <div className={cn("min-h-screen`,
  groupedEmailsCode + `    <div className={cn("min-h-screen`
);

fs.writeFileSync('src/components/Dashboard.tsx', code);
console.log("Patched grouping logic");
