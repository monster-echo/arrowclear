import { logoSVG, mascotSVG } from './art';
import { icon } from './icons';

const ICONS = [
  'gear','coin','heart','clock','bulb','restart','pause','play',
  'sound','sound-off','back','lock','star','star-empty','levels','shop','help','close',
];

const stage = document.getElementById('stage')!;

function place(name: string, x: number, y: number, w: number, h: number, html: string): void {
  const d = document.createElement('div');
  d.className = 'asset';
  d.dataset.asset = name;
  d.style.left = `${x}px`;
  d.style.top = `${y}px`;
  d.style.width = `${w}px`;
  d.style.height = `${h}px`;
  d.innerHTML = html;
  stage.appendChild(d);
}

ICONS.forEach((name, i) => {
  const x = 20 + (i % 5) * 140;
  const y = 20 + Math.floor(i / 5) * 140;
  place(`icon-${name}`, x, y, 128, 128, icon(name));
});

place('logo', 20, 620, 980, 300, logoSVG());
place('mascot', 20, 970, 600, 540, mascotSVG());
