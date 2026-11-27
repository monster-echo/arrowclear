/**
 * playtest.ts — 人类认知模拟试玩器与关卡评分/时间校准引擎（纯逻辑、引擎无关）。
 *
 * 通过多档玩家画像（Fast / Median / Careful）实际逐箭试玩通关，
 * 采集真实对局指标（清盘耗时 T20/T50/T80、连锁爆发、瓶颈搜索、误触风险），
 * 给出体验向关卡评分，并校准出合理的 `recommendedTime`（秒）。
 */
import { Rng } from './rng';
import { Arrow, Cell, DIR_VECTORS, Level, bossShadowCells, canArrowEscape, cellKey, corridorCells } from './types';

export type PlayerTier = 'fast' | 'median' | 'careful';

interface PlayerProfile {
  tier: PlayerTier;
  baseTapSec: number;
  scanScale: number;
  errorRate: number;
}

const PROFILES: Record<PlayerTier, PlayerProfile> = {
  fast: { tier: 'fast', baseTapSec: 0.2, scanScale: 0.75, errorRate: 0.008 },
  median: { tier: 'median', baseTapSec: 0.27, scanScale: 0.95, errorRate: 0.016 },
  careful: { tier: 'careful', baseTapSec: 0.35, scanScale: 1.15, errorRate: 0.024 },
};

export interface PlayRunMetrics {
  tier: PlayerTier;
  clearTimeSec: number;
  mistakes: number;
  openingFree: number;
  avgFree: number;
  bottleneckSteps: number;
  maxCascadeBurst: number;
  cascadeCount: number;
  maxStepSec: number;
}

export interface PlaytestSubScores {
  tension: number;
  cascade: number;
  pacing: number;
  fairness: number;
  timeFit: number;
}

export interface PlaytestReport {
  id: number;
  part?: number;
  mode: string;
  shape: string;
  arrows: number;
  hasBoss: boolean;
  clearTimeFast: number;
  clearTimeMedian: number;
  clearTimeCareful: number;
  avgMistakes: number;
  openingFree: number;
  avgFree: number;
  bottleneckRatio: number;
  maxCascadeBurst: number;
  cascadeCount: number;
  currentTimeLimit: number;
  recommendedTime: number;
  score: number;
  tier: 'S' | 'A' | 'B' | 'C';
  subScores: PlaytestSubScores;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round5 = (sec: number): number => Math.round(sec / 5) * 5;

function worldOfId(id: number): number {
  const ch = Math.min(25, Math.floor((Math.max(1, id) - 1) / 20) + 1);
  return Math.min(5, Math.floor((ch - 1) / 5) + 1);
}

const WORLD_TIME_CAPS = [180, 195, 210, 225, 240];
const WORLD_BOSS_CAPS = [150, 165, 180, 200, 220];

/** 单次真实逐箭试玩模拟。 */
export function simulatePlayRun(level: Level, tier: PlayerTier, seed: number): PlayRunMetrics {
  const profile = PROFILES[tier];
  const rng = new Rng(seed);
  const alive = new Set(level.arrows.map((a) => a.id));
  const occ = new Map<number, Arrow>();
  for (const a of level.arrows) {
    for (const c of a.cells) occ.set(cellKey(c), a);
    for (const c of bossShadowCells(level, a)) occ.set(cellKey(c), a);
  }

  let elapsed = 0;
  let mistakes = 0;
  let openingFree = 0;
  let freeSum = 0;
  let steps = 0;
  let bottleneckSteps = 0;
  let currentBurst = 0;
  let maxCascadeBurst = 0;
  let cascadeCount = 0;
  let maxStepSec = 0;
  let lastHead: Cell | null = null;

  while (alive.size > 0) {
    const playable: Arrow[] = [];
    let deceptiveBlocked = 0;
    const isBlocked = (c: Cell, selfId: number): boolean => {
      const o = occ.get(cellKey(c));
      return !!o && o.id !== selfId;
    };

    for (const a of level.arrows) {
      if (!alive.has(a.id)) continue;
      if (canArrowEscape(level, a, (c) => isBlocked(c, a.id))) {
        playable.push(a);
      } else {
        // 统计“前段看起来通畅”的迷惑假通道数量，用于模拟人类误触概率。
        const d = DIR_VECTORS[a.dir];
        const h = a.cells[0];
        let clearSteps = 0;
        let cx = h.x + d.x;
        let cy = h.y + d.y;
        while (cx >= 0 && cy >= 0 && cx < level.cols && cy < level.rows) {
          if (isBlocked({ x: cx, y: cy }, a.id)) break;
          clearSteps++;
          cx += d.x;
          cy += d.y;
        }
        if (clearSteps >= 4 || a.isBoss) deceptiveBlocked++;
      }
    }

    if (!playable.length) break;
    if (steps === 0) openingFree = playable.length;
    freeSum += playable.length;
    if (playable.length <= 2) bottleneckSteps++;

    // 人类视觉显著性挑选：优先局部连锁，避免全盘瞬移跳点。
    let best = playable[0];
    let bestRank = -Infinity;
    for (const a of playable) {
      const h = a.cells[0];
      const dist = lastHead ? Math.hypot(h.x - lastHead.x, h.y - lastHead.y) : 0;
      const localBonus = lastHead && dist <= 4.5 ? (5.5 - dist) * 14 : -dist * 0.75;
      const bossBonus = a.isBoss ? 6 : 0;
      const lenBonus = Math.min(8, a.cells.length * 0.35);
      const rank = localBonus + bossBonus + lenBonus + rng.next() * 10;
      if (rank > bestRank) {
        bestRank = rank;
        best = a;
      }
    }

    const head = best.cells[0];
    const dist = lastHead ? Math.hypot(head.x - lastHead.x, head.y - lastHead.y) : 0;
    const isLocalCascade = lastHead !== null && dist <= 5.5;
    if (isLocalCascade) {
      currentBurst++;
    } else {
      if (currentBurst >= 3) cascadeCount++;
      currentBurst = 1;
    }
    if (currentBurst > maxCascadeBurst) maxCascadeBurst = currentBurst;

    // 评估沿途窄门夹壁视觉扫描成本。
    const cor = corridorCells(level, best);
    const d = DIR_VECTORS[best.dir];
    const p1 = { x: -d.y, y: d.x };
    const p2 = { x: d.y, y: -d.x };
    let flankCount = 0;
    for (const c of cor) {
      const o1 = occ.get(cellKey({ x: c.x + p1.x, y: c.y + p1.y }));
      const o2 = occ.get(cellKey({ x: c.x + p2.x, y: c.y + p2.y }));
      if (o1 && o1.id !== best.id && o2 && o2.id !== best.id) flankCount++;
    }

    // 人类步进耗时拆分：点击起飞 + 视线转移 + 瓶颈全盘搜索 + 通道确认。
    let stepSec = profile.baseTapSec;
    stepSec += isLocalCascade
      ? Math.min(6, dist) * 0.025
      : (0.08 + Math.min(18, dist) * 0.028) * profile.scanScale;

    if (playable.length <= 2 && alive.size > 10) {
      stepSec += (playable.length === 1 ? 0.95 : 0.5) * Math.sqrt(alive.size / 60) * profile.scanScale;
    }
    stepSec += (Math.min(14, cor.length) * 0.018 + Math.min(8, flankCount) * 0.022) * profile.scanScale;
    if (best.isBoss) stepSec += 0.38 * profile.scanScale;

    // 模拟人类在窄门/假通道压力下的误触停顿。
    if (deceptiveBlocked > 0 && steps > 0) {
      const pressure = Math.min(1, deceptiveBlocked / 10) * (playable.length <= 2 ? 1.45 : 0.85);
      if (rng.next() < profile.errorRate * pressure) {
        mistakes++;
        stepSec += 1.1 * profile.scanScale;
      }
    }

    // 移除箭头。
    for (const c of best.cells) occ.delete(cellKey(c));
    for (const c of bossShadowCells(level, best)) occ.delete(cellKey(c));
    alive.delete(best.id);

    elapsed += stepSec;
    if (stepSec > maxStepSec) maxStepSec = stepSec;
    lastHead = head;
    steps++;
  }

  if (currentBurst >= 3) cascadeCount++;

  return {
    tier,
    clearTimeSec: elapsed,
    mistakes,
    openingFree,
    avgFree: steps > 0 ? freeSum / steps : 0,
    bottleneckSteps,
    maxCascadeBurst,
    cascadeCount,
    maxStepSec,
  };
}

/** 计算试玩校准后的合理限时（秒；禅意关为 0）。 */
export function computeRecommendedTime(
  level: Pick<Level, 'id' | 'mode' | 'shape' | 'part'>,
  t50: number,
  t80: number,
): number {
  const mode = level.mode ?? 'normal';
  if (mode === 'zen') return 0;

  const world = worldOfId(level.id);
  const cap = WORLD_TIME_CAPS[world - 1];
  const bossCap = WORLD_BOSS_CAPS[world - 1];
  const isPicture = !!level.shape && level.shape !== 'board';

  if (mode === 'sprint') {
    const raw = Math.max(t50 * 1.15 + 10, t80 * 0.92 + 5);
    return clamp(round5(raw), 45, round5(cap * 0.65));
  }
  if (mode === 'boss' && level.part) {
    const raw = Math.max(t50 * 1.3 + 12, t80 + 18);
    return clamp(round5(raw), 45, bossCap);
  }
  if (isPicture) {
    const raw = Math.max(180, t80 + 35);
    return clamp(round5(raw), 180, 300);
  }

  const buffers = [25, 20, 18, 15, 12];
  const floors = [45, 50, 55, 60, 65];
  const buf = buffers[world - 1] ?? 15;
  const floor = floors[world - 1] ?? 50;
  const raw = Math.max(t50 * 1.25 + 8, t80 + buf);
  return clamp(round5(raw), floor, cap);
}

/** 对单张盘面执行多画像试玩并给出体验评分与校准时间。 */
export function playtestLevel(level: Level): PlaytestReport {
  const baseSeed = level.seed ^ (level.id * 2654435761) ^ ((level.part ?? 0) * 97531);
  const runs: PlayRunMetrics[] = [
    simulatePlayRun(level, 'fast', baseSeed + 11),
    simulatePlayRun(level, 'median', baseSeed + 23),
    simulatePlayRun(level, 'median', baseSeed + 37),
    simulatePlayRun(level, 'median', baseSeed + 53),
    simulatePlayRun(level, 'careful', baseSeed + 71),
    simulatePlayRun(level, 'careful', baseSeed + 97),
  ];

  const avg = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const fastRun = runs.filter((r) => r.tier === 'fast');
  const medRuns = runs.filter((r) => r.tier === 'median');
  const careRuns = runs.filter((r) => r.tier === 'careful');

  const clearTimeFast = Math.round(avg(fastRun.map((r) => r.clearTimeSec)));
  const clearTimeMedian = Math.round(avg(medRuns.map((r) => r.clearTimeSec)));
  const clearTimeCareful = Math.round(avg(careRuns.map((r) => r.clearTimeSec)));
  const avgMistakes = Math.round(avg(runs.map((r) => r.mistakes)) * 10) / 10;
  const openingFree = runs[0].openingFree;
  const avgFree = Math.round(avg(runs.map((r) => r.avgFree)) * 10) / 10;
  const n = Math.max(1, level.arrows.length);
  const bottleneckRatio = Math.round((avg(runs.map((r) => r.bottleneckSteps)) / n) * 1000) / 1000;
  const maxCascadeBurst = Math.round(avg(runs.map((r) => r.maxCascadeBurst)));
  const cascadeCount = Math.round(avg(runs.map((r) => r.cascadeCount)) * 10) / 10;

  const recommendedTime = computeRecommendedTime(level, clearTimeMedian, clearTimeCareful);

  // 五维试玩体验评分（总分 100）：
  // 1. 突破紧张感（25分）：开局漏斗收敛 + 全程单/双线思考占比
  const openScore = openingFree <= 2 ? 13 : openingFree <= 4 ? 11 : openingFree <= 6 ? 8 : Math.max(2, 12 - openingFree);
  const bnScore = clamp((bottleneckRatio / 0.14) * 12, 3, 12);
  const tension = Math.round(openScore + bnScore);

  // 2. 锁与连锁爽感（30分）：最大连消长度 + 连锁次数
  const burstScore = clamp(((maxCascadeBurst - 2) / 6) * 12, 2, 12);
  const countScore = clamp((cascadeCount / Math.max(3, n * 0.08)) * 12, 2, 12);
  const cascadeBonus = 5;
  const cascade = Math.round(burstScore + countScore + cascadeBonus);

  // 3. 节奏波浪（20分）：平均可飞窗口在甜点 2.2~6.5，且有张有弛
  const avgFreeScore =
    avgFree >= 2.2 && avgFree <= 6.5
      ? 14
      : clamp(14 - Math.abs(avgFree - (avgFree < 2.2 ? 2.2 : 6.5)) * 2.4, 4, 14);
  const contrast = clamp((avg(runs.map((r) => r.maxStepSec)) / 3.5) * 6, 2, 6);
  const pacing = Math.round(avgFreeScore + contrast);

  // 4. 公平与容错（15分）：模拟平均误触保持在 3 颗爱心安全区内
  const mistakeLimit = level.mode === 'sprint' ? 3.5 : 2.2;
  const fairness =
    avgMistakes <= mistakeLimit
      ? 15
      : Math.round(clamp(15 - (avgMistakes - mistakeLimit) * 5, 3, 15));

  // 5. 时限匹配度（10分）：当前限时与试玩校准时长的吻合度
  const timeFit =
    level.mode === 'zen'
      ? 10
      : Math.round(clamp(10 - Math.abs(level.timeLimit - recommendedTime) / 12, 0, 10));

  const score = clamp(tension + cascade + pacing + fairness + timeFit, 0, 100);
  const tier: 'S' | 'A' | 'B' | 'C' = score >= 85 ? 'S' : score >= 75 ? 'A' : score >= 62 ? 'B' : 'C';

  return {
    id: level.id,
    part: level.part,
    mode: level.mode ?? 'normal',
    shape: level.shape ?? 'board',
    arrows: level.arrows.length,
    hasBoss: level.arrows.some((a) => a.isBoss),
    clearTimeFast,
    clearTimeMedian,
    clearTimeCareful,
    avgMistakes,
    openingFree,
    avgFree,
    bottleneckRatio,
    maxCascadeBurst,
    cascadeCount,
    currentTimeLimit: level.timeLimit,
    recommendedTime,
    score,
    tier,
    subScores: { tension, cascade, pacing, fairness, timeFit },
  };
}
