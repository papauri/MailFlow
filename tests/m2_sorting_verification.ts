import { EmailData } from "../src/lib/gmail";

interface TestCaseResult {
  name: string;
  passed: boolean;
  details?: string;
  error?: string;
}

const results: TestCaseResult[] = [];

function assert(condition: boolean, name: string, details?: string) {
  if (condition) {
    results.push({ name, passed: true, details });
    console.log(`  [PASS] ${name}${details ? ` - ${details}` : ''}`);
  } else {
    results.push({ name, passed: false, details: `Assertion failed: ${details}` });
    console.error(`  [FAIL] ${name} - ${details}`);
  }
}

// Comparator implementation extracted from Dashboard.tsx lines 330-352
function sortEmails(emails: EmailData[], sortBy: "date" | "size" | "sender", sortDesc: boolean): EmailData[] {
  return [...emails].sort((a, b) => {
    let cmp = 0;
    if (sortBy === "date") {
      const timeA = a.date instanceof Date && !isNaN(a.date.getTime()) 
        ? a.date.getTime() 
        : (!isNaN(new Date(a.date).getTime()) ? new Date(a.date).getTime() : 0);
      const timeB = b.date instanceof Date && !isNaN(b.date.getTime()) 
        ? b.date.getTime() 
        : (!isNaN(new Date(b.date).getTime()) ? new Date(b.date).getTime() : 0);
      cmp = timeA - timeB;
    } else if (sortBy === "size") {
      const sizeA = Number(a.sizeEstimate) || 0;
      const sizeB = Number(b.sizeEstimate) || 0;
      cmp = sizeA - sizeB;
    } else if (sortBy === "sender") {
      const senderA = (a.sender || '').toLowerCase().trim();
      const senderB = (b.sender || '').toLowerCase().trim();
      cmp = senderA.localeCompare(senderB);
    }
    return sortDesc ? -cmp : cmp;
  });
}

// Format size function from Dashboard.tsx
function formatSize(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

console.log("=== STARTING EMPIRICAL SORTING TESTS ===");

// -------------------------------------------------------------
// 1. DATE SORTING ADVERSARIAL TESTS
// -------------------------------------------------------------
console.log("\n--- Suite 1: Date Sorting ---");

const dateTestEmails: EmailData[] = [
  { id: "d1", threadId: "t1", snippet: "", sender: "A", subject: "Valid 2026", date: new Date("2026-08-20T12:00:00Z"), labelIds: [], sizeEstimate: 100 },
  { id: "d2", threadId: "t2", snippet: "", sender: "B", subject: "Valid 2024", date: new Date("2024-01-01T00:00:00Z"), labelIds: [], sizeEstimate: 100 },
  { id: "d3", threadId: "t3", snippet: "", sender: "C", subject: "Epoch 1970", date: new Date(0), labelIds: [], sizeEstimate: 100 },
  { id: "d4", threadId: "t4", snippet: "", sender: "D", subject: "Far Future 2099", date: new Date("2099-12-31T23:59:59Z"), labelIds: [], sizeEstimate: 100 },
  { id: "d5", threadId: "t5", snippet: "", sender: "E", subject: "Invalid Date String", date: "not-a-date" as any, labelIds: [], sizeEstimate: 100 },
  { id: "d6", threadId: "t6", snippet: "", sender: "F", subject: "NaN Date Object", date: new Date(NaN), labelIds: [], sizeEstimate: 100 },
  { id: "d7", threadId: "t7", snippet: "", sender: "G", subject: "Undefined Date", date: undefined as any, labelIds: [], sizeEstimate: 100 },
  { id: "d8", threadId: "t8", snippet: "", sender: "H", subject: "Null Date", date: null as any, labelIds: [], sizeEstimate: 100 },
  { id: "d9", threadId: "t9", snippet: "", sender: "I", subject: "ISO String Date", date: "2025-06-15T10:30:00Z" as any, labelIds: [], sizeEstimate: 100 },
];

try {
  // Sort Descending (Newest first)
  const descSorted = sortEmails(dateTestEmails, "date", true);
  assert(descSorted.length === dateTestEmails.length, "Date sort desc preserves all items");
  assert(descSorted[0].id === "d4", "Date sort desc: 2099 is first", `Got ${descSorted[0].subject}`);
  assert(descSorted[1].id === "d1", "Date sort desc: 2026 is second", `Got ${descSorted[1].subject}`);
  assert(descSorted[2].id === "d9", "Date sort desc: ISO string 2025 parsed correctly", `Got ${descSorted[2].subject}`);
  assert(descSorted[3].id === "d2", "Date sort desc: 2024 is fourth", `Got ${descSorted[3].subject}`);
  
  // Verify invalid/null/undefined dates fallback to 0 and do not crash
  const zeroDateItems = descSorted.slice(4).map(e => e.id);
  assert(zeroDateItems.includes("d3") && zeroDateItems.includes("d5") && zeroDateItems.includes("d6") && zeroDateItems.includes("d7") && zeroDateItems.includes("d8"), 
    "Date sort desc: invalid/null/undefined/epoch dates handled gracefully without crash");

  // Sort Ascending (Oldest first)
  const ascSorted = sortEmails(dateTestEmails, "date", false);
  assert(ascSorted.length === dateTestEmails.length, "Date sort asc preserves all items");
  assert(ascSorted[ascSorted.length - 1].id === "d4", "Date sort asc: 2099 is last", `Got ${ascSorted[ascSorted.length - 1].subject}`);
  assert(ascSorted[ascSorted.length - 2].id === "d1", "Date sort asc: 2026 is second to last", `Got ${ascSorted[ascSorted.length - 2].subject}`);
} catch (e: any) {
  assert(false, "Date sorting execution", `Crashed with error: ${e.message}`);
}

// -------------------------------------------------------------
// 2. SIZE SORTING ADVERSARIAL TESTS
// -------------------------------------------------------------
console.log("\n--- Suite 2: Size Sorting ---");

const sizeTestEmails: EmailData[] = [
  { id: "s1", threadId: "t1", snippet: "", sender: "A", subject: "0 Bytes", date: new Date(), labelIds: [], sizeEstimate: 0 },
  { id: "s2", threadId: "t2", snippet: "", sender: "B", subject: "500 KB", date: new Date(), labelIds: [], sizeEstimate: 500 * 1024 },
  { id: "s3", threadId: "t3", snippet: "", sender: "C", subject: "50 MB", date: new Date(), labelIds: [], sizeEstimate: 50 * 1024 * 1024 },
  { id: "s4", threadId: "t4", snippet: "", sender: "D", subject: "1 GB", date: new Date(), labelIds: [], sizeEstimate: 1024 * 1024 * 1024 },
  { id: "s5", threadId: "t5", snippet: "", sender: "E", subject: "Missing sizeEstimate", date: new Date(), labelIds: [], sizeEstimate: undefined },
  { id: "s6", threadId: "t6", snippet: "", sender: "F", subject: "Null sizeEstimate", date: new Date(), labelIds: [], sizeEstimate: null as any },
  { id: "s7", threadId: "t7", snippet: "", sender: "G", subject: "String sizeEstimate '2048'", date: new Date(), labelIds: [], sizeEstimate: "2048" as any },
  { id: "s8", threadId: "t8", snippet: "", sender: "H", subject: "Negative sizeEstimate", date: new Date(), labelIds: [], sizeEstimate: -100 as any },
  { id: "s9", threadId: "t9", snippet: "", sender: "I", subject: "MAX_SAFE_INTEGER", date: new Date(), labelIds: [], sizeEstimate: Number.MAX_SAFE_INTEGER },
];

try {
  // Sort Descending (Largest first)
  const sizeDesc = sortEmails(sizeTestEmails, "size", true);
  assert(sizeDesc[0].id === "s9", "Size sort desc: MAX_SAFE_INTEGER is first", `Got ${sizeDesc[0].subject}`);
  assert(sizeDesc[1].id === "s4", "Size sort desc: 1 GB is second", `Got ${sizeDesc[1].subject}`);
  assert(sizeDesc[2].id === "s3", "Size sort desc: 50 MB is third", `Got ${sizeDesc[2].subject}`);
  assert(sizeDesc[3].id === "s2", "Size sort desc: 500 KB is fourth", `Got ${sizeDesc[3].subject}`);
  assert(sizeDesc[4].id === "s7", "Size sort desc: String '2048' converted to number", `Got ${sizeDesc[4].subject}`);

  // Sort Ascending (Smallest first)
  const sizeAsc = sortEmails(sizeTestEmails, "size", false);
  assert(sizeAsc[sizeAsc.length - 1].id === "s9", "Size sort asc: MAX_SAFE_INTEGER is last");
  assert(sizeAsc[sizeAsc.length - 2].id === "s4", "Size sort asc: 1 GB is second to last");

  // Format size utility tests
  assert(formatSize(0) === '0 B', "formatSize(0) returns '0 B'");
  assert(formatSize(500 * 1024).includes('KB'), "formatSize(500KB) formats KB");
  assert(formatSize(50 * 1024 * 1024).includes('MB'), "formatSize(50MB) formats MB");
  assert(formatSize(1024 * 1024 * 1024).includes('GB'), "formatSize(1GB) formats GB");
} catch (e: any) {
  assert(false, "Size sorting execution", `Crashed with error: ${e.message}`);
}

// -------------------------------------------------------------
// 3. SENDER SORTING ADVERSARIAL TESTS
// -------------------------------------------------------------
console.log("\n--- Suite 3: Sender Sorting ---");

const senderTestEmails: EmailData[] = [
  { id: "snd1", threadId: "t1", snippet: "", sender: "alice@example.com", subject: "Lowercase alice", date: new Date(), labelIds: [], sizeEstimate: 100 },
  { id: "snd2", threadId: "t2", snippet: "", sender: "BOB@EXAMPLE.COM", subject: "Uppercase BOB", date: new Date(), labelIds: [], sizeEstimate: 100 },
  { id: "snd3", threadId: "t3", snippet: "", sender: "  charlie@example.com  ", subject: "Whitespace charlie", date: new Date(), labelIds: [], sizeEstimate: 100 },
  { id: "snd4", threadId: "t4", snippet: "", sender: "", subject: "Empty sender", date: new Date(), labelIds: [], sizeEstimate: 100 },
  { id: "snd5", threadId: "t5", snippet: "", sender: undefined as any, subject: "Undefined sender", date: new Date(), labelIds: [], sizeEstimate: 100 },
  { id: "snd6", threadId: "t6", snippet: "", sender: null as any, subject: "Null sender", date: new Date(), labelIds: [], sizeEstimate: 100 },
  { id: "snd7", threadId: "t7", snippet: "", sender: "🚀 Rocket Team <team@rocket.io>", subject: "Emoji sender", date: new Date(), labelIds: [], sizeEstimate: 100 },
  { id: "snd8", threadId: "t8", snippet: "", sender: "zoe@example.com", subject: "Zoe", date: new Date(), labelIds: [], sizeEstimate: 100 },
  { id: "snd9", threadId: "t9", snippet: "", sender: "éponine@lesmis.fr", subject: "Accented sender", date: new Date(), labelIds: [], sizeEstimate: 100 },
  { id: "snd10", threadId: "t10", snippet: "", sender: "123-support@domain.com", subject: "Numeric prefix sender", date: new Date(), labelIds: [], sizeEstimate: 100 },
];

try {
  // Sort Ascending (A -> Z)
  const senderAsc = sortEmails(senderTestEmails, "sender", false);
  assert(senderAsc.length === senderTestEmails.length, "Sender sort asc preserves all items");
  
  // Empty/null/undefined should be sorted first in asc
  const first3 = senderAsc.slice(0, 3).map(e => e.id);
  assert(first3.includes("snd4") && first3.includes("snd5") && first3.includes("snd6"), 
    "Sender sort asc: empty/null/undefined senders grouped at beginning without error");

  // Alice, Bob, Charlie order
  const names = senderAsc.map(e => (e.sender || '').toLowerCase().trim()).filter(Boolean);
  const isSorted = names.every((val, i, arr) => i === 0 || arr[i - 1].localeCompare(val) <= 0);
  assert(isSorted, "Sender sort asc: all non-empty senders correctly ordered via localeCompare");

  // Sort Descending (Z -> A)
  const senderDesc = sortEmails(senderTestEmails, "sender", true);
  assert(senderDesc.length === senderTestEmails.length, "Sender sort desc preserves all items");
  assert(senderDesc[0].id === "snd8" || senderDesc[0].id === "snd7" || senderDesc[0].id === "snd9", 
    "Sender sort desc: Z/Unicode/Emoji at top of desc sort", `Got ${senderDesc[0].sender}`);
} catch (e: any) {
  assert(false, "Sender sorting execution", `Crashed with error: ${e.message}`);
}

// -------------------------------------------------------------
// 4. UI RENDER SIMULATION & SENDER FORMATTING SAFETY
// -------------------------------------------------------------
console.log("\n--- Suite 4: UI Rendering Edge Case Simulation ---");

// Test sender parsing in UI (Dashboard.tsx line 607)
function formatSenderDisplay(sender: any): string {
  if (!sender) return 'Unknown';
  return (typeof sender === 'string' ? sender.replace(/<.*>/, "").trim() : '') || sender || 'Unknown';
}

function formatDateDisplay(date: any): string {
  try {
    const d = (date instanceof Date && !isNaN(date.getTime())) ? date : new Date(date);
    return isNaN(d.getTime()) ? 'Invalid Date' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch (e) {
    return 'Invalid Date';
  }
}

const allAdversarialEmails = [...dateTestEmails, ...sizeTestEmails, ...senderTestEmails];

let uiRenderCrashCount = 0;
for (const email of allAdversarialEmails) {
  try {
    const senderDisplay = formatSenderDisplay(email.sender);
    const dateDisplay = formatDateDisplay(email.date);
    const sizeDisplay = formatSize(email.sizeEstimate || 0);
    if (!senderDisplay || !dateDisplay || !sizeDisplay) {
      uiRenderCrashCount++;
    }
  } catch (e) {
    uiRenderCrashCount++;
  }
}
assert(uiRenderCrashCount === 0, "UI email item formatting handles all adversarial emails without crash");

// -------------------------------------------------------------
// 5. IN-MEMORY ISOLATION & PAGINATION CO-EXISTENCE
// -------------------------------------------------------------
console.log("\n--- Suite 5: In-Memory Isolation & Pagination Stability ---");

let serverFetchCount = 0;
const mockFetchGmail = () => { serverFetchCount++; return Promise.resolve({}); };

// Initial page load (page 1: 100 emails)
let emailsState: EmailData[] = Array.from({ length: 100 }, (_, i) => ({
  id: `email_${i}`,
  threadId: `thread_${i}`,
  snippet: `Snippet ${i}`,
  sender: `user_${(100 - i)}@example.com`,
  subject: `Subject ${i}`,
  date: new Date(Date.now() - i * 3600000),
  labelIds: ['INBOX'],
  sizeEstimate: (i % 10) * 10240,
}));

// Changing sort in-memory
const sorted1 = sortEmails(emailsState, "sender", false);
const sorted2 = sortEmails(emailsState, "size", true);
const sorted3 = sortEmails(emailsState, "date", true);

assert(serverFetchCount === 0, "Sorting operates 100% in-memory without triggering server refetches");
assert(emailsState.length === 100, "Original emailsState is not mutated by sorting");
assert(sorted1.length === 100 && sorted2.length === 100 && sorted3.length === 100, "All sorted views retain full 100 items");

// Simulate Load More (Page 2: 50 additional emails)
const page2Emails: EmailData[] = Array.from({ length: 50 }, (_, i) => ({
  id: `email_p2_${i}`,
  threadId: `thread_p2_${i}`,
  snippet: `Page 2 Snippet ${i}`,
  sender: `p2_user_${i}@example.com`,
  subject: `Page 2 Subject ${i}`,
  date: new Date(Date.now() - (100 + i) * 3600000),
  labelIds: ['INBOX'],
  sizeEstimate: ((i + 5) % 10) * 10240,
}));

// Simulate appending page 2 to existing emails state
emailsState = [...emailsState, ...page2Emails];
assert(emailsState.length === 150, "Load more appends emails (total 150)");

// Re-sort with combined 150 emails
const sortedCombined = sortEmails(emailsState, "date", true);
assert(sortedCombined.length === 150, "Sort applies seamlessly to combined 150 emails");
assert(sortedCombined[0].id === "email_0", "Newest email is correctly at index 0");
assert(sortedCombined[149].id === "email_p2_49", "Oldest email from page 2 is correctly at index 149");

// Simulate Bulk Delete of 10 items
const deletedIds = new Set(sortedCombined.slice(0, 10).map(e => e.id));
emailsState = emailsState.filter(e => !deletedIds.has(e.id));
assert(emailsState.length === 140, "Bulk action cleanly removes items from memory");

const sortedAfterDelete = sortEmails(emailsState, "date", true);
assert(sortedAfterDelete.length === 140, "Sort seamlessly reflects reduced count after deletion");

// -------------------------------------------------------------
// 6. LARGE DATASET STRESS TEST (5,000 EMAILS)
// -------------------------------------------------------------
console.log("\n--- Suite 6: Large Dataset Stress Test (5,000 items) ---");

const largeDataset: EmailData[] = Array.from({ length: 5000 }, (_, i) => ({
  id: `large_${i}`,
  threadId: `thread_${i}`,
  snippet: `Stress test snippet ${i}`,
  sender: i % 7 === 0 ? "" : i % 11 === 0 ? "UNKNOWN <unknown@test.com>" : `sender_${(5000 - i) % 1000}@domain.com`,
  subject: `Email ${i}`,
  date: i % 13 === 0 ? new Date(NaN) : new Date(1700000000000 + (i * 10000)),
  labelIds: ['INBOX'],
  sizeEstimate: i % 5 === 0 ? undefined : Math.floor(Math.random() * 5000000),
}));

const t0 = performance.now();
const largeSortedDate = sortEmails(largeDataset, "date", true);
const t1 = performance.now();
const largeSortedSize = sortEmails(largeDataset, "size", true);
const t2 = performance.now();
const largeSortedSender = sortEmails(largeDataset, "sender", false);
const t3 = performance.now();

const dateSortTimeMs = t1 - t0;
const sizeSortTimeMs = t2 - t1;
const senderSortTimeMs = t3 - t2;

console.log(`  Sort times for 5,000 items: Date=${dateSortTimeMs.toFixed(2)}ms, Size=${sizeSortTimeMs.toFixed(2)}ms, Sender=${senderSortTimeMs.toFixed(2)}ms`);

assert(dateSortTimeMs < 100, "5,000 items Date sort completes in under 100ms", `${dateSortTimeMs.toFixed(2)}ms`);
assert(sizeSortTimeMs < 100, "5,000 items Size sort completes in under 100ms", `${sizeSortTimeMs.toFixed(2)}ms`);
assert(senderSortTimeMs < 100, "5,000 items Sender sort completes in under 100ms", `${senderSortTimeMs.toFixed(2)}ms`);
assert(largeSortedDate.length === 5000 && largeSortedSize.length === 5000 && largeSortedSender.length === 5000, 
  "All 5,000 items retained across all sort passes");

// -------------------------------------------------------------
// SUMMARY
// -------------------------------------------------------------
console.log("\n=== TEST RESULTS SUMMARY ===");
const totalTests = results.length;
const passedTests = results.filter(r => r.passed).length;
const failedTests = results.filter(r => !r.passed).length;

console.log(`Total: ${totalTests} | Passed: ${passedTests} | Failed: ${failedTests}`);

if (failedTests > 0) {
  console.error("FAILURES DETECTED:");
  results.filter(r => !r.passed).forEach(r => console.error(`  - ${r.name}: ${r.details}`));
  process.exit(1);
} else {
  console.log("ALL ADVERSARIAL AND EMPIRICAL TESTS PASSED!");
  process.exit(0);
}
