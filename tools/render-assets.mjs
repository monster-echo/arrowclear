#!/usr/bin/env node
/** Rasterises the SVG art board into PNGs for the Cocos resources folder. */
import * as esbuild from 'esbuild';
import { writeFile, mkdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9334;
const OUT = 'assets/resources/art';

async function chrome() {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
    if (r.ok) return;
  } catch {}
  spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--mute-audio',
    `--remote-debugging-port=${PORT}`, '--user-data-dir=/tmp/arrowclear-assets',
    '--no-first-run', '--no-default-browser-check', 'about:blank',
  ], { detached: true, stdio: 'ignore' }).unref();
  for (let i = 0; i < 60; i++) {
    await sleep(250);
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (r.ok) return;
    } catch {}
  }
  throw new Error('chrome failed');
}

class CDP {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  connect() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => res();
      this.ws.onerror = rej;
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id && this.pending.has(m.id)) {
          const { resolve, reject } = this.pending.get(m.id);
          this.pending.delete(m.id);
          m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
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
    const r = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  }
}

// Build the art board bundle first so the page is self-contained.
await esbuild.build({
  entryPoints: ['web/src/assetlab.ts'],
  bundle: true,
  format: 'esm',
  outfile: 'web/assetlab.js',
  logLevel: 'warning',
});

await chrome();
const tab = await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent('http://localhost:4173/asset-lab.html')}`, { method: 'PUT' }).then((r) => r.json());
const c = new CDP(tab.webSocketDebuggerUrl);
await c.connect();
await c.send('Page.enable');
await c.send('Runtime.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await c.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
await c.send('Page.navigate', { url: 'http://localhost:4173/asset-lab.html' });
await sleep(1200);
await c.eval('document.fonts.ready.then(() => true)');
await sleep(300);

const rects = await c.eval(`JSON.stringify(Array.from(document.querySelectorAll('[data-asset]')).map(el => ({ name: el.dataset.asset, r: el.getBoundingClientRect().toJSON() })))`);
const list = JSON.parse(rects);
await mkdir(`${OUT}/icons`, { recursive: true });

for (const { name, r } of list) {
  const out = name.startsWith('icon-') ? `${OUT}/icons/${name.slice(5)}.png` : `${OUT}/${name}.png`;
  const shot = await c.send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 },
    captureBeyondViewport: true,
  });
  await writeFile(out, Buffer.from(shot.data, 'base64'));
  console.log('wrote', out, `${Math.round(r.width)}x${Math.round(r.height)}`);
}
console.log('done', list.length, 'assets');
process.exit(0);
