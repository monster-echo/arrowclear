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
  /**
   * Frozen arrows cannot take off (but still block corridors) until 2
   * distinct arrows adjacent to their body have flown away. Optional rule
   * layer: absent/undefined behaves exactly like the classic game.
   */
  frozen?: boolean;
  /**
   * Boss 箭（新算法阶段 1A）：双倍宽（身体每格右侧一格也是它的领地），
   * 头部或头右侧任一条射线畅通即可飞（OR 语义），专属蓝色 + 大眼表情。
   */
  isBoss?: boolean;
}

/** Level pacing variants (rules doc §5). */
export type LevelMode = 'normal' | 'sprint' | 'boss' | 'zen';

export interface Level {
  id: number;
  cols: number;
  rows: number;
  arrows: Arrow[];
  /** Seconds allowed for the level. 0 = no time limit (zen). */
  timeLimit: number;
  seed: number;
  /** Arrow ids in a known-good removal order (last placed = removed first). */
  solution: number[];
  /**
   * Optional silhouette mask (1 = an arrow body may occupy the cell). The grid
   * is still `cols × rows`; corridors may travel through 0-cells to the edge,
   * which is what makes arrows leave through the silhouette boundary.
   */
  mask?: Uint8Array;
  /** Cosmetic silhouette id ("b", "heart", ...). */
  shape?: string;
  /** Pacing variant; "normal" when omitted. */
  mode?: LevelMode;
  /** Boss gauntlet part (1..3) when the level is one part of a 3-part boss. */
  part?: number;
  /** Chapter number (1..25) this level belongs to. */
  chapter?: number;
  /** Chapter-relative step (0..19). */
  step?: number;
}

/** Number of body cells in a level (mask-aware). */
export function bodyCellCount(level: Pick<Level, 'cols' | 'rows' | 'mask'>): number {
  if (!level.mask) return level.cols * level.rows;
  let n = 0;
  for (let i = 0; i < level.mask.length; i++) n += level.mask[i] ? 1 : 0;
  return n;
}

/** True when an arrow body may occupy (x, y). Outside the grid is always false. */
export function isBodyCell(
  level: Pick<Level, 'cols' | 'rows' | 'mask'>,
  x: number,
  y: number,
): boolean {
  if (x < 0 || y < 0 || x >= level.cols || y >= level.rows) return false;
  return level.mask ? level.mask[y * level.cols + x] === 1 : true;
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

/** Boss 箭的影子格：身体每格右侧一格（双倍宽的右半边）。 */
export function bossShadowCells(level: Pick<Level, 'cols' | 'rows'>, arrow: Arrow): Cell[] {
  if (!arrow.isBoss) return [];
  const out: Cell[] = [];
  for (const c of arrow.cells) {
    const x = c.x + 1;
    if (x < level.cols) out.push({ x, y: c.y });
  }
  return out;
}

/**
 * 逃逸判定：普通箭看头部射线；Boss 箭双倍宽，**两条射线（头部列 + 头右侧一列）
 * 必须同时畅通**才能飞（参考实现语义：任一射线被挡即不可飞）。
 */
export function canArrowEscape(
  level: Pick<Level, 'cols' | 'rows'>,
  arrow: Arrow,
  isOccupied: (c: Cell) => boolean,
): boolean {
  const head = arrow.cells[0];
  const d = DIR_VECTORS[arrow.dir];
  const rayClear = (sx: number, sy: number): boolean => {
    let x = sx + d.x;
    let y = sy + d.y;
    while (x >= 0 && y >= 0 && x < level.cols && y < level.rows) {
      if (isOccupied({ x, y })) return false;
      x += d.x;
      y += d.y;
    }
    return true;
  };
  if (!rayClear(head.x, head.y)) return false;
  if (arrow.isBoss && !rayClear(head.x + 1, head.y)) return false;
  return true;
}