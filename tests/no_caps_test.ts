/**
 * No hidden ceilings on how much mail the app looks at.
 *
 * Caps were scattered as bare numbers at call sites — 1,500 behind a label reading
 * "Auditing newsletters", 300 behind a purge that reported the sender cleared,
 * 5,000 behind a scope option literally named "Entire Folder". Each presented a
 * partial result as a complete one, which is a wrong answer rather than a smaller
 * one. These assertions fail if any of them come back.
 */
import './helpers/browserEnv';
import { stubGmail, messagePage } from './helpers/browserEnv';
import { listMessageIds, countEmails } from '../src/lib/gmail';
import * as fs from 'fs';

let passed = 0, failed = 0;
function assert(c: boolean, label: string, detail?: string) {
  if (c) { passed++; console.log(`  PASS: ${label}`); }
  else { failed++; console.error(`  FAIL: ${label}${detail ? ` — ${detail}` : ''}`); }
}

console.log('=== No hardcoded scan caps ===\n');

// --- listMessageIds pages past every old ceiling ---
{
  // 12 full pages then a short one: 6,120 ids, well past the old 2,000 and 5,000.
  let page = 0;
  const stub = stubGmail(() => {
    page++;
    return page <= 12 ? { body: messagePage(500, `p${page}`) } : { body: messagePage(120) };
  });
  const ids = await listMessageIds('in:anywhere');
  stub.restore();
  assert(ids.length === 6120, 'listMessageIds returns every id, past 2,000 and 5,000', String(ids.length));
}

// --- an explicit limit is still honoured, for deliberate sampling ---
{
  const stub = stubGmail(() => ({ body: messagePage(500, 'more') }));
  const ids = await listMessageIds('in:anywhere', 750);
  stub.restore();
  assert(ids.length === 750, 'An explicit limit is still respected when a caller asks for a sample',
    String(ids.length));
}

// --- counting runs to completion rather than switching to an estimate ---
{
  let page = 0;
  const stub = stubGmail(() => {
    page++;
    // 25 pages: past the old 20-page / 10,000 bound.
    return page <= 25 ? { body: messagePage(500, `p${page}`, 999999) } : { body: messagePage(300) };
  });
  const total = await countEmails('in:anywhere');
  stub.restore();
  assert(total === 12800, 'countEmails counts every page instead of stopping at 10,000', String(total));
}

// --- the call sites themselves carry no numeric ceilings ---
{
  const cases: [string, string][] = [
    ['src/components/UnsubscribeManager.tsx', 'newsletter audit and sender purge'],
    ['src/lib/inboxAnalytics.ts', 'routing and cluster samples'],
    ['src/components/ExportCenter.tsx', 'CSV exports'],
    ['src/components/LabelManagerModal.tsx', 'folder browser'],
  ];
  const capCall = /(scanFolderMetadata|listMessageIds|searchEmails)\([^)]*,\s*\d{2,}/;
  for (const [file, what] of cases) {
    const src = fs.readFileSync(file, 'utf-8');
    assert(!capCall.test(src), `No numeric scan cap in the ${what} (${file})`,
      (src.match(capCall) || [''])[0]);
  }

  const omni = fs.readFileSync('src/components/OmniCleanPage.tsx', 'utf-8');
  assert(!/sampleLimit === 0 \? 5000/.test(omni),
    '"Entire Folder" no longer means five thousand');

  const exp = fs.readFileSync('src/components/ExportCenter.tsx', 'utf-8');
  assert(!/MESSAGE_EXPORT_LIMIT\s*=\s*\d+/.test(exp),
    'Exports carry no row ceiling');
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
process.exit(failed > 0 ? 1 : 0);
