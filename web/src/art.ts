/** Hand-built vector art: logo lockup + mascot. Keeps the art style consistent
 *  across the web preview and the Cocos build (rasterised to PNG there). */

const CHARS: { ch: string; color: string; x: number; rot: number }[] = [
  { ch: '箭', color: '#FFC53D', x: 181, rot: 3 },
  { ch: '清', color: '#48C46D', x: 300, rot: -3 },
  { ch: '空', color: '#3FA9F5', x: 419, rot: 4 },
];

/** Chunky sticker logo: white outer ring + bold colour + soft drop shadow. */
export function logoSVG(): string {
  const layer = (stroke: string, width: number, fill: string) =>
    CHARS.map(
      (c) =>
        `<text x="${c.x}" y="114" fill="${fill}" stroke="${stroke}" stroke-width="${width}" transform="rotate(${c.rot} ${c.x} 74)">${c.ch}</text>`,
    ).join('');

  return `<svg class="logo-svg" viewBox="0 0 490 150" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="一箭清空">
  <g font-family="'ZCOOL KuaiLe','PingFang SC',sans-serif" font-size="86" text-anchor="middle" stroke-linejoin="round" paint-order="stroke fill">
    <g transform="rotate(-6 66 76)">
      <rect x="20" y="84" width="92" height="34" rx="17" fill="#FF7A45" stroke="#fff" stroke-width="15"/>
    </g>
    <g>${layer('#fff', 20, '#FFC53D')}</g>
    <g>${CHARS.map((c) => `<text x="${c.x}" y="114" fill="${c.color}" stroke="${c.color}" stroke-width="4.5" transform="rotate(${c.rot} ${c.x} 74)">${c.ch}</text>`).join('')}</g>
  </g>
</svg>`;
}

export function mascotSVG(): string {
  return `<svg viewBox="0 0 300 270" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="小箭">
  <defs>
    <linearGradient id="mBody" x1="0" y1="0" x2="0.35" y2="1">
      <stop offset="0" stop-color="#7BD8FF"/>
      <stop offset="0.45" stop-color="#3FB1F2"/>
      <stop offset="1" stop-color="#1C86D6"/>
    </linearGradient>
    <linearGradient id="mHead" x1="0" y1="0" x2="0.4" y2="1">
      <stop offset="0" stop-color="#66CBFA"/>
      <stop offset="1" stop-color="#2288D8"/>
    </linearGradient>
  </defs>

  <g transform="translate(6 6)">
    <!-- dark outline silhouette -->
    <path d="M50 96 H162 V70 Q162 54 176 63 L262 120 Q274 126 262 133 L176 190 Q162 199 162 183 V158 H50 Q30 158 30 138 V116 Q30 96 50 96 Z"
      fill="#124C7C" stroke="#124C7C" stroke-width="30" stroke-linejoin="round"/>
    <!-- body -->
    <path d="M50 96 H162 V70 Q162 54 176 63 L262 120 Q274 126 262 133 L176 190 Q162 199 162 183 V158 H50 Q30 158 30 138 V116 Q30 96 50 96 Z"
      fill="url(#mBody)" stroke="#2A93DA" stroke-width="0"/>
    <!-- head sheen -->
    <path d="M168 76 Q168 68 176 73 L254 122 Q258 125 252 128 L196 165 Z" fill="url(#mHead)" opacity=".85"/>
    <!-- top highlight -->
    <path d="M52 107 H150" stroke="#B6ECFF" stroke-width="9" stroke-linecap="round" opacity=".55"/>

    <!-- eyes -->
    <g>
      <ellipse cx="140" cy="121" rx="24" ry="26" fill="#fff" stroke="#124C7C" stroke-width="4"/>
      <ellipse cx="196" cy="121" rx="24" ry="26" fill="#fff" stroke="#124C7C" stroke-width="4"/>
      <circle cx="135" cy="125" r="11.5" fill="#12344F"/>
      <circle cx="191" cy="125" r="11.5" fill="#12344F"/>
      <circle cx="138.5" cy="120" r="4" fill="#fff"/>
      <circle cx="194.5" cy="120" r="4" fill="#fff"/>
    </g>
    <!-- angry brows -->
    <path d="M110 99 L152 91" stroke="#124C7C" stroke-width="11" stroke-linecap="round"/>
    <path d="M226 99 L184 91" stroke="#124C7C" stroke-width="11" stroke-linecap="round"/>

    <!-- mouth -->
    <path d="M158 142 Q168 152 178 142" stroke="#124C7C" stroke-width="6" stroke-linecap="round" fill="none"/>

    <!-- blush -->
    <ellipse cx="118" cy="145" rx="13" ry="8" fill="#FF8FA3" opacity=".35"/>
    <ellipse cx="219" cy="150" rx="13" ry="8" fill="#FF8FA3" opacity=".35"/>

    <!-- sparkles -->
    <g fill="#FFD75E">
      <path d="M62 40 l5 13 13 5 -13 5 -5 13 -5 -13 -13 -5 13 -5 Z" opacity=".95"/>
      <path d="M252 26 l3.4 9 9 3.4 -9 3.4 -3.4 9 -3.4 -9 -9 -3.4 9 -3.4 Z" opacity=".9"/>
    </g>
    <path d="M86 206 l2.6 7 7 2.6 -7 2.6 -2.6 7 -2.6 -7 -7 -2.6 7 -2.6 Z" fill="#fff" opacity=".85"/>
  </g>
</svg>`;
}