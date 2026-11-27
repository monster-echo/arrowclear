#!/usr/bin/env node
/**
 * 商店海报生成器:真实游戏截图 + 标题排版 → 双店三规格海报。
 *
 * 版式:眉标 pill + ZCOOL KuaiLe 大标题(关键词马克笔高亮)+ 副标 + 圆角卡片截图 + 品牌/卖点页脚。
 * 画面全部来自真实截图(store/posters/_src/),排版只是营销文案,符合双店"截图须真实反映应用"政策。
 *
 * 用法:  node tools/make_store_posters.mjs [--out store/posters]
 * 依赖:  本地 web 预览截出的 4 张源图(见 SRC),tools/cdp.mjs + Chrome。
 * 重拍源图:
 *   npm run web &
 *   CLEAN=1 CW=540 CH=960 DPR=2 node tools/cdp.mjs shot  http://127.0.0.1:4173 store/posters/_src/capture-home.png
 *   CLEAN=1 CW=540 CH=960 DPR=2 node tools/cdp.mjs game  http://127.0.0.1:4173 store/posters/_src/capture-game.png
 *   CLEAN=1 CW=540 CH=960 DPR=2 node tools/cdp.mjs play  http://127.0.0.1:4173 .tmp/win-frames/f 110   # 末帧=揭画,再补延迟帧=结算弹窗
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'store/posters/_src');
const OUT = (() => {
	const i = process.argv.indexOf('--out');
	return i > 0 ? resolve(ROOT, process.argv[i + 1]) : join(ROOT, 'store/posters');
})();

const FONT = readFileSync(join(ROOT, 'assets/art/fonts/ZCOOLKuaiLe-full.ttf')).toString('base64');
const SHOTS = {
	home: readFileSync(join(SRC, 'capture-home.png')).toString('base64'),
	game: readFileSync(join(SRC, 'capture-game.png')).toString('base64'),
	win: readFileSync(join(SRC, 'capture-win.png')).toString('base64'),
	reveal: readFileSync(join(SRC, 'capture-reveal.png')).toString('base64'),
};

// ---------- 文案与配色 ----------
const THEMES = {
	blue: { c: '#2F80ED', soft: '#B9DBFF' },
	orange: { c: '#F5871F', soft: '#FFD9A8' },
	gold: { c: '#E8A200', soft: '#FFE39A' },
	green: { c: '#2FB56B', soft: '#B9EBCD' },
};

const VARIANTS = {
	zh: [
		{ id: 'hero', shot: 'home', theme: 'blue', kicker: '解压解谜',
			hl: [['点一下,', false], ['箭就飞出去', true]], sub: '解压上头的箭阵解谜,随便点都不会死局' },
		{ id: 'game', shot: 'game', theme: 'orange', kicker: '500 个手工关卡',
			hl: [['层层拆解,', false], ['清空棋盘', true]], sub: '撞墙越少,星星越多' },
		{ id: 'win', shot: 'win', zoom: true, theme: 'gold', kicker: '三星通关',
			hl: [['零撞墙,', false], ['完美通关!', true]], sub: '一颗心都不掉的爽快,谁玩谁知道' },
		{ id: 'reveal', shot: 'reveal', theme: 'green', kicker: '隐藏彩蛋',
			hl: [['通关还能', false], ['揭出一幅画', true]], sub: '每一关的棋盘底下,都藏着一张剪影画' },
	],
	en: [
		{ id: 'hero', shot: 'home', theme: 'blue', kicker: 'ONE-TAP PUZZLE',
			hl: [['Tap. ', false], ['Watch it fly.', true]], sub: 'A satisfying one-tap arrow maze puzzle' },
		{ id: 'game', shot: 'game', theme: 'orange', kicker: '500 HANDCRAFTED LEVELS',
			hl: [['Untangle the ', false], ['board', true]], sub: 'Free blocked arrows first, peel it layer by layer' },
		{ id: 'reveal', shot: 'reveal', theme: 'green', kicker: 'HIDDEN PICTURE',
			hl: [['Clear it to ', false], ['reveal art', true]], sub: 'A little picture hides under every board' },
	],
};

const PILLS = {
	zh: ['500 关', '无内购', '离线可玩'],
	en: ['500 LEVELS', 'NO IAP', 'PLAY OFFLINE'],
};
const BRAND = { zh: '一箭清空 · ARROW CLEAR', en: 'ARROW CLEAR' };
const HL_SIZE = { zh: '8.2vw', en: '7.2vw' };

// 中文文案标点规范化:半角 → 全角(避免混排)
const zhPunct = (s) => s.replace(/,/g, '\uFF0C').replace(/!/g, '\uFF01');

// ---------- 模板 ----------
const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="168" height="168" viewBox="0 0 168 168">
<g fill="#9db8d8" stroke="none" opacity="0.5">
<path d="M40 92 V56 H31 L48 30 L65 56 H56 V92 Z"/>
<path d="M124 76 V112 H115 L132 138 L149 112 H140 V76 Z"/>
</g></svg>`;

function html(variant, locale) {
	const th = THEMES[variant.theme];
	const P = locale === 'zh' ? zhPunct : (s) => s;
	const hlHtml = variant.hl.map(([t, mark]) =>
		mark ? `<span class="hl" style="--mark:${th.soft}">${P(t)}</span>` : P(t)
	).join('');
	const pills = PILLS[locale].map(p => `<span class="pill">${P(p)}</span>`).join('');
	const zoom = variant.zoom ? ' zoom' : '';
	return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:ZK;src:url(data:font/ttf;base64,${FONT}) format('truetype');}
*{box-sizing:border-box;margin:0}
html,body{width:100vw;height:100vh;overflow:hidden}
body{
	font-family:ZK,'PingFang SC',sans-serif;color:#1C2B4B;
	background:
		radial-gradient(52vw 52vw at 88% 3%, ${th.soft}66 0%, transparent 62%),
		radial-gradient(48vw 48vw at 4% 96%, ${th.soft}88 0%, transparent 60%),
		url('data:image/svg+xml;base64,${Buffer.from(bgSvg).toString('base64')}') repeat,
		#F5F7FC;
	background-size:auto,auto,10vw 10vw,auto;
	display:grid;grid-template-rows:auto auto auto 1fr auto;align-items:center;justify-items:center;
	padding:6vw 6vw 5vw;gap:0;
}
.kicker{
	margin-top:1vw;font-size:3vw;letter-spacing:.32em;text-indent:.32em;
	color:${th.c};background:#FFFFFFD9;border:.28vw solid ${th.c}44;
	padding:1.2vw 3.2vw;border-radius:99px;
	box-shadow:0 .8vw 2.4vw rgba(28,43,75,.07);
}
h1{
	margin-top:2.8vw;font-size:${HL_SIZE[locale]};font-weight:400;
	line-height:1.22;text-align:center;white-space:nowrap;
}
.hl{background:linear-gradient(180deg,transparent 52%,var(--mark) 52%);border-radius:.25em;padding:0 .08em}
.sub{margin-top:2vw;font-size:3.4vw;color:#5A6478;text-align:center;white-space:nowrap}
.shotwrap{min-height:0;height:100%;width:100%;display:flex;align-items:center;justify-content:center;margin-top:3.6vw}
.shot{
	height:100%;max-height:100%;aspect-ratio:9/16;max-width:80vw;border-radius:5vw;overflow:hidden;
	background:#fff;border:.3vw solid #E2E7F1;
	box-shadow:0 3.4vw 8vw rgba(28,43,75,.20),0 1vw 2.2vw rgba(28,43,75,.10);
}
.shot img{width:100%;height:100%;object-fit:cover;object-position:center top;display:block}
.shot.zoom img{transform:scale(1.3);transform-origin:50% 44%}
.foot{
	margin-top:3vw;display:flex;flex-direction:column;align-items:center;gap:2vw;
}
.brand{font-size:4.6vw;color:#1C2B4B;letter-spacing:.14em}
.pills{display:flex;gap:2vw}
.pill{
	font-size:2.9vw;color:#42506B;background:#FFFFFFCC;border:.24vw solid #D8DFEC;
	padding:1vw 2.8vw;border-radius:99px;letter-spacing:.06em;
}
</style></head><body>
<div class="kicker">${P(variant.kicker)}</div>
<h1>${hlHtml}</h1>
<div class="sub">${P(variant.sub)}</div>
<div class="shotwrap"><div class="shot${zoom}"><img src="data:image/png;base64,${SHOTS[variant.shot]}"></div></div>
<div class="foot"><div class="brand">${BRAND[locale]}</div><div class="pills">${pills}</div></div>
</body></html>`;
}

// ---------- 渲染 ----------
const SIZES = {
	asc69: { cw: 660, ch: 1434, dpr: 2, tag: '1320x2868' },   // ASC 6.9"
	ascmed: { cw: 603, ch: 1311, dpr: 2, tag: '1206x2622' },  // ASC medium(必填槽)
	play: { cw: 540, ch: 960, dpr: 2, tag: '1080x1920' },     // Play 手机截图
};

const tmp = join(OUT, '.render');
mkdirSync(tmp, { recursive: true });
let n = 0;
for (const [locale, vars] of Object.entries(VARIANTS)) {
	for (const v of vars) {
		const file = join(tmp, `${locale}-${v.id}.html`);
		writeFileSync(file, html(v, locale));
		for (const [sk, s] of Object.entries(SIZES)) {
			const out = join(OUT, locale, `${v.id}-${sk}.png`);
			mkdirSync(dirname(out), { recursive: true });
			const r = spawnSync('node', [join(ROOT, 'tools/cdp.mjs'), 'shot', `file://${file}`, out], {
				cwd: ROOT, env: { ...process.env, CW: s.cw, CH: s.ch, DPR: s.dpr },
				encoding: 'utf8',
			});
			if (r.status !== 0) { console.error('FAIL', out, r.stderr?.slice(0, 300)); process.exit(1); }
			n++; console.log('✓', `${locale}/${v.id}-${sk}.png`);
		}
	}
}
console.log(`done: ${n} posters → ${OUT}`);
