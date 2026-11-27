import { sys } from 'cc';
import { fullEnergy } from '../core/energy';
import { Lang } from './I18n';

export interface SaveData {
  version: 1;
  unlocked: number;
  stars: Record<string, number>;
  /** 剩余提示次数：初始 3 次，看一次激励广告 +1 次（HINTS_PER_AD）。 */
  hints: number;
  /** 体力（0..ENERGY_MAX），见 core/energy.ts。 */
  energy: number;
  /** 上次体力变动/触顶时刻（ms epoch），离线恢复用它现算。 */
  energyAt: number;
  sound: boolean;
  haptics: boolean;
  seenHowto: boolean;
  /** UI language — defaults to English ('en'). */
  lang: Lang;
  /** 已通过「看广告通行证」放行的章（章号字符串 → true，规则书 §7）。 */
  chapterPasses: Record<string, boolean>;
}

const KEY = 'arrowclear.save.v2';

export function defaultSave(): SaveData {
  const now = Date.now();
  return {
    version: 1,
    unlocked: 1,
    stars: {},
    hints: 3,
    ...fullEnergy(now),
    sound: true,
    haptics: true,
    seenHowto: false,
    lang: 'en',
    chapterPasses: {},
  };
}

export function loadSave(): SaveData {
  try {
    const raw = sys.localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return { ...defaultSave(), ...parsed, version: 1 };
  } catch {
    return defaultSave();
  }
}

export function persist(save: SaveData): void {
  try {
    sys.localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* ignore quota errors */
  }
}

export function totalStars(save: SaveData): number {
  return Object.keys(save.stars).reduce((n, k) => n + (save.stars[k] || 0), 0);
}