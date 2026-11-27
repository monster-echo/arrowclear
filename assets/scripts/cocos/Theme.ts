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

/**
 * Western Casual Mobile Game Visual System (Royal Match / Toon Blast inspired).
 * Sunlit royal-sky palette, warm cream surfaces, juicy 3D candy buttons,
 * crisp dark-navy outlines, and 5 distinct world color banners.
 */
export const C = {
  ink: hex('#153661'),
  inkSoft: hex('#4D6D91'),
  inkFaint: hex('#8BA5C2'),
  white: hex('#FFFFFF'),
  cream: hex('#FFFDF6'),
  creamWarm: hex('#FFF5DE'),
  creamDeep: hex('#F0E5CC'),
  boardMat: hex('#FFFDF7'),
  boardFrame: hex('#D8E8F8'),
  boardFrameDark: hex('#9CC0E3'),

  skyTop: hex('#247EE8'),
  skyMid: hex('#4AA8FA'),
  royalTop: hex('#2C82EB'),
  royal: hex('#1C62C7'),
  royalDark: hex('#113F88'),
  royalRim: hex('#73C8FF'),

  blue: hex('#2E9BF7'),
  blueDark: hex('#1562BC'),
  blueLight: hex('#79D4FF'),

  green: hex('#39CA4D'),
  greenDark: hex('#1D8A2D'),
  greenLight: hex('#7AF46F'),

  yellow: hex('#FFC526'),
  yellowDark: hex('#D47A00'),
  goldLight: hex('#FFE875'),
  goldText: hex('#8D4800'),

  orange: hex('#FF8C2E'),
  orangeDark: hex('#C9560D'),

  red: hex('#F2524C'),
  redDark: hex('#B82622'),

  purple: hex('#8E64F7'),
  purpleDark: hex('#5B36C4'),

  panel: hex('#FFFDF7'),
  shade: hex('#0B2447', 64),
  dim: new Color(11, 30, 58, 175),
};

export type ButtonStyleName = 'green' | 'blue' | 'gold' | 'red' | 'purple' | 'cream';

export interface ButtonStyleTokens {
  fill: Color;
  top: Color;
  bevel: Color;
  outline: Color;
  text: Color;
  textOutline: Color | null;
}

export const BTN_STYLES: Record<ButtonStyleName, ButtonStyleTokens> = {
  green: {
    fill: hex('#37C94A'),
    top: hex('#6EEB69'),
    bevel: hex('#1D8A2D'),
    outline: hex('#12571D'),
    text: hex('#FFFFFF'),
    textOutline: hex('#135E20'),
  },
  blue: {
    fill: hex('#2E9BF7'),
    top: hex('#6ED0FF'),
    bevel: hex('#1563BD'),
    outline: hex('#0E4182'),
    text: hex('#FFFFFF'),
    textOutline: hex('#0F4588'),
  },
  gold: {
    fill: hex('#FFBD22'),
    top: hex('#FFE46B'),
    bevel: hex('#CF7300'),
    outline: hex('#874400'),
    text: hex('#FFFFFF'),
    textOutline: hex('#8C4600'),
  },
  red: {
    fill: hex('#F2524C'),
    top: hex('#FF8982'),
    bevel: hex('#B82522'),
    outline: hex('#7B1413'),
    text: hex('#FFFFFF'),
    textOutline: hex('#801615'),
  },
  purple: {
    fill: hex('#8E64F7'),
    top: hex('#BD9FFF'),
    bevel: hex('#5A36C4'),
    outline: hex('#391D8A'),
    text: hex('#FFFFFF'),
    textOutline: hex('#3A1E8A'),
  },
  cream: {
    fill: hex('#F4F8FE'),
    top: hex('#FFFFFF'),
    bevel: hex('#C2D4E8'),
    outline: hex('#8FB0D2'),
    text: hex('#1C4675'),
    textOutline: null,
  },
};

export interface WorldTheme {
  enName: string;
  zhName: string;
  banner: Color;
  bannerDark: Color;
  bannerRim: Color;
  tint: Color;
}

/** 5 Worlds matching levels.ts (25 chapters = 5 worlds x 5 chapters). */
export const WORLD_THEMES: WorldTheme[] = [
  {
    enName: 'Sunny Meadow',
    zhName: '阳光草甸',
    banner: hex('#33BE4F'),
    bannerDark: hex('#1B8232'),
    bannerRim: hex('#93F58C'),
    tint: hex('#EBFBE9'),
  },
  {
    enName: 'Frozen Castle',
    zhName: '冰雪城堡',
    banner: hex('#289EF5'),
    bannerDark: hex('#1365B0'),
    bannerRim: hex('#96E1FF'),
    tint: hex('#E8F6FF'),
  },
  {
    enName: 'Art Gallery',
    zhName: '艺术画廊',
    banner: hex('#9366F7'),
    bannerDark: hex('#5D34C2'),
    bannerRim: hex('#D4BFFF'),
    tint: hex('#F3ECFF'),
  },
  {
    enName: 'World Tour',
    zhName: '环游世界',
    banner: hex('#F58529'),
    bannerDark: hex('#BD530C'),
    bannerRim: hex('#FFD18F'),
    tint: hex('#FFF3E5'),
  },
  {
    enName: 'Royal Throne',
    zhName: '皇家王座',
    banner: hex('#E6486A'),
    bannerDark: hex('#A31E3E'),
    bannerRim: hex('#FFADBE'),
    tint: hex('#FFECF0'),
  },
];

/** Vibrant yet eye-friendly Western casual puzzle arrow palette on warm ivory mat. */
export const ARROW_PALETTE_CASUAL: Color[] = [
  hex('#E85B5B'), // juicy coral red
  hex('#F28F3B'), // tangerine orange
  hex('#E5B222'), // sunlit honey gold
  hex('#4AB857'), // fresh leaf green
  hex('#2AB89E'), // vibrant mint teal
  hex('#25A9C4'), // ocean cyan
  hex('#3C8EF0'), // sky royal blue
  hex('#696DF0'), // periwinkle indigo
  hex('#A164E6'), // berry purple
  hex('#E268A8'), // bubblegum pink
  hex('#BA8156'), // warm caramel
  hex('#6A8AA8'), // slate denim
];

export const ARROW_NAMES = ['红', '橙', '黄', '绿', '青', '蓝', '靛', '紫', '粉', '莓', '棕', '灰'];

export const FONT = {
  title: 48,
  h1: 42,
  h2: 34,
  body: 28,
  small: 23,
  tiny: 19,
  button: 38,
};

export const BOARD_STROKE_RATIO = 0.34;
