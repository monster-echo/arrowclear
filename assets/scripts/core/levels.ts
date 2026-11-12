import { generateLevel, GenOptions } from './levelgen';
import { Level } from './types';

export interface LevelSpec extends Omit<GenOptions, 'seed'> {
  seed: number;
}

export const LEVEL_COUNT = 60;

/**
 * Difficulty curve.
 *
 * Four chapters, each one a step up in board size, arrow count and "how many
 * moves are obvious at a glance". Within a chapter the arrow count creeps up
 * every level so the last level of a chapter always feels like a small boss.
 */
export function specFor(id: number): LevelSpec {
  const chapter = Math.min(3, Math.floor((id - 1) / 15));
  const step = (id - 1) % 15; // 0..14 inside a chapter
  const t = step / 14;

  const boards = [
    { cols: 8, rows: 12, base: 9, span: 2 },
    { cols: 9, rows: 14, base: 12, span: 3 },
    { cols: 10, rows: 15, base: 14, span: 3 },
    { cols: 11, rows: 17, base: 16, span: 4 },
  ][chapter];

  const targetArrows = Math.round(boards.base + boards.span * t);
  const minLen = [5, 6, 7, 8][chapter];
  const maxLen = [9, 11, 12, 14][chapter];
  const freeTarget = Math.max(2, Math.round(7 - chapter - t * 2));

  return {
    id,
    cols: boards.cols,
    rows: boards.rows,
    targetArrows,
    minLen,
    maxLen,
    freeTarget,
    seed: 100003 + id * 104729,
  };
}

const cache = new Map<number, Level>();

/** Levels are generated deterministically and cached; first call costs ~5ms. */
export function getLevel(id: number): Level {
  const clamped = Math.max(1, Math.min(LEVEL_COUNT, Math.floor(id)));
  const hit = cache.get(clamped);
  if (hit) return hit;
  const level = generateLevel(specFor(clamped));
  level.id = clamped;
  cache.set(clamped, level);
  return level;
}

export function levelName(id: number): string {
  return `第 ${id} 关`;
}