#!/usr/bin/env node
/**
 * Web build for the playable preview.
 *
 *   node web/build.mjs           -> dist/web (static folder)
 *   node web/build.mjs --serve   -> http://localhost:4173 with rebuild on save
 */
import * as esbuild from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const web = path.join(root, 'web');
const dist = path.join(root, 'dist', 'web');
const serve = process.argv.includes('--serve');

const common = {
  entryPoints: [path.join(web, 'src', 'main.ts')],
  bundle: true,
  format: 'esm',
  target: ['es2020', 'safari14'],
  logLevel: 'info',
  loader: { '.ttf': 'file' },
};

async function buildStatic() {
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });

  await esbuild.build({
    ...common,
    minify: true,
    sourcemap: false,
    outfile: path.join(dist, 'main.js'),
  });

  const html = await readFile(path.join(web, 'index.html'), 'utf8');
  await writeFile(
    path.join(dist, 'index.html'),
    html.replace('./main.js', './main.js'),
  );

  await cp(path.join(web, 'style.css'), path.join(dist, 'style.css'));
  await cp(path.join(web, 'bg-arrows.svg'), path.join(dist, 'bg-arrows.svg'));
  if (existsSync(path.join(web, 'fonts'))) {
    await cp(path.join(web, 'fonts'), path.join(dist, 'fonts'), { recursive: true });
  }
  if (existsSync(path.join(web, 'favicon.svg'))) {
    await cp(path.join(web, 'favicon.svg'), path.join(dist, 'favicon.svg'));
  }
  console.log(`\n✔ built ${path.relative(root, dist)}`);
}

if (serve) {
  const ctx = await esbuild.context({
    ...common,
    sourcemap: true,
    outfile: path.join(web, 'main.js'),
  });
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: web, port: 4173 });
  console.log(`\n▶ preview: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}\n`);
} else {
  await buildStatic();
}