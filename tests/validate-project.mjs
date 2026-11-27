#!/usr/bin/env node
/**
 * Static validation of the Cocos Creator project.
 *
 * The editor is not available in this environment, so this suite checks every
 * thing that can be checked without it: scene graph integrity, script/meta UUID
 * linkage, resource paths used by Assets.ts, binary asset headers and the
 * engine-agnostic purity of the core.
 *
 * Run: npm run test:project
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const results = [];
let failed = 0;

function check(cond, name, detail = '') {
  results.push({ name, ok: !!cond, detail });
  if (cond) {
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const readJson = async (p) => JSON.parse(await readFile(path.join(ROOT, p), 'utf8'));
const exists = async (p) => {
  try {
    await stat(path.join(ROOT, p));
    return true;
  } catch {
    return false;
  }
};

// ---------------------------------------------------------------- project files

console.log('\n[project] manifest');
const project = await readJson('project.json');
const pkg = await readJson('package.json');
check(project.engine === '3.8.6', 'project.json targets Cocos 3.8.6', project.engine);
check(pkg.creator?.version === '3.8.6', 'package.json creator version', pkg.creator?.version);

// ---------------------------------------------------------------- scene graph

console.log('\n[scene] structure');
const scene = await readJson('assets/scenes/main.scene');
check(Array.isArray(scene) && scene.length > 0, 'scene is a non-empty JSON array', `${scene.length} objects`);

let dangling = 0;
const walk = (v) => {
  if (Array.isArray(v)) v.forEach(walk);
  else if (v && typeof v === 'object') {
    if (typeof v.__id__ === 'number') {
      if (v.__id__ < 0 || v.__id__ >= scene.length) dangling++;
    }
    Object.values(v).forEach(walk);
  }
};
walk(scene);
check(dangling === 0, 'all object references resolve', `${dangling} dangling`);

const byType = (t) => scene.map((o, i) => ({ o, i })).filter((x) => x.o.__type__ === t);
const assets = byType('cc.SceneAsset');
const scenes = byType('cc.Scene');
check(assets.length === 1, 'exactly one SceneAsset', String(assets.length));
check(scenes.length === 1, 'exactly one Scene', String(scenes.length));

const rootScene = scenes[0]?.o;
const sceneChildren = rootScene?._children?.map((r) => scene[r.__id__]) ?? [];
check(sceneChildren.length === 1, 'scene has one root node', String(sceneChildren.length));
const canvas = sceneChildren[0];
check(canvas?._name === 'Canvas', 'root node is Canvas', canvas?._name);

const canvasChildren = canvas?._children?.map((r) => scene[r.__id__]) ?? [];
const names = canvasChildren.map((n) => n._name);
check(names.includes('Camera'), 'Canvas has a Camera child', names.join(','));
check(names.includes('GameRoot'), 'Canvas has a GameRoot child', names.join(','));

const canvasComps = canvas?._components?.map((r) => scene[r.__id__]) ?? [];
const canvasComp = canvasComps.find((c) => c.__type__ === 'cc.Canvas');
const canvasUIT = canvasComps.find((c) => c.__type__ === 'cc.UITransform');
check(!!canvasUIT, 'Canvas has cc.UITransform');
check(!!canvasComp, 'Canvas has cc.Canvas');
check(canvasUIT?._contentSize?.width === 720 && canvasUIT?._contentSize?.height === 1280, 'Canvas design size 720×1280');

const cameraNode = canvasChildren.find((n) => n._name === 'Camera');
const cameraComp = cameraNode?._components?.map((r) => scene[r.__id__]).find((c) => c.__type__ === 'cc.Camera');
check(!!cameraComp, 'Camera node has cc.Camera');
check(canvasComp?._cameraComponent?.__id__ === scene.indexOf(cameraComp), 'Canvas references the camera', String(canvasComp?._cameraComponent?.__id__));
check(cameraComp?._projection === 0, 'camera is orthographic');
check(((cameraComp?._visibility ?? 0) & (1 << 25)) !== 0, 'camera renders UI_2D layer');
check(canvas?._layer === 1 << 25, 'Canvas node is on UI_2D layer', String(canvas?._layer));

const gameRootNode = canvasChildren.find((n) => n._name === 'GameRoot');
const gameRootComps = gameRootNode?._components?.map((r) => scene[r.__id__]) ?? [];
check(gameRootNode?._layer === 1 << 25, 'GameRoot node is on UI_2D layer');

const BASE64_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function compressUuid(uuid) {
  const hex = uuid.replace(/-/g, '');
  let out = hex.slice(0, 5);
  for (let i = 5; i < 32; i += 3) {
    const a = parseInt(hex[i], 16);
    const b = parseInt(hex[i + 1], 16);
    const c = parseInt(hex[i + 2], 16);
    out += BASE64_KEYS[(a << 2) | (b >> 2)];
    out += BASE64_KEYS[((b & 3) << 4) | c];
  }
  return out;
}

const scriptMeta = await readJson('assets/scripts/cocos/GameRoot.ts.meta');
const scriptCompressedUuid = compressUuid(scriptMeta.uuid);
const scriptComp = gameRootComps.find((c) => c.__type__ === scriptCompressedUuid);
check(!!scriptComp, 'GameRoot component uses the compressed script UUID from its .meta', scriptCompressedUuid);
check(scriptComp?.node?.__id__ === scene.indexOf(gameRootNode), 'GameRoot component points at the GameRoot node');
check(scene.filter((o) => o.__type__ === scriptCompressedUuid).length === 1, 'exactly one GameRoot component in the scene');

const sceneMeta = await readJson('assets/scenes/main.scene.meta');
check(sceneMeta.importer === 'scene', 'scene .meta importer is scene');
check(/^[0-9a-f-]{36}$/.test(sceneMeta.uuid), 'scene meta uuid format', sceneMeta.uuid);

// ---------------------------------------------------------------- UUID uniqueness

console.log('\n[meta] uuids');
async function findMetas(dir) {
  const out = [];
  for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await findMetas(rel)));
    else if (entry.name.endsWith('.meta')) out.push(rel);
  }
  return out;
}
const metas = await findMetas('assets');
const uuids = new Map();
let badMeta = 0;
for (const m of metas) {
  try {
    const data = JSON.parse(await readFile(path.join(ROOT, m), 'utf8'));
    if (!data.uuid) continue;
    if (uuids.has(data.uuid)) badMeta++;
    uuids.set(data.uuid, m);
  } catch {
    badMeta++;
  }
}
check(badMeta === 0, 'all .meta files are valid and uuids unique', `${metas.length} metas`);

// ---------------------------------------------------------------- resources

console.log('\n[resources] files referenced by Assets.ts');
const assetsSrc = await readFile(path.join(ROOT, 'assets/scripts/cocos/Assets.ts'), 'utf8');
const listOf = (name) => {
  const m = assetsSrc.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  if (!m) return [];
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
};
const icons = listOf('icons');
const art = listOf('art');
const audio = listOf('audio');
const fontMatch = assetsSrc.match(/loadFont\('([^']+)'\)/);
const fontPath = fontMatch ? fontMatch[1] : '';

check(icons.length >= 18, 'icon list parsed', `${icons.length} icons`);
check(art.length >= 3, 'art list parsed', art.join(','));
check(audio.length >= 6, 'audio list parsed', audio.join(','));
check(!!fontPath, 'font path parsed', fontPath);

let missing = 0;
for (const n of icons) {
  if (!(await exists(`assets/resources/art/icons/${n}.png`))) {
    missing++;
    console.log(`    missing icon ${n}.png`);
  }
}
for (const n of art) {
  if (!(await exists(`assets/resources/art/${n}.png`))) {
    missing++;
    console.log(`    missing art ${n}.png`);
  }
}
for (const n of audio) {
  if (!(await exists(`assets/resources/audio/${n}.mp3`))) {
    missing++;
    console.log(`    missing audio ${n}.mp3`);
  }
}
if (!(await exists(`assets/resources/${fontPath}.ttf`))) missing++;
check(missing === 0, 'every resource referenced by code exists', `${missing} missing`);

// lowercase resource paths (case sensitivity on native / WeChat)
const badCase = [...icons.map((n) => `art/icons/${n}.png`), ...art.map((n) => `art/${n}.png`), ...audio.map((n) => `audio/${n}.mp3`)].filter(
  (p) => p !== p.toLowerCase(),
);
check(badCase.length === 0, 'resource paths are lowercase', badCase.join(','));

// ---------------------------------------------------------------- asset formats

console.log('\n[assets] binary headers');
async function pngSize(rel) {
  const buf = await readFile(path.join(ROOT, rel));
  const magic = buf.subarray(0, 8).toString('hex');
  if (magic !== '89504e470d0a1a0a') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const icon = await pngSize('assets/resources/art/icons/coin.png');
check(icon?.w === 128 && icon?.h === 128, 'icons are 128×128', icon ? `${icon.w}×${icon.h}` : 'invalid');
let tinyIcons = [];
for (const n of icons) {
  const st = await stat(path.join(ROOT, `assets/resources/art/icons/${n}.png`));
  if (st.size < 500) tinyIcons.push(`${n}(${st.size}B)`);
}
check(tinyIcons.length === 0, 'all icons are non-empty graphics', tinyIcons.join(','));
const logo = await pngSize('assets/resources/art/logo.png');
check(logo && logo.w >= 900, 'logo is high-res', logo ? `${logo.w}×${logo.h}` : 'invalid');
const mascot = await pngSize('assets/resources/art/mascot.png');
check(mascot && mascot.w >= 560, 'mascot is high-res', mascot ? `${mascot.w}×${mascot.h}` : 'invalid');
const bg = await pngSize('assets/resources/art/bg.png');
check(bg?.w === 720, 'background is 720 wide', bg ? `${bg.w}×${bg.h}` : 'invalid');
const appIcon = await pngSize('assets/art/app-icon-1024.png');
check(appIcon?.w === 1024 && appIcon?.h === 1024, 'store icon is 1024×1024', appIcon ? `${appIcon.w}×${appIcon.h}` : 'invalid');

const mp3 = await readFile(path.join(ROOT, 'assets/resources/audio/pop.mp3'));
const mp3Magic = mp3.subarray(0, 3).toString('latin1');
check(mp3Magic === 'ID3' || (mp3[0] === 0xff && (mp3[1] & 0xe0) === 0xe0), 'audio is real mp3', mp3Magic);

const ttf = await readFile(path.join(ROOT, `assets/resources/${fontPath}.ttf`));
const sfnt = ttf.readUInt32BE(0);
check(sfnt === 0x00010000 || sfnt === 0x74727565, 'font has a valid TTF header');
check(ttf.length > 20000 && ttf.length < 300000, 'font is subset (20–300KB)', `${Math.round(ttf.length / 1024)}KB`);

// ---------------------------------------------------------------- core purity

console.log('\n[core] engine independence');
const coreFiles = await readdir(path.join(ROOT, 'assets/scripts/core'));
let ccImports = 0;
for (const f of coreFiles.filter((f) => f.endsWith('.ts'))) {
  const src = await readFile(path.join(ROOT, 'assets/scripts/core', f), 'utf8');
  if (/from\s+['"]cc['"]/.test(src)) ccImports++;
}
check(ccImports === 0, 'core has no Cocos imports', `${coreFiles.length} files`);
check(coreFiles.some((f) => f === 'levelgen.ts'), 'level generator present');

console.log(`\n${results.filter((r) => r.ok).length} checks passed, ${failed} failed`);
process.exit(failed ? 1 : 0);