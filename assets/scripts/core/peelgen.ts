import { Arrow, Cell, DIR_VECTORS, Dir, Level, OPPOSITE, corridorCells } from './types';
import { Rng } from './rng';
import { buildLaneSeed, LaneSeed } from './lanegen';
import { buildRemoteSeed } from './remotegen';

/**
 * Full-coverage picture level generator.
 *
 * The old generator dropped a handful of long arrows into a rectangle and left
 * the rest empty, so a "B" had holes in the middle. This one peels the mask
 * from the outside in:
 *
 *  1. Every mask cell must become exactly one arrow body cell.
 *  2. Arrows are created in removal order A1..An.
 *  3. When Ak is removed, A1..A(k-1) are already gone, and Ak's corridor may
 *     only cross those already-empty cells (or the paper outside the mask).
 *     It may not cross any yet-unassigned cell, because that will still hold a
 *     later arrow.
 *  4. So the level is solvable by construction, and every arrow is a real
 *     dependency: only the first few boundary openings are free at start.
 *
 * Difficulty comes from that dependency chain, not from holes in the picture.
 */

export interface PeelOptions {
  id: number;
  cols: number;
  rows: number;
  mask: Uint8Array;
  shape?: string;
  minLen: number;
  maxLen: number;
  freeTarget: number;
  seed: number;
  timeLimit?: number;
  laneMax?: number;
  laneTail?: number;
  laneSegMin?: number;
  laneSegMax?: number;
  remote?: boolean;
}

interface Candidate {
  x: number;
  y: number;
  dir: Dir;
  chain: number;
  urgency: number;
  outsideOnly: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Color a set of arrows so neighbours never share a color. */
function colorize(arrows: Arrow[], cols: number, rows: number): void {
  const owners = new Int16Array(cols * rows).fill(-1);
  for (const a of arrows) for (const c of a.cells) owners[c.y * cols + c.x] = a.id;
  const neighbours: Set<number>[] = arrows.map(() => new Set<number>());
  for (const a of arrows) {
    for (const c of a.cells) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = c.x + dx;
          const ny = c.y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const other = owners[ny * cols + nx];
          if (other >= 0 && other !== a.id) neighbours[a.id].add(other);
        }
      }
    }
  }
  const used = new Array<number>(12).fill(0);
  const order = arrows.map((a) => a.id).sort((a, b) => neighbours[b].size - neighbours[a].size);
  for (const id of order) {
    const taken = new Set<number>();
    for (const n of neighbours[id]) taken.add(arrows[n].color);
    let best = -1;
    let bestUses = Infinity;
    for (let c = 0; c < 12; c++) {
      if (taken.has(c)) continue;
      if (used[c] < bestUses) {
        bestUses = used[c];
        best = c;
      }
    }
    if (best < 0) best = used.indexOf(Math.min(...used));
    arrows[id].color = best;
    used[best]++;
  }
}

function adjacent(a: Cell, b: Cell): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1;
}

function solvableArrows(arrows: Arrow[], cols: number, rows: number, mask: Uint8Array): boolean {
  const level: Level = {
    id: 0,
    cols,
    rows,
    arrows,
    timeLimit: 99,
    seed: 0,
    solution: arrows.map((a) => a.id),
    mask,
  };
  const alive = new Set(arrows.map((a) => a.id));
  const occ = new Set<number>();
  for (const a of arrows) for (const c of a.cells) occ.add(c.y * cols + c.x);
  let progress = true;
  while (progress && alive.size) {
    progress = false;
    for (const a of arrows) {
      if (!alive.has(a.id)) continue;
      if (corridorCells(level, a).some((c) => occ.has(c.y * cols + c.x))) continue;
      for (const c of a.cells) occ.delete(c.y * cols + c.x);
      alive.delete(a.id);
      progress = true;
    }
  }
  return alive.size === 0;
}

function maxStraight(cells: Cell[]): number {
  let best = 1;
  let run = 1;
  for (let i = 2; i < cells.length; i++) {
    const a = cells[i - 2];
    const b = cells[i - 1];
    const c = cells[i];
    if (b.x - a.x === c.x - b.x && b.y - a.y === c.y - b.y) run++;
    else run = 1;
    if (run > best) best = run;
  }
  return best;
}

function acyclicArrows(arrows: Arrow[], cols: number, rows: number, mask: Uint8Array): boolean {
  const level: Level = { id: 0, cols, rows, arrows, timeLimit: 99, seed: 0, solution: [], mask };
  const owner = new Map<number, number>();
  for (const a of arrows) for (const c of a.cells) owner.set(c.y * cols + c.x, a.id);
  const out = new Map<number, Set<number>>();
  for (const a of arrows) out.set(a.id, new Set());
  for (const a of arrows) {
    for (const c of corridorCells(level, a)) {
      const b = owner.get(c.y * cols + c.x);
      if (b !== undefined && b !== a.id) out.get(a.id)!.add(b);
    }
  }
  const state = new Map<number, number>();
  const visit = (id: number): boolean => {
    const s = state.get(id) ?? 0;
    if (s === 1) return false;
    if (s === 2) return true;
    state.set(id, 1);
    for (const b of out.get(id) ?? []) if (!visit(b)) return false;
    state.set(id, 2);
    return true;
  };
  for (const a of arrows) if (!visit(a.id)) return false;
  return true;
}

function hasOverlap(arrows: Arrow[], cols: number): boolean {
  const seen = new Set<number>();
  for (const a of arrows) {
    for (const c of a.cells) {
      const k = c.y * cols + c.x;
      if (seen.has(k)) return true;
      seen.add(k);
    }
  }
  return false;
}

function stemOk(cells: Cell[], dir: Dir): boolean {
  if (cells.length < 3) return true;
  const v = DIR_VECTORS[dir];
  for (let i = 1; i <= 2; i++) {
    const a = cells[i - 1];
    const b = cells[i];
    if (b.x - a.x !== -v.x || b.y - a.y !== -v.y) return false;
  }
  return true;
}

/**
 * Head placement pass. The body is fixed; only the head/tail orientation is
 * chosen. Prefer an orientation whose first blocker is far away, so arrows
 * point across the board instead of at their immediate neighbour.
 */
function orientArrows(arrows: Arrow[], cols: number, rows: number): Arrow[] {
  const owner = new Map<number, number>();
  for (const a of arrows) for (const c of a.cells) owner.set(c.y * cols + c.x, a.id);
  const dirCounts = [0, 0, 0, 0];
  const zoneDirs: number[][] = Array.from({ length: 9 }, () => [0, 0, 0, 0]);
  const zoneOf = (x: number, y: number): number =>
    Math.min(2, Math.floor((y / rows) * 3)) * 3 + Math.min(2, Math.floor((x / cols) * 3));
  for (const a of arrows) {
    dirCounts[a.dir]++;
    zoneDirs[zoneOf(a.cells[0].x, a.cells[0].y)][a.dir]++;
  }
  const blockerDistance = (cells: Cell[], dir: Dir, id: number): number => {
    const v = DIR_VECTORS[dir];
    let x = cells[0].x + v.x;
    let y = cells[0].y + v.y;
    let d = 1;
    while (x >= 0 && y >= 0 && x < cols && y < rows) {
      const o = owner.get(y * cols + x);
      if (o !== undefined && o !== id) return d;
      x += v.x;
      y += v.y;
      d++;
    }
    return 999;
  };
  const out: Arrow[] = [];
  for (const a of arrows) {
    const candidates: { cells: Cell[]; dir: Dir; dist: number }[] = [];
    if (stemOk(a.cells, a.dir)) {
      candidates.push({ cells: a.cells, dir: a.dir, dist: blockerDistance(a.cells, a.dir, a.id) });
    }
    const rev = [...a.cells].reverse();
    if (stemOk(rev, OPPOSITE[a.dir])) {
      candidates.push({ cells: rev, dir: OPPOSITE[a.dir], dist: blockerDistance(rev, OPPOSITE[a.dir], a.id) });
    }
    if (!candidates.length) {
      out.push(a);
      dirCounts[a.dir]++;
      continue;
    }
    candidates.sort((p, q) => q.dist - p.dist || dirCounts[p.dir] - dirCounts[q.dir]);
    const pick = candidates[0];
    out.push({ ...a, cells: pick.cells, dir: pick.dir });
    dirCounts[pick.dir]++;
  }
  return out;
}

/** Merge tiny arrows into an adjacent arrow when the result stays solvable. */
function mergeShortArrows(arrows: Arrow[], cols: number, rows: number, mask: Uint8Array): Arrow[] {
  let list = arrows;
  for (let pass = 0; pass < 4; pass++) {
    let merged = false;
    for (let i = 0; i < list.length && !merged; i++) {
      const b = list[i];
      if (b.cells.length > 4) continue;
      for (let j = 0; j < list.length && !merged; j++) {
        if (i === j) continue;
        const a = list[j];
        if (a.cells.length + b.cells.length > 13) continue;
        const tail = a.cells[a.cells.length - 1];
        let order: Cell[] | null = null;
        if (adjacent(tail, b.cells[0])) order = [...b.cells];
        else if (adjacent(tail, b.cells[b.cells.length - 1])) order = [...b.cells].reverse();
        if (!order) continue;
        if (a.cells.length === 2) {
          const v = DIR_VECTORS[OPPOSITE[a.dir]];
          const tail0 = a.cells[1];
          if (order[0].x - tail0.x !== v.x || order[0].y - tail0.y !== v.y) continue;
        }
        const seen = new Set<number>();
        for (const c of a.cells) seen.add(c.y * cols + c.x);
        if (order.some((c) => seen.has(c.y * cols + c.x))) continue;
        const target = i < j ? j - 1 : j;
        const test = list
          .filter((_, k) => k !== i)
          .map((x, k) => (k === target ? { ...a, cells: [...a.cells, ...order] } : x))
          .map((x, k) => ({ ...x, id: k }));
        if (maxStraight([...a.cells, ...order]) > 5) continue;
        if (!solvableArrows(test, cols, rows, mask)) continue;
        if (!acyclicArrows(test, cols, rows, mask)) continue;
        list = test;
        merged = true;
      }
    }
    if (!merged) break;
  }
  return list;
}

function attempt(
  opts: PeelOptions,
  seed: number,
  maxStraight: number,
  laneSeed?: LaneSeed,
): Level | null {
  const { cols, rows, mask } = opts;
  const rng = new Rng(seed);
  const open = new Uint8Array(cols * rows);
  let remaining = 0;
  for (let i = 0; i < mask.length; i++) {
    if (laneSeed?.open[i]) open[i] = 1;
    if (mask[i] && !open[i]) remaining++;
    else open[i] = 1;
  }
  if (remaining === 0 && !laneSeed) return null;

  const isOpen = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return true;
    return open[y * cols + x] === 1;
  };

  const corridorOpen = (x: number, y: number, dir: Dir): number => {
    const v = DIR_VECTORS[dir];
    let cx = x + v.x;
    let cy = y + v.y;
    let chain = 0;
    while (cx >= 0 && cy >= 0 && cx < cols && cy < rows) {
      const i = cy * cols + cx;
      if (!open[i]) return -1;
      if (mask[i]) chain++;
      cx += v.x;
      cy += v.y;
    }
    return chain;
  };

  const unassignedNeighbours = (x: number, y: number): number => {
    let n = 0;
    for (const v of DIR_VECTORS) {
      const nx = x + v.x;
      const ny = y + v.y;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const i = ny * cols + nx;
      if (mask[i] && !open[i]) n++;
    }
    return n;
  };

  const candidates = (): Candidate[] => {
    const out: Candidate[] = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (!mask[i] || open[i]) continue;
        for (const dir of [0, 1, 2, 3] as Dir[]) {
          const v = DIR_VECTORS[dir];
          if (!isOpen(x + v.x, y + v.y)) continue;
          const chain = corridorOpen(x, y, dir);
          if (chain < 0) continue;
          const back = OPPOSITE[dir];
          const bv = DIR_VECTORS[back];
          const bx = x + bv.x;
          const by = y + bv.y;
          if (bx < 0 || by < 0 || bx >= cols || by >= rows) continue;
          const bi = by * cols + bx;
          if (!mask[bi] || open[bi]) continue;
          out.push({
            x,
            y,
            dir,
            chain,
            urgency: unassignedNeighbours(x, y),
            outsideOnly: chain === 0,
          });
        }
      }
    }
    return out;
  };

  const growOnce = (head: Cell, dir: Dir, target: number): Cell[] | null => {
    const path: Cell[] = [{ x: head.x, y: head.y }];
    const used = new Set<number>([head.y * cols + head.x]);
    let cur = head;
    let last: Dir = OPPOSITE[dir];
    let run = 1;
    while (path.length < target) {
      const forced = path.length <= 2;
      let dirs: Dir[] = forced
        ? [last]
        : [last, ((last + 1) % 4) as Dir, ((last + 3) % 4) as Dir];
      if (!forced && run >= maxStraight) dirs = dirs.filter((d) => d !== last);
      if (!dirs.length) dirs = [last];
      const straightWeight = forced
        ? 1
        : run <= 1
          ? 0.55
          : run === 2
            ? 0.45
            : run === 3
              ? 0.3
              : 0;
      const options: { dir: Dir; x: number; y: number; i: number; weight: number }[] = [];
      for (const d of dirs) {
        const v = DIR_VECTORS[d];
        const nx = cur.x + v.x;
        const ny = cur.y + v.y;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const i = ny * cols + nx;
        if (used.has(i) || !mask[i] || open[i]) continue;
        // Prefer cells with more free neighbours: this is a cheap warning
        // against walking into a one-cell pocket and stopping short.
        let free = 0;
        for (const vv of DIR_VECTORS) {
          const ax = nx + vv.x;
          const ay = ny + vv.y;
          if (ax < 0 || ay < 0 || ax >= cols || ay >= rows) continue;
          const ai = ay * cols + ax;
          if (mask[ai] && !open[ai] && !used.has(ai)) free++;
        }
        const turn = d === last ? straightWeight : (1 - straightWeight) / 2;
        options.push({ dir: d, x: nx, y: ny, i, weight: turn * (1 + free * 0.18) });
      }
      if (!options.length) break;
      let total = 0;
      for (const o of options) total += o.weight;
      let r = rng.next() * total;
      let pick = options[options.length - 1];
      for (const o of options) {
        r -= o.weight;
        if (r <= 0) {
          pick = o;
          break;
        }
      }
      cur = { x: pick.x, y: pick.y };
      path.push(cur);
      used.add(pick.i);
      if (pick.dir === last) run++;
      else run = 1;
      last = pick.dir;
    }
    return path.length >= 2 ? path : null;
  };

  const grow = (head: Cell, dir: Dir): Cell[] | null => {
    const target = clamp(rng.range(opts.minLen, opts.maxLen + 1), 2, opts.maxLen);
    let best: Cell[] | null = null;
    for (let attempt = 0; attempt < 7; attempt++) {
      const path = growOnce(head, dir, target);
      if (path && (!best || path.length > best.length)) best = path;
      if (best && best.length >= target) break;
    }
    return best;
  };

  const validRemaining = (path: Cell[]): boolean => {
    const inPath = new Set<number>();
    for (const c of path) inPath.add(c.y * cols + c.x);
    const seen = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        if (!mask[i] || open[i] || inPath.has(i) || seen[i]) continue;
        // Flood one remaining component.
        const stack = [i];
        seen[i] = 1;
        let size = 0;
        let touchesOpen = false;
        while (stack.length) {
          const j = stack.pop()!;
          size++;
          const jx = j % cols;
          const jy = Math.floor(j / cols);
          for (const v of DIR_VECTORS) {
            const nx = jx + v.x;
            const ny = jy + v.y;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
              touchesOpen = true;
              continue;
            }
            const k = ny * cols + nx;
            if (!mask[k]) {
              touchesOpen = true;
              continue;
            }
            if (open[k] || inPath.has(k)) {
              touchesOpen = true;
              continue;
            }
            if (seen[k]) continue;
            seen[k] = 1;
            stack.push(k);
          }
        }
        // A single unassigned cell can never become a length-2 arrow; a
        // component with no open edge has no valid head at all.
        if (size < 2 || !touchesOpen) return false;
      }
    }
    return true;
  };

  const arrows: Arrow[] = laneSeed ? laneSeed.arrows.map((a) => ({ ...a, cells: a.cells.map((c) => ({ ...c })) })) : [];
  const dirCounts = [0, 0, 0, 0];
  const zoneDirs: number[][] = Array.from({ length: 9 }, () => [0, 0, 0, 0]);
  const zoneOf = (x: number, y: number): number =>
    Math.min(2, Math.floor((y / rows) * 3)) * 3 + Math.min(2, Math.floor((x / cols) * 3));
  for (const a of arrows) {
    dirCounts[a.dir]++;
    zoneDirs[zoneOf(a.cells[0].x, a.cells[0].y)][a.dir]++;
  }
  let freeMade = laneSeed ? opts.freeTarget : 0;
  let guard = 0;
  while (remaining > 0) {
    if (guard++ > 500) break;
    const all = candidates();
    if (!all.length) break;

    // Prefer heads with the fewest unassigned neighbours (they are in danger
    // of becoming isolated pockets). For the opening set, allow a few free
    // boundary arrows; after that prefer heads pointing into already-peeled
    // cells, which keeps the initial opening count small.
    let pool = all.filter((c) => c.urgency <= 2);
    if (!pool.length) pool = all;
    if (freeMade < opts.freeTarget) {
      const freePool = pool.filter((c) => c.outsideOnly);
      if (freePool.length) pool = freePool;
    } else {
      const chained = pool.filter((c) => c.chain > 0);
      if (chained.length) pool = chained;
    }
    pool.sort((a, b) => a.urgency - b.urgency || b.chain - a.chain);
    const shortlist = pool.slice(0, Math.max(1, Math.min(14, pool.length)));
    rng.shuffle(shortlist);
    // Balance head directions: a picture-B boundary naturally offers many
    // left/right heads; prefer under-represented directions so the finished
    // sheet does not look like a field of horizontal arrows.
    shortlist.sort((a, b) => {
      const za = zoneOf(a.x, a.y);
      const zb = zoneOf(b.x, b.y);
      return (
        a.urgency + dirCounts[a.dir] * 0.55 + zoneDirs[za][a.dir] * 1.1 -
        (b.urgency + dirCounts[b.dir] * 0.55 + zoneDirs[zb][b.dir] * 1.1)
      );
    });

    let committed = false;
    let bestC: Candidate | null = null;
    let bestPath: Cell[] | null = null;
    for (const c of shortlist) {
      for (let tries = 0; tries < 2; tries++) {
        const path = grow({ x: c.x, y: c.y }, c.dir);
        if (!path) continue;
        if (!bestPath || path.length > bestPath.length) {
          bestC = c;
          bestPath = path;
        }
        if (bestPath.length >= opts.maxLen) break;
      }
      if (bestPath && bestPath.length >= opts.maxLen) break;
    }
    if (bestC && bestPath) {
      arrows.push({ id: arrows.length, color: 0, cells: bestPath, dir: bestC.dir });
      for (const cell of bestPath) open[cell.y * cols + cell.x] = 1;
      remaining -= bestPath.length;
      dirCounts[bestC.dir]++;
      zoneDirs[zoneOf(bestC.x, bestC.y)][bestC.dir]++;
      if (bestC.outsideOnly) freeMade++;
      committed = true;
    }
    if (!committed) break;
  }

  // Boundary repair: prefer a 3-cell L-shape (one turn) over a missing edge.
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (!mask[i] || open[i]) continue;
      const edge =
        x === 0 || y === 0 || x === cols - 1 || y === rows - 1 ||
        !mask[y * cols + x - 1] || !mask[y * cols + x + 1] ||
        !mask[(y - 1) * cols + x] || !mask[(y + 1) * cols + x];
      if (!edge) continue;
      let placed = false;
      for (const dir of [0, 1, 2, 3] as Dir[]) {
        const v = DIR_VECTORS[dir];
        const ox = x + v.x;
        const oy = y + v.y;
        if (ox >= 0 && oy >= 0 && ox < cols && oy < rows && mask[oy * cols + ox]) continue;
        const back = OPPOSITE[dir];
        const bv = DIR_VECTORS[back];
        const bx = x + bv.x;
        const by = y + bv.y;
        if (bx < 0 || by < 0 || bx >= cols || by >= rows) continue;
        const bi = by * cols + bx;
        if (!mask[bi] || open[bi]) continue;
        // Continue straight one more cell, then turn: a 4-cell L-shape gives
        // two straight cells behind the head (valid) and one real bend.
        const b2x = bx + bv.x;
        const b2y = by + bv.y;
        let made = false;
        if (b2x >= 0 && b2y >= 0 && b2x < cols && b2y < rows) {
          const b2i = b2y * cols + b2x;
          if (mask[b2i] && !open[b2i]) {
            for (const side of [((dir + 1) % 4) as Dir, ((dir + 3) % 4) as Dir]) {
              const sv = DIR_VECTORS[side];
              const cx = b2x + sv.x;
              const cy = b2y + sv.y;
              if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
              const ci = cy * cols + cx;
              if (!mask[ci] || open[ci] || (cx === x && cy === y)) continue;
              const arrow: Arrow = {
                id: arrows.length,
                color: 0,
                cells: [{ x, y }, { x: bx, y: by }, { x: b2x, y: b2y }, { x: cx, y: cy }],
                dir,
              };
              arrows.push(arrow);
              open[i] = open[bi] = open[b2i] = open[ci] = 1;
              remaining -= 4;
              made = true;
              break;
            }
          }
        }
        if (!made) {
          const arrow: Arrow = { id: arrows.length, color: 0, cells: [{ x, y }, { x: bx, y: by }], dir };
          arrows.push(arrow);
          open[i] = open[bi] = 1;
          remaining -= 2;
        }
        placed = true;
        break;
      }
      if (!placed) {
        // Thin boundary features (bag handle, B bar) have no inward body.
        // Run a 2-cell arrow tangentially along the edge instead.
        for (const dir of [0, 1, 2, 3] as Dir[]) {
          const v = DIR_VECTORS[dir];
          const bx = x + v.x;
          const by = y + v.y;
          if (bx < 0 || by < 0 || bx >= cols || by >= rows) continue;
          const bi = by * cols + bx;
          if (!mask[bi] || open[bi]) continue;
          const arrow: Arrow = { id: arrows.length, color: 0, cells: [{ x, y }, { x: bx, y: by }], dir };
          arrows.push(arrow);
          open[i] = open[bi] = 1;
          remaining -= 2;
          break;
        }
      }
    }
  }

  if (hasOverlap(arrows, cols)) return null;
  const merged = opts.remote ? arrows : mergeShortArrows(arrows, cols, rows, mask);
  const safe = hasOverlap(merged, cols) ? arrows : merged;
  // Two-cell stubs read as noise and make the sheet look sparse. Leave those
  // pocket cells as paper instead; the fill gate still enforces >=92%.
  const finalArrows = safe
    .filter((a) => a.cells.length >= 2)
    .map((a, k) => ({ ...a, id: k }));
  arrows.length = 0;
  arrows.push(...finalArrows);
  // Safe head-orientation pass: only keep it when the level still solves and
  // the blocker graph stays acyclic. Otherwise retain the generated heads.
  const oriented = opts.remote ? finalArrows : orientArrows(finalArrows, cols, rows);
  if (
    !hasOverlap(oriented, cols) &&
    solvableArrows(oriented, cols, rows, mask) &&
    acyclicArrows(oriented, cols, rows, mask)
  ) {
    arrows.length = 0;
    arrows.push(...oriented.map((a, k) => ({ ...a, id: k })));
  }
  let covered = 0;
  for (const a of arrows) covered += a.cells.length;
  const maskArea = opts.mask.reduce((s, v) => s + v, 0);
  if (covered / Math.max(1, maskArea) < (opts.remote ? 0.62 : 0.88)) return null;

  const buildSolution = (): number[] | null => {
    const order: number[] = [];
    const count = arrows.length;
    const owner = new Map<number, number>();
    for (const a of arrows) for (const c of a.cells) owner.set(c.y * cols + c.x, a.id);
    const dead = new Set<number>();
    while (order.length < count) {
      let picked = -1;
      for (const a of arrows) {
        if (dead.has(a.id)) continue;
        let blocked = false;
        const v = DIR_VECTORS[a.dir];
        let x = a.cells[0].x + v.x;
        let y = a.cells[0].y + v.y;
        while (x >= 0 && y >= 0 && x < cols && y < rows) {
          const id = owner.get(y * cols + x);
          if (id !== undefined && id !== a.id && !dead.has(id)) { blocked = true; break; }
          x += v.x;
          y += v.y;
        }
        if (!blocked) { picked = a.id; break; }
      }
      if (picked < 0) return null;
      order.push(picked);
      dead.add(picked);
    }
    return order.length === count ? order : null;
  };
  const order = buildSolution();
  if (!order) return null;

  const level: Level = {
    id: opts.id,
    cols,
    rows,
    arrows,
    timeLimit: opts.timeLimit ?? Math.round((arrows.length * 2.2 + 40) / 5) * 5,
    seed,
    solution: order,
    mask: opts.mask,
    shape: opts.shape,
  };
  colorize(arrows, cols, rows);

  // Free-at-start count is the main difficulty knob (fewer = harder).
  let free = 0;
  for (const a of arrows) {
    const corridor = corridorCells(level, a);
    if (corridor.every((c) => mask[c.y * cols + c.x] === 0)) free++;
  }

  // Cheap check; the peel construction should make this always true.
  const alive = new Set(arrows.map((a) => a.id));
  const occ = new Set<number>();
  for (const a of arrows) for (const c of a.cells) occ.add(c.y * cols + c.x);
  let progress = true;
  while (progress && alive.size) {
    progress = false;
    for (const a of arrows) {
      if (!alive.has(a.id)) continue;
      if (corridorCells(level, a).some((c) => occ.has(c.y * cols + c.x))) continue;
      for (const c of a.cells) occ.delete(c.y * cols + c.x);
      alive.delete(a.id);
      progress = true;
    }
  }
  if (alive.size) return null;

  void opts.freeTarget;
  return level;
}

export function generatePeelLevel(opts: PeelOptions): Level | null {
  const laneSeed = opts.remote
    ? (() => {
        const remote = buildRemoteSeed({
          cols: opts.cols,
          rows: opts.rows,
          mask: opts.mask,
          rng: new Rng(opts.seed ^ 0x51ed2701),
          rays: 60,
        });
        return remote.arrows.length
          ? { arrows: remote.arrows, open: remote.open, lanes: remote.farLinks, laneCells: new Set<number>() }
          : undefined;
      })()
    : buildLaneSeed({
        cols: opts.cols,
        rows: opts.rows,
        mask: opts.mask,
        rng: new Rng(opts.seed ^ 0x9e3779b9),
        maxLanes: opts.laneMax ?? 0,
        tailLen: opts.laneTail,
        segMin: opts.laneSegMin,
        segMax: opts.laneSegMax,
      });
  let best: Level | null = null;
  let bestScore = -Infinity;
  // Phase 1 is the maze-like version. Phase 2 relaxes the turn cap so a
  // difficult silhouette still gets a complete picture instead of falling
  // back to a sparse rectangle.
  const phases: { maxStraight: number; minLen: number; maxLen: number }[] = [
    { maxStraight: 3, minLen: Math.max(7, opts.minLen), maxLen: opts.maxLen },
    { maxStraight: 3, minLen: Math.max(5, opts.minLen), maxLen: opts.maxLen },
    { maxStraight: 4, minLen: 4, maxLen: 12 },
  ];
  for (const phase of phases) {
    const maxStraight = phase.maxStraight;
    const attempts = 260;
    for (let i = 0; i < attempts; i++) {
      const level = attempt(
        { ...opts, minLen: phase.minLen, maxLen: phase.maxLen },
        opts.seed + i * 7919 + maxStraight,
        maxStraight,
        laneSeed?.arrows.length ? laneSeed : undefined,
      );
      if (!level) continue;
      let free = 0;
      for (const a of level.arrows) {
        const corridor = corridorCells(level, a);
        if (corridor.every((c) => opts.mask[c.y * level.cols + c.x] === 0)) free++;
      }
      const freePenalty = Math.abs(free - opts.freeTarget) * 3;
      const countPenalty = Math.abs(level.arrows.length - 12) * 0.4;
      const turnBonus = maxStraight > 90 ? -12 : 0;
      const score = 100 - freePenalty - countPenalty + turnBonus;
      if (score > bestScore) {
        bestScore = score;
        best = level;
      }
      if (Math.abs(free - opts.freeTarget) <= 1 && level.arrows.length >= 8) return level;
    }
    if (best) break;
  }
  if (best) return best;
  // Last resort: pure peel without lane seeds. Better a straight level than
  // the old sparse fallback rectangle.
  for (const phase of phases) {
    for (let i = 0; i < 180; i++) {
      const level = attempt(
        { ...opts, minLen: Math.max(2, phase.minLen), maxLen: phase.maxLen },
        opts.seed + 104729 + i * 7919,
        phase.maxStraight,
        undefined,
      );
      if (!level) continue;
      let fill = 0;
      for (const a of level.arrows) fill += a.cells.length;
      if (fill / opts.mask.reduce((s, v) => s + v, 0) >= (opts.remote ? 0.62 : 0.88)) return level;
    }
  }
  return best;
}