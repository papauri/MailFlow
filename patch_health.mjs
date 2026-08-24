import fs from 'fs';

let content = fs.readFileSync('src/components/InboxHealth.tsx', 'utf8');

// 1. Add scrollToAndFlash function at the top of the component (inside InboxHealth function)
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
// Find the function start
content = content.replace(
  `export function InboxHealth({ onApplyQuery }: InboxHealthProps) {`,
  `export function InboxHealth({ onApplyQuery }: InboxHealthProps) {\n${scrollToAndFlashStr}`
);

// 2. Replace the playbook spans
const replaceAction1 = `<p><strong className="text-slate-800">Action:</strong> Click any colored segment in the <span className="font-semibold text-blue-700">Storage Breakdown</span> bar directly below.</p>`;
const newAction1 = `<p><strong className="text-slate-800">Action:</strong> <span onClick={() => scrollToAndFlash('storage-breakdown')} className="cursor-pointer hover:underline text-blue-700 font-semibold transition-colors">Click any colored segment in the Storage Breakdown bar</span> directly below.</p>`;

const replaceAction2 = `<p><strong className="text-slate-800">Action:</strong> Open the <span className="font-semibold text-blue-700">Subscriptions</span> manager from the Inbox Overview tools.</p>`;
const newAction2 = `<p><strong className="text-slate-800">Action:</strong> Open the <span onClick={() => scrollToAndFlash('card-subscriptions')} className="cursor-pointer hover:underline text-blue-700 font-semibold transition-colors">Subscriptions</span> manager from the Inbox Overview tools.</p>`;

const replaceAction3 = `<p><strong className="text-slate-800">Action:</strong> Run the <span className="font-semibold text-blue-700">Batch Organizer</span> from the Inbox Overview tools.</p>`;
const newAction3 = `<p><strong className="text-slate-800">Action:</strong> Run the <span onClick={() => scrollToAndFlash('card-batch-organizer')} className="cursor-pointer hover:underline text-blue-700 font-semibold transition-colors">Batch Organizer</span> from the Inbox Overview tools.</p>`;

content = content.replace(replaceAction1, newAction1);
content = content.replace(replaceAction2, newAction2);
content = content.replace(replaceAction3, newAction3);

// 3. Add ID to Storage Breakdown
content = content.replace(
  `<StorageBreakdownBar onApplyQuery={onApplyQuery} className="mb-4 sm:mb-6" />`,
  `<div id="storage-breakdown" className="mb-4 sm:mb-6 rounded-2xl"><StorageBreakdownBar onApplyQuery={onApplyQuery} /></div>`
);

// 4. Update HealthCard definition to accept id
content = content.replace(
  `function HealthCard({ title, count, desc, actionText, onAction, sizeEstimate }: any) {`,
  `function HealthCard({ id, title, count, desc, actionText, onAction, sizeEstimate }: any) {`
);
content = content.replace(
  `    <button \n      onClick={onAction}`,
  `    <button \n      id={id}\n      onClick={onAction}`
);

// 5. Add IDs to Subscriptions and Batch Organizer HealthCards
content = content.replace(
  `<HealthCard \n                  title="Subscriptions"`,
  `<HealthCard \n                  id="card-subscriptions"\n                  title="Subscriptions"`
);
content = content.replace(
  `<HealthCard \n                  title="Batch Organizer"`,
  `<HealthCard \n                  id="card-batch-organizer"\n                  title="Batch Organizer"`
);

fs.writeFileSync('src/components/InboxHealth.tsx', content);
console.log("Successfully patched InboxHealth.tsx!");
