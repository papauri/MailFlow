import fs from 'fs';

let content = fs.readFileSync('src/components/HealthScoreModal.tsx', 'utf8');

// Imports
content = content.replace(
  `import { countEmails } from '../lib/gmail';`,
  `import { countEmails, markAllAsReadByQuery, emptyAllTrash, searchEmails, batchDeleteEmails, batchTrashEmails } from '../lib/gmail';`
);

// Loader2 import
if (!content.includes('Loader2')) {
  content = content.replace('Activity,', 'Activity,\n  Loader2,');
}

// State variables
const stateVars = `  const [activeTab, setActiveTab] = useState<'breakdown' | 'simulator'>('breakdown');
  const [simulatedSpamClean, setSimulatedSpamClean] = useState(false);
  const [simulatedPromoClean, setSimulatedPromoClean] = useState(false);
  const [simulatedUnreadClean, setSimulatedUnreadClean] = useState(false);

  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<{message: string, pts: number} | null>(null);`;

content = content.replace(
  `  const [activeTab, setActiveTab] = useState<'breakdown' | 'simulator'>('breakdown');
  const [simulatedSpamClean, setSimulatedSpamClean] = useState(false);
  const [simulatedPromoClean, setSimulatedPromoClean] = useState(false);
  const [simulatedUnreadClean, setSimulatedUnreadClean] = useState(false);`,
  stateVars
);


fs.writeFileSync('src/components/HealthScoreModal.tsx', content);
console.log("Patched imports and states");
