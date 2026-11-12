#!/usr/bin/env node
/**
 * End-to-end test suite: drives the real static build in headless Chrome
 * through the full player journey and checks the DOM, the game state, the
 * save file, responsiveness and rendering performance.
 *
 * Run: npm run test:e2e   (expects dist/web to exist)
 */
import { createServer } from 'node:http';
import { readFile, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const DIST = path.join(ROOT, 'dist', 'web');
const ARTIFACTS = path.join(ROOT, 'tests', 'artifacts');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const results = [];
let failed = 0;

function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
}

function fail(name, err) {
  failed++;
  results.push({ name, ok: false, detail: String(err && err.message ? err.message : err) });
  console.log(`  ✗ ${name} — ${err && err.message ? err.message : err}`);
}

async function step(name, fn) {
  try {
    const detail = await fn();
    pass(name, typeof detail === 'string' ? detail : '');
  } catch (err) {
    fail(name, err);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function eq(actual, expected, msg) {
  if (actual !== expected) throw new Error(`${msg}: expected ${expected}, got ${actual}`);
}

// ---------------------------------------------------------------- static server

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.json': 'application/json',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (url.pathname === '/' || url.pathname === '') file = path.join(DIST, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const BASE = `http://127.0.0.1:${port}/`;

// ---------------------------------------------------------------- chrome + cdp

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.handlers = new Map();
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error(`ws error ${e.message ?? ''}`));
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: ok, reject: no } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) no(new Error(JSON.stringify(msg.error)));
          else ok(msg.result);
          return;
        }
        if (msg.method && this.handlers.has(msg.method)) {
          for (const fn of this.handlers.get(msg.method)) fn(msg.params);
        }
      };
    });
  }

  on(method, fn) {
    if (!this.handlers.has(method)) this.handlers.set(method, []);
    this.handlers.get(method).push(fn);
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
    if (r.exceptionDetails) {
      throw new Error(
        r.exceptionDetails.exception?.description || JSON.stringify(r.exceptionDetails),
      );
    }
    return r.result?.value;
  }

  async waitFor(expression, timeout = 5000, label = expression) {
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      try {
        if (await this.eval(`!!(${expression})`)) return true;
      } catch {
        /* page may be mid-navigation */
      }
      await sleep(80);
    }
    throw new Error(`timeout waiting for ${label}`);
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

  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' });
    const file = path.join(ARTIFACTS, `${name}.png`);
    await writeFile(file, Buffer.from(r.data, 'base64'));
    return file;
  }

  async viewport(width, height, dpr = 2) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: dpr,
      mobile: true,
    });
  }

  async reload() {
    await this.send('Page.reload', { ignoreCache: true });
    await sleep(900);
  }
}

const profile = await mkdtemp(path.join(tmpdir(), 'arrowclear-e2e-'));
const debugPort = 9500 + Math.floor(Math.random() * 300);
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { stdio: 'ignore' },
);

let wsUrl = null;
for (let i = 0; i < 80; i++) {
  await sleep(200);
  try {
    const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
    if (r.ok) break;
  } catch {
    /* retry */
  }
}
const target = await fetch(
  `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent('about:blank')}`,
  { method: 'PUT' },
).then((r) => r.json());
wsUrl = target.webSocketDebuggerUrl;

const cdp = new CDP(wsUrl);
await cdp.connect();

const consoleErrors = [];
const pageErrors = [];
cdp.on('Runtime.consoleAPICalled', (p) => {
  if (p.type === 'error') {
    const text = (p.args || []).map((a) => a.value ?? a.description ?? '').join(' ');
    consoleErrors.push(text);
  }
});
cdp.on('Runtime.exceptionThrown', (p) => {
  pageErrors.push(p.exceptionDetails?.exception?.description ?? JSON.stringify(p.exceptionDetails));
});
cdp.on('Log.entryAdded', (p) => {
  if (p.entry?.level === 'error') consoleErrors.push(p.entry.text);
});

await cdp.send('Page.enable');
await cdp.send('Runtime.enable');
await cdp.send('Log.enable');
await cdp.viewport(430, 932, 3);
await cdp.send('Page.navigate', { url: BASE });
await sleep(1200);

const state = () => cdp.eval('window.__arrowGame ? window.__arrowGame.debugState() : null');
const freePos = () =>
  cdp.eval(`(() => {
    const p = window.__arrowGame.debugFreeArrowScreenPos();
    return p ? { x: p.x, y: p.y } : null;
  })()`);
const blockedPos = () =>
  cdp.eval(`(() => {
    const g = window.__arrowGame;
    const a = g.level.arrows.find((x) => g.alive.has(x.id) && !g.renderer.isFree(x, g.alive));
    if (!a) return null;
    const p = g.renderer.cellCenter(a.cells[0]);
    return { x: p.x, y: p.y };
  })()`);

console.log('\n[E2E] boot & layout');
await step('home renders with logo, mascot and play button', async () => {
  await cdp.waitFor("document.querySelector('#btn-play')");
  const nav = await cdp.eval(`(() => {
    const n = performance.getEntriesByType('navigation')[0] || {};
    const paints = performance.getEntriesByType('paint') || [];
    const fcp = paints.find((p) => p.name === 'first-contentful-paint');
    return {
      dcl: Math.round(n.domContentLoadedEventEnd || 0),
      load: Math.round(n.loadEventEnd || 0),
      fcp: Math.round(fcp ? fcp.startTime : 0),
    };
  })()`);
  const info = await cdp.eval(`({
    title: document.title,
    logo: !!document.querySelector('#logo svg'),
    mascot: !!document.querySelector('#mascot svg'),
    playVisible: document.querySelector('#btn-play').getBoundingClientRect().height > 40,
    coins: document.querySelector('#home-coins').textContent,
  })`);
  assert(info.logo, 'logo svg missing');
  assert(info.mascot, 'mascot svg missing');
  assert(info.playVisible, 'play button not visible');
  assert(info.title.includes('一箭清空'), 'title missing');
  assert(info.coins === '120', `initial coins should be 120, got ${info.coins}`);
  assert(nav.fcp > 0 && nav.fcp < 1500, `first paint ${nav.fcp}ms > 1500ms`);
  assert(nav.dcl < 1500, `DOMContentLoaded ${nav.dcl}ms > 1500ms`);
  return `coins=${info.coins}, FCP=${nav.fcp}ms, DCL=${nav.dcl}ms`;
});

await step('no horizontal overflow at 430×932', async () => {
  const m = await cdp.eval(
    '({sw: document.documentElement.scrollWidth, iw: innerWidth, cw: document.querySelector("#board").clientWidth})',
  );
  assert(m.sw <= m.iw + 1, `scrollWidth ${m.sw} > innerWidth ${m.iw}`);
  eq(m.cw, m.iw, 'canvas width');
  return `scrollWidth=${m.sw}`;
});

console.log('\n[E2E] level start');
await step('start level 1', async () => {
  await cdp.eval("document.querySelector('#btn-play').click()");
  await cdp.waitFor("window.__arrowGame && window.__arrowGame.debugState().running", 4000);
  // first-run tutorial
  await sleep(500);
  await cdp.eval("(() => { const b = document.querySelector('#howto-ok'); if (b) b.click(); })()");
  await sleep(250);
  const s = await state();
  eq(s.level, 1, 'level id');
  eq(s.hearts, 3, 'hearts');
  assert(s.total >= 10, `expected >=10 arrows, got ${s.total}`);
  eq(s.alive, s.total, 'alive at start');
  return `arrows=${s.total}, free=${s.free}`;
});

await step('board and toolbar are inside the viewport', async () => {
  const m = await cdp.eval(`(() => {
    const c = document.querySelector('#board').getBoundingClientRect();
    const t = document.querySelector('#toolbar').getBoundingClientRect();
    const h = document.querySelector('#hud').getBoundingClientRect();
    return { cw: c.width, ch: c.height, tw: t.width, hb: h.bottom, tt: t.top, ih: innerHeight };
  })()`);
  eq(Math.round(m.cw), 430, 'canvas css width');
  assert(m.tt > m.hb, 'toolbar overlaps hud');
  return `canvas=${m.cw}×${Math.round(m.ch)}`;
});

console.log('\n[E2E] interaction');
await step('tap a free arrow removes it', async () => {
  const before = await state();
  const pos = await freePos();
  assert(pos, 'no free arrow found');
  await cdp.tap(pos.x, pos.y);
  await sleep(200);
  const after = await state();
  eq(after.alive, before.alive - 1, 'alive count after clear');
  const w = await cdp.eval("parseFloat(document.querySelector('#hud-progress').style.width)");
  assert(w > 0, 'progress bar did not move');
  return `alive ${before.alive}→${after.alive}, progress=${w.toFixed(1)}%`;
});

await step('tap a blocked arrow costs a heart', async () => {
  const before = await state();
  const pos = await blockedPos();
  assert(pos, 'no blocked arrow found');
  await cdp.tap(pos.x, pos.y);
  await sleep(250);
  const after = await state();
  eq(after.hearts, before.hearts - 1, 'hearts after blocked tap');
  const toast = await cdp.eval(
    "({show: document.querySelector('#toast').classList.contains('show'), text: document.querySelector('#toast').textContent})",
  );
  assert(toast.show, 'toast not shown');
  assert(toast.text.includes('挡'), `toast text: ${toast.text}`);
  return `hearts ${before.hearts}→${after.hearts}, "${toast.text}"`;
});

await step('hint costs 30 coins and highlights an arrow', async () => {
  const before = await cdp.eval('window.__arrowGame.save.coins');
  await cdp.eval("document.querySelector('#btn-hint').click()");
  await sleep(250);
  const after = await cdp.eval('window.__arrowGame.save.coins');
  eq(after, before - 30, 'coins after hint');
  const hint = await cdp.eval('window.__arrowGame.hintId');
  assert(hint !== null && hint !== undefined, 'hint not set');
  return `coins ${before}→${after}, hintId=${hint}`;
});

await step('pause and resume', async () => {
  await cdp.eval("document.querySelector('#btn-pause').click()");
  await sleep(300);
  const open = await cdp.eval("document.querySelector('#overlay').textContent.includes('暂停')");
  assert(open, 'pause modal missing');
  await cdp.eval("document.querySelector('#pause-resume').click()");
  await sleep(250);
  const paused = await cdp.eval('window.__arrowGame.paused');
  eq(paused, false, 'paused after resume');
  return 'pause → resume ok';
});

await step('restart resets progress and hearts', async () => {
  await cdp.eval("document.querySelector('#btn-restart').click()");
  await sleep(250);
  await cdp.eval("document.querySelector('#restart-yes').click()");
  await sleep(400);
  const s = await state();
  eq(s.alive, s.total, 'alive after restart');
  eq(s.hearts, 3, 'hearts after restart');
  return `alive=${s.alive}/${s.total}`;
});

console.log('\n[E2E] win flow');
await step('clear the board and reach the win modal', async () => {
  for (let i = 0; i < 40; i++) {
    const s = await state();
    if (!s.running) break;
    const pos = await freePos();
    if (!pos) throw new Error('no free arrow while clearing');
    await cdp.tap(pos.x, pos.y);
    await sleep(200);
  }
  const s = await state();
  eq(s.alive, 0, 'all arrows cleared');
  await sleep(700);
  const modal = await cdp.eval("document.querySelector('#overlay').textContent");
  assert(modal.includes('通关啦'), `win modal missing: ${modal.slice(0, 60)}`);
  await cdp.waitFor("document.querySelectorAll('#win-stars svg.on').length === 3", 2500, '3 stars');
  const stars = await cdp.eval("document.querySelectorAll('#win-stars svg.on').length");
  eq(stars, 3, 'three stars for a clean run');
  const save = await cdp.eval("JSON.parse(localStorage.getItem('arrowclear.save.v2'))");
  eq(save.unlocked, 2, 'unlocked after win');
  await cdp.shot('e2e-win');
  return `stars=${stars}, coins=${save.coins}, unlocked=${save.unlocked}`;
});

await step('next level loads', async () => {
  await cdp.eval("document.querySelector('#win-next').click()");
  await sleep(500);
  const s = await state();
  eq(s.level, 2, 'level after next');
  eq(s.running, true, 'running after next');
  return `level ${s.level}, arrows=${s.total}`;
});

console.log('\n[E2E] lose flow');
await step('three blocked taps end the run', async () => {
  for (let i = 0; i < 3; i++) {
    const pos = await blockedPos();
    assert(pos, 'no blocked arrow');
    await cdp.tap(pos.x, pos.y);
    await sleep(280);
  }
  const s = await state();
  eq(s.hearts, 0, 'hearts exhausted');
  eq(s.running, false, 'run stopped');
  await sleep(900);
  const modal = await cdp.eval("document.querySelector('#overlay').textContent");
  assert(modal.includes('爱心用尽'), `lose modal missing: ${modal.slice(0, 60)}`);
  await cdp.shot('e2e-lose');
  return 'lose modal shown';
});

await step('retry restores hearts', async () => {
  await cdp.eval("document.querySelector('#lose-retry').click()");
  await sleep(500);
  const s = await state();
  eq(s.hearts, 3, 'hearts after retry');
  eq(s.level, 2, 'same level after retry');
  return `level ${s.level}`;
});

console.log('\n[E2E] persistence & navigation');
await step('progress survives a reload', async () => {
  await cdp.eval("document.querySelector('#btn-pause').click()");
  await sleep(200);
  await cdp.eval("document.querySelector('#pause-home').click()");
  await sleep(300);
  await cdp.reload();
  await cdp.waitFor("document.querySelector('#btn-play')");
  const chip = await cdp.eval("document.querySelector('#home-level-chip').textContent");
  assert(chip.includes('2'), `home chip should show level 2, got ${chip}`);
  return chip;
});

await step('level select shows 60 tiles with locks', async () => {
  await cdp.eval("document.querySelector('#btn-nav-levels').click()");
  await sleep(350);
  const m = await cdp.eval(`({
    tiles: document.querySelectorAll('.lv').length,
    locked: document.querySelectorAll('.lv.locked').length,
    starred: document.querySelectorAll('.lv .stars svg.on').length,
  })`);
  eq(m.tiles, 60, 'tile count');
  eq(m.locked, 58, 'locked tile count');
  eq(m.starred, 3, 'earned stars shown');
  const shot = await cdp.shot('e2e-levels');
  void shot;
  return `tiles=${m.tiles}, locked=${m.locked}, stars=${m.starred}`;
});

await step('selecting a level starts it', async () => {
  await cdp.eval("document.querySelectorAll('.lv')[1].click()");
  await sleep(500);
  const s = await state();
  eq(s.level, 2, 'level from grid');
  return `level ${s.level}`;
});

console.log('\n[E2E] responsive layout');
for (const [w, h] of [
  [320, 568],
  [375, 667],
  [390, 844],
  [430, 932],
  [540, 960],
]) {
  await step(`layout fits ${w}×${h}`, async () => {
    await cdp.viewport(w, h, 2);
    await cdp.reload();
    await cdp.waitFor("document.querySelector('#btn-play')");
    const m = await cdp.eval(`(() => {
      const app = document.querySelector('#app').getBoundingClientRect();
      const play = document.querySelector('#btn-play').getBoundingClientRect();
      const nav = document.querySelector('.home-nav').getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, aw: app.width,
               playR: play.right, navR: nav.right, navB: nav.bottom, ih: innerHeight };
    })()`);
    assert(m.sw <= m.iw + 1, `scrollWidth ${m.sw} > ${m.iw}`);
    assert(m.playR <= w + 1, `play button overflows (${m.playR})`);
    assert(m.navB <= h + 1, `nav overflows vertically (${m.navB})`);
    await cdp.eval("document.querySelector('#btn-play').click()");
    await sleep(500);
    await cdp.eval("(() => { const b = document.querySelector('#howto-ok'); if (b) b.click(); })()");
    await sleep(300);
    const b = await cdp.eval(`(() => {
      const c = document.querySelector('#board').getBoundingClientRect();
      return { w: c.width, h: c.height };
    })()`);
    assert(b.w > 0 && b.h > 0, 'board has no size');
    assert(b.h <= h, 'board taller than screen');
    return `board=${Math.round(b.w)}×${Math.round(b.h)}`;
  });
}

console.log('\n[E2E] performance');
await step('60fps while playing', async () => {
  await cdp.viewport(430, 932, 3);
  await cdp.reload();
  await cdp.waitFor("document.querySelector('#btn-play')");
  await cdp.eval("document.querySelector('#btn-play').click()");
  await sleep(600);
  await cdp.eval("(() => { const b = document.querySelector('#howto-ok'); if (b) b.click(); })()");
  const fps = await cdp.eval(`new Promise((resolve) => {
    let frames = 0;
    const t0 = performance.now();
    function tick() {
      frames++;
      const dt = performance.now() - t0;
      if (dt < 2500) requestAnimationFrame(tick);
      else resolve(Math.round((frames / dt) * 1000));
    }
    requestAnimationFrame(tick);
  })`);
  assert(fps >= 45, `fps too low: ${fps}`);
  return `${fps} fps`;
});

await step('tap latency under 120ms', async () => {
  const pos = await freePos();
  assert(pos, 'no free arrow');
  const aliveBefore = (await state()).alive;
  const t0 = Date.now();
  await cdp.tap(pos.x, pos.y);
  let aliveAfter = aliveBefore;
  for (let i = 0; i < 20; i++) {
    aliveAfter = (await state()).alive;
    if (aliveAfter < aliveBefore) break;
    await sleep(10);
  }
  const ms = Date.now() - t0;
  assert(aliveAfter < aliveBefore, 'tap had no effect');
  assert(ms < 120, `latency ${ms}ms`);
  return `${ms}ms`;
});

console.log('\n[E2E] level sweep in the real UI');
await step('5 representative levels can be cleared end-to-end', async () => {
  const swept = [];
  for (const id of [1, 15, 30, 45, 60]) {
    await cdp.eval(`window.__arrowGame.startLevel(${id})`);
    await sleep(350);
    let taps = 0;
    for (let i = 0; i < 60; i++) {
      const s = await state();
      if (!s.running) break;
      const pos = await freePos();
      if (!pos) throw new Error(`L${id}: no free arrow while clearing`);
      await cdp.tap(pos.x, pos.y);
      taps++;
      await sleep(120);
    }
    const s = await state();
    eq(s.alive, 0, `L${id} cleared`);
    swept.push(`L${id}:${taps}`);
  }
  await cdp.eval('window.__arrowGame.showHome()');
  await sleep(300);
  return swept.join(', ');
});

console.log('\n[E2E] console health');
await step('no uncaught errors / console errors', async () => {
  assert(pageErrors.length === 0, `uncaught: ${pageErrors.slice(0, 2).join(' | ')}`);
  assert(consoleErrors.length === 0, `console: ${consoleErrors.slice(0, 2).join(' | ')}`);
  return 'clean';
});

await cdp.shot('e2e-final');

// ---------------------------------------------------------------- teardown

const summary = {
  when: new Date().toISOString(),
  chrome: '157.0.8103.51',
  viewport: '430x932 @3x',
  passed: results.filter((r) => r.ok).length,
  failed,
  results,
  consoleErrors,
  pageErrors,
};

await mkdir(ARTIFACTS, { recursive: true });
await writeFile(path.join(ARTIFACTS, 'e2e-results.json'), JSON.stringify(summary, null, 2));

console.log(`\n${summary.passed} passed, ${summary.failed} failed`);
console.log(`artifacts: ${ARTIFACTS}`);

try {
  chrome.kill('SIGKILL');
} catch {
  /* ignore */
}
server.close();
process.exit(failed ? 1 : 0);