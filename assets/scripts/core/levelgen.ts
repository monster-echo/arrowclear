import { Rng } from './rng';
import {
  Arrow,
  Cell,
  Dir,
  DIR_VECTORS,
  Level,
  OPPOSITE,
  cellKey,
  corridorCells,
} from './types';

export interface GenOptions {
  id: number;
  cols: number;
  rows: number;
  /** How many arrows we would like to place. The builder may stop earlier. */
  targetArrows: number;
  minLen: number;
  maxLen: number;
  /** Preferred number of arrows that are already free when the level starts. */
  freeTarget: number;
  seed: number;
  timeLimit?: number;
}

export interface LevelStats {
  arrows: number;
  freeAtStart: number;
  fillRatio: number;
  avgLength: number;
  turns: number;
}

/**
 * Levels are built backwards from the removal order.
 *
 * If arrows are removed A1, A2, ... An, then the corridor of Ai only has to be
 * free of the bodies of A(i+1..n). We therefore place An first (no constraint),
 * then A(n-1) (its corridor must avoid An) and so on. The resulting level is
 * guaranteed solvable, and it naturally contains long dependency chains:
 * early-placed arrows sit in the corridors of the ones placed after them.
 *
 * Because removing an arrow can only free cells, the game is monotone — any
 * legal move keeps the level solvable. That is what makes the "tap and watch"
 * loop feel fair: a blocked tap is always the player's mistake, never a trap.
 */
class Builder {
  readonly cols: number;
  readonly rows: number;
  readonly body: Int16Array;
  readonly placed: Arrow[] = [];
  readonly corridors: Cell[][] = [];

  constructor(cols: number, rows: number) {
    this.cols = cols;
    this.rows = rows;
    this.body = new Int16Array(cols * rows).fill(-1);
  }

  private idx(x: number, y: number): number {
    return y * this.cols + x;
  }

  ownerAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return -1;
    return this.body[this.idx(x, y)];
  }

  private isFree(x: number, y: number): boolean {
    return this.ownerAt(x, y) === -1;
  }

  /**
   * Grow a self-avoiding path backwards from the head.
   * `forbidden` holds the cells in front of the head so an arrow never doubles
   * back onto its own exit lane.
   */
  buildPath(head: Cell, dir: Dir, length: number, rng: Rng): Cell[] | null {
    const forbidden = new Set<number>();
    for (const c of this.frontCells(head, dir)) forbidden.add(cellKey(c));

    const path: Cell[] = [{ x: head.x, y: head.y }];
    const used = new Set<number>([cellKey(head)]);
    let cur = head;
    let last: Dir = OPPOSITE[dir];

    while (path.length < length) {
      const candidates: Dir[] = [];
      const weights: number[] = [];
      const dirs: Dir[] = [last, ((last + 1) % 4) as Dir, ((last + 3) % 4) as Dir];
      const w = [0.62, 0.19, 0.19];
      for (let i = 0; i < 3; i++) {
        const d = dirs[i];
        const v = DIR_VECTORS[d];
        const nx = cur.x + v.x;
        const ny = cur.y + v.y;
        if (nx < 0 || ny < 0 || nx >= this.cols || ny >= this.rows) continue;
        const key = cellKey({ x: nx, y: ny });
        if (used.has(key) || forbidden.has(key)) continue;
        if (!this.isFree(nx, ny)) continue;
        candidates.push(d);
        weights.push(w[i]);
      }
      if (!candidates.length) break;
      const pick = rng.weighted(candidates, weights);
      const v = DIR_VECTORS[pick];
      cur = { x: cur.x + v.x, y: cur.y + v.y };
      path.push(cur);
      used.add(cellKey(cur));
      last = pick;
    }

    return path.length >= 2 ? path : null;
  }

  frontCells(head: Cell, dir: Dir): Cell[] {
    const out: Cell[] = [];
    const v = DIR_VECTORS[dir];
    let x = head.x + v.x;
    let y = head.y + v.y;
    while (x >= 0 && y >= 0 && x < this.cols && y < this.rows) {
      out.push({ x, y });
      x += v.x;
      y += v.y;
    }
    return out;
  }

  /** Corridor free of every body already on the board? */
  private corridorClear(head: Cell, dir: Dir): Cell[] | null {
    const cells = this.frontCells(head, dir);
    for (const c of cells) {
      if (!this.isFree(c.x, c.y)) return null;
    }
    return cells;
  }

  private commit(cells: Cell[], dir: Dir, corridor: Cell[], color: number): Arrow {
    const arrow: Arrow = {
      id: this.placed.length,
      color,
      cells: cells.map((c) => ({ x: c.x, y: c.y })),
      dir,
    };
    for (const c of cells) this.body[this.idx(c.x, c.y)] = arrow.id;
    this.placed.push(arrow);
    this.corridors.push(corridor);
    return arrow;
  }

  /**
   * Add one arrow in the "chain" phase. Tries many candidates and keeps the
   * one that packs the most body cells while leaving a decent exit lane.
   */
  addChained(rng: Rng, minLen: number, maxLen: number): boolean {
    let best: { cells: Cell[]; dir: Dir; corridor: Cell[]; score: number } | null = null;
    const tries = Math.min(220, this.cols * this.rows * 2);

    for (let t = 0; t < tries; t++) {
      const x = rng.int(this.cols);
      const y = rng.int(this.rows);
      if (!this.isFree(x, y)) continue;
      const head = { x, y };
      const dir = rng.int(4) as Dir;
      const corridor = this.corridorClear(head, dir);
      if (!corridor) continue;

      const length = rng.range(minLen, maxLen);
      const cells = this.buildPath(head, dir, length, rng);
      if (!cells) continue;

      let turns = 0;
      for (let i = 2; i < cells.length; i++) {
        const a = cells[i - 1];
        const b = cells[i - 2];
        if (a.x - b.x !== cells[i].x - a.x || a.y - b.y !== cells[i].y - a.y) turns++;
      }
      // Prefer long arrows, some wiggle, and a tight (but non-zero) exit lane.
      const score =
        cells.length * 2.6 +
        turns * 0.35 +
        Math.min(corridor.length, 6) * 0.15 +
        rng.next() * 1.4;
      if (!best || score > best.score) best = { cells, dir, corridor, score };
    }

    if (!best) return false;
    this.commit(best.cells, best.dir, best.corridor, 0);
    return true;
  }

  /**
   * Add a short arrow whose exit lane is completely clear: a "free" arrow that
   * gives the player an obvious first move.
   */
  addFreeFiller(rng: Rng, minLen: number, maxLen: number): boolean {
    for (let t = 0; t < 220; t++) {
      const x = rng.int(this.cols);
      const y = rng.int(this.rows);
      if (!this.isFree(x, y)) continue;
      const head = { x, y };
      // Bias towards border heads so the lane is short and obviously open.
      const dir = rng.int(4) as Dir;
      const corridor = this.corridorClear(head, dir);
      if (!corridor) continue;
      const length = rng.range(2, Math.min(5, Math.max(3, maxLen)));
      const cells = this.buildPath(head, dir, length, rng);
      if (!cells) continue;
      this.commit(cells, dir, corridor, 0);
      return true;
    }
    return false;
  }

  finalize(): Level {
    const arrows = this.placed;
    assignColors(arrows, this.cols, this.rows);
    const order = arrows.map((a) => a.id).reverse();
    return {
      id: 0,
      cols: this.cols,
      rows: this.rows,
      arrows,
      timeLimit: 0,
      seed: 0,
      solution: order,
    };
  }
}

/** Greedy graph colouring so neighbouring arrows never share a colour. */
function assignColors(arrows: Arrow[], cols: number, rows: number): void {
  const paletteSize = 9;
  const owners = new Int16Array(cols * rows).fill(-1);
  for (const a of arrows) {
    for (const c of a.cells) owners[c.y * cols + c.x] = a.id;
  }

  const neighbours: Set<number>[] = arrows.map(() => new Set<number>());
  for (const a of arrows) {
    for (const c of a.cells) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = c.x + dx;
          const y = c.y + dy;
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          const other = owners[y * cols + x];
          if (other >= 0 && other !== a.id) neighbours[a.id].add(other);
        }
      }
    }
  }

  const used = new Array<number>(paletteSize).fill(0);
  const order = arrows
    .map((a) => a.id)
    .sort((a, b) => neighbours[b].size - neighbours[a].size);

  for (const id of order) {
    const taken = new Set<number>();
    for (const n of neighbours[id]) {
      const other = arrows[n];
      if (other && typeof other.color === 'number') taken.add(other.color);
    }
    let best = -1;
    let bestUses = Infinity;
    for (let c = 0; c < paletteSize; c++) {
      if (taken.has(c)) continue;
      if (used[c] < bestUses) {
        bestUses = used[c];
        best = c;
      }
    }
    if (best < 0) {
      // Fully surrounded: pick the least used colour anyway.
      best = used.indexOf(Math.min(...used));
    }
    arrows[id].color = best;
    used[best]++;
  }
}

export function arrowsFreeAtStart(level: Level): number {
  let free = 0;
  const occ = new Set<number>();
  for (const a of level.arrows) for (const c of a.cells) occ.add(cellKey(c));
  for (const a of level.arrows) {
    const cor = corridorCells(level, a);
    if (cor.every((c) => !occ.has(cellKey(c)))) free++;
  }
  return free;
}

export function analyzeLevel(level: Level): LevelStats {
  let cells = 0;
  let turns = 0;
  for (const a of level.arrows) {
    cells += a.cells.length;
    for (let i = 2; i < a.cells.length; i++) {
      const p = a.cells[i - 2];
      const q = a.cells[i - 1];
      const r = a.cells[i];
      if (q.x - p.x !== r.x - q.x || q.y - p.y !== r.y - q.y) turns++;
    }
  }
  return {
    arrows: level.arrows.length,
    freeAtStart: arrowsFreeAtStart(level),
    fillRatio: cells / (level.cols * level.rows),
    avgLength: cells / Math.max(1, level.arrows.length),
    turns,
  };
}

function tryGenerate(opts: GenOptions): Level | null {
  const rng = new Rng(opts.seed);
  const b = new Builder(opts.cols, opts.rows);

  let guard = 0;
  while (b.placed.length < opts.targetArrows && guard++ < opts.targetArrows * 4) {
    if (!b.addChained(rng, opts.minLen, opts.maxLen)) break;
  }

  // Top up with obviously-open arrows when the board is short on easy moves.
  let freeCount = countFree(b);
  let fillerGuard = 0;
  while (freeCount < opts.freeTarget && fillerGuard++ < 40) {
    if (!b.addFreeFiller(rng, opts.minLen, opts.maxLen)) break;
    freeCount = countFree(b);
  }

  if (b.placed.length < Math.max(6, Math.floor(opts.targetArrows * 0.55))) return null;

  const level = b.finalize();
  level.id = opts.id;
  level.seed = opts.seed;
  level.arrows.forEach((a, i) => (a.id = i));
  level.timeLimit =
    opts.timeLimit ?? Math.round((level.arrows.length * 8.5 + 30) / 5) * 5;

  if (!solveGreedy(level).solved) return null;
  return level;
}

function countFree(b: Builder): number {
  let free = 0;
  for (let i = 0; i < b.placed.length; i++) {
    if (b.corridors[i].every((c) => b.ownerAt(c.x, c.y) === -1)) free++;
  }
  return free;
}

/**
 * Remove any free arrow until the board is empty. Because every move only
 * frees cells, a greedy pass is a complete solvability test.
 */
export function solveGreedy(level: Level): { solved: boolean; order: number[] } {
  const alive = new Set(level.arrows.map((a) => a.id));
  const occ = new Set<number>();
  for (const a of level.arrows) for (const c of a.cells) occ.add(cellKey(c));
  const order: number[] = [];

  let progress = true;
  while (progress && alive.size > 0) {
    progress = false;
    for (const a of level.arrows) {
      if (!alive.has(a.id)) continue;
      const cor = corridorCells(level, a);
      if (cor.some((c) => occ.has(cellKey(c)))) continue;
      for (const c of a.cells) occ.delete(cellKey(c));
      alive.delete(a.id);
      order.push(a.id);
      progress = true;
    }
  }
  return { solved: alive.size === 0, order };
}

export function generateLevel(opts: GenOptions): Level {
  let best: Level | null = null;
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < 18; attempt++) {
    const seed = opts.seed + attempt * 7919;
    const level = tryGenerate({ ...opts, seed });
    if (!level) continue;

    const stats = analyzeLevel(level);
    const freePenalty =
      stats.freeAtStart > opts.freeTarget + 3
        ? (stats.freeAtStart - opts.freeTarget) * 2.2
        : 0;
    const countPenalty = Math.max(0, opts.targetArrows - stats.arrows) * 1.5;
    const score =
      stats.fillRatio * 100 +
      stats.arrows * 0.8 -
      freePenalty -
      countPenalty +
      Math.min(stats.turns, 60) * 0.25;

    if (score > bestScore) {
      bestScore = score;
      best = level;
    }
  }

  if (!best) {
    // The requested density was not reachable: relax and try again. Keeps the
    // game playable even if a level spec is tuned too aggressively.
    if (opts.targetArrows > 10) {
      return generateLevel({ ...opts, targetArrows: Math.floor(opts.targetArrows * 0.82) });
    }
    throw new Error(`level generation failed for seed ${opts.seed}`);
  }
  return best;
}