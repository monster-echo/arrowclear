#!/usr/bin/env node
/**
 * Self-contained SVG -> PNG rasteriser for Cocos Creator resources.
 * Generates Western-casual glossy icons (128x128), 3D game logo (980x320),
 * and hero mascot (640x580) directly into assets/resources/art/.
 */
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'assets', 'resources', 'art');
const FONT_PATH = path.join(ROOT, 'assets', 'art', 'fonts', 'ZCOOLKuaiLe-full.ttf');
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// ------------------------------------------------------------------ Western Casual SVG Icons (24x24)

const ICONS = {
  gear: `
    <defs>
      <linearGradient id="gGear" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#8FA8C8"/>
        <stop offset="50%" stop-color="#587498"/>
        <stop offset="100%" stop-color="#365070"/>
      </linearGradient>
    </defs>
    <path fill="url(#gGear)" stroke="#163050" stroke-width="1.35" stroke-linejoin="round"
      d="M19.3 13.05a7.3 7.3 0 0 0 0-2.1l2.06-1.6a.6.6 0 0 0 .14-.76l-1.95-3.38a.6.6 0 0 0-.73-.26l-2.43.98a7.1 7.1 0 0 0-1.82-1.06l-.37-2.58a.6.6 0 0 0-.6-.51h-3.9a.6.6 0 0 0-.6.51l-.37 2.58a7.1 7.1 0 0 0-1.82 1.06l-2.43-.98a.6.6 0 0 0-.73.26L1.8 8.59a.6.6 0 0 0 .14.76L4 10.95a7.3 7.3 0 0 0 0 2.1l-2.06 1.6a.6.6 0 0 0-.14.76l1.95 3.38a.6.6 0 0 0 .73.26l2.43-.98c.55.44 1.16.8 1.82 1.06l.37 2.58a.6.6 0 0 0 .6.51h3.9a.6.6 0 0 0 .6-.51l.37-2.58c.66-.26 1.27-.62 1.82-1.06l2.43.98a.6.6 0 0 0 .73-.26l1.95-3.38a.6.6 0 0 0-.14-.76l-2.06-1.6ZM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2Z"/>
    <circle cx="12" cy="12" r="3.6" fill="none" stroke="#DCEBFF" stroke-width="0.9" opacity="0.7"/>`,

  coin: `
    <defs>
      <linearGradient id="gCoinOut" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFE66D"/>
        <stop offset="100%" stop-color="#E58B00"/>
      </linearGradient>
      <linearGradient id="gCoinIn" x1="0" y1="0" x2="0.3" y2="1">
        <stop offset="0%" stop-color="#FFF29C"/>
        <stop offset="55%" stop-color="#FFC72C"/>
        <stop offset="100%" stop-color="#F29B00"/>
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="10.2" fill="url(#gCoinOut)" stroke="#8A4800" stroke-width="1.3"/>
    <circle cx="12" cy="11.6" r="7.9" fill="url(#gCoinIn)" stroke="#FFF4B8" stroke-width="0.9"/>
    <path fill="#D97B00" d="m12 6.8 1.48 3 3.3.48-2.39 2.33.56 3.28L12 14.34l-2.95 1.55.56-3.28-2.39-2.33 3.3-.48Z"/>
    <path fill="#FFF8D2" d="M7.6 6.8A6.5 6.5 0 0 1 15.2 5.4" fill="none" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" opacity="0.65"/>`,

  bolt: `
    <defs>
      <linearGradient id="gBolt" x1="0" y1="0" x2="0.2" y2="1">
        <stop offset="0%" stop-color="#FFF078"/>
        <stop offset="48%" stop-color="#FFC41F"/>
        <stop offset="100%" stop-color="#F07F00"/>
      </linearGradient>
    </defs>
    <path fill="url(#gBolt)" stroke="#7F3F00" stroke-width="1.45" stroke-linejoin="round"
      d="M14.2 1.8 4.6 13.1h5.3l-1.5 9.1 10.9-11.7h-5.4L14.2 1.8Z"/>
    <path fill="#FFF9C4" opacity="0.85"
      d="M13.1 4.4 7.4 11.7h2.9l-.6 4.4 5.5-6h-2.8l.7-5.7Z"/>`,

  heart: `
    <defs>
      <linearGradient id="gHeart" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FF7F8A"/>
        <stop offset="42%" stop-color="#F64252"/>
        <stop offset="100%" stop-color="#C4192C"/>
      </linearGradient>
    </defs>
    <path fill="url(#gHeart)" stroke="#7E0F1D" stroke-width="1.4" stroke-linejoin="round"
      d="M12 21.1s-8.2-4.8-9.8-9.2C.9 8.3 3 4.2 7 4.2c2.2 0 3.9 1.2 5 2.7 1.1-1.5 2.8-2.7 5-2.7 4 0 6.1 4.1 4.8 7.7-1.6 4.4-9.8 9.2-9.8 9.2Z"/>
    <ellipse cx="7.4" cy="8.5" rx="2.3" ry="1.45" transform="rotate(-32 7.4 8.5)" fill="#FFC4CA" opacity="0.85"/>
    <circle cx="5.7" cy="11.2" r="0.85" fill="#FFC4CA" opacity="0.65"/>`,

  clock: `
    <defs>
      <linearGradient id="gClockRim" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6DD0FF"/>
        <stop offset="100%" stop-color="#1E78E0"/>
      </linearGradient>
    </defs>
    <circle cx="12" cy="12.4" r="9.3" fill="url(#gClockRim)" stroke="#123F7A" stroke-width="1.35"/>
    <circle cx="12" cy="12.4" r="6.8" fill="#FFFDF7"/>
    <path fill="none" stroke="#184378" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M12 8.2v4.3l3 2.1"/>
    <circle cx="12" cy="12.4" r="1.25" fill="#F2544B"/>
    <rect x="9.6" y="1.4" width="4.8" height="2" rx="1" fill="#FFD13B" stroke="#8C4E00" stroke-width="0.9"/>`,

  bulb: `
    <defs>
      <linearGradient id="gBulb" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFF58A"/>
        <stop offset="55%" stop-color="#FFC726"/>
        <stop offset="100%" stop-color="#F28C00"/>
      </linearGradient>
    </defs>
    <path fill="url(#gBulb)" stroke="#854500" stroke-width="1.35" stroke-linejoin="round"
      d="M12 2.2a6.6 6.6 0 0 0-3.9 11.9c.7.55 1.1 1.3 1.1 2.2v.7h5.6v-.7c0-.9.4-1.65 1.1-2.2A6.6 6.6 0 0 0 12 2.2Z"/>
    <ellipse cx="9.2" cy="7.2" rx="1.6" ry="2.7" transform="rotate(20 9.2 7.2)" fill="#FFFFFF" opacity="0.72"/>
    <rect x="8.8" y="17.2" width="6.4" height="2.4" rx="1.2" fill="#8EA6BF" stroke="#2D4A68" stroke-width="1"/>
    <rect x="9.7" y="19.9" width="4.6" height="2" rx="1" fill="#6F8AA6" stroke="#2D4A68" stroke-width="1"/>`,

  restart: `
    <defs>
      <linearGradient id="gRestart" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFFFFF"/>
        <stop offset="100%" stop-color="#D8ECFF"/>
      </linearGradient>
    </defs>
    <path fill="none" stroke="#134278" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"
      d="M5.1 12.2a7.1 7.1 0 1 0 2.1-5.1"/>
    <path fill="none" stroke="url(#gRestart)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"
      d="M5.1 12.2a7.1 7.1 0 1 0 2.1-5.1"/>
    <path fill="#FFFFFF" stroke="#134278" stroke-width="1.25" stroke-linejoin="round"
      d="M3.6 4.2v6.1h6.1L3.6 4.2Z"/>`,

  pause: `
    <rect x="5" y="3.8" width="5.2" height="16.4" rx="2.6" fill="#FFFFFF" stroke="#143D73" stroke-width="1.5"/>
    <rect x="13.8" y="3.8" width="5.2" height="16.4" rx="2.6" fill="#FFFFFF" stroke="#143D73" stroke-width="1.5"/>
    <rect x="6.4" y="5.4" width="1.8" height="5.5" rx="0.9" fill="#DCEEFF" opacity="0.8"/>
    <rect x="15.2" y="5.4" width="1.8" height="5.5" rx="0.9" fill="#DCEEFF" opacity="0.8"/>`,

  play: `
    <defs>
      <linearGradient id="gPlay" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFFFFF"/>
        <stop offset="100%" stop-color="#E4FFE8"/>
      </linearGradient>
    </defs>
    <path fill="url(#gPlay)" stroke="#145D20" stroke-width="1.5" stroke-linejoin="round"
      d="M6.4 4.2a1.9 1.9 0 0 1 2.9-1.62l11.2 6.8a1.9 1.9 0 0 1 0 3.24l-11.2 6.8A1.9 1.9 0 0 1 6.4 17.8V4.2Z"
      transform="translate(0 1)"/>`,

  sound: `
    <path fill="#45A9FF" stroke="#134278" stroke-width="1.4" stroke-linejoin="round"
      d="M3.6 9h3.5l5.1-4.3v14.6L7.1 15H3.6a1.2 1.2 0 0 1-1.2-1.2v-3.6A1.2 1.2 0 0 1 3.6 9Z"/>
    <path fill="none" stroke="#1E7AE0" stroke-width="2.2" stroke-linecap="round"
      d="M15.6 8.3a5.1 5.1 0 0 1 0 7.4M18.6 5.6a8.9 8.9 0 0 1 0 12.8"/>`,

  'sound-off': `
    <path fill="#8FA6BD" stroke="#2D4761" stroke-width="1.4" stroke-linejoin="round"
      d="M3.6 9h3.5l5.1-4.3v14.6L7.1 15H3.6a1.2 1.2 0 0 1-1.2-1.2v-3.6A1.2 1.2 0 0 1 3.6 9Z"/>
    <path fill="none" stroke="#F24B4B" stroke-width="2.8" stroke-linecap="round"
      d="m15.4 8.8 5.8 6.4M21.2 8.8l-5.8 6.4"/>`,

  back: `
    <path fill="none" stroke="#134278" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round"
      d="M15 4.8 7.4 12l7.6 7.2"/>
    <path fill="none" stroke="#FFFFFF" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"
      d="M15 4.8 7.4 12l7.6 7.2"/>`,

  lock: `
    <defs>
      <linearGradient id="gLock" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#A6BDD4"/>
        <stop offset="100%" stop-color="#6F89A6"/>
      </linearGradient>
    </defs>
    <path fill="none" stroke="#4D6682" stroke-width="2.8" stroke-linecap="round"
      d="M8 10.4V7.6a4 4 0 0 1 8 0v2.8"/>
    <rect x="4.4" y="10" width="15.2" height="10.8" rx="3.2" fill="url(#gLock)" stroke="#3B536E" stroke-width="1.35"/>
    <circle cx="12" cy="14.7" r="1.5" fill="#324861"/>
    <rect x="11.25" y="15.4" width="1.5" height="2.6" rx="0.75" fill="#324861"/>`,

  star: `
    <defs>
      <linearGradient id="gStar" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFF176"/>
        <stop offset="48%" stop-color="#FFC627"/>
        <stop offset="100%" stop-color="#EE8500"/>
      </linearGradient>
    </defs>
    <path fill="url(#gStar)" stroke="#8F4B00" stroke-width="1.35" stroke-linejoin="round"
      d="m12 2.2 3 6.1 6.7.98-4.85 4.72 1.15 6.7L12 17.55 6 20.7l1.15-6.7L2.3 9.28l6.7-.98Z"/>
    <path fill="#FFFBD0" opacity="0.78"
      d="m12 4.1 1.7 3.6 3.7.56-5.4 3.4Z"/>`,

  'star-empty': `
    <defs>
      <linearGradient id="gStarE" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#C9D8E8"/>
        <stop offset="100%" stop-color="#A8BCD2"/>
      </linearGradient>
    </defs>
    <path fill="url(#gStarE)" stroke="#7F98B4" stroke-width="1.35" stroke-linejoin="round"
      d="m12 2.2 3 6.1 6.7.98-4.85 4.72 1.15 6.7L12 17.55 6 20.7l1.15-6.7L2.3 9.28l6.7-.98Z"/>`,

  levels: `
    <rect x="2.8" y="2.8" width="8.2" height="8.2" rx="2.5" fill="#3AA8FF" stroke="#124782" stroke-width="1.25"/>
    <rect x="13" y="2.8" width="8.2" height="8.2" rx="2.5" fill="#9D7BFF" stroke="#3B248A" stroke-width="1.25"/>
    <rect x="2.8" y="13" width="8.2" height="8.2" rx="2.5" fill="#4AD459" stroke="#176B26" stroke-width="1.25"/>
    <rect x="13" y="13" width="8.2" height="8.2" rx="2.5" fill="#FFC933" stroke="#8C4F00" stroke-width="1.25"/>
    <rect x="4.3" y="4.2" width="4.4" height="1.5" rx="0.75" fill="#FFFFFF" opacity="0.65"/>
    <rect x="14.5" y="4.2" width="4.4" height="1.5" rx="0.75" fill="#FFFFFF" opacity="0.65"/>
    <rect x="4.3" y="14.4" width="4.4" height="1.5" rx="0.75" fill="#FFFFFF" opacity="0.65"/>
    <rect x="14.5" y="14.4" width="4.4" height="1.5" rx="0.75" fill="#FFFFFF" opacity="0.65"/>`,

  shop: `
    <path fill="none" stroke="#8C4F00" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"
      d="M3 4.6h2.5l2.5 10.2"/>
    <path fill="#FFD03B" stroke="#8C4F00" stroke-width="1.5" stroke-linejoin="round"
      d="M6.2 7.5h14.6l-1.9 7.3a2 2 0 0 1-2 1.5H9.5a2 2 0 0 1-1.9-1.5L6.2 7.5Z"/>
    <circle cx="9.8" cy="19.5" r="1.8" fill="#F29B00" stroke="#8C4F00" stroke-width="0.9"/>
    <circle cx="16.8" cy="19.5" r="1.8" fill="#F29B00" stroke="#8C4F00" stroke-width="0.9"/>`,

  help: `
    <defs>
      <linearGradient id="gHelp" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#6DD0FF"/>
        <stop offset="100%" stop-color="#1E7AE6"/>
      </linearGradient>
    </defs>
    <circle cx="12" cy="12" r="9.6" fill="url(#gHelp)" stroke="#11407A" stroke-width="1.4"/>
    <path fill="none" stroke="#FFFFFF" stroke-width="1.1" stroke-linecap="round" opacity="0.55" d="M6.4 6.7a7.5 7.5 0 0 1 8.4-1.7"/>
    <path fill="#FFFFFF" d="M12.1 6.2c2.1 0 3.5 1.15 3.5 2.85 0 1.2-.6 1.9-1.7 2.6-.9.55-1.15.95-1.15 1.8v.35h-2.15v-.5c0-1.25.45-1.9 1.55-2.65.8-.55 1.05-.85 1.05-1.5 0-.7-.55-1.15-1.4-1.15-.9 0-1.5.5-1.6 1.3H8c.1-2 1.65-3.1 4.1-3.1Zm-1.05 10.1a1.35 1.35 0 1 1 2.7 0 1.35 1.35 0 0 1-2.7 0Z"/>`,

  close: `
    <path fill="none" stroke="#7A1515" stroke-width="5.2" stroke-linecap="round"
      d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6"/>
    <path fill="none" stroke="#FFFFFF" stroke-width="2.8" stroke-linecap="round"
      d="m6.4 6.4 11.2 11.2M17.6 6.4 6.4 17.6"/>`,
};

function iconSVG(name) {
  return `<svg viewBox="0 0 24 24" width="128" height="128" xmlns="http://www.w3.org/2000/svg">${ICONS[name] ?? ''}</svg>`;
}

// ------------------------------------------------------------------ Western Casual 3D English Logo (980x360)

function logoEnSVG() {
  const topWord = [
    { ch: 'A', x: 205, y: 158, rot: -6, grad: 'url(#enCoral)' },
    { ch: 'R', x: 344, y: 148, rot: -2, grad: 'url(#enGold)' },
    { ch: 'R', x: 484, y: 144, rot: 1, grad: 'url(#enGold)' },
    { ch: 'O', x: 628, y: 148, rot: 3, grad: 'url(#enGold)' },
    { ch: 'W', x: 782, y: 158, rot: 6, grad: 'url(#enCoral)' },
  ];
  const botWord = [
    { ch: 'C', x: 248, y: 298, rot: -4, grad: 'url(#enSky)' },
    { ch: 'L', x: 368, y: 304, rot: -2, grad: 'url(#enGreen)' },
    { ch: 'E', x: 488, y: 306, rot: 0, grad: 'url(#enSky)' },
    { ch: 'A', x: 612, y: 304, rot: 2, grad: 'url(#enGreen)' },
    { ch: 'R', x: 738, y: 298, rot: 4, grad: 'url(#enSky)' },
  ];

  const renderRow = (list, size, fill, stroke, sw, dy = 0) =>
    list
      .map(
        (c) =>
          `<text x="${c.x}" y="${c.y + dy}" font-size="${size}" fill="${fill ?? c.grad}" stroke="${stroke ?? c.grad}" stroke-width="${sw}" transform="rotate(${c.rot} ${c.x} ${c.y - size * 0.35})">${c.ch}</text>`,
      )
      .join('');

  return `<svg viewBox="0 0 980 360" width="980" height="360" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="enCoral" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFB963"/>
      <stop offset="46%" stop-color="#FF6938"/>
      <stop offset="100%" stop-color="#D92E1C"/>
    </linearGradient>
    <linearGradient id="enGold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFF58A"/>
      <stop offset="48%" stop-color="#FFC524"/>
      <stop offset="100%" stop-color="#EB7A00"/>
    </linearGradient>
    <linearGradient id="enGreen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#A6FF7F"/>
      <stop offset="48%" stop-color="#3CD654"/>
      <stop offset="100%" stop-color="#169834"/>
    </linearGradient>
    <linearGradient id="enSky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#A8EEFF"/>
      <stop offset="48%" stop-color="#35ADFF"/>
      <stop offset="100%" stop-color="#136EDB"/>
    </linearGradient>
    <linearGradient id="enArrow" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="#FF9F45"/>
      <stop offset="55%" stop-color="#FF5938"/>
      <stop offset="100%" stop-color="#FFE052"/>
    </linearGradient>
    <filter id="enShadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="10" stdDeviation="6" flood-color="#0B2447" flood-opacity="0.36"/>
    </filter>
  </defs>

  <!-- Dynamic decorative swoosh arrow behind wordmark -->
  <g transform="translate(0 6)" filter="url(#enShadow)">
    <path d="M98 186 H818 V162 Q818 148 831 156 L902 195 Q914 202 902 209 L831 248 Q818 256 818 242 V218 H98 Q78 218 78 202 Q78 186 98 186 Z"
      fill="#0F2F5B" stroke="#0F2F5B" stroke-width="26" stroke-linejoin="round" transform="translate(0 7)"/>
    <path d="M98 186 H818 V162 Q818 148 831 156 L902 195 Q914 202 902 209 L831 248 Q818 256 818 242 V218 H98 Q78 218 78 202 Q78 186 98 186 Z"
      fill="#FFFFFF" stroke="#FFFFFF" stroke-width="22" stroke-linejoin="round"/>
    <path d="M98 186 H818 V162 Q818 148 831 156 L902 195 Q914 202 902 209 L831 248 Q818 256 818 242 V218 H98 Q78 218 78 202 Q78 186 98 186 Z"
      fill="url(#enArrow)" stroke="#143D73" stroke-width="8" stroke-linejoin="round"/>
  </g>

  <!-- Wordmark: ARROW / CLEAR -->
  <g font-family="'Arial Rounded MT Bold','Trebuchet MS','Helvetica Neue',sans-serif" font-weight="900"
     text-anchor="middle" stroke-linejoin="round" paint-order="stroke fill" filter="url(#enShadow)">

    <!-- 3D deep navy extrusion -->
    <g transform="translate(0 13)">
      ${renderRow(topWord, 152, '#0D2C59', '#0D2C59', 38)}
      ${renderRow(botWord, 134, '#0D2C59', '#0D2C59', 36)}
    </g>

    <!-- Thick white sticker border -->
    <g>
      ${renderRow(topWord, 152, '#FFFFFF', '#FFFFFF', 28)}
      ${renderRow(botWord, 134, '#FFFFFF', '#FFFFFF', 26)}
    </g>

    <!-- Crisp dark navy inner outline -->
    <g>
      ${renderRow(topWord, 152, '#133C73', '#133C73', 12)}
      ${renderRow(botWord, 134, '#133C73', '#133C73', 11)}
    </g>

    <!-- Main glossy gradient fills -->
    <g>
      ${renderRow(topWord, 152, null, null, 2)}
      ${renderRow(botWord, 134, null, null, 2)}
    </g>
  </g>

  <!-- Twinkling golden sparkles -->
  <g>
    <path d="M912 64 l8 22 22 8 -22 8 -8 22 -8 -22 -22 -8 22 -8 Z" fill="#FFE66D" stroke="#9C5600" stroke-width="2.2"/>
    <path d="M68 68 l6 16 16 6 -16 6 -6 16 -6 -16 -16 -6 16 -6 Z" fill="#FFFFFF" opacity="0.96"/>
    <path d="M126 286 l5 14 14 5 -14 5 -5 14 -5 -14 -14 -5 14 -5 Z" fill="#FFE66D" stroke="#9C5600" stroke-width="1.6"/>
    <circle cx="888" cy="272" r="9" fill="#FFFFFF" opacity="0.9"/>
  </g>
</svg>`;
}

// ------------------------------------------------------------------ Western Casual 3D Chinese Logo (980x320)

function logoZhSVG() {
  const chars = [
    { ch: '箭', grad: 'url(#lgGold)', x: 356, y: 186, rot: -4 },
    { ch: '清', grad: 'url(#lgGreen)', x: 562, y: 182, rot: 3 },
    { ch: '空', grad: 'url(#lgSky)', x: 766, y: 188, rot: -3 },
  ];

  const charLayer = (fill, stroke, sw, dy = 0) =>
    chars
      .map(
        (c) =>
          `<text x="${c.x}" y="${c.y + dy}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" transform="rotate(${c.rot} ${c.x} ${c.y - 45})">${c.ch}</text>`,
      )
      .join('');

  return `<svg viewBox="0 0 980 320" width="980" height="320" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="lgCoral" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFB15E"/>
      <stop offset="45%" stop-color="#FF6A3D"/>
      <stop offset="100%" stop-color="#DC321C"/>
    </linearGradient>
    <linearGradient id="lgGold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFF282"/>
      <stop offset="48%" stop-color="#FFC226"/>
      <stop offset="100%" stop-color="#EB7F00"/>
    </linearGradient>
    <linearGradient id="lgGreen" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#9BFF7A"/>
      <stop offset="48%" stop-color="#3CD452"/>
      <stop offset="100%" stop-color="#179934"/>
    </linearGradient>
    <linearGradient id="lgSky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#9BE7FF"/>
      <stop offset="48%" stop-color="#35A9FF"/>
      <stop offset="100%" stop-color="#136EDB"/>
    </linearGradient>
    <linearGradient id="lgRibbon" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#2769C4"/>
      <stop offset="100%" stop-color="#133C7A"/>
    </linearGradient>
    <filter id="logoShadow" x="-10%" y="-10%" width="120%" height="130%">
      <feDropShadow dx="0" dy="10" stdDeviation="6" flood-color="#0B2447" flood-opacity="0.34"/>
    </filter>
  </defs>

  <!-- Sub-banner ribbon: ARROW CLEAR -->
  <g transform="translate(490 256)" filter="url(#logoShadow)">
    <path d="M-212,-24 L212,-24 L236,0 L212,24 L-212,24 L-236,0 Z"
      fill="url(#lgRibbon)" stroke="#FFD54F" stroke-width="5" stroke-linejoin="round"/>
    <text x="0" y="9" text-anchor="middle" font-family="'Arial Rounded MT Bold','Helvetica Neue',sans-serif"
      font-weight="900" font-size="25" letter-spacing="10" fill="#FFFDF5">ARROW CLEAR</text>
  </g>

  <g font-family="'ZCOOL KuaiLe','PingFang SC',sans-serif" font-size="166" text-anchor="middle"
     stroke-linejoin="round" paint-order="stroke fill" filter="url(#logoShadow)">

    <!-- 3D deep navy extrusion shadow -->
    <g transform="translate(0 13)">
      <g transform="rotate(-7 154 148)">
        <path d="M56 126 H178 V96 Q178 82 191 90 L254 134 Q264 142 254 150 L191 194 Q178 202 178 188 V160 H56 Q34 160 34 143 Q34 126 56 126 Z"
          fill="#0F2F5B" stroke="#0F2F5B" stroke-width="34" stroke-linejoin="round"/>
      </g>
      ${charLayer('#0F2F5B', '#0F2F5B', 38)}
    </g>

    <!-- Thick white sticker border -->
    <g>
      <g transform="rotate(-7 154 148)">
        <path d="M56 126 H178 V96 Q178 82 191 90 L254 134 Q264 142 254 150 L191 194 Q178 202 178 188 V160 H56 Q34 160 34 143 Q34 126 56 126 Z"
          fill="#FFFFFF" stroke="#FFFFFF" stroke-width="28" stroke-linejoin="round"/>
      </g>
      ${charLayer('#FFFFFF', '#FFFFFF', 28)}
    </g>

    <!-- Inner dark outline for crisp pop -->
    <g>
      <g transform="rotate(-7 154 148)">
        <path d="M56 126 H178 V96 Q178 82 191 90 L254 134 Q264 142 254 150 L191 194 Q178 202 178 188 V160 H56 Q34 160 34 143 Q34 126 56 126 Z"
          fill="#153E73" stroke="#153E73" stroke-width="12" stroke-linejoin="round"/>
      </g>
      ${charLayer('#153E73', '#153E73', 12)}
    </g>

    <!-- Main glossy character fills -->
    <g transform="rotate(-7 154 148)">
      <path d="M56 126 H178 V96 Q178 82 191 90 L254 134 Q264 142 254 150 L191 194 Q178 202 178 188 V160 H56 Q34 160 34 143 Q34 126 56 126 Z"
        fill="url(#lgCoral)"/>
      <path d="M58 134 H172" stroke="#FFD6A5" stroke-width="9" stroke-linecap="round" opacity="0.72"/>
    </g>
    ${chars
      .map(
        (c) =>
          `<text x="${c.x}" y="${c.y}" fill="${c.grad}" stroke="${c.grad}" stroke-width="3" transform="rotate(${c.rot} ${c.x} ${c.y - 45})">${c.ch}</text>`,
      )
      .join('')}
  </g>

  <!-- Twinkling Western-casual gold sparkles -->
  <g>
    <path d="M902 58 l8 21 21 8 -21 8 -8 21 -8 -21 -21 -8 21 -8 Z" fill="#FFE66D" stroke="#A65E00" stroke-width="2"/>
    <path d="M74 60 l6 15 15 6 -15 6 -6 15 -6 -15 -15 -6 15 -6 Z" fill="#FFFFFF" opacity="0.95"/>
    <path d="M460 38 l5 13 13 5 -13 5 -5 13 -5 -13 -13 -5 13 -5 Z" fill="#FFE66D"/>
    <circle cx="888" cy="196" r="8" fill="#FFFFFF" opacity="0.88"/>
    <circle cx="112" cy="212" r="6" fill="#FFE66D" opacity="0.9"/>
  </g>
</svg>`;
}

// ------------------------------------------------------------------ Western Casual Hero Mascot (640x580)

function mascotSVG() {
  return `<svg viewBox="0 0 340 308" width="640" height="580" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <radialGradient id="halo" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.78"/>
      <stop offset="55%" stop-color="#C8EEFF" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="#8ED8FF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="mBody" x1="0.1" y1="0" x2="0.4" y2="1">
      <stop offset="0%" stop-color="#87ECFF"/>
      <stop offset="32%" stop-color="#36B6FF"/>
      <stop offset="78%" stop-color="#1A82EC"/>
      <stop offset="100%" stop-color="#115DC4"/>
    </linearGradient>
    <linearGradient id="mGloss" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFFFFF" stop-opacity="0.82"/>
      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="mGold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#FFF385"/>
      <stop offset="55%" stop-color="#FFC627"/>
      <stop offset="100%" stop-color="#E87D00"/>
    </linearGradient>
    <filter id="mShadow" x="-15%" y="-15%" width="130%" height="135%">
      <feDropShadow dx="0" dy="14" stdDeviation="9" flood-color="#0B2C59" flood-opacity="0.34"/>
    </filter>
  </defs>

  <!-- Soft sunlit halo behind hero -->
  <circle cx="176" cy="156" r="136" fill="url(#halo)"/>

  <!-- Dynamic speed swoosh trails behind tail -->
  <g stroke-linecap="round" opacity="0.88">
    <path d="M24 122 H54" stroke="#FFFFFF" stroke-width="8"/>
    <path d="M18 152 H48" stroke="#FFE66D" stroke-width="9"/>
    <path d="M28 182 H56" stroke="#FFFFFF" stroke-width="7"/>
  </g>

  <g transform="translate(22 18) rotate(-4 150 135)" filter="url(#mShadow)">
    <!-- 3D bottom extrusion -->
    <path d="M58 96 H166 V64 Q166 44 184 55 L278 118 Q294 129 278 140 L184 203 Q166 214 166 194 V162 H58 Q34 162 34 138 V120 Q34 96 58 96 Z"
      transform="translate(0 11)" fill="#0D3566" stroke="#0D3566" stroke-width="24" stroke-linejoin="round"/>

    <!-- White outer sticker rim -->
    <path d="M58 96 H166 V64 Q166 44 184 55 L278 118 Q294 129 278 140 L184 203 Q166 214 166 194 V162 H58 Q34 162 34 138 V120 Q34 96 58 96 Z"
      fill="#FFFFFF" stroke="#FFFFFF" stroke-width="22" stroke-linejoin="round"/>

    <!-- Crisp dark navy contour -->
    <path d="M58 96 H166 V64 Q166 44 184 55 L278 118 Q294 129 278 140 L184 203 Q166 214 166 194 V162 H58 Q34 162 34 138 V120 Q34 96 58 96 Z"
      fill="#104480" stroke="#104480" stroke-width="11" stroke-linejoin="round"/>

    <!-- Main 3D glossy body -->
    <path d="M58 96 H166 V64 Q166 44 184 55 L278 118 Q294 129 278 140 L184 203 Q166 214 166 194 V162 H58 Q34 162 34 138 V120 Q34 96 58 96 Z"
      fill="url(#mBody)"/>

    <!-- Lower rim bounce light -->
    <path d="M58 153 H166" stroke="#78E4FF" stroke-width="6" stroke-linecap="round" opacity="0.45"/>

    <!-- Top glossy candy reflection -->
    <path d="M58 103 H162 Q170 103 173 95 L176 72 Q178 65 186 70 L258 117 Q244 114 218 116 L58 116 Q46 116 46 109 Q46 103 58 103 Z"
      fill="url(#mGloss)"/>
    <ellipse cx="62" cy="110" rx="14" ry="5" fill="#FFFFFF" opacity="0.72"/>

    <!-- Expressive Pixar/Dream-Games Eyes -->
    <g>
      <!-- Left eye -->
      <ellipse cx="144" cy="126" rx="23" ry="26" fill="#FFFFFF" stroke="#103B6E" stroke-width="4.5"/>
      <circle cx="149" cy="128" r="13" fill="#103052"/>
      <circle cx="150" cy="131" r="7.2" fill="#2178D6"/>
      <circle cx="149" cy="127" r="6.5" fill="#0B1F38"/>
      <circle cx="143" cy="119" r="5" fill="#FFFFFF"/>
      <circle cx="155" cy="134" r="2.4" fill="#FFFFFF"/>

      <!-- Right eye -->
      <ellipse cx="202" cy="126" rx="23" ry="26" fill="#FFFFFF" stroke="#103B6E" stroke-width="4.5"/>
      <circle cx="207" cy="128" r="13" fill="#103052"/>
      <circle cx="208" cy="131" r="7.2" fill="#2178D6"/>
      <circle cx="207" cy="127" r="6.5" fill="#0B1F38"/>
      <circle cx="201" cy="119" r="5" fill="#FFFFFF"/>
      <circle cx="213" cy="134" r="2.4" fill="#FFFFFF"/>
    </g>

    <!-- Energetic friendly raised eyebrows -->
    <path d="M120 96 Q142 86 160 95" fill="none" stroke="#103B6E" stroke-width="8.5" stroke-linecap="round"/>
    <path d="M186 95 Q205 86 226 96" fill="none" stroke="#103B6E" stroke-width="8.5" stroke-linecap="round"/>

    <!-- Happy confident grin -->
    <path d="M161 151 Q174 166 187 151 Z" fill="#8C1D35" stroke="#103B6E" stroke-width="4" stroke-linejoin="round"/>
    <path d="M166 157 Q174 163 182 157" fill="none" stroke="#FF758F" stroke-width="4" stroke-linecap="round"/>

    <!-- Warm rosy cheeks -->
    <ellipse cx="119" cy="148" rx="11" ry="6.5" fill="#FF7997" opacity="0.52"/>
    <ellipse cx="228" cy="148" rx="11" ry="6.5" fill="#FF7997" opacity="0.52"/>
  </g>

  <!-- Floating golden crown-star & sparkles -->
  <g>
    <path d="M84 44 l9 22 22 9 -22 9 -9 22 -9 -22 -22 -9 22 -9 Z"
      fill="url(#mGold)" stroke="#8F4B00" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="M286 38 l7 17 17 7 -17 7 -7 17 -7 -17 -17 -7 17 -7 Z"
      fill="url(#mGold)" stroke="#8F4B00" stroke-width="1.8" stroke-linejoin="round"/>
    <path d="M274 226 l5 13 13 5 -13 5 -5 13 -5 -13 -13 -5 13 -5 Z"
      fill="#FFFFFF" opacity="0.92"/>
    <circle cx="96" cy="242" r="7" fill="#FFE66D" opacity="0.9"/>
  </g>
</svg>`;
}

// ------------------------------------------------------------------ Build Artboard HTML

function buildArtboardHTML(fontDataUrl) {
  const iconNames = Object.keys(ICONS);
  const items = [];

  iconNames.forEach((name, i) => {
    const x = 20 + (i % 5) * 148;
    const y = 20 + Math.floor(i / 5) * 148;
    items.push(
      `<div class="asset" data-asset="icon-${name}" style="left:${x}px;top:${y}px;width:128px;height:128px;">${iconSVG(name)}</div>`,
    );
  });

  items.push(
    `<div class="asset" data-asset="logo" style="left:20px;top:640px;width:980px;height:360px;">${logoEnSVG()}</div>`,
  );
  items.push(
    `<div class="asset" data-asset="logo-zh" style="left:20px;top:1020px;width:980px;height:320px;">${logoZhSVG()}</div>`,
  );
  items.push(
    `<div class="asset" data-asset="mascot" style="left:20px;top:1360px;width:640px;height:580px;">${mascotSVG()}</div>`,
  );

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @font-face {
    font-family: 'ZCOOL KuaiLe';
    src: url('${fontDataUrl}') format('truetype');
  }
  html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
  #stage { position: relative; width: 1100px; height: 2000px; }
  .asset { position: absolute; display: flex; align-items: center; justify-content: center; }
  .asset svg { width: 100%; height: 100%; display: block; overflow: visible; }
</style>
</head>
<body><div id="stage">${items.join('')}</div></body>
</html>`;
}

// ------------------------------------------------------------------ CDP Runner

class CDP {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }
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
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails));
    return r.result?.value;
  }
}

const fontBuf = await readFile(FONT_PATH);
const fontDataUrl = `data:font/ttf;base64,${fontBuf.toString('base64')}`;
const html = buildArtboardHTML(fontDataUrl);

const server = createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const httpPort = server.address().port;

const profile = await mkdtemp(path.join(tmpdir(), 'arrowclear-assets-'));
const debugPort = 9400 + Math.floor(Math.random() * 250);
const chromeProc = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--mute-audio',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    'about:blank',
  ],
  { stdio: 'ignore' },
);

try {
  let ready = false;
  for (let i = 0; i < 80; i++) {
    await sleep(200);
    try {
      const r = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
      if (r.ok) {
        ready = true;
        break;
      }
    } catch {}
  }
  if (!ready) throw new Error('headless chrome failed to start');

  const tab = await fetch(
    `http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(`http://127.0.0.1:${httpPort}/`)}`,
    { method: 'PUT' },
  ).then((r) => r.json());

  const c = new CDP(tab.webSocketDebuggerUrl);
  await c.connect();
  await c.send('Page.enable');
  await c.send('Runtime.enable');
  await c.send('Emulation.setDeviceMetricsOverride', {
    width: 1120,
    height: 2020,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await c.send('Emulation.setDefaultBackgroundColorOverride', {
    color: { r: 0, g: 0, b: 0, a: 0 },
  });
  await c.send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/` });
  await sleep(900);
  await c.eval('document.fonts.ready.then(() => true)');
  await sleep(250);

  const rects = await c.eval(
    `JSON.stringify(Array.from(document.querySelectorAll('[data-asset]')).map(el => ({ name: el.dataset.asset, r: el.getBoundingClientRect().toJSON() })))`,
  );
  const list = JSON.parse(rects);
  await mkdir(path.join(OUT, 'icons'), { recursive: true });

  for (const { name, r } of list) {
    const out = name.startsWith('icon-')
      ? path.join(OUT, 'icons', `${name.slice(5)}.png`)
      : path.join(OUT, `${name}.png`);
    const shot = await c.send('Page.captureScreenshot', {
      format: 'png',
      clip: { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 },
      captureBeyondViewport: true,
    });
    await writeFile(out, Buffer.from(shot.data, 'base64'));
    console.log('wrote', path.relative(ROOT, out), `${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  console.log('done', list.length, 'assets');
} finally {
  try {
    chromeProc.kill('SIGKILL');
  } catch {}
  server.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}
