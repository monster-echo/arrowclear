/**
 * Core data types for "Arrow Clear" (一箭清空).
 *
 * The whole game rule set lives in this folder and is engine-agnostic:
 *  - the Cocos Creator project imports it directly,
 *  - the HTML5 playable preview bundles it with esbuild,
 *  - unit tests / level validators run it in plain Node.
 */

/** 0 = up, 1 = right, 2 = down, 3 = left (screen space, y grows downwards). */
export type Dir = 0 | 1 | 2 | 3;

export interface Cell {
  x: number;
  y: number;
}

export const DIR_VECTORS: readonly Cell[] = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export const OPPOSITE: readonly Dir[] = [2, 3, 0, 1];

export const DIR_NAMES: readonly string[] = ['up', 'right', 'down', 'left'];

export interface Arrow {
  id: number;
  /** Index into the cosmetic palette. */
  color: number;
  /** Body cells, head first, tail last. Always length >= 2. */
  cells: Cell[];
  /** Facing direction of the arrow head. */
  dir: Dir;
}

export interface Level {
  id: number;
  cols: number;
  rows: number;
  arrows: Arrow[];
  /** Seconds allowed for the level. */
  timeLimit: number;
  seed: number;
  /** Arrow ids in a known-good removal order (last placed = removed first). */
  solution: number[];
}

export function cellKey(c: Cell): number {
  return c.y * 4096 + c.x;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

/** Cells strictly in front of `arrow` up to the board edge, in travel order. */
export function corridorCells(level: Pick<Level, 'cols' | 'rows'>, arrow: Arrow): Cell[] {
  const out: Cell[] = [];
  const d = DIR_VECTORS[arrow.dir];
  let x = arrow.cells[0].x + d.x;
  let y = arrow.cells[0].y + d.y;
  while (x >= 0 && y >= 0 && x < level.cols && y < level.rows) {
    out.push({ x, y });
    x += d.x;
    y += d.y;
  }
  return out;
}