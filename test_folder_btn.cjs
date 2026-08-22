const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

function startServer() {
  const distDir = path.join(__dirname, 'dist');
  const server = http.createServer((req, res) => {
    let reqUrl = req.url.split('?')[0];
    if (reqUrl === '/' || !reqUrl) reqUrl = 'test.html';
    reqUrl = reqUrl.replace(/^\/+/, '');
    const filePath = path.join(distDir, reqUrl);
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath);
    const mimeTypes = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

class CDPClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl);
    this.id = 1;
    this.callbacks = new Map();
    this.ws.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.id && this.callbacks.has(data.id)) {
        const cb = this.callbacks.get(data.id);
        this.callbacks.delete(data.id);
        if (data.error) cb.reject(new Error(data.error.message));
        else cb.resolve(data.result);
      }
    };
  }
  static async connect(port) {
    for (let i = 0; i < 20; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) {
          const data = await res.json();
          const client = new CDPClient(data.webSocketDebuggerUrl);
          await new Promise((r) => client.ws.onopen = r);
          return client;
        }
      } catch(e) {}
      await new Promise(r => setTimeout(r, 200));
    }
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const msgId = this.id++;
      this.callbacks.set(msgId, { resolve, reject });
      this.ws.send(JSON.stringify({ id: msgId, method, params }));
    });
  }
  async eval(expr) {
    const res = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    return res.result?.value;
  }
}

async function run() {
  const { server, port } = await startServer();
  const userDataDir = path.join(os.tmpdir(), 'edge_test_' + Date.now());
  const cp = spawn('C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', [
    '--headless', '--remote-debugging-port=9227', '--user-data-dir=' + userDataDir, '--disable-gpu', '--no-first-run'
  ]);
  try {
    const cdp = await CDPClient.connect(9227);
    const target = await cdp.send('Target.createTarget', { url: `http://127.0.0.1:${port}/test.html` });
    const pageCdp = new CDPClient(`ws://127.0.0.1:9227/devtools/page/${target.targetId}`);
    await new Promise(r => pageCdp.ws.onopen = r);
    await pageCdp.send('Page.enable');
    await pageCdp.send('Runtime.enable');
    await pageCdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/test.html` });
    await new Promise(r => setTimeout(r, 2000));

    // List all buttons and their texts
    const btns = await pageCdp.eval(`Array.from(document.querySelectorAll('button')).map(b => ({
      text: b.innerText,
      title: b.title,
      className: b.className?.slice(0, 40)
    }))`);
    console.log('Buttons on page:', btns);

    // Find and click the folder button
    const clickRes = await pageCdp.eval(`(() => {
      const btns = Array.from(document.querySelectorAll('button'));
      const fBtn = btns.find(b => b.innerText.includes('All Mail') || b.innerText.includes('Folders') || b.querySelector('svg.lucide-chevron-down'));
      if (!fBtn) return { error: 'Button not found' };
      fBtn.click();
      return { clicked: true, text: fBtn.innerText };
    })()`);
    console.log('Click res:', clickRes);
    await new Promise(r => setTimeout(r, 500));

    // Check if dropdown opened
    const dropdownRes = await pageCdp.eval(`(() => {
      const menu = document.querySelector('.max-h-80') || document.querySelector('.shadow-lg');
      return {
        found: !!menu,
        rect: menu?.getBoundingClientRect(),
        itemsCount: menu?.querySelectorAll('label')?.length
      };
    })()`);
    console.log('Dropdown res:', dropdownRes);

    await pageCdp.ws.close();
    await cdp.ws.close();
  } finally {
    cp.kill();
    server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch(e) {}
  }
}
run();
