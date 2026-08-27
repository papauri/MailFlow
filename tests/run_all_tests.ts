import { spawn } from 'child_process';
import path from 'path';

interface TestSuite {
  name: string;
  file: string;
  milestone: string;
  description: string;
}

const testSuites: TestSuite[] = [
  {
    name: 'Gmail Quota Governor Verification',
    file: 'tests/quota_governor_test.ts',
    milestone: 'Platform',
    description: 'Per-endpoint pricing, 250 u/s ceiling under concurrent load, 403/429 throttle handling'
  },
  {
    name: 'Cached Resource Staleness & Optimistic Updates',
    file: 'tests/cached_resource_test.tsx',
    milestone: 'Platform',
    description: 'Stale-while-mounted refetch, dedupe across views, optimistic writes reaching the screen'
  },
  {
    name: 'Inbox Health Analytics & Algorithm Verification',
    file: 'tests/inbox_health_analytics_verification.ts',
    milestone: 'Analytics',
    description: 'Gmail query integrity, health scoring, sender parsing, cleanup/routing/audit models, export rows'
  },
  {
    name: 'M1 Mobile Responsive Design Stress Test',
    file: 'tests/m1_stress_test.tsx',
    milestone: 'M1 (R1)',
    description: 'Mobile responsive layouts, touch scrolling, dynamic viewports, truncation'
  },
  {
    name: 'M2 Challenger Adversarial Test',
    file: 'tests/m2_challenger_adversarial.tsx',
    milestone: 'M2 (R2)',
    description: 'Adversarial edge cases for counts, sorting, pagination, and SSR'
  },
  {
    name: 'M2 Empirical Sorting & Pagination Verification',
    file: 'tests/m2_sorting_verification.ts',
    milestone: 'M2 (R2)',
    description: 'Date/size/sender null-safe sorting, deduplication, 5k performance benchmarking'
  },
  {
    name: 'M2 Pagination & Cap Stress Test',
    file: 'tests/m2_stress_test.tsx',
    milestone: 'M2 (R2)',
    description: 'countEmails traversal, 5,000 cap, searchIdRef race conditions, chunking'
  },
  {
    name: 'M2 Core Unit Verification',
    file: 'tests/m2_verification.ts',
    milestone: 'M2 (R2)',
    description: 'Sorting logic, pagination dedup, count display unit checks'
  },
  {
    name: 'M3 Dynamic Lifecycle & Interaction Stress Test',
    file: 'tests/m3_dynamic_stress_test.tsx',
    milestone: 'M3 (R3)',
    description: 'Modal lifecycle, Escape keydown listener cleanup, body scroll lock, concurrency'
  },
  {
    name: 'M3 Category Distribution Modal Stress Test',
    file: 'tests/m3_stress_test.tsx',
    milestone: 'M3 (R3)',
    description: 'Recharts integration, zero-division defense, 5,000+ volume, category filtering'
  },
  {
    name: 'M3 Recharts Core Verification',
    file: 'tests/m3_verification.ts',
    milestone: 'M3 (R3)',
    description: 'Recharts React 19 export checks, percentage math, normalization'
  },
  {
    name: 'M3 Direct Recharts SSR Render Test',
    file: 'tests/recharts_direct_test.tsx',
    milestone: 'M3 (R3)',
    description: 'SSR rendering of PieChart, ResponsiveContainer, Tooltip and Cell'
  },
  {
    name: 'M3 Recharts SVG DOM Generation Test',
    file: 'tests/recharts_svg_dom_test.tsx',
    milestone: 'M3 (R3)',
    description: 'JSDOM verification of SVG and Pie slice rendering'
  },
  {
    name: 'Milestone 4 E2E Cross-Milestone Integration Test',
    file: 'tests/e2e_integration_test.tsx',
    milestone: 'M4 (E2E)',
    description: 'Complete user journey covering R1 (Mobile) + R2 (Pagination & Sorting) + R3 (Recharts Modal)'
  },
  {
    name: 'Milestone 4 Forensic Integrity Audit',
    file: 'tests/m4_forensic_integrity_audit.tsx',
    milestone: 'M4 (Audit)',
    description: 'Independent forensic audit for hardcoded values, facade detection, and contract integrity'
  }
];

interface SuiteResult {
  suite: TestSuite;
  passed: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

function runTestSuite(suite: TestSuite): Promise<SuiteResult> {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const cmd = process.platform === 'win32' ? `npx tsx ${suite.file}` : `npx tsx ${suite.file}`;
    const child = spawn(cmd, {
      shell: true,
      cwd: process.cwd(),
      env: { ...process.env, FORCE_COLOR: 'true' }
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      const durationMs = Date.now() - startTime;
      resolve({
        suite,
        passed: code === 0,
        durationMs,
        stdout,
        stderr,
        exitCode: code
      });
    });

    child.on('error', (err) => {
      const durationMs = Date.now() - startTime;
      resolve({
        suite,
        passed: false,
        durationMs,
        stdout,
        stderr: err.message,
        exitCode: 1
      });
    });
  });
}

async function main() {
  console.log('======================================================================');
  console.log('               MAILFLOW UNIFIED TEST RUNNER (ALL SUITES)              ');
  console.log('======================================================================\n');
  console.log(`Discovered ${testSuites.length} test suites across Analytics and Milestones M1, M2, M3, and M4.\n`);

  const results: SuiteResult[] = [];
  const globalStart = Date.now();

  for (let i = 0; i < testSuites.length; i++) {
    const suite = testSuites[i];
    console.log(`[${i + 1}/${testSuites.length}] Running ${suite.name} (${suite.milestone})...`);
    const result = await runTestSuite(suite);
    results.push(result);

    if (result.passed) {
      console.log(`  ✓ PASSED in ${result.durationMs}ms`);
    } else {
      console.error(`  ✗ FAILED in ${result.durationMs}ms (exit code ${result.exitCode})`);
      if (result.stderr) {
        console.error(`    Error Output:\n${result.stderr.trim()}`);
      }
    }
  }

  const globalDuration = Date.now() - globalStart;
  const passedSuites = results.filter(r => r.passed);
  const failedSuites = results.filter(r => !r.passed);

  console.log('\n======================================================================');
  console.log('                         TEST EXECUTION SUMMARY                       ');
  console.log('======================================================================');
  console.log(`Total Suites Run : ${results.length}`);
  console.log(`Passed Suites    : ${passedSuites.length}`);
  console.log(`Failed Suites    : ${failedSuites.length}`);
  console.log(`Pass Rate        : ${((passedSuites.length / results.length) * 100).toFixed(1)}%`);
  console.log(`Total Time       : ${(globalDuration / 1000).toFixed(2)}s\n`);

  console.log('--- Suite Breakdown ---');
  results.forEach(r => {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  ${status} | [${r.suite.milestone.padEnd(10)}] ${r.suite.name.padEnd(52)} | ${r.durationMs}ms`);
  });
  console.log('======================================================================\n');

  if (failedSuites.length > 0) {
    console.error('ONE OR MORE TEST SUITES FAILED:');
    failedSuites.forEach(f => {
      console.error(`\nSuite: ${f.suite.name} (${f.suite.file})`);
      console.error(`STDOUT:\n${f.stdout}`);
      console.error(`STDERR:\n${f.stderr}`);
    });
    process.exit(1);
  } else {
    console.log('🎉 ALL INTEGRATION, STRESS, AND UNIT TEST SUITES PASSED (100%)!');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error in unified test runner:', err);
  process.exit(1);
});
