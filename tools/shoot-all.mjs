#!/usr/bin/env node
/** 批量截图：541 个盘面（主线 + Boss 部件 + 彩蛋）→ .tmp/shots/*.png */
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const BASE = 'http://127.0.0.1:4173/?debug=1';
const OUT = path.resolve('.tmp/shots');

class CDP {
  constructor(u) { this.u = u; this.id = 0; this.p = new Map(); }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.u);
      this.ws.onopen = () => res();
      this.ws.onerror = (e) => rej(new Error(String(e.message)));
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && this.p.has(m.id)) {
          const p = this.p.get(m.id); this.p.delete(m.id);
          m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
        }
      };
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.p.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception?.description ?? r.exceptionDetails));
    return r.result.value;
  }
}

await mkdir(OUT, { recursive: true });
const profile = await mkdtemp(path.join(tmpdir(), 'shots-'));
const port = 9700 + Math.floor(Math.random() * 80);
const chrome = spawn(CHROME, [
  '--headless=new', '--disable-gpu', '--mute-audio', '--no-first-run',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, 'about:blank',
], { stdio: 'ignore' });
for (let i = 0; i < 80; i++) {
  await sleep(150);
  try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
}
const t = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
const cdp = new CDP(t.webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Emulation.setDeviceMetricsOverride', { width: 430, height: 932, deviceScaleFactor: 1, mobile: true });
await cdp.send('Page.navigate', { url: BASE });
await sleep(1800);
await cdp.eval("(() => { localStorage.clear(); })()");
await cdp.send('Page.reload', { ignoreCache: true });
await sleep(1600);

// 目标清单：主线 500 + Boss 部件 + 彩蛋
const targets = [];
for (let id = 1; id <= 500; id++) {
  const isBossGauntlet = await 0;
  targets.push({ id, part: 0 });
}
for (const id of [119, 139, 159, 179, 199, 219, 239, 259, 279, 299, 319, 339, 359, 379, 399, 419, 439, 459, 479, 499]) {
  targets.push({ id, part: 1 }, { id, part: 2 });
}
targets.push({ id: 501, part: 0 });

let n = 0;
const t0 = Date.now();
for (const { id, part } of targets) {
  const name = part > 0 ? `L${id}-${part + 1}` : `L${id}`;
  try {
    await cdp.eval(`window.__arrowGame.debugPreview(${id}, ${part})`);
    await sleep(70);
    const rect = await cdp.eval(`(() => {
      const c = document.querySelector('#board');
      const r = c.getBoundingClientRect();
      return { x: Math.max(0, r.x), y: Math.max(0, r.y), w: r.width, h: r.height };
    })()`);
    const shot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: rect.x, y: rect.y, width: Math.min(rect.w, 430), height: Math.min(rect.h, 932), scale: 0.55 },
    });
    await writeFile(path.join(OUT, `${name}.png`), Buffer.from(shot.data, 'base64'));
    n++;
    if (n % 50 === 0) console.log(`${n}/${targets.length} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  } catch (e) {
    console.error(`FAIL ${name}:`, String(e).slice(0, 120));
  }
}
console.log(`done: ${n}/${targets.length} screenshots in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${OUT}`);
chrome.kill('SIGKILL');
process.exit(n === targets.length ? 0 : 1);
