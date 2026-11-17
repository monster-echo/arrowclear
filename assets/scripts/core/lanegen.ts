import { Arrow, Cell, DIR_VECTORS, Dir, OPPOSITE } from './types';
import { Rng } from './rng';

/**
 * Lane seeding for picture levels.
 *
 * A lane is a 1-cell-wide straight run of mask cells from the outer boundary
 * toward the interior. It is filled with collinear arrow segments from the
 * outside in. Every segment's exit corridor runs back along the lane, so the
 * segments form a forced local order (A1; A1+A2; ...). The segment tail may
 * leave the lane and wind through the adjacent paper, which gives the long
 * arrows their turns without breaking the lane's unique order.
 */

export interface LaneSeed {
  arrows: Arrow[];
  open: Uint8Array;
  lanes: number;
  laneCells: Set<number>;
}

interface Lane {
  dir: Dir;
  cells: Cell[];
  pos: number;
  horizontal: boolean;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function buildLaneSeed(opts: {
  cols: number;
  rows: number;
  mask: Uint8Array;
  rng: Rng;
  maxLanes?: number;
  tailLen?: number;
  segMin?: number;
  segMax?: number;
}): LaneSeed {
  const { cols, rows, mask, rng } = opts;
  const n = cols * rows;
  const open = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!mask[i]) open[i] = 1;

  const lanes: Lane[] = [];
  // Horizontal lanes every few rows, anchored to a left/right silhouette edge.
  for (let y = 2; y < rows - 1; y += 4) {
    let x = 0;
    while (x < cols) {
      if (!mask[y * cols + x]) {
        x++;
        continue;
      }
      let x1 = x;
      while (x1 + 1 < cols && mask[y * cols + x1 + 1]) x1++;
      const len = x1 - x + 1;
      if (len >= 5) {
        if (x === 0) {
          const cells: Cell[] = [];
          for (let xx = x; xx <= x1; xx++) cells.push({ x: xx, y });
          lanes.push({ dir: 3, cells, pos: y, horizontal: true });
        } else if (x1 === cols - 1) {
          const cells: Cell[] = [];
          for (let xx = x1; xx >= x; xx--) cells.push({ x: xx, y });
          lanes.push({ dir: 1, cells, pos: y, horizontal: true });
        }
      }
      x = x1 + 1;
    }
  }
  // Vertical lanes only when horizontal lanes cannot describe the shape;
  // mixing orientations creates crossing/overlapping lane cells.
  if (lanes.length < 2)
  for (let x = 2; x < cols - 1; x += 5) {
    let y = 0;
    while (y < rows) {
      if (!mask[y * cols + x]) {
        y++;
        continue;
      }
      let y1 = y;
      while (y1 + 1 < rows && mask[(y1 + 1) * cols + x]) y1++;
      const len = y1 - y + 1;
      if (len >= 5) {
        if (y === 0) {
          const cells: Cell[] = [];
          for (let yy = y; yy <= y1; yy++) cells.push({ x, y: yy });
          lanes.push({ dir: 0, cells, pos: x, horizontal: false });
        } else if (y1 === rows - 1) {
          const cells: Cell[] = [];
          for (let yy = y1; yy >= y; yy--) cells.push({ x, y: yy });
          lanes.push({ dir: 2, cells, pos: x, horizontal: false });
        }
      }
      y = y1 + 1;
    }
  }

  // Spread the lanes out; avoid two adjacent rows/columns.
  rng.shuffle(lanes);
  const chosen: Lane[] = [];
  const used = new Set<string>();
  for (const lane of lanes) {
    const group = lane.horizontal ? 'h' : 'v';
    const bucket = [...used].filter((k) => k.startsWith(group)).map((k) => Number(k.slice(1)));
    if (bucket.some((p) => Math.abs(p - lane.pos) < 3)) continue;
    used.add(group + lane.pos);
    chosen.push(lane);
    if (chosen.length >= (opts.maxLanes ?? 5)) break;
  }

  const laneCells = new Set<number>();
  for (const lane of chosen) for (const c of lane.cells) laneCells.add(c.y * cols + c.x);

  const assigned = new Uint8Array(n);
  const arrows: Arrow[] = [];
  let laneCount = 0;

  const growTail = (head: Cell, lastDir: Dir): Cell[] => {
    const tail: Cell[] = [{ x: head.x, y: head.y }];
    const used = new Set<number>([head.y * cols + head.x]);
    let cur = head;
    let last = lastDir;
    const target = opts.tailLen ?? 5;
    for (let step = 0; step < target; step++) {
      const dirs: Dir[] = [last, ((last + 1) % 4) as Dir, ((last + 3) % 4) as Dir];
      const options: { d: Dir; x: number; y: number; i: number; w: number }[] = [];
      for (const d of dirs) {
        const v = DIR_VECTORS[d];
        const nx = cur.x + v.x;
        const ny = cur.y + v.y;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const i = ny * cols + nx;
        if (!mask[i] || open[i] || assigned[i] || used.has(i) || laneCells.has(i)) continue;
        options.push({ d, x: nx, y: ny, i, w: d === last ? 0.35 : 0.65 });
      }
      if (!options.length) break;
      let total = 0;
      for (const o of options) total += o.w;
      let roll = rng.next() * total;
      let pick = options[options.length - 1];
      for (const o of options) {
        roll -= o.w;
        if (roll <= 0) {
          pick = o;
          break;
        }
      }
      cur = { x: pick.x, y: pick.y };
      tail.push(cur);
      used.add(pick.i);
      last = pick.d;
    }
    return tail;
  };

  for (const lane of chosen) {
    const cells = lane.cells;
    if (cells.length < 2) continue;
    let at = 0;
    while (at < cells.length) {
      let size = rng.range(opts.segMin ?? 3, (opts.segMax ?? 4) + 1);
      if (cells.length - at - size === 1) size = cells.length - at;
      size = Math.min(size, cells.length - at);
      if (size < 2) break;
      const segment = cells.slice(at, at + size);
      const head = segment[0];
      const inner = segment[segment.length - 1];
      for (const c of segment) {
        open[c.y * cols + c.x] = 1;
        assigned[c.y * cols + c.x] = 1;
      }
      const tail = segment.length >= 3 ? growTail(inner, OPPOSITE[lane.dir] as Dir) : [{ ...inner }];
      const body = [...segment];
      for (let i = 1; i < tail.length; i++) {
        body.push(tail[i]);
        const c = tail[i];
        open[c.y * cols + c.x] = 1;
        assigned[c.y * cols + c.x] = 1;
      }
      arrows.push({ id: arrows.length, color: 0, cells: body, dir: lane.dir });
      at += size;
    }
    laneCount++;
  }

  return { arrows, open, lanes: laneCount, laneCells };
}
