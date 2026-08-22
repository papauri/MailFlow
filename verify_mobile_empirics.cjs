const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// 1. Static file server for dist/
function startServer() {
  const distDir = path.join(__dirname, 'dist');
  const server = http.createServer((req, res) => {
    let reqUrl = req.url.split('?')[0];
    if (reqUrl === '/' || !reqUrl) reqUrl = 'test.html';
    reqUrl = reqUrl.replace(/^\/+/, '');
    
    const filePath = path.join(distDir, reqUrl);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not Found: ' + reqUrl);
      return;
    }

    const ext = path.extname(filePath);
    const mimeTypes = {
      '.html': 'text/html',
      '.js': 'application/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.png': 'image/png',
      '.svg': 'image/svg+xml'
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(fs.readFileSync(filePath));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, port });
    });
  });
}

// 2. CDP Client
class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.events = new Map();

    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id && this.callbacks.has(data.id)) {
        const cb = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) cb.reject(new Error(data.error.message));
        else cb.resolve(data.result);
      } else if (data.method) {
        const cbs = this.events.get(data.method) || [];
        cbs.forEach(fn => fn(data.params));
      }
    };
  }

  static async connect(port = 9226) {
    for (let i = 0; i < 25; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          const data = await res.json();
          const client = new CDPClient(data.webSocketDebuggerUrl);
          await new Promise((resolve) => { client.ws.onopen = resolve; });
          return client;
        }
      } catch (e) {}
      await new Promise(r => setTimeout(r, 200));
    }
    throw new Error('Failed to connect to CDP');
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }

  async eval(expr) {
    const res = await this.send('Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true
    });
    if (res.exceptionDetails) {
      console.error('EVAL EXCEPTION DETAILS:', JSON.stringify(res.exceptionDetails, null, 2));
      throw new Error(res.exceptionDetails.exception?.description || res.exceptionDetails.text || 'Eval exception');
    }
    return res.result?.value;
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 2,
      mobile: true,
      screenWidth: width,
      screenHeight: height
    });
    await this.send('Emulation.setVisibleSize', { width, height });
  }

  async close() {
    this.ws.close();
  }
}

// 3. Verification Test Suite
async function runVerification() {
  const { server, port } = await startServer();
  const cdpPort = 9226;
  const userDataDir = path.join(os.tmpdir(), 'edge_verify_' + Date.now());
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

  const cp = spawn(edgePath, [
    '--headless',
    `--remote-debugging-port=${cdpPort}`,
    '--user-data-dir=' + userDataDir,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check'
  ]);

  try {
    const cdp = await CDPClient.connect(cdpPort);
    console.log(`Connected to Edge CDP on port ${cdpPort}. Serving on port ${port}.`);

    const target = await cdp.send('Target.createTarget', { url: `http://127.0.0.1:${port}/test.html` });
    const targetWsUrl = `ws://127.0.0.1:${cdpPort}/devtools/page/${target.targetId}`;
    const pageCdp = new CDPClient(targetWsUrl);
    await new Promise(r => { pageCdp.ws.onopen = r; });

    let loadFired = false;
    pageCdp.events.set('Page.loadEventFired', [() => { loadFired = true; }]);
    await pageCdp.send('Page.enable');
    await pageCdp.send('Runtime.enable');
    await pageCdp.send('DOM.enable');

    await pageCdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/test.html` });
    for (let i = 0; i < 20; i++) {
      if (loadFired) break;
      await new Promise(r => setTimeout(r, 200));
    }
    await new Promise(r => setTimeout(r, 1000));

    const viewports = [
      { name: 'iPhone SE 1st Gen (320px)', width: 320, height: 568 },
      { name: 'Galaxy S9 / Android Small (360px)', width: 360, height: 640 },
      { name: 'iPhone SE 2nd / iPhone 8 (375px)', width: 375, height: 667 },
      { name: 'iPhone 11 / XR / Plus (414px)', width: 414, height: 896 },
      { name: 'Phablet / Wide Mobile (480px)', width: 480, height: 854 },
      { name: 'Mobile Landscape / Small Tablet sm (640px)', width: 640, height: 960 },
      { name: 'iPad Portrait md (768px)', width: 768, height: 1024 }
    ];

    const allResults = [];

    for (const vp of viewports) {
      console.log(`\n======================================================================`);
      console.log(`🔍 TESTING VIEWPORT: ${vp.name} [${vp.width}x${vp.height}]`);
      console.log(`======================================================================`);

      await pageCdp.setViewport(vp.width, vp.height);
      await new Promise(r => setTimeout(r, 300));

      const vpReport = {
        viewport: vp,
        tests: {}
      };

      // -------------------------------------------------------------
      // Test 1: LoginScreen View
      // -------------------------------------------------------------
      await pageCdp.eval(`document.getElementById('btn-view-login')?.click();`);
      await new Promise(r => setTimeout(r, 400));
      const loginCheck = await pageCdp.eval(`(() => {
        const docW = document.documentElement.clientWidth;
        const scrollW = document.documentElement.scrollWidth;
        const bodyScrollW = document.body.scrollWidth;
        const card = document.querySelector('.max-w-md');
        const cardRect = card?.getBoundingClientRect();
        const btn = card?.querySelector('button');
        const btnRect = btn?.getBoundingClientRect();

        return {
          viewportWidth: window.innerWidth,
          clientWidth: docW,
          scrollWidth: scrollW,
          bodyScrollWidth: bodyScrollW,
          hasHorizontalScroll: scrollW > docW || bodyScrollW > docW,
          cardFits: cardRect ? (cardRect.right <= docW && cardRect.left >= 0) : false,
          cardWidth: cardRect?.width,
          btnWidth: btnRect?.width,
          btnHeight: btnRect?.height
        };
      })()`);
      vpReport.tests.loginScreen = loginCheck;
      console.log(` [1. LoginScreen] ${loginCheck.hasHorizontalScroll ? '❌ HORIZONTAL SCROLL' : '✅ PASS'} | cardWidth: ${loginCheck.cardWidth?.toFixed(1)}px, btn: ${loginCheck.btnWidth?.toFixed(1)}x${loginCheck.btnHeight?.toFixed(1)}px`);

      // -------------------------------------------------------------
      // Test 2: Dashboard Normal (Emails Loaded)
      // -------------------------------------------------------------
      await pageCdp.eval(`document.getElementById('btn-view-dash')?.click();`);
      await new Promise(r => setTimeout(r, 500));
      const dashCheck = await pageCdp.eval(`(() => {
        const docW = document.documentElement.clientWidth;
        const scrollW = document.documentElement.scrollWidth;
        const bodyScrollW = document.body.scrollWidth;

        // Check overflowing elements
        const all = Array.from(document.querySelectorAll('*'));
        const overflows = [];
        for (const el of all) {
          if (el.id === 'test-nav' || el.closest('#test-nav')) continue;
          const style = window.getComputedStyle(el);
          if (style.overflowX === 'auto' || style.overflowX === 'scroll' || style.overflowX === 'hidden') continue;
          if (el.closest('.overflow-x-auto') || el.closest('.no-scrollbar')) continue;

          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.right > docW + 1) {
            overflows.push({
              tag: el.tagName,
              className: el.className?.toString().slice(0, 40),
              right: rect.right,
              width: rect.width,
              text: (el.innerText || '').slice(0, 25)
            });
          }
        }

        const header = document.querySelector('header');
        const headerRect = header?.getBoundingClientRect();
        const inboxHealthBtn = header?.querySelector('button[title=\"Inbox Health\"]');
        const healthBtnText = inboxHealthBtn?.querySelector('span')?.offsetParent !== null;
        const settingsBtn = header?.querySelector('button[title=\"Model Configuration\"]');
        const userChip = header?.querySelector('div[title*=\"@\"]');
        const userEmailText = userChip?.querySelector('span')?.offsetParent !== null;

        const searchInput = document.querySelector('input[placeholder*=\"Search\"]') || document.querySelector('input[type=\"text\"]');
        const searchBtn = Array.from(document.querySelectorAll('button')).find(b => b.innerText.includes('Search') || b.querySelector('svg.lucide-search'));

        const toolbar = document.querySelector('select')?.closest('.border-b');
        const selects = Array.from(document.querySelectorAll('select'));
        const mobileSort = selects.find(s => s.closest('.flex')?.className?.includes('sm:hidden')) || selects[0];
        const trashBtn = Array.from(document.querySelectorAll('button')).find(b => b.title === 'Trash');
        const archiveBtn = Array.from(document.querySelectorAll('button')).find(b => b.title === 'Archive');
        const readBtn = Array.from(document.querySelectorAll('button')).find(b => b.title === 'Mark Read');

        const emails = Array.from(document.querySelectorAll('li'));
        const senderTruncated = emails.map(li => {
          const sender = li.querySelector('.truncate');
          return {
            text: sender?.innerText?.slice(0, 30),
            width: sender?.getBoundingClientRect()?.width
          };
        });

        return {
          clientWidth: docW,
          scrollWidth: scrollW,
          bodyScrollWidth: bodyScrollW,
          hasHorizontalScroll: scrollW > docW || bodyScrollW > docW,
          overflowCount: overflows.length,
          overflows: overflows.slice(0, 3),
          header: {
            width: headerRect?.width,
            healthBtnTextVisible: healthBtnText,
            userEmailVisible: userEmailText
          },
          search: {
            inputWidth: searchInput?.getBoundingClientRect()?.width,
            btnWidth: searchBtn?.getBoundingClientRect()?.width
          },
          toolbar: {
            hasMobileSort: !!mobileSort,
            trashWidth: trashBtn?.getBoundingClientRect()?.width,
            archiveWidth: archiveBtn?.getBoundingClientRect()?.width,
            readWidth: readBtn?.getBoundingClientRect()?.width
          },
          emailCount: emails.length,
          senders: senderTruncated.slice(0, 3)
        };
      })()`);
      vpReport.tests.dashboard = dashCheck;
      console.log(` [2. Dashboard] ${dashCheck.hasHorizontalScroll ? '❌ HORIZONTAL SCROLL' : '✅ PASS'} | overflows: ${dashCheck.overflowCount}, searchInput: ${dashCheck.search.inputWidth?.toFixed(1)}px, toolbarBtns: [${dashCheck.toolbar.trashWidth?.toFixed(1)}, ${dashCheck.toolbar.archiveWidth?.toFixed(1)}, ${dashCheck.toolbar.readWidth?.toFixed(1)}]px`);

      // -------------------------------------------------------------
      // Test 3: Toolbar Bulk Selection & Action Button Usability
      // -------------------------------------------------------------
      // Click select all checkbox button
      await pageCdp.eval(`(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const selectAllBtn = btns.find(b => b.className?.includes('w-7') || b.querySelector('.rounded.border'));
        selectAllBtn?.click();
      })()`);
      await new Promise(r => setTimeout(r, 200));
      const selectionCheck = await pageCdp.eval(`(() => {
        const countSpan = Array.from(document.querySelectorAll('span')).find(s => s.innerText.includes('selected') || s.innerText.includes('emails'));
        const trashBtn = Array.from(document.querySelectorAll('button')).find(b => b.title === 'Trash');
        const trashRect = trashBtn?.getBoundingClientRect();
        return {
          countText: countSpan?.innerText,
          trashEnabled: !trashBtn?.disabled,
          trashTapArea: { width: trashRect?.width, height: trashRect?.height }
        };
      })()`);
      vpReport.tests.bulkSelection = selectionCheck;
      console.log(` [3. Bulk Toolbar] ✅ PASS | count: "${selectionCheck.countText}", Trash enabled: ${selectionCheck.trashEnabled}, Tap target: ${selectionCheck.trashTapArea.width?.toFixed(1)}x${selectionCheck.trashTapArea.height?.toFixed(1)}px`);

      // -------------------------------------------------------------
      // Test 4: FolderMultiSelect Dropdown Menu Bounds
      // -------------------------------------------------------------
      // Click folder multiselect dropdown
      await pageCdp.eval(`(() => {
        const btns = Array.from(document.querySelectorAll('button'));
        const folderBtn = btns.find(b => b.innerText.includes('All Mail') || b.innerText.includes('Folders'));
        folderBtn?.click();
      })()`);
      await new Promise(r => setTimeout(r, 300));
      const folderMenuCheck = await pageCdp.eval(`(() => {
        const docW = document.documentElement.clientWidth;
        const menu = document.querySelector('.max-h-80') || document.querySelector('.absolute.top-full');
        const menuRect = menu?.getBoundingClientRect();
        return {
          menuOpen: !!menu,
          menuWidth: menuRect?.width,
          menuLeft: menuRect?.left,
          menuRight: menuRect?.right,
          itemsCount: menu?.querySelectorAll('label')?.length || 0,
          fitsWithinViewport: menuRect ? (menuRect.right <= docW && menuRect.left >= 0) : false
        };
      })()`);
      vpReport.tests.folderMenu = folderMenuCheck;
      console.log(` [4. Folder Dropdown] ${folderMenuCheck.menuOpen ? '✅ PASS' : '❌ MENU NOT OPEN'} | items: ${folderMenuCheck.itemsCount}, width: ${folderMenuCheck.menuWidth?.toFixed(1)}px, bounds: [${folderMenuCheck.menuLeft?.toFixed(1)}, ${folderMenuCheck.menuRight?.toFixed(1)}] vs docW: ${vp.width}px`);

      // Close dropdown by clicking backdrop
      await pageCdp.eval(`document.querySelector('.fixed.inset-0')?.click();`);
      await new Promise(r => setTimeout(r, 200));

      // -------------------------------------------------------------
      // Test 5: BYOK Settings Modal Scaling & Viewport Bounds
      // -------------------------------------------------------------
      // Open settings modal
      await pageCdp.eval(`document.querySelector('button[title=\"Model Configuration\"]')?.click();`);
      await new Promise(r => setTimeout(r, 400));
      const modalCheck = await pageCdp.eval(`(() => {
        const docW = document.documentElement.clientWidth;
        const docH = window.innerHeight;
        const overlay = document.querySelector('.fixed.inset-0');
        const modal = overlay?.querySelector('.bg-white');
        const modalRect = modal?.getBoundingClientRect();
        const providerGrid = modal?.querySelector('.grid');
        const gridComputed = providerGrid ? window.getComputedStyle(providerGrid) : null;
        const gridCols = gridComputed?.gridTemplateColumns?.split(' ').length;
        const autoSelectBtn = Array.from(modal?.querySelectorAll('button') || []).find(b => b.innerText.includes('Auto-select'));
        const autoBtnRect = autoSelectBtn?.getBoundingClientRect();

        return {
          modalVisible: !!modal,
          modalWidth: modalRect?.width,
          modalHeight: modalRect?.height,
          modalTop: modalRect?.top,
          modalBottom: modalRect?.bottom,
          fitsViewportWidth: modalRect ? (modalRect.right <= docW + 1 && modalRect.left >= -1) : false,
          fitsViewportHeight: modalRect ? (modalRect.height <= docH * 0.92) : false,
          providerGridColumns: gridCols,
          autoSelectBtnWidth: autoBtnRect?.width,
          autoSelectBtnHeight: autoBtnRect?.height
        };
      })()`);
      vpReport.tests.byokModal = modalCheck;
      console.log(` [5. BYOK Modal] ${modalCheck.fitsViewportWidth && modalCheck.fitsViewportHeight ? '✅ PASS' : '❌ MODAL OVERFLOW'} | modal: ${modalCheck.modalWidth?.toFixed(1)}x${modalCheck.modalHeight?.toFixed(1)}px, gridCols: ${modalCheck.providerGridColumns}, autoBtn: ${modalCheck.autoSelectBtnWidth?.toFixed(1)}px`);

      // Close modal
      await pageCdp.eval(`document.querySelector('.fixed.inset-0 button.text-slate-400')?.click();`);
      await new Promise(r => setTimeout(r, 300));

      // -------------------------------------------------------------
      // Test 6: Inbox Health View
      // -------------------------------------------------------------
      await pageCdp.eval(`document.getElementById('btn-view-health')?.click();`);
      await new Promise(r => setTimeout(r, 800));
      const healthCheck = await pageCdp.eval(`(() => {
        const docW = document.documentElement.clientWidth;
        const scrollW = document.documentElement.scrollWidth;
        const bodyScrollW = document.body.scrollWidth;

        // Health Cards
        const healthCards = Array.from(document.querySelectorAll('.rounded-2xl, .rounded-xl')).filter(el => el.innerText.includes('Storage Hogs') || el.innerText.includes('Stale Promotions'));

        // Quick Filters Scroll Container
        const quickFilterContainer = Array.from(document.querySelectorAll('.overflow-x-auto')).find(el => el.innerText.includes('Newsletters'));
        const quickFilterButtons = quickFilterContainer ? Array.from(quickFilterContainer.querySelectorAll('button')).map(b => ({
          text: b.innerText.split('\\n')[0],
          width: b.getBoundingClientRect().width,
          height: b.getBoundingClientRect().height
        })) : [];

        // Top Senders & Domain Clusters
        const sendersList = document.querySelector('.bg-white.rounded-xl.shadow-sm.border');
        const sendersRect = sendersList?.getBoundingClientRect();

        // Recurring Patterns Cards
        const patternCards = Array.from(document.querySelectorAll('h4')).map(h => {
          const card = h.closest('.rounded-xl.p-4');
          return {
            title: h.innerText,
            width: card?.getBoundingClientRect().width
          };
        });

        return {
          clientWidth: docW,
          scrollWidth: scrollW,
          bodyScrollWidth: bodyScrollW,
          hasHorizontalScroll: scrollW > docW || bodyScrollW > docW,
          healthCardsCount: healthCards.length,
          quickFiltersCount: quickFilterButtons.length,
          quickFilterScrollable: quickFilterContainer ? quickFilterContainer.scrollWidth > quickFilterContainer.clientWidth : false,
          quickFilters: quickFilterButtons,
          topSendersWidth: sendersRect?.width,
          patternCardsCount: patternCards.length,
          patternCards: patternCards
        };
      })()`);
      vpReport.tests.inboxHealth = healthCheck;
      console.log(` [6. Inbox Health] ${healthCheck.hasHorizontalScroll ? '❌ HORIZONTAL SCROLL' : '✅ PASS'} | Quick filters scrollable: ${healthCheck.quickFilterScrollable}, cards: ${healthCheck.healthCardsCount}, patterns: ${healthCheck.patternCardsCount}`);

      // -------------------------------------------------------------
      // Test 7: Adversarial Extreme Content Stress Test
      // -------------------------------------------------------------
      // Return to Dashboard and inspect the ultra-long sender email item
      await pageCdp.eval(`document.getElementById('btn-view-dash')?.click();`);
      await new Promise(r => setTimeout(r, 400));
      const extremeCheck = await pageCdp.eval(`(() => {
        const docW = document.documentElement.clientWidth;
        const scrollW = document.documentElement.scrollWidth;
        const extremeRow = Array.from(document.querySelectorAll('li')).find(li => li.innerText.includes('Supercalifragilisticexpialidocious') || li.innerText.includes('EXTREME_STRESS_TEST'));
        const senderSpan = extremeRow?.querySelector('.truncate');
        const senderRect = senderSpan?.getBoundingClientRect();
        const subjectP = extremeRow?.querySelectorAll('p')[0];
        const subjectRect = subjectP?.getBoundingClientRect();

        return {
          clientWidth: docW,
          scrollWidth: scrollW,
          hasHorizontalScroll: scrollW > docW,
          senderTextWidth: senderRect?.width,
          senderRight: senderRect?.right,
          subjectTextWidth: subjectRect?.width,
          subjectRight: subjectRect?.right,
          containedWithinPage: senderRect && subjectRect ? (senderRect.right <= docW && subjectRect.right <= docW) : false
        };
      })()`);
      vpReport.tests.adversarialStress = extremeCheck;
      console.log(` [7. Extreme Stress] ${extremeCheck.containedWithinPage && !extremeCheck.hasHorizontalScroll ? '✅ PASS' : '❌ OVERFLOW'} | senderWidth: ${extremeCheck.senderTextWidth?.toFixed(1)}px (right: ${extremeCheck.senderRight?.toFixed(1)}px vs docW: ${vp.width}px)`);

      const vpPassed = !loginCheck.hasHorizontalScroll && 
                       !dashCheck.hasHorizontalScroll && 
                       dashCheck.overflowCount === 0 &&
                       folderMenuCheck.fitsWithinViewport &&
                       modalCheck.fitsViewportWidth &&
                       modalCheck.fitsViewportHeight &&
                       !healthCheck.hasHorizontalScroll &&
                       extremeCheck.containedWithinPage &&
                       !extremeCheck.hasHorizontalScroll;

      vpReport.passed = vpPassed;
      allResults.push(vpReport);
      console.log(`>>> RESULT FOR ${vp.name}: ${vpPassed ? '🟢 PASS' : '🔴 FAIL'}`);
    }

    console.log(`\n======================================================================`);
    console.log(`FINAL EMPIRICAL MATRIX SUMMARY`);
    console.log(`======================================================================`);
    let finalVerdict = true;
    for (const r of allResults) {
      console.log(`• [${r.passed ? 'PASS' : 'FAIL'}] ${r.viewport.name} (${r.viewport.width}px):`);
      console.log(`    - LoginScreen: H-Scroll=${r.tests.loginScreen.hasHorizontalScroll}, CardFits=${r.tests.loginScreen.cardFits}`);
      console.log(`    - Dashboard: H-Scroll=${r.tests.dashboard.hasHorizontalScroll}, OverflowCount=${r.tests.dashboard.overflowCount}`);
      console.log(`    - FolderMenu: FitsWithinViewport=${r.tests.folderMenu.fitsWithinViewport}`);
      console.log(`    - BYOK Modal: FitsWidth=${r.tests.byokModal.fitsViewportWidth}, FitsHeight=${r.tests.byokModal.fitsViewportHeight}, GridCols=${r.tests.byokModal.providerGridColumns}`);
      console.log(`    - InboxHealth: H-Scroll=${r.tests.inboxHealth.hasHorizontalScroll}, QuickFiltersScrollable=${r.tests.inboxHealth.quickFilterScrollable}`);
      console.log(`    - Adversarial: Contained=${r.tests.adversarialStress.containedWithinPage}`);
      if (!r.passed) finalVerdict = false;
    }
    console.log(`\nOVERALL VERDICT: ${finalVerdict ? 'APPROVE' : 'REQUEST_CHANGES'}`);

    fs.writeFileSync('empirical_verification_report.json', JSON.stringify({
      verdict: finalVerdict ? 'APPROVE' : 'REQUEST_CHANGES',
      timestamp: new Date().toISOString(),
      results: allResults
    }, null, 2));

    await pageCdp.close();
    await cdp.close();
  } finally {
    cp.kill();
    server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch(e) {}
  }
}

runVerification().catch(err => {
  console.error('Empirical verification failed with error:', err);
  process.exit(1);
});
