import { Arrow, Cell, DIR_VECTORS, Dir, OPPOSITE } from './types';
import { Rng } from './rng';

export interface RemoteSeed {
  arrows: Arrow[];
  open: Uint8Array;
  lanes: number;
  farLinks: number;
}

/**
 * Prototype "chessboard" seed: a head looks down a reserved empty lane at a
 * blocker several cells away. Peel fills the rest; the lane stays empty, so
 * the first blocker is genuinely far instead of the adjacent arrow.
 */
export function buildRemoteSeed(opts: {
  cols: number;
  rows: number;
  mask: Uint8Array;
  rng: Rng;
  rays?: number;
}): RemoteSeed {
  const { cols, rows, mask, rng } = opts;
  const n = cols * rows;
  const open = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!mask[i]) open[i] = 1;
  const used = new Uint8Array(n);
  const arrows: Arrow[] = [];
  let farLinks = 0;
  const count = opts.rays ?? 12;

  for (let attempt = 0; attempt < 500 && farLinks < count; attempt++) {
    const x = rng.int(cols);
    const y = rng.int(rows);
    const hi = y * cols + x;
    if (!mask[hi] || used[hi] || open[hi]) continue;
    const dir = rng.int(4) as Dir;
    const v = DIR_VECTORS[dir];
    const len = rng.range(7, 13);
    // Reserved exit lane.
    const lane: Cell[] = [];
    let ok = true;
    for (let d = 1; d <= len; d++) {
      const nx = x + v.x * d;
      const ny = y + v.y * d;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || !mask[ny * cols + nx]) { ok = false; break; }
      lane.push({ x: nx, y: ny });
    }
    if (!ok) continue;
    if (lane.some((c) => used[c.y * cols + c.x])) continue;
    // Head/body behind the head must be three in a row (valid head stem).
    const back = OPPOSITE[dir];
    const bv = DIR_VECTORS[back];
    const body: Cell[] = [{ x, y }];
    for (let k = 1; k <= 2; k++) {
      const bx = x + bv.x * k;
      const by = y + bv.y * k;
      if (bx < 0 || by < 0 || bx >= cols || by >= rows || !mask[by * cols + bx]) { ok = false; break; }
      if (used[by * cols + bx] || open[by * cols + bx]) { ok = false; break; }
      body.push({ x: bx, y: by });
    }
    if (!ok) continue;
    if (body.some((c) => used[c.y * cols + c.x])) continue;
    // Blocker body crosses the far end of the lane.
    const end = lane[lane.length - 1];
    const perp = ((dir + 1) % 4) as Dir;
    const pv = DIR_VECTORS[perp];
    const blocker: Cell[] = [{ x: end.x, y: end.y }];
    for (let k = 1; k <= 2; k++) {
      const bx = end.x + pv.x * k;
      const by = end.y + pv.y * k;
      if (bx < 0 || by < 0 || bx >= cols || by >= rows || !mask[by * cols + bx]) { ok = false; break; }
      if (used[by * cols + bx] || open[by * cols + bx]) { ok = false; break; }
      blocker.push({ x: bx, y: by });
    }
    if (!ok) continue;
    if (used[end.y * cols + end.x] || open[end.y * cols + end.x]) continue;
    // Commit: head arrow, blocker arrow, and the empty lane between them.
    const headArrow: Arrow = { id: arrows.length, color: 0, cells: body, dir };
    arrows.push(headArrow);
    const blockArrow: Arrow = { id: arrows.length, color: 0, cells: blocker, dir: perp };
    arrows.push(blockArrow);
    for (const c of body) { used[c.y * cols + c.x] = 1; open[c.y * cols + c.x] = 1; }
    for (const c of blocker) { used[c.y * cols + c.x] = 1; open[c.y * cols + c.x] = 1; }
    for (let i = 0; i < lane.length - 1; i++) {
      const c = lane[i];
      open[c.y * cols + c.x] = 1;
    }
    farLinks++;
  }
  return { arrows, open, lanes: farLinks, farLinks };
}
