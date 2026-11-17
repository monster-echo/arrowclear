import { Arrow, Cell, DIR_VECTORS } from './types';

export interface SnakePoint {
  x: number;
  y: number;
}

/**
 * Head-first, tail-following window over an arrow polyline.
 *
 * Port of `computeSnakedPolylinePoints` from the Arrows Out reference
 * library. The project stores cells head → tail; the reference stores
 * tail → head, so the track is reversed internally.
 *
 * @param arrow         arrow with cells ordered head → tail
 * @param advanceCells  how many cells the head has advanced (can be fractional)
 * @param cellSize      pixel size of one cell
 * @param offsetX       board pixel offset X
 * @param offsetY       board pixel offset Y
 * @returns polyline centers from the current tail to the current head
 */
export function computeSnakedPolylinePoints(
  arrow: Arrow,
  advanceCells: number,
  cellSize = 1,
  offsetX = 0,
  offsetY = 0,
): SnakePoint[] {
  // Reference convention: tail → head.
  const cells: Cell[] = [...arrow.cells].reverse();
  const segments = cells.length - 1;
  if (segments < 1) return [];

  const maxExtend = Math.ceil(advanceCells) + 2;
  const track: SnakePoint[] = cells.map((c) => ({
    x: offsetX + (c.x + 0.5) * cellSize,
    y: offsetY + (c.y + 0.5) * cellSize,
  }));

  const head = cells[cells.length - 1];
  const dir = DIR_VECTORS[arrow.dir];
  for (let k = 1; k <= maxExtend; k++) {
    track.push({
      x: offsetX + (head.x + dir.x * k + 0.5) * cellSize,
      y: offsetY + (head.y + dir.y * k + 0.5) * cellSize,
    });
  }

  const sampleTrack = (s: number): SnakePoint => {
    const idx = Math.floor(s);
    const frac = s - idx;
    if (idx >= track.length - 1) return { ...track[track.length - 1] };
    const p0 = track[idx];
    const p1 = track[idx + 1];
    return { x: p0.x + (p1.x - p0.x) * frac, y: p0.y + (p1.y - p0.y) * frac };
  };

  const sStart = Math.max(0, advanceCells);
  const sEnd = sStart + segments;
  const startIdx = Math.floor(sStart);
  const endIdx = Math.floor(sEnd);
  const pts: SnakePoint[] = [sampleTrack(sStart)];
  for (let i = startIdx + 1; i <= endIdx; i++) {
    if (i < track.length) pts.push({ ...track[i] });
  }
  if (sEnd > endIdx) pts.push(sampleTrack(sEnd));
  return pts;
}
