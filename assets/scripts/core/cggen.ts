/**
 * cggen.ts — compositional generator for high-deduction "tangled" levels.
 *
 * 与 levelgen(反向构造)的根本区别:
 *  - levelgen 要求每支箭落位时航道干净,航道还被偏好得越短越好,于是阻挡
 *    只能发生在近身、一眼看穿 —— 没有"解密感";
 *  - cggen 允许箭身落在任何已有箭的航道上(这正是"纠缠"),只要求放置后
 *    依赖图仍是 DAG。无环 ⟺ 必有解(拓扑序即一个解),所以每放一条做
 *    一次环检测就能一边乱撒一边保证可解。
 *
 * 三层结构:
 *   1. 构图单元(motif)装配:口袋套娃 / 总闸 fan-in / 远距深链 / 多重门,
 *      "包含"与"纠缠"是设计出来的,不是碰运气;
 *   2. 背景增量填充:2~6 格短线随机撒,把棋盘织密;
 *   3. 收尾:相邻空格对放 2 格箭、孤立空格延长相邻箭尾,逼近满盘。
 */

import { Rng } from './rng';
import { assignColors, solveGreedy } from './levelgen';
import {
  Arrow,
  Cell,
  corridorCells,
  DIR_VECTORS,
  Dir,
  Level,
  OPPOSITE,
} from './types';

export interface CgSpec {
  id: number;
  cols: number;
  rows: number;
  seed: number;
  arrowsTarget: number;
  minLen: number;
  maxLen: number;
  /** 口袋套娃层数:中心箭外层层包裹。 */
  pocketDepth: number;
  /** 远距深链长度:A1 被 A2 挡、A2 被 A3 挡…… */
  chainLen: number;
  /** 总闸组数:一支闸箭锁住多支箭,飞走瞬间连锁释放。 */
  faninCount: number;
  /** 多重门:一支箭的航道上横多支互相独立的门。 */
  gateDoors: number;
  fillTarget: number;
}

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

class CgBoard {
  readonly body: Int16Array;
  readonly arrows: Arrow[] = [];

  constructor(readonly cols: number, readonly rows: number) {
    this.body = new Int16Array(cols * rows).fill(-1);
  }

  private idx(x: number, y: number): number {
    return y * this.cols + x;
  }

  free(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return false;
    return this.body[this.idx(x, y)] === -1;
  }

  ownerAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) return -1;
    return this.body[this.idx(x, y)];
  }

  place(cells: Cell[], dir: Dir): Arrow {
    const arrow: Arrow = { id: this.arrows.length, color: 0, cells, dir };
    for (const c of cells) this.body[this.idx(c.x, c.y)] = arrow.id;
    this.arrows.push(arrow);
    return arrow;
  }

  /** Roll back the most recent place() call. */
  unplace(): void {
    const a = this.arrows.pop();
    if (!a) return;
    for (const c of a.cells) this.body[this.idx(c.x, c.y)] = -1;
  }

  /** Ids of arrows whose bodies sit inside `a`'s corridor. */
  blockersOf(a: Arrow): number[] {
    const out = new Set<number>();
    for (const c of corridorCells(this, a)) {
      const o = this.body[this.idx(c.x, c.y)];
      if (o !== -1 && o !== a.id) out.add(o);
    }
    return [...out];
  }

  /**
   * Dependency edge A → B means "A waits for B" (B's body blocks A's lane).
   * A level is solvable iff this graph is acyclic, checked with Kahn's
   * algorithm after every placement — cheap at ≤ 45 arrows.
   */
  acyclic(): boolean {
    const n = this.arrows.length;
    const indeg = new Int32Array(n);
    const adj: number[][] = Array.from({ length: n }, () => []);
    for (const a of this.arrows) {
      for (const b of this.blockersOf(a)) {
        adj[a.id].push(b);
        indeg[b]++;
      }
    }
    let seen = 0;
    const stack: number[] = [];
    for (let i = 0; i < n; i++) if (indeg[i] === 0) stack.push(i);
    while (stack.length) {
      const u = stack.pop() as number;
      seen++;
      for (const v of adj[u]) if (--indeg[v] === 0) stack.push(v);
    }
    return seen === n;
  }
}

// ---------------------------------------------------------------------------
// Body growth
// ---------------------------------------------------------------------------

interface GrowOpts {
  /** Probability weight of bending on each step after the mandatory stem. */
  bend: number;
  /** When true the body must reach exactly `len` cells or fail. */
  exact: boolean;
  /** After this many straight cells in a row, turning becomes near-certain. */
  maxRun?: number;
}

/**
 * Grow a self-avoiding body backwards from `head`, tail first step along
 * OPPOSITE[dir] so the head segment always matches `dir` (house rule).
 * The body never enters its own corridor. Unlike levelgen, the corridor may
 * be full of other arrows — tangling is the point.
 */
function growBody(
  b: CgBoard,
  head: Cell,
  dir: Dir,
  len: number,
  rng: Rng,
  opts: GrowOpts,
): Cell[] | null {
  const forbid = new Set<number>();
  {
    const v = DIR_VECTORS[dir];
    let x = head.x + v.x;
    let y = head.y + v.y;
    while (x >= 0 && y >= 0 && x < b.cols && y < b.rows) {
      forbid.add(y * b.cols + x);
      x += v.x;
      y += v.y;
    }
  }

  const path: Cell[] = [{ x: head.x, y: head.y }];
  const used = new Set<number>([head.y * b.cols + head.x]);
  let cur = head;
  let last: Dir = OPPOSITE[dir];
  let run = 0; // consecutive straight cells since the last turn

  while (path.length < len) {
    const stem = path.length <= 2; // head + first body cell must be straight
    const cands: Dir[] = stem
      ? [last]
      : [last, ((last + 1) % 4) as Dir, ((last + 3) % 4) as Dir];
    const base: number[] = stem ? [1] : [1 - opts.bend, opts.bend / 2, opts.bend / 2];
    // Long straight runs look like rulers, not snakes: past maxRun the
    // straight option nearly vanishes so bodies take an L/S silhouette.
    const straightDamped = !stem && run >= (opts.maxRun ?? 3);

    const opts_: Dir[] = [];
    const ws: number[] = [];
    for (let i = 0; i < cands.length; i++) {
      const v = DIR_VECTORS[cands[i]];
      const nx = cur.x + v.x;
      const ny = cur.y + v.y;
      if (nx < 0 || ny < 0 || nx >= b.cols || ny >= b.rows) continue;
      const k = ny * b.cols + nx;
      if (used.has(k) || forbid.has(k)) continue;
      if (!b.free(nx, ny)) continue;
      opts_.push(cands[i]);
      ws.push(i === 0 && straightDamped ? base[i] * 0.12 : base[i]);
    }
    if (!opts_.length) {
      if (opts.exact) return null;
      break;
    }
    const pick = rng.weighted(opts_, ws);
    const v = DIR_VECTORS[pick];
    cur = { x: cur.x + v.x, y: cur.y + v.y };
    path.push(cur);
    used.add(cur.y * b.cols + cur.x);
    run = pick === last ? run + 1 : 0;
    last = pick;
  }
  return path.length >= 2 ? path : null;
}

/** Place one arrow; reject when the placement would create a dependency cycle. */
function tryPlace(
  b: CgBoard,
  rng: Rng,
  head: Cell,
  dir: Dir,
  len: number,
  opts: GrowOpts,
): Arrow | null {
  const cells = growBody(b, head, dir, len, rng, opts);
  if (!cells) return null;
  b.place(cells, dir);
  if (!b.acyclic()) {
    b.unplace();
    return null;
  }
  return b.arrows[b.arrows.length - 1];
}

// ---------------------------------------------------------------------------
// Motifs — the designed "tangle" structures
// ---------------------------------------------------------------------------

function dirOf(dx: number, dy: number): Dir {
  if (dx > 0) return 1;
  if (dx < 0) return 3;
  if (dy > 0) return 2;
  return 0;
}

/**
 * Put a "door" across `target`'s corridor: a short wall whose body covers a
 * corridor cell `gapMin..gapMax` squares ahead. The wall juts perpendicular
 * to the corridor so it visually cups the target. Returns null when no spot
 * fits without making the dependency graph cyclic.
 */
function placeDoor(
  b: CgBoard,
  rng: Rng,
  target: Arrow,
  gapMin: number,
  gapMax: number,
  lenMin = 2,
  lenMax = 4,
): Arrow | null {
  const cor = corridorCells(b, target);
  if (cor.length < 3) return null;
  // Shrink the requested gap window to what this corridor can actually host,
  // so short lanes still get a (nearer) door instead of nothing.
  const lo = Math.min(gapMin, Math.max(2, Math.floor((cor.length - 1) * 0.4)));
  const hi = Math.max(lo, Math.min(gapMax, cor.length - 1));
  const spots: number[] = [];
  for (let i = lo; i <= hi; i++) {
    if (b.free(cor[i].x, cor[i].y)) spots.push(i);
  }
  rng.shuffle(spots);

  for (const i of spots) {
    const c = cor[i];
    // Doors prefer to jut perpendicular to the lane (visually a cup/wall),
    // but may also lie along it when that is the only acyclic option.
    const facings: Dir[] = [
      ((target.dir + 1) % 4) as Dir,
      ((target.dir + 3) % 4) as Dir,
      target.dir,
      OPPOSITE[target.dir],
    ];
    rng.shuffle(facings.slice(0, 2));
    for (const p of facings) {
      const pv = DIR_VECTORS[p];
      for (const s of [1, -1]) {
        const dx = pv.x * s;
        const dy = pv.y * s;
        // L-shaped doors first (leg + hook), straight sticks last.
        const turns: Array<[number, number]> = [
          [-dy, dx],
          [dy, -dx],
          [0, 0],
        ];
        for (let leg = lenMax; leg >= lenMin; leg--) {
          for (const [tx, ty] of turns) {
            for (const hook of [2, 1, 0]) {
              if (tx === 0 && ty === 0 && hook > 0) continue;
              const cells: Cell[] = [];
              const seen = new Set<number>();
              let ok = true;
              const push = (x: number, y: number) => {
                const k = y * b.cols + x;
                if (!b.free(x, y) || seen.has(k)) {
                  ok = false;
                  return;
                }
                seen.add(k);
                cells.push({ x, y });
              };
              push(c.x, c.y);
              for (let j = 1; ok && j < leg; j++) push(c.x - dx * j, c.y - dy * j);
              for (let j = 0; ok && j < hook; j++) {
                push(c.x - dx * (leg - 1) + tx * (j + 1), c.y - dy * (leg - 1) + ty * (j + 1));
              }
              if (!ok || cells.length < lenMin) continue;
              // Head sits on the corridor cell; the wall hooks behind it.
              b.place(cells, dirOf(dx, dy));
              if (b.acyclic()) return b.arrows[b.arrows.length - 1];
              b.unplace();
            }
          }
        }
      }
    }
  }
  return null;
}

function randomEmptyCell(b: CgBoard, rng: Rng): Cell | null {
  const empties: Cell[] = [];
  for (let y = 0; y < b.rows; y++) {
    for (let x = 0; x < b.cols; x++) {
      if (b.free(x, y)) empties.push({ x, y });
    }
  }
  if (!empties.length) return null;
  return rng.pick(empties);
}

/**
 * Pick a facing that keeps the four directions roughly balanced. A board
 * dominated by one or two facings reads as noise, not as lanes to deduce.
 */
function pickBalancedDir(b: CgBoard, rng: Rng): Dir {
  const counts = [0, 0, 0, 0];
  for (const a of b.arrows) counts[a.dir]++;
  const maxC = Math.max(...counts);
  const weights = counts.map((c) => 1 + (maxC - c) * 0.9);
  return rng.weighted([0, 1, 2, 3] as Dir[], weights);
}

/**
 * Pocket nesting: a short target T plus `depth` shells, each shell a door
 * across the previous arrow's corridor several squares out. Visually the
 * inner arrow appears wrapped; releasing it peels shell after shell.
 */
function placePocket(b: CgBoard, rng: Rng, depth: number): Arrow[] {
  const head = randomEmptyCell(b, rng);
  if (!head) return [];
  const t = tryPlace(b, rng, head, pickBalancedDir(b, rng), rng.range(3, 5), {
    bend: 0.58,
    exact: false,
    maxRun: 2,
  });
  if (!t) return [];

  const placed = [t];
  let cur = t;
  for (let d = 0; d < depth; d++) {
    const shell = placeDoor(b, rng, cur, 3, 8, 3, 7);
    if (!shell) break;
    placed.push(shell);
    cur = shell;
  }
  return placed;
}

/**
 * Far blockade chain: A1 waits on A2 waits on A3 … with the doors planted far
 * down each corridor (gap 4..12). Every link is a long-range trap: the lane
 * *looks* open until the eye travels far enough. The chain starter prefers a
 * long open lane so the chain has room to snake.
 */
function placeChain(b: CgBoard, rng: Rng, len: number): Arrow[] {
  let first: Arrow | null = null;
  for (let attempt = 0; attempt < 20 && !first; attempt++) {
    const head = randomEmptyCell(b, rng);
    if (!head) return [];
    // Pick the facing with the longest open corridor from this cell.
    let bestDir = rng.int(4) as Dir;
    let bestLen = -1;
    for (let d = 0 as Dir; d < 4; d = (d + 1) as Dir) {
      const l = corridorCells(b, { cells: [head], dir: d } as Arrow).length;
      if (l > bestLen) {
        bestLen = l;
        bestDir = d as Dir;
      }
    }
    if (bestLen < 6) continue;
    first = tryPlace(b, rng, head, bestDir, rng.range(4, 6), {
      bend: 0.58,
      exact: false,
      maxRun: 2,
    });
  }
  if (!first) return [];

  const placed = [first];
  let cur = first;
  for (let i = 1; i < len; i++) {
    const door = placeDoor(b, rng, cur, 4, 12, 3, 8);
    if (!door) break;
    placed.push(door);
    cur = door;
  }
  return placed;
}

/**
 * Master gate (fan-in): one gate arrow Z plus k waiters aimed straight at Z's
 * body. Every waiter's corridor is blocked by Z — and only by Z — so the
 * moment Z flies the waiters cascade out together.
 */
function placeFanIn(
  b: CgBoard,
  rng: Rng,
  k: number,
): { gate: Arrow; waits: Arrow[] } | null {
  for (let attempt = 0; attempt < 24; attempt++) {
    const head = randomEmptyCell(b, rng);
    if (!head) return null;
    const gate = tryPlace(b, rng, head, rng.int(4) as Dir, rng.range(2, 3), {
      bend: 0,
      exact: false,
    });
    if (!gate) continue;

    const waits: Arrow[] = [];
    const anchor = gate.cells[gate.cells.length - 1];
    const dirs = rng.shuffle([0, 1, 2, 3] as Dir[]);
    for (const v of dirs) {
      for (let dist = 1; dist <= 3 && waits.length < k; dist++) {
        const wv = DIR_VECTORS[v];
        const wHead = { x: anchor.x + wv.x * dist, y: anchor.y + wv.y * dist };
        if (!b.free(wHead.x, wHead.y)) continue;
        const w = tryPlace(b, rng, wHead, OPPOSITE[v], rng.range(2, 3), {
          bend: 0,
          exact: false,
        });
        if (!w) continue;
        // The waiter must be blocked by the gate (and nothing else), so the
        // gate's departure triggers a clean cascade.
        const blockers = b.blockersOf(w);
        if (blockers.length === 1 && blockers[0] === gate.id) waits.push(w);
        else b.unplace();
      }
    }
    if (waits.length >= Math.min(2, k)) return { gate, waits };
    // Roll the whole motif back and try another spot.
    while (b.arrows.length && b.arrows[b.arrows.length - 1].id !== gate.id) b.unplace();
    b.unplace();
  }
  return null;
}

/**
 * Multi-gate lane: a long target whose corridor is fenced by several
 * independent doors, so freeing it requires clearing every one of them.
 */
function placeGates(b: CgBoard, rng: Rng, doors: number): Arrow[] {
  const head = randomEmptyCell(b, rng);
  if (!head) return [];
  const target = tryPlace(b, rng, head, pickBalancedDir(b, rng), rng.range(4, 6), {
    bend: 0.58,
    exact: false,
    maxRun: 2,
  });
  if (!target) return [];

  const placed = [target];
  for (let i = 0; i < doors; i++) {
    const door = placeDoor(b, rng, target, 2, 11, 3, 7);
    if (!door) break;
    placed.push(door);
  }
  return placed;
}

// ---------------------------------------------------------------------------
// Background fill & gap closing
// ---------------------------------------------------------------------------

function fillBackground(b: CgBoard, rng: Rng, spec: CgSpec): void {
  let guard = spec.arrowsTarget * 80;
  while (b.arrows.length < spec.arrowsTarget && guard-- > 0) {
    const head = randomEmptyCell(b, rng);
    if (!head) return;
    const dir = pickBalancedDir(b, rng);
    // Long arrows read as "paths" — the deduction is seeing WHO crosses WHOM,
    // which needs room to look along a lane, not a wall-to-wall carpet.
    const lens: number[] = [];
    const ws: number[] = [];
    for (let l = spec.minLen; l <= spec.maxLen; l++) {
      lens.push(l);
      ws.push(l <= spec.minLen + 1 ? 1.6 : l >= spec.maxLen - 1 ? 1.1 : 2.4);
    }
    const len = rng.weighted(lens, ws);
    tryPlace(b, rng, head, dir, len, { bend: 0.58, exact: false, maxRun: 2 });
  }
}

function listEmpty(b: CgBoard): Cell[] {
  const out: Cell[] = [];
  for (let y = 0; y < b.rows; y++) {
    for (let x = 0; x < b.cols; x++) {
      if (b.free(x, y)) out.push({ x, y });
    }
  }
  return out;
}

/**
 * Close gaps by extending neighbouring arrows' tails. Leftover empties stay
 * empty on purpose: breathing room along lanes is what makes "who blocks
 * whom" readable instead of a wall-to-wall carpet of fragments.
 */
function fillGaps(b: CgBoard, rng: Rng): void {
  let progress = true;
  while (progress) {
    progress = false;
    for (const c of listEmpty(b)) {
      if (!b.free(c.x, c.y)) continue;
      for (const d of rng.shuffle([0, 1, 2, 3] as Dir[])) {
        const v = DIR_VECTORS[d];
        const ownerId = b.ownerAt(c.x + v.x, c.y + v.y);
        if (ownerId < 0) continue;
        const owner = b.arrows[ownerId];
        const tail = owner.cells[owner.cells.length - 1];
        if (tail.x !== c.x + v.x || tail.y !== c.y + v.y) continue;
        // One snake may not swallow the whole board rim.
        if (owner.cells.length >= 12) continue;
        if (owner.cells.some((s) => s.x === c.x && s.y === c.y)) continue;
        if (corridorCells(b, owner).some((s) => s.x === c.x && s.y === c.y)) continue;
        // Extending a 2-cell arrow to 3 must keep its head stem straight.
        if (owner.cells.length === 2) {
          const tx = owner.cells[1].x - owner.cells[0].x;
          const ty = owner.cells[1].y - owner.cells[0].y;
          if (c.x !== owner.cells[1].x + tx || c.y !== owner.cells[1].y + ty) continue;
        }

        const key = c.y * b.cols + c.x;
        owner.cells.push({ x: c.x, y: c.y });
        b.body[key] = owner.id;
        if (b.acyclic()) {
          progress = true;
          break;
        }
        owner.cells.pop();
        b.body[key] = -1;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface CgMotifReport {
  pocketArrows: number;
  chainArrows: number;
  gateArrows: number;
  faninWaits: number;
}

export function generateCgLevel(
  spec: CgSpec,
): (Level & { motifs: CgMotifReport }) | null {
  const rng = new Rng(spec.seed);
  const b = new CgBoard(spec.cols, spec.rows);

  // 1) Designed tangles first, on an open board where they have room to nest.
  const pocket = placePocket(b, rng, spec.pocketDepth);
  const chain = placeChain(b, rng, spec.chainLen);
  let faninWaits = 0;
  for (let i = 0; i < spec.faninCount; i++) {
    const f = placeFanIn(b, rng, 3 + (i & 1));
    if (f) faninWaits += f.waits.length;
  }
  const gates = placeGates(b, rng, spec.gateDoors);

  // 2) Weave the background: short arrows anywhere, cycle-checked per drop.
  fillBackground(b, rng, spec);
  // 3) Close in on a full board.
  fillGaps(b, rng);

  if (b.arrows.length < spec.arrowsTarget * 0.6) return null;

  const arrows = b.arrows;
  assignColors(arrows, spec.cols, spec.rows);
  const level: Level & { motifs: CgMotifReport } = {
    id: spec.id,
    cols: spec.cols,
    rows: spec.rows,
    arrows,
    timeLimit: 0,
    seed: spec.seed,
    solution: [],
    motifs: {
      pocketArrows: pocket.length,
      chainArrows: chain.length,
      gateArrows: gates.length,
      faninWaits,
    },
  };
  const greedy = solveGreedy(level);
  if (!greedy.solved) return null; // Cannot happen while acyclic() holds; guard anyway.
  level.solution = greedy.order;
  return level;
}

// ---------------------------------------------------------------------------
// Puzzle metrics — quantify the "deduction feel"
// ---------------------------------------------------------------------------

export interface PuzzleMetrics {
  arrows: number;
  fill: number;
  /** Average body length — short arrow soup reads as noise, not lanes. */
  avgLen: number;
  /** Share of arrows with at least one bend (L/S silhouettes). */
  turnRatio: number;
  /** Largest share of any single facing (0.25 = perfectly balanced). */
  dirSkew: number;
  solved: boolean;
  /** Longest chain in the initial dependency graph (wait-for depth). */
  depth: number;
  freeAtStart: number;
  /** Free-arrow count before each removal while replaying a greedy solve. */
  minFree: number;
  avgFree: number;
  maxFree: number;
  /** Arrows whose nearest blocker sits >=5 cells out (long-range traps). */
  traps: number;
  /** Biggest jump in free arrows after one removal (cascade size - 1). */
  waterfall: number;
  /** Steps in the greedy solve. */
  steps: number;
}

export function puzzleMetrics(level: Level): PuzzleMetrics {
  const n = level.arrows.length;
  const blockers: number[][] = level.arrows.map((a) => {
    const occ = new Map<number, number>();
    for (const other of level.arrows) {
      if (other.id === a.id) continue;
      for (const c of other.cells) occ.set(c.y * level.cols + c.x, other.id);
    }
    const out = new Set<number>();
    for (const c of corridorCells(level, a)) {
      const o = occ.get(c.y * level.cols + c.x);
      if (o !== undefined) out.add(o);
    }
    return [...out];
  });

  // Longest path in the dependency DAG (memoised DFS).
  const memo = new Int32Array(n).fill(-1);
  const depAt = (id: number): number => {
    if (memo[id] >= 0) return memo[id];
    memo[id] = 0; // cycle guard; graph is acyclic for generated levels
    let best = 0;
    for (const w of blockers[id]) best = Math.max(best, depAt(w) + 1);
    memo[id] = best;
    return best;
  };
  let depth = 0;
  for (let i = 0; i < n; i++) depth = Math.max(depth, depAt(i));

  // Traps: the nearest blocker sits far along the lane (>=4 empty cells, and
  // in the far half of the corridor), so the arrow *looks* flyable at a
  // glance — the classic glance-and-miss bump.
  let traps = 0;
  for (const a of level.arrows) {
    if (!blockers[a.id].length) continue;
    const cor = corridorCells(level, a);
    const body = new Set<number>();
    for (const other of level.arrows) {
      if (other.id === a.id) continue;
      for (const c of other.cells) body.add(c.y * level.cols + c.x);
    }
    let first = cor.length;
    for (let i = 0; i < cor.length; i++) {
      if (body.has(cor[i].y * level.cols + cor[i].x)) {
        first = i;
        break;
      }
    }
    if (first >= 4 && first >= cor.length / 2) traps++;
  }

  // Free-arrow curve along a greedy replay.
  const alive = new Set(level.arrows.map((a) => a.id));
  const occ = new Set<number>();
  for (const a of level.arrows) for (const c of a.cells) occ.add(c.y * level.cols + c.x);
  const isFree = (a: Arrow): boolean =>
    corridorCells(level, a).every((c) => !occ.has(c.y * level.cols + c.x));

  const greedy = solveGreedy(level);
  const curve: number[] = [];
  let waterfall = 0;
  for (const id of greedy.order) {
    let free = 0;
    for (const a of level.arrows) if (alive.has(a.id) && isFree(a)) free++;
    curve.push(free);
    const a = level.arrows[id];
    for (const c of a.cells) occ.delete(c.y * level.cols + c.x);
    alive.delete(id);
  }
  // How many extra arrows one removal set loose (cascade feel).
  for (let i = 1; i < curve.length; i++) {
    waterfall = Math.max(waterfall, curve[i] - curve[i - 1] + 1);
  }

  const dirCounts = [0, 0, 0, 0];
  let bodyCells = 0;
  let bent = 0;
  for (const a of level.arrows) {
    dirCounts[a.dir]++;
    bodyCells += a.cells.length;
    let hasTurn = false;
    for (let i = 2; i < a.cells.length && !hasTurn; i++) {
      const p = a.cells[i - 2];
      const q = a.cells[i - 1];
      const r = a.cells[i];
      if (q.x - p.x !== r.x - q.x || q.y - p.y !== r.y - q.y) hasTurn = true;
    }
    if (hasTurn) bent++;
  }

  return {
    arrows: n,
    fill: bodyCells / (level.cols * level.rows),
    avgLen: bodyCells / Math.max(1, n),
    turnRatio: bent / Math.max(1, n),
    dirSkew: Math.max(...dirCounts) / Math.max(1, n),
    solved: greedy.solved,
    depth,
    freeAtStart: curve[0] ?? 0,
    minFree: curve.length ? Math.min(...curve) : 0,
    avgFree: curve.length ? curve.reduce((s, v) => s + v, 0) / curve.length : 0,
    maxFree: curve.length ? Math.max(...curve) : 0,
    traps,
    waterfall,
    steps: greedy.order.length,
  };
}
