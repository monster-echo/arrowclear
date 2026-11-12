import { Color } from 'cc';

/** #RRGGBB (or #RRGGBBAA) -> cc.Color */
export function hex(value: string, alpha = 255): Color {
  const s = value.replace('#', '');
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  const a = s.length >= 8 ? parseInt(s.slice(6, 8), 16) : alpha;
  return new Color(r, g, b, a);
}

export const C = {
  ink: hex('#163D5C'),
  inkSoft: hex('#5D819B'),
  inkFaint: hex('#9DB8C9'),
  white: hex('#FFFFFF'),
  blue: hex('#3498EF'),
  blueDark: hex('#1E6FBE'),
  blueLight: hex('#78C4FB'),
  yellow: hex('#FFC93C'),
  yellowDark: hex('#E0A20A'),
  orange: hex('#FF9F43'),
  green: hex('#48C46D'),
  red: hex('#F2685F'),
  purple: hex('#8B78F0'),
  panel: hex('#FFFFFF'),
  shade: hex('#0A2E48', 40),
  dim: new Color(12, 42, 64, 150),
};

/** Same palette / order as web/src/theme.ts — keeps both builds consistent. */
export const ARROW_COLORS: Color[] = [
  hex('#F2685F'),
  hex('#FF9F43'),
  hex('#FFC93C'),
  hex('#6ACB5B'),
  hex('#2FBF9E'),
  hex('#4AA8F0'),
  hex('#7C6BF2'),
  hex('#C46BE8'),
  hex('#F26BA0'),
];

export const ARROW_NAMES = ['红', '橙', '黄', '绿', '青', '蓝', '靛', '紫', '粉'];

export const FONT = {
  title: 54,
  h1: 46,
  h2: 38,
  body: 30,
  small: 24,
  tiny: 20,
  button: 40,
};

export const BOARD_STROKE_RATIO = 0.34;