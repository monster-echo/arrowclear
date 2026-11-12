#!/usr/bin/env node
/**
 * Minimal Chrome DevTools Protocol driver for preview QA.
 *
 *   node tools/cdp.mjs shot <url> <out.png> [w] [h]
 *   node tools/cdp.mjs eval <url> "<js>"
 *   node tools/cdp.mjs play <url> <out-prefix> [taps]
 *
 * Keeps a headless Chrome alive per invocation.
 */
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;

async function ensureChrome() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (r.ok) return JSON.parse(await r.text());
  } catch {}
  spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--mute-audio',
      `--remote-debugging-port=${PORT}`,
      '--user-data-dir=/tmp/arrowclear-chrome',
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { detached: true, stdio: 'ignore' },
  ).unref();
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return JSON.parse(await r.text());
    } catch {}
  }
  throw new Error('chrome did not start');
}

class CDP {
  static async open(url, w, h, dpr = 2) {
    await ensureChrome();
    const t = await fetch(
      `http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(url)}`,
      { method: 'PUT' },
    ).then((r) => r.json());
    const c = new CDP(t.webSocketDebuggerUrl);
    await c.connect();
    c.sessionId = null;
    await c.send('Page.enable');
    await c.send('Runtime.enable');
    await c.send('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: dpr,
      mobile: true,
    });
    await c.send('Page.navigate', { url });
    await sleep(1200);
    return c;
  }

  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(e);
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      };
    });
  }

  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  }

  async shot(file, clip) {
    const r = await this.send('Page.captureScreenshot', { format: 'png', clip });
    await writeFile(file, Buffer.from(r.data, 'base64'));
  }

  async tap(x, y) {
    await this.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
      pointerType: 'mouse',
    });
    await this.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
      pointerType: 'mouse',
    });
  }
}

const [cmd, url, arg1, arg2, arg3] = process.argv.slice(2);
const W = Number(process.env.CW) || 390;
const H = Number(process.env.CH) || 844;
const DPR = Number(process.env.DPR) || 2;
const open = (url) => CDP.open(url, W, H, DPR);

async function clean(c, url) {
  if (!process.env.CLEAN) return;
  await c.eval("localStorage.clear()");
  await c.send('Page.reload', { ignoreCache: true });
  await sleep(1100);
}

if (cmd === 'shot') {
  const c = await open(url);
  await clean(c, url);
  await sleep(Number(arg2) || 800);
  await c.shot(arg1);
  console.log('saved', arg1);
  process.exit(0);
}

if (cmd === 'eval') {
  const c = await open(url);
  await sleep(600);
  const v = await c.eval(arg1);
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  process.exit(0);
}

if (cmd === 'game') {
  const c = await open(url);
  await clean(c, url);
  await sleep(900);
  await c.eval("document.querySelector('#btn-play').click()");
  await sleep(700);
  await c.eval("(() => { const b = document.querySelector('#howto-ok'); if (b) b.click(); })()");
  await sleep(500);
  await c.shot(arg1);
  console.log('saved', arg1);
  process.exit(0);
}

if (cmd === 'play') {
  const c = await open(url);
  await sleep(900);
  await c.eval("document.querySelector('#btn-play').click()");
  await sleep(600);
  await c.eval("(() => { const b = document.querySelector('#howto-ok'); if (b) b.click(); })()");
  await sleep(400);
  await c.shot(`${arg1}-0.png`);
  const taps = Number(arg2) || 6;
  for (let i = 0; i < taps; i++) {
    const pos = await c.eval(`(() => {
      const g = window.__arrowGame;
      if (!g) return null;
      return g.debugFreeArrowScreenPos();
    })()`);
    if (!pos) break;
    console.log('tap', i + 1, pos);
    await c.tap(pos.x, pos.y);
    await sleep(520);
    console.log('state', await c.eval('JSON.stringify(window.__arrowGame.debugState())'));
    await c.shot(`${arg1}-${i + 1}.png`);
  }
  process.exit(0);
}
if (cmd === 'lose') {
  const c = await open(url);
  await sleep(900);
  await c.eval("document.querySelector('#btn-play').click()");
  await sleep(500);
  await c.eval("(() => { const b = document.querySelector('#howto-ok'); if (b) b.click(); })()");
  await sleep(300);
  for (let i = 0; i < 3; i++) {
    const pos = await c.eval(`(() => {
      const g = window.__arrowGame;
      const a = g.level.arrows.find((x) => g.alive.has(x.id) && !g.renderer.isFree(x, g.alive));
      if (!a) return null;
      const p = g.renderer.cellCenter(a.cells[0]);
      return { x: p.x, y: p.y };
    })()`);
    if (!pos) break;
    console.log('blocked tap', i + 1, pos);
    await c.tap(pos.x, pos.y);
    await sleep(650);
  }
  await sleep(600);
  await c.shot(arg1);
  console.log('state', await c.eval('JSON.stringify(window.__arrowGame.debugState())'));
  console.log('saved', arg1);
  process.exit(0);
}

if (cmd === 'do') {
  const c = await open(url);
  await sleep(800);
  await c.eval(arg2);
  await sleep(700);
  await c.shot(arg1);
  console.log('saved', arg1);
  process.exit(0);
}

if (cmd === 'auto') {
  const c = await open(url);
  await clean(c, url);
  await sleep(900);
  await c.eval("document.querySelector('#btn-play').click()");
  await sleep(500);
  await c.eval("(() => { const b = document.querySelector('#howto-ok'); if (b) b.click(); })()");
  await sleep(300);
  for (let i = 0; i < 60; i++) {
    const st = JSON.parse(await c.eval('JSON.stringify(window.__arrowGame.debugState())'));
    if (!st.running) break;
    const pos = await c.eval('(() => { const p = window.__arrowGame.debugFreeArrowScreenPos(); return p ? {x:p.x,y:p.y} : null; })()');
    if (!pos) break;
    await c.tap(pos.x, pos.y);
    await sleep(180);
  }
  await sleep(900);
  await c.shot(arg1);
  console.log('state', await c.eval('JSON.stringify(window.__arrowGame.debugState())'));
  console.log('saved', arg1);
  process.exit(0);
}

console.log('usage: shot|eval|play|auto');
process.exit(1);