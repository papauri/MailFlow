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

  static async connect(port = 9223) {
    for (let i = 0; i < 20; i++) {
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
      throw new Error(res.exceptionDetails.text || 'Eval exception: ' + JSON.stringify(res.exceptionDetails));
    }
    return res.result?.value;
  }
}

async function run() {
  const { server, port } = await startServer();
  const cdpPort = 9225;
  const userDataDir = path.join(os.tmpdir(), 'edge_diag_' + Date.now());
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
    const target = await cdp.send('Target.createTarget', { url: `http://127.0.0.1:${port}/test.html` });
    const targetWsUrl = `ws://127.0.0.1:${cdpPort}/devtools/page/${target.targetId}`;
    const pageCdp = new CDPClient(targetWsUrl);
    await new Promise(r => { pageCdp.ws.onopen = r; });

    pageCdp.events.set('Runtime.consoleAPICalled', [p => console.log('Browser console:', p.type, p.args.map(a => a.value))]);
    pageCdp.events.set('Runtime.exceptionThrown', [p => console.log('Browser exception:', p.exceptionDetails)]);

    await pageCdp.send('Page.enable');
    await pageCdp.send('Runtime.enable');
    await pageCdp.send('Emulation.setDeviceMetricsOverride', {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
      mobile: true
    });

    let loadFired = false;
    pageCdp.events.set('Page.loadEventFired', [() => { loadFired = true; }]);
    await pageCdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/test.html` });
    
    for (let i = 0; i < 20; i++) {
      if (loadFired) break;
      await new Promise(r => setTimeout(r, 200));
    }
    await new Promise(r => setTimeout(r, 1000));

    const html = await pageCdp.eval('document.body.innerHTML');
    console.log('Root HTML preview:', html.slice(0, 500));

    const dimensions = await pageCdp.eval('({ innerWidth: window.innerWidth, innerHeight: window.innerHeight, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth })');
    console.log('Dimensions:', dimensions);

    await pageCdp.ws.close();
    await cdp.ws.close();
  } finally {
    cp.kill();
    server.close();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch(e) {}
  }
}

run().catch(console.error);
