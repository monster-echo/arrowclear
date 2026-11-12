import { sys } from 'cc';

export interface SaveData {
  version: 1;
  unlocked: number;
  stars: Record<string, number>;
  coins: number;
  sound: boolean;
  haptics: boolean;
  seenHowto: boolean;
}

const KEY = 'arrowclear.save.v2';

export function defaultSave(): SaveData {
  return {
    version: 1,
    unlocked: 1,
    stars: {},
    coins: 120,
    sound: true,
    haptics: true,
    seenHowto: false,
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