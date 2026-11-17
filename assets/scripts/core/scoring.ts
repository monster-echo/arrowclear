import { Arrow, DIR_VECTORS, Level, bossShadowCells, cellKey, corridorCells } from './types';
import { Rng } from './rng';
import { frozenAdjacencies, freeAtStartCount, solveGreedyFrozen } from './frozen';

/**
 * Pure, engine-independent level scoring.
 *
 * The goal is to make "is this level fun?" measurable enough to filter
 * generated candidates: full solvability, silhouette coverage, arrow length /
 * turn distribution, dependency depth, forced local chains, pacing and time
 * calibration. A score below 90 means "regenerate", not "tweak by eye".
 */

export interface GateFailure {
  id: string;
  detail: string;
}

export interface DistributionStats {
  lengthBins: number[];
  turnBins: number[];
  runBins: number[];
  lengthShare: number[];
  turnShare: number[];
  runShare: number[];
  zeroTurnShare: number;
  longShare: number;
  shortShare: number;
  maxStraight: number;
  avgTurns: number;
  avgLength: number;
  directionEntropy: number;
  spatialDeviation: number;
  jointLongStraight: number;
}

export interface DependencyStats {
  freeAtStart: number;
  freeRatio: number;
  chainDepth: number;
  forcedRatio: number;
  longestForcedRun: number;
  forcedRunCount: number;
  decisionPoints: number;
  avgFree: number;
  uniqueChains: number[];
  longestUnique: number;
  chokeUnlocks: number;
  medianBlockers: number;
  maxBlockers: number;
  solvable: boolean;
  cycle: boolean;
}

export interface ScoreReport {
  id: number;
  shape: string;
  cols: number;
  rows: number;
  arrows: number;
  fill: number;
  boundaryCoverage: number;
  timeLimit: number;
  estimatedT80: number;
  total: number;
  passed: boolean;
  subscores: {
    shape: number;
    distribution: number;
    difficulty: number;
    unique: number;
    pacing: number;
    clarity: number;
    time: number;
    fairness: number;
  };
  distribution: DistributionStats;
  dependency: DependencyStats;
  gates: GateFailure[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

const band = (x: number, lo: number, hi: number, soft: number): number => {
  if (x >= lo && x <= hi) return 100;
  const d = x < lo ? lo - x : x - hi;
  return clamp(100 - (d / soft) * 100, 0, 100);
};

const l1 = (a: number[], b: number[]): number => {
  let s = 0;
  for (let i = 0; i < b.length; i++) s += Math.abs((a[i] ?? 0) - b[i]);
  return s;
};

const shares = (bins: number[], total: number): number[] =>
  bins.map((v) => (total > 0 ? v / total : 0));

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};

function turnCount(arrow: Arrow): number {
  let turns = 0;
  for (let i = 2; i < arrow.cells.length; i++) {
    const a = arrow.cells[i - 2];
    const b = arrow.cells[i - 1];
    const c = arrow.cells[i];
    if (b.x - a.x !== c.x - b.x || b.y - a.y !== c.y - b.y) turns++;
  }
  return turns;
}

function straightRuns(arrow: Arrow): number[] {
  const runs: number[] = [];
  if (arrow.cells.length < 2) return runs;
  let dir = -1;
  let run = 1;
  for (let i = 1; i < arrow.cells.length; i++) {
    const a = arrow.cells[i - 1];
    const b = arrow.cells[i];
    let d = -1;
    for (let k = 0; k < 4; k++) {
      if (DIR_VECTORS[k].x === b.x - a.x && DIR_VECTORS[k].y === b.y - a.y) d = k;
    }
    if (d === dir) run++;
    else {
      if (dir >= 0) runs.push(run);
      dir = d;
      run = 1;
    }
  }
  if (dir >= 0) runs.push(run);
  return runs;
}

function blockerGraph(level: Level): { blockers: Map<number, Set<number>>; dependents: Map<number, Set<number>> } {
  const owners = new Map<number, Arrow>();
  for (const a of level.arrows) {
    for (const c of a.cells) owners.set(cellKey(c), a);
    // Boss 双倍宽：影子格同样归属 Boss。
    for (const c of bossShadowCells(level, a)) {
      if (!owners.has(cellKey(c))) owners.set(cellKey(c), a);
    }
  }
  const blockers = new Map<number, Set<number>>();
  const dependents = new Map<number, Set<number>>();
  for (const a of level.arrows) {
    blockers.set(a.id, new Set());
    dependents.set(a.id, new Set());
  }
  for (const a of level.arrows) {
    for (const c of corridorCells(level, a)) {
      const owner = owners.get(c.y * 4096 + c.x);
      if (owner && owner.id !== a.id) blockers.get(a.id)!.add(owner.id);
    }
  }
  // 冰冻箭（规则书 §4）：起飞前提是「≥2 支相邻箭飞走」。评分口径取保守近似：
  // 冻结箭依赖其全部相邻箭（高估深度，但保证它绝不会被当成自由箭）。
  const adj = frozenAdjacencies(level);
  for (const a of level.arrows) {
    if (!a.frozen) continue;
    for (const n of adj.get(a.id) ?? []) blockers.get(a.id)!.add(n);
  }
  for (const [id, bs] of blockers) {
    for (const b of bs) dependents.get(b)!.add(id);
  }
  return { blockers, dependents };
}

function analyzeDistribution(level: Level): DistributionStats {
  const lengthBins = [0, 0, 0, 0];
  const turnBins = [0, 0, 0];
  const runBins = [0, 0, 0, 0];
  let zeroTurn = 0;
  let maxStraight = 1;
  let totalTurns = 0;
  let totalLen = 0;
  let longStraight = 0;
  const dirs = [0, 0, 0, 0];

  for (const a of level.arrows) {
    const len = a.cells.length;
    totalLen += len;
    dirs[a.dir]++;
    if (len <= 4) lengthBins[0]++;
    else if (len <= 7) lengthBins[1]++;
    else if (len <= 11) lengthBins[2]++;
    else lengthBins[3]++;

    const turns = turnCount(a);
    totalTurns += turns;
    if (turns <= 1) turnBins[0]++;
    else if (turns <= 3) turnBins[1]++;
    else turnBins[2]++;
    if (turns === 0) zeroTurn++;
    if (len >= 8 && turns <= 1) longStraight++;

    for (const run of straightRuns(a)) {
      maxStraight = Math.max(maxStraight, run);
      if (run <= 2) runBins[0]++;
      else if (run === 3) runBins[1]++;
      else if (run === 4) runBins[2]++;
      else runBins[3]++;
    }
  }

  const n = Math.max(1, level.arrows.length);
  const entropy = -dirs.reduce((s, v) => {
    const p = v / n;
    return s + (p > 0 ? p * Math.log2(p) : 0);
  }, 0) / 2;

  // 3×3 spatial zones; arrows are assigned by centroid.
  const zoneLen = new Map<number, number[]>();
  const zoneTurn = new Map<number, number[]>();
  for (const a of level.arrows) {
    let sx = 0;
    let sy = 0;
    for (const c of a.cells) {
      sx += c.x;
      sy += c.y;
    }
    const cx = sx / a.cells.length;
    const cy = sy / a.cells.length;
    const zx = clamp(Math.floor((cx / Math.max(1, level.cols)) * 2), 0, 1);
    const zy = clamp(Math.floor((cy / Math.max(1, level.rows)) * 2), 0, 1);
    const z = zy * 2 + zx;
    if (!zoneLen.has(z)) {
      zoneLen.set(z, []);
      zoneTurn.set(z, []);
    }
    zoneLen.get(z)!.push(a.cells.length);
    zoneTurn.get(z)!.push(turnCount(a));
  }
  const globalLen = totalLen / n;
  const globalTurn = totalTurns / n;
  let maxDev = 0;
  for (const [z, lens] of zoneLen) {
    if (lens.length < 4) continue;
    const dl = Math.abs(mean(lens) - globalLen) / Math.max(1, globalLen);
    const dt = Math.abs(mean(zoneTurn.get(z) ?? []) - globalTurn) / Math.max(1, globalTurn);
    maxDev = Math.max(maxDev, dl, dt);
  }

  return {
    lengthBins,
    turnBins,
    runBins,
    lengthShare: shares(lengthBins, n),
    turnShare: shares(turnBins, n),
    runShare: shares(runBins, Math.max(1, runBins.reduce((a, b) => a + b, 0))),
    zeroTurnShare: zeroTurn / n,
    longShare: lengthBins[3] / n,
    shortShare: lengthBins[0] / n,
    maxStraight,
    avgTurns: totalTurns / n,
    avgLength: globalLen,
    directionEntropy: clamp(entropy, 0, 1),
    spatialDeviation: maxDev,
    jointLongStraight: longStraight / n,
  };
}

function analyzeDependencies(level: Level, blockers: Map<number, Set<number>>, dependents: Map<number, Set<number>>): DependencyStats {
  // 可解性判定：有冰冻箭时用冰冻感知贪心（完备），否则用普通贪心。
  const solvableCheck = level.arrows.some((a) => a.frozen)
    ? (() => solveGreedyFrozen(level).solved)()
    : (() => {
      const alive = new Set(level.arrows.map((a) => a.id));
      const occ = new Set<number>();
      for (const a of level.arrows) for (const c of a.cells) occ.add(c.y * 4096 + c.x);
      let progress = true;
      while (progress && alive.size) {
        progress = false;
        for (const a of level.arrows) {
          if (!alive.has(a.id)) continue;
          const cor = corridorCells(level, a);
          if (cor.some((c) => occ.has(c.y * 4096 + c.x))) continue;
          for (const c of a.cells) occ.delete(c.y * 4096 + c.x);
          alive.delete(a.id);
          progress = true;
        }
      }
      return alive.size === 0;
    })();

  const memo = new Map<number, number>();
  const visiting = new Set<number>();
  let cycle = false;
  const depth = (id: number): number => {
    const hit = memo.get(id);
    if (hit !== undefined) return hit;
    if (visiting.has(id)) {
      cycle = true;
      return 0;
    }
    visiting.add(id);
    let best = 0;
    for (const b of blockers.get(id) ?? []) best = Math.max(best, depth(b));
    visiting.delete(id);
    const value = best + 1;
    memo.set(id, value);
    return value;
  };
  let chainDepth = 0;
  for (const a of level.arrows) chainDepth = Math.max(chainDepth, depth(a.id));

  const free0 = level.arrows
    .filter((a) => !a.frozen && blockers.get(a.id)!.size === 0)
    .map((a) => a.id);
  const trials = 240;
  let forced = 0;
  let steps = 0;
  let decision = 0;
  let longestForced = 0;
  let runCount = 0;
  let freeSum = 0;
  const rng = new Rng(0x51ed2701 + level.id);

  for (let t = 0; t < trials; t++) {
    const counts = new Map<number, number>();
    const free = [...free0];
    for (const a of level.arrows) counts.set(a.id, blockers.get(a.id)!.size);
    let lastFree = free.length;
    let run = 0;
    let removed = 0;
    let localForced = 0;
    while (removed < level.arrows.length) {
      if (!free.length) break;
      const idx = rng.int(free.length);
      const id = free[idx];
      free[idx] = free[free.length - 1];
      free.pop();
      lastFree = free.length + 1;
      freeSum += lastFree;
      if (lastFree === 1) {
        localForced++;
        run++;
        longestForced = Math.max(longestForced, run);
      } else {
        if (run > 0) runCount++;
        run = 0;
      }
      if (lastFree > 1) decision++;
      steps++;
      removed++;
      for (const d of dependents.get(id) ?? []) {
        const c = (counts.get(d) ?? 0) - 1;
        counts.set(d, c);
        if (c === 0) free.push(d);
      }
    }
    forced += localForced;
    if (run > 0) runCount++;
  }

  // Chains where every step is blocked by exactly one predecessor: a forced
  // local order. We follow from a free root through single-dependency children.
  const unique: number[] = [];
  let longestUnique = 0;
  let chokes = 0;
  for (const root of free0) {
    const chain = [root];
    const chainSet = new Set<number>([root]);
    let guard = 0;
    let cur = root;
    while (guard++ < level.arrows.length) {
      // The next forced step is the unique arrow whose blockers are already
      // a subset of this chain. This also recognises a lane whose arrows are
      // blocked by the whole prefix (A1; A1+A2; ...), not only by one arrow.
      const nexts = level.arrows
        .map((a) => a.id)
        .filter((id) => {
          if (chainSet.has(id)) return false;
          const bs = blockers.get(id) ?? new Set<number>();
          if (!bs.size) return false;
          for (const b of bs) if (!chainSet.has(b)) return false;
          return true;
        });
      if (nexts.length !== 1) break;
      cur = nexts[0];
      chain.push(cur);
      chainSet.add(cur);
    }
    if (chain.length >= 3) {
      unique.push(chain.length);
      longestUnique = Math.max(longestUnique, chain.length);
      const unlock = [...(dependents.get(cur) ?? [])].filter((id) => !chainSet.has(id)).length;
      if (unlock >= 4) chokes++;
    }
  }

  const blockerCounts = level.arrows.map((a) => blockers.get(a.id)!.size);
  const freeRatio = free0.length / Math.max(1, level.arrows.length);

  return {
    freeAtStart: free0.length,
    freeRatio,
    chainDepth,
    forcedRatio: steps ? forced / steps : 0,
    longestForcedRun: longestForced,
    forcedRunCount: runCount / trials,
    decisionPoints: decision / trials,
    avgFree: steps ? freeSum / steps : 0,
    uniqueChains: unique,
    longestUnique,
    chokeUnlocks: chokes,
    medianBlockers: median(blockerCounts),
    maxBlockers: Math.max(0, ...blockerCounts),
    solvable: solvableCheck,
    cycle,
  };
}

export function scoreLevel(level: Level): ScoreReport {
  const { blockers, dependents } = blockerGraph(level);
  const dist = analyzeDistribution(level);
  const dep = analyzeDependencies(level, blockers, dependents);
  const n = Math.max(1, level.arrows.length);
  const maskArea = level.mask ? level.mask.reduce((a, b) => a + b, 0) : level.cols * level.rows;
  const cells = level.arrows.reduce((s, a) => s + a.cells.length, 0);
  const fill = cells / Math.max(1, maskArea);

  let boundary = 0;
  let boundaryCells = 0;
  if (level.mask) {
    const occ = new Set<number>();
    for (const a of level.arrows) for (const c of a.cells) occ.add(c.y * 4096 + c.x);
    // Only the outer silhouette counts; hole edges (B counters, bag handles)
    // are interior detail, not the shape outline.
    const outside = new Uint8Array(level.cols * level.rows);
    const q: number[] = [];
    for (let x = 0; x < level.cols; x++) {
      for (const y of [0, level.rows - 1]) {
        const i = y * level.cols + x;
        if (!level.mask[i] && !outside[i]) { outside[i] = 1; q.push(i); }
      }
    }
    for (let y = 0; y < level.rows; y++) {
      for (const x of [0, level.cols - 1]) {
        const i = y * level.cols + x;
        if (!level.mask[i] && !outside[i]) { outside[i] = 1; q.push(i); }
      }
    }
    while (q.length) {
      const i = q.pop()!;
      const x = i % level.cols;
      const y = Math.floor(i / level.cols);
      for (const v of DIR_VECTORS) {
        const nx = x + v.x;
        const ny = y + v.y;
        if (nx < 0 || ny < 0 || nx >= level.cols || ny >= level.rows) continue;
        const j = ny * level.cols + nx;
        if (level.mask[j] || outside[j]) continue;
        outside[j] = 1;
        q.push(j);
      }
    }
    for (let y = 0; y < level.rows; y++) {
      for (let x = 0; x < level.cols; x++) {
        if (!level.mask[y * level.cols + x]) continue;
        let edge = x === 0 || y === 0 || x === level.cols - 1 || y === level.rows - 1;
        if (!edge) {
          for (const v of DIR_VECTORS) {
            const j = (y + v.y) * level.cols + (x + v.x);
            if (outside[j]) { edge = true; break; }
          }
        }
        if (!edge) continue;
        boundaryCells++;
        if (occ.has(y * 4096 + x)) boundary++;
      }
    }
  } else {
    boundary = boundaryCells = 1;
  }
  const boundaryCoverage = boundaryCells ? boundary / boundaryCells : 1;

  const gates: GateFailure[] = [];
  if (!dep.solvable) gates.push({ id: 'solvable', detail: 'greedy solve failed' });
  if (dep.cycle) gates.push({ id: 'cycle', detail: 'blocker graph cycle' });
  if (fill < 0.92) gates.push({ id: 'fill', detail: `fill ${(fill * 100).toFixed(1)}% < 92%` });
  if (level.arrows.length < 40) gates.push({ id: 'count', detail: `${level.arrows.length} arrows < 40` });
  const badSingle = level.arrows.some((a) => {
    if (a.cells.length >= 2) return false;
    const c = a.cells[0];
    if (!level.mask) return false;
    return !(c.x === 0 || c.y === 0 || c.x === level.cols - 1 || c.y === level.rows - 1 ||
      !level.mask[c.y * level.cols + c.x - 1] ||
      !level.mask[c.y * level.cols + c.x + 1] ||
      !level.mask[(c.y - 1) * level.cols + c.x] ||
      !level.mask[(c.y + 1) * level.cols + c.x]);
  });
  if (badSingle) gates.push({ id: 'minLen', detail: '1-cell interior arrow' });
  if (dist.maxStraight > 5) gates.push({ id: 'straight', detail: `max straight ${dist.maxStraight} > 5` });
  if (dep.freeAtStart < 1) gates.push({ id: 'free', detail: 'no free arrow at start' });
  // 禅意关无时限（timeLimit 0），跳过时间门禁。
  if (level.mode !== 'zen' && level.timeLimit < 20) gates.push({ id: 'time', detail: 'time limit < 20s' });
  if (boundaryCoverage < 0.90) gates.push({ id: 'boundary', detail: `boundary ${(boundaryCoverage * 100).toFixed(1)}%` });

  const lengthTarget = [0.25, 0.45, 0.25, 0.05];
  const turnTarget = [0.25, 0.5, 0.25];
  const runTarget = [0.75, 0.18, 0.05, 0.02];
  const lengthMatch = 1 - l1(dist.lengthShare, lengthTarget) / 2;
  const turnMatch = 1 - l1(dist.turnShare, turnTarget) / 2;
  const runMatch = 1 - l1(dist.runShare, runTarget) / 2;
  let distributionScore =
    100 * (0.4 * lengthMatch + 0.35 * turnMatch + 0.25 * runMatch);
  if (dist.longShare > 0.12) distributionScore -= (dist.longShare - 0.12) * 300;
  if (dist.shortShare > 0.35) distributionScore -= (dist.shortShare - 0.35) * 200;
  if (dist.zeroTurnShare > 0.3) distributionScore -= (dist.zeroTurnShare - 0.3) * 200;
  if (dist.maxStraight > 4) distributionScore -= (dist.maxStraight - 4) * 12;
  distributionScore -= dist.spatialDeviation * 15;
  distributionScore = clamp(distributionScore, 0, 100);

  const freeScore = band(dep.freeRatio, 0.04, 0.1, 0.04);
  const depthScore = clamp((dep.chainDepth / 8) * 100, 0, 100);
  const forcedScore = band(dep.forcedRatio, 0.05, 0.2, 0.1);
  // Decision points scale with level length: a 130-arrow picture naturally
  // has more branch moments than a 50-arrow one. Score the ratio, not an
  // absolute count.
  const decisionRatio = dep.decisionPoints / Math.max(1, level.arrows.length);
  const decisionScore = band(decisionRatio, 0.25, 0.95, 0.2);
  const difficultyScore = clamp(
    0.3 * freeScore + 0.25 * depthScore + 0.25 * forcedScore + 0.2 * decisionScore,
    0,
    100,
  );

  const uniqueCountScore = clamp((dep.uniqueChains.length / 2) * 100, 0, 100);
  const uniqueLenScore = clamp((dep.longestUnique / 5) * 100, 0, 100);
  const staticUniqueScore = clamp(0.4 * uniqueCountScore + 0.6 * uniqueLenScore, 0, 100);
  // A forced window (free count == 1 for several moves) is also a local
  // unique order even when no single-prefix chain is exposed statically.
  const forcedWindowScore = clamp(
    0.6 * Math.min(1, dep.longestForcedRun / 5) * 100 +
    0.4 * Math.min(1, dep.forcedRunCount / 3) * 100,
    0,
    100,
  );
  const uniqueScore = Math.max(staticUniqueScore, forcedWindowScore);

  const runScore = band(dep.longestForcedRun, 3, 8, 4);
  const runCountScore = band(dep.forcedRunCount, 3, 10, 5);
  const pacingScore = clamp(0.5 * runScore + 0.3 * runCountScore + 0.2 * decisionScore, 0, 100);

  const entropyScore = dist.directionEntropy * 100;
  const occlusionScore = band(dep.medianBlockers, 2, 8, 6);
  const maxOcclusionScore = dep.maxBlockers <= 30 ? 100 : clamp(100 - (dep.maxBlockers - 30) * 4, 0, 100);
  const clarityScore = clamp(0.4 * entropyScore + 0.4 * occlusionScore + 0.2 * maxOcclusionScore, 0, 100);

  const fillScore = fill >= 0.92 ? 100 : clamp(fill * 100, 0, 100);
  const shapeScore = clamp(0.6 * fillScore + 0.4 * boundaryCoverage * 100, 0, 100);

  const estimatedT80 =
    n * (1.1 + 0.18 * dep.avgFree + 0.06 * dist.avgLength + 0.08 * dist.avgTurns) * 1.2 + 15;
  const buffer = level.timeLimit - estimatedT80;
  const timeScore =
    level.mode === 'zen' ? 100 : clamp(100 - Math.abs(buffer - 30) * 2.5, 0, 100);

  const fairnessScore = gates.length ? 0 : 100;

  let total =
    0.1 * shapeScore +
    0.2 * distributionScore +
    0.2 * difficultyScore +
    0.2 * uniqueScore +
    0.1 * pacingScore +
    0.1 * clarityScore +
    0.05 * timeScore +
    0.05 * fairnessScore;
  if (gates.length) total = Math.min(total, 40);

  return {
    id: level.id,
    shape: level.shape ?? 'rect',
    cols: level.cols,
    rows: level.rows,
    arrows: level.arrows.length,
    fill,
    boundaryCoverage,
    timeLimit: level.timeLimit,
    estimatedT80: Math.round(estimatedT80),
    total: Math.round(clamp(total, 0, 100)),
    passed: gates.length === 0 && total >= 90,
    subscores: {
      shape: Math.round(shapeScore),
      distribution: Math.round(distributionScore),
      difficulty: Math.round(difficultyScore),
      unique: Math.round(uniqueScore),
      pacing: Math.round(pacingScore),
      clarity: Math.round(clarityScore),
      time: Math.round(timeScore),
      fairness: Math.round(fairnessScore),
    },
    distribution: dist,
    dependency: dep,
    gates,
  };
}