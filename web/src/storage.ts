import { fullEnergy } from '../../assets/scripts/core/energy';

export interface SaveData {
  version: 1;
  unlocked: number;
  stars: Record<string, number>;
  /** 剩余提示次数：初始 3 次，看一次激励广告 +1 次（HINTS_PER_AD）。 */
  hints: number;
  /** 体力（0..ENERGY_MAX），见 core/energy.ts。 */
  energy: number;
  /** 上次体力变动/触顶时刻（ms epoch），离线恢复用现算。 */
  energyAt: number;
  sound: boolean;
  music: boolean;
  haptics: boolean;
  seenHowto: boolean;
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
    music: true,
    haptics: true,
    seenHowto: false,
    chapterPasses: {},
  };
}

export function loadSave(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultSave();
    const parsed = JSON.parse(raw) as Partial<SaveData>;
    return { ...defaultSave(), ...parsed, version: 1 };
  } catch {
    return defaultSave();
  }
}

export function persist(save: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(save));
  } catch {
    /* private mode / quota — ignore */
  }
}

export function totalStars(save: SaveData): number {
  return Object.values(save.stars).reduce((n, v) => n + (v || 0), 0);
}