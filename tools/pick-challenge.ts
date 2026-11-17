/**
 * Seed search for the compositional challenge level.
 *
 * V3 after playtest feedback ("too many straight sticks, board should read
 * bigger"): bodies must SNAKE (L/S silhouettes, hard turnRatio gate), doors
 * are L-hooks, and the board shrinks to 9×14 so each cell renders bigger —
 * the same 9-column proportion as the reference game.
 */
import {
  CgMotifReport,
  CgSpec,
  generateCgLevel,
  puzzleMetrics,
} from '../assets/scripts/core/cggen';

const SPEC: Omit<CgSpec, 'seed' | 'id'> = {
  cols: 11,
  rows: 17,
  arrowsTarget: 50,
  minLen: 3,
  maxLen: 6,
  pocketDepth: 3,
  chainLen: 8,
  faninCount: 2,
  gateDoors: 3,
  fillTarget: 0.97,
};

function score(m: ReturnType<typeof puzzleMetrics>, mf: CgMotifReport): number {
  let s = 0;
  // Silhouette: most arrows must bend — straight sticks look like rulers.
  if (m.turnRatio < 0.45) s -= (0.45 - m.turnRatio) * 700;
  else s += Math.min(m.turnRatio, 0.8) * 100;
  // Fill: sweet spot around 0.90 — dense enough to tangle, sparse enough to read.
  s += 100 - Math.abs(m.fill - 0.97) * 400;
  // Arrow count and body length: long arrows read as lanes.
  s -= Math.max(0, 44 - m.arrows) * 4;
  s -= Math.max(0, m.arrows - 58) * 3;
  s += Math.min(m.avgLen, 4.2) * 10;
  // Facing balance: no direction may dominate.
  if (m.dirSkew > 0.36) s -= (m.dirSkew - 0.36) * 800;
  else s += (0.36 - m.dirSkew) * 200;
  // Few flyable arrows at every step is what forces deduction.
  s += m.freeAtStart >= 1 && m.freeAtStart <= 4 ? 50 : -Math.abs(m.freeAtStart - 3) * 30;
  const avgPen = Math.abs(m.avgFree - 2.6);
  s += avgPen <= 0.5 ? 70 : 70 - avgPen * 90;
  // Depth and one cascade are the spice.
  s += Math.min(m.depth, 26) * 5;
  s += Math.min(m.waterfall, 4) * 10;
  // Motif achievement — designed structures, not accidents.
  s += Math.min(Math.max(0, mf.pocketArrows - 1), 3) * 14;
  s += Math.min(Math.max(0, mf.chainArrows - 1), 5) * 12;
  s += Math.min(Math.max(0, mf.gateArrows - 1), 3) * 12;
  s += Math.min(mf.faninWaits, 6) * 10;
  return s;
}

const results: {
  seed: number;
  m: ReturnType<typeof puzzleMetrics>;
  mf: CgMotifReport;
  s: number;
}[] = [];
for (let seed = 1; seed <= 2000; seed++) {
  const level = generateCgLevel({ ...SPEC, seed });
  if (!level) continue;
  const m = puzzleMetrics(level);
  if (!m.solved) continue;
  results.push({ seed, m, mf: level.motifs, s: score(m, level.motifs) });
}

results.sort((a, b) => b.s - a.s);
console.log(
  'seed  score  arrows fill  len  turn skew depth free0 avgF wf | pkt chn gate fan',
);
for (const r of results.slice(0, 15)) {
  const { m, mf } = r;
  console.log(
    String(r.seed).padStart(4),
    r.s.toFixed(0).padStart(6),
    String(m.arrows).padStart(6),
    m.fill.toFixed(3).padStart(5),
    m.avgLen.toFixed(1).padStart(5),
    m.turnRatio.toFixed(2).padStart(5),
    m.dirSkew.toFixed(2).padStart(4),
    String(m.depth).padStart(5),
    String(m.freeAtStart).padStart(5),
    m.avgFree.toFixed(2).padStart(5),
    String(m.waterfall).padStart(2),
    ' |',
    String(mf.pocketArrows).padStart(3),
    String(mf.chainArrows).padStart(3),
    String(mf.gateArrows).padStart(4),
    String(mf.faninWaits).padStart(3),
  );
}
console.log(`\ncandidates: ${results.length}/2000`);
