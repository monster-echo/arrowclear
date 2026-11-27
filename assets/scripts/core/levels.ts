import { freeAtStartCount, generateLevel, GenOptions, solveGreedy } from './levelgen';
import { generateMasterLevel, MasterSpec } from './arrowscore';
import { ACORN_COLS, ACORN_ROWS, acornMask } from './acorn';
import { scoreLevel } from './scoring';
import { getChallengeLevel, CHALLENGE_ID } from './challenge';
import {
  compileShapeScaled,
  festivalForDate,
  MAJOR_SHAPES,
  MINOR_SHAPES,
  proceduralBoardMask,
  ShapeMask,
} from './shapes';
import { BOSS_PART_TIME_OVERRIDES, LEVEL_TIME_OVERRIDES } from './levelTimes';
import { Level, LevelMode } from './types';

export interface LevelSpec extends Omit<GenOptions, 'seed'> {
  seed: number;
  /** Pacing variant for this level. */
  mode: LevelMode;
  /** True when the level is one part of a 3-part boss gauntlet. */
  bossPart?: boolean;
}

/* ------------------------------------------------------------------ */
/* 500 关总体结构：5 世界 × 5 章 × 20 关（规则书 §2）。                */
/* ------------------------------------------------------------------ */

export const LEVEL_COUNT = 500;
export const CHAPTER_SIZE = 20;
export const CHAPTER_COUNT = LEVEL_COUNT / CHAPTER_SIZE; // 25
/** 千层箭阵彩蛋关：主线之外，首页直达（原 61 关挑战位迁移）。 */
export const BONUS_CHALLENGE_ID = 501;

export interface WorldSpec {
  name: string;
  /** timeLimit 上限（秒）；禅意关无时限。 */
  timeCap: number;
  /** Boss 小关的 timeLimit 上限（秒）。 */
  bossTimeCap: number;
}

export const WORLDS: WorldSpec[] = [
  { name: 'Sunny Meadow', timeCap: 180, bossTimeCap: 150 },
  { name: 'Frozen Castle', timeCap: 195, bossTimeCap: 165 },
  { name: 'Art Gallery', timeCap: 210, bossTimeCap: 180 },
  { name: 'World Tour', timeCap: 225, bossTimeCap: 200 },
  { name: 'Royal Throne', timeCap: 240, bossTimeCap: 220 },
];

export function chapterOf(id: number): number {
  return Math.min(CHAPTER_COUNT, Math.floor((Math.max(1, id) - 1) / CHAPTER_SIZE) + 1);
}

export function worldOf(id: number): number {
  return Math.min(5, Math.floor((chapterOf(id) - 1) / 5) + 1);
}

export function stepOf(id: number): number {
  return (Math.max(1, id) - 1) % CHAPTER_SIZE;
}

export function isMajorPicture(id: number): boolean {
  return id % 10 === 0;
}

export function isMinorPicture(id: number): boolean {
  return stepOf(id) === 6;
}

export function isSprint(id: number): boolean {
  return stepOf(id) === 13;
}

export function isBoss(id: number): boolean {
  return stepOf(id) === 18;
}

export function isZen(id: number): boolean {
  // 章末主图案（每章 L20）与章中小歇（L7）都是禅意关：无时限、无失败。
  return stepOf(id) === 19 || isMinorPicture(id);
}

export function levelMode(id: number): LevelMode {
  if (isSprint(id)) return 'sprint';
  if (isBoss(id)) return 'boss';
  if (isZen(id)) return 'zen';
  return 'normal';
}

/** The bonus challenge level (id 501) is always playable. */
export function isChallenge(id: number): boolean {
  return id === CHALLENGE_ID;
}

/**
 * 每章爬坡尺寸（大 board 关）。以参考盘 22×34 为甜点基准：
 * 世界一从 12×18 教学区起步，世界五封顶 32×48。
 */
const CHAPTER_BOARDS: [number, number][][] = [
  // 世界一：20×30 → 24×36（箭量下限约 80 支）
  [
    [20, 30],
    [21, 32],
  ],
  [
    [21, 32],
    [22, 33],
  ],
  [
    [22, 33],
    [22, 34],
  ],
  [
    [22, 34],
    [23, 35],
  ],
  [
    [23, 35],
    [24, 36],
  ],
  // 世界二：24×36 → 28×42
  [
    [24, 36],
    [25, 37],
  ],
  [
    [25, 37],
    [26, 39],
  ],
  [
    [26, 39],
    [27, 40],
  ],
  [
    [27, 40],
    [28, 42],
  ],
  [
    [28, 42],
    [28, 42],
  ],
  // 世界三：图案世界，底盘由剪影自身决定；非图案关用中盘
  [
    [24, 34],
    [24, 34],
  ],
  [
    [24, 34],
    [25, 36],
  ],
  [
    [25, 36],
    [26, 38],
  ],
  [
    [26, 38],
    [26, 38],
  ],
  [
    [26, 38],
    [28, 40],
  ],
  // 世界四：环球地标，全形态混排
  [
    [28, 40],
    [28, 42],
  ],
  [
    [28, 42],
    [29, 44],
  ],
  [
    [29, 44],
    [30, 45],
  ],
  [
    [30, 45],
    [30, 46],
  ],
  [
    [30, 46],
    [30, 46],
  ],
  // 世界五：王座之巅，32×48 → 34×52
  [
    [32, 48],
    [32, 48],
  ],
  [
    [32, 48],
    [33, 50],
  ],
  [
    [33, 50],
    [33, 50],
  ],
  [
    [33, 50],
    [34, 52],
  ],
  [
    [34, 52],
    [34, 52],
  ],
];

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * 漏斗手术目标 + 锁数量 + 蛇尺缩放（按世界与关位动态爬坡）。
 * 章首 2 关（step 0, 1）放宽入口营造爽感；主力爬坡与精英/Boss 压紧至单线突破口。
 */
function masterParamsFor(
  id: number,
  world: number,
): Pick<MasterSpec, 'targetMovable' | 'lockCount' | 'giantScale' | 'midScale'> {
  const step = stepOf(id);
  const opener = step <= 1;
  const targetMovable = opener
    ? world <= 2
      ? 4
      : world <= 4
        ? 3
        : 2
    : world <= 2
      ? 2
      : 1;

  let lockCount = 3;
  if (world === 1) lockCount = id <= 10 ? 2 : 3;
  else if (world === 2) lockCount = step < 10 ? 3 : 4;
  else if (world === 3) lockCount = step < 10 ? 4 : 5;
  else if (world === 4) lockCount = step < 10 ? 5 : 6;
  else lockCount = step < 10 ? 6 : 8;

  const giantScale: [number, number] = world === 1 ? [26, 42] : world === 2 ? [32, 52] : [40, 65];
  const midScale: [number, number] = world === 1 ? [14, 24] : world === 2 ? [18, 30] : [20, 36];

  return { targetMovable, lockCount, giantScale, midScale };
}

/** 世界三的图案占比 ≥50%：偶数步（0,2,4,8,10,12,14,16,17）也走剪影。 */
function wantsPictureBoard(id: number): boolean {
  if (isMajorPicture(id) || isMinorPicture(id)) return true;
  if (worldOf(id) !== 3) return false;
  const step = stepOf(id);
  if (isBoss(id) || isSprint(id)) return false;
  return step % 2 === 0 || step === 17;
}

/**
 * 大箭头（Boss 箭）不再每关都带：
 * - L1~L14 不出现，让新手先把经典蛇形清盘玩透；
 * - L19（第 1 章 Boss）惊喜首秀；
 * - 禅意关 / 冲刺关 / 图案剪影关 / 章首爽关一律不带大箭头，保持视觉纯净；
 * - 常规爬坡仅在章内精英位（随世界 10%~30% 提升）与 Boss 关（L19）登场。
 */
export function hasBossArrow(id: number): boolean {
  const clamped = Math.max(1, Math.min(LEVEL_COUNT, Math.floor(id)));
  if (clamped < 15) return false;
  if (isZen(clamped) || isSprint(clamped) || wantsPictureBoard(clamped)) return false;
  const step = stepOf(clamped);
  if (step <= 1) return false;
  if (isBoss(clamped)) return true;
  const world = worldOf(clamped);
  switch (world) {
    case 1:
      return step === 15;
    case 2:
    case 3:
      return step === 11 || step === 15;
    case 4:
      return step === 8 || step === 12 || step === 15 || step === 17;
    default:
      return step === 5 || step === 8 || step === 11 || step === 15 || step === 17;
  }
}

/** 图案面积目标：1250~2400 格 ≈ 90~180 支箭 ≈ 3~5 分钟游玩量。 */
const PICTURE_MIN_AREA = 680;
const PICTURE_MAX_AREA = 880;

function maskFor(id: number): ShapeMask | undefined {
  // 节日窗口期：当章 L7 换成节日限定图案（例如 12 月自动变圣诞树）。
  if (isMinorPicture(id)) {
    const fest = festivalForDate(new Date());
    if (fest) {
      return compileShapeScaled(
        { id: fest.id, name: fest.name, rows: fest.rows, scaleX: fest.scaleX, scaleY: fest.scaleY },
        PICTURE_MIN_AREA,
        PICTURE_MAX_AREA,
      );
    }
  }
  if (isMajorPicture(id)) {
    const idx = Math.floor(id / 10) - 1;
    const def = MAJOR_SHAPES[((idx % MAJOR_SHAPES.length) + MAJOR_SHAPES.length) % MAJOR_SHAPES.length];
    return compileShapeScaled(def, PICTURE_MIN_AREA, PICTURE_MAX_AREA);
  }
  if (isMinorPicture(id)) {
    const chapter = Math.max(1, Math.floor((id - 1) / 20) + 1);
    const def = MINOR_SHAPES[(chapter - 1) % MINOR_SHAPES.length];
    return compileShapeScaled(def, PICTURE_MIN_AREA, PICTURE_MAX_AREA);
  }
  if (wantsPictureBoard(id)) {
    const mid = id - (id % 10) + 5;
    const idx = Math.floor(mid / 10) - 1;
    const def = MAJOR_SHAPES[((idx % MAJOR_SHAPES.length) + MAJOR_SHAPES.length) % MAJOR_SHAPES.length];
    return compileShapeScaled(def, PICTURE_MIN_AREA, PICTURE_MAX_AREA);
  }
  return undefined;
}

/**
 * 500 关难度曲线（规则书 §2）。
 */
export function specFor(id: number): LevelSpec {
  const clamped = Math.max(1, Math.min(LEVEL_COUNT, Math.floor(id)));
  const chapter = chapterOf(clamped);
  const step = stepOf(clamped);
  const world = worldOf(clamped);
  const t = step / (CHAPTER_SIZE - 1);

  const [from, to] = CHAPTER_BOARDS[chapter - 1];
  let cols = Math.round(lerp(from[0], to[0], t));
  let rows = Math.round(lerp(from[1], to[1], t));

  let mask: Uint8Array | undefined;
  let shape: string | undefined;
  const pic = maskFor(clamped);
  if (pic) {
    mask = pic.mask;
    shape = pic.id;
    cols = pic.cols;
    rows = pic.rows;
  } else {
    // 普通关：程序化盘面变异（圆角/内洞/边缺口/八边形），告别纯长方形。
    const proc = proceduralBoardMask(77123 + clamped * 65537, cols, rows, Math.min(4, Math.max(2, world - 1)));
    mask = proc.mask;
    shape = proc.name;
  }

  const area = mask ? mask.reduce((a, b) => a + b, 0) : cols * rows;
  const targetArrows = Math.max(12, Math.round(area / 10));

  const minLen = 4;
  const maxLen = Math.round(lerp(9, 14, (world - 1) / 4));

  const freeTarget = Math.max(2, Math.round(5 - (world - 1) * 0.5 - t * 1.2));

  const spec: LevelSpec = {
    id: clamped,
    cols,
    rows,
    targetArrows,
    minLen,
    maxLen,
    freeTarget,
    // 468 号关旧种子群在异形盘上评分困在 68；给它换一个起点即可整体平移。
    seed: clamped === 468 ? 20261116 + clamped * 7919 : 100003 + clamped * 104729,
    mask,
    shape: pic ? shape : 'board',
    mode: levelMode(clamped),
    bossPart: isBoss(clamped) && world >= 2,
  };
  if (clamped === 1) {
    // 首关沿用橡果剪影：品牌记忆点。
    spec.cols = ACORN_COLS;
    spec.rows = ACORN_ROWS;
    spec.mask = acornMask();
    spec.shape = 'acorn';
    spec.targetArrows = Math.round(spec.mask.reduce((a, b) => a + b, 0) / 10);
  }
  return spec;
}

const cache = new Map<number, Level>();
const bossCache = new Map<number, Level[]>();

function finishLevel(level: Level, spec: LevelSpec, chapter: number, step: number): Level {
  level.id = spec.id;
  level.shape = spec.shape ?? 'board';
  level.mode = spec.mode;
  level.chapter = chapter;
  level.step = step;

  // 时长校准：区分真图案关（3~5 分钟休闲节奏）与常规盘（随世界收紧缓冲，体现难度）。
  const world = worldOf(spec.id);
  const cap = WORLDS[world - 1].timeCap;
  const isPicture = !!spec.shape && spec.shape !== 'board';
  const buffer = Math.round(lerp(24, 10, (world - 1) / 4));
  const report = scoreLevel(level);
  if (spec.mode === 'zen') {
    level.timeLimit = 0;
  } else if (LEVEL_TIME_OVERRIDES[spec.id] !== undefined) {
    level.timeLimit = LEVEL_TIME_OVERRIDES[spec.id];
  } else if (spec.mode === 'sprint') {
    const full = Math.min(cap, Math.max(45, report.estimatedT80 + buffer));
    level.timeLimit = Math.max(45, Math.round(full / 2 / 5) * 5);
  } else if (isPicture) {
    level.timeLimit = Math.min(300, Math.max(180, Math.round((report.estimatedT80 + 20) / 5) * 5));
  } else {
    level.timeLimit = Math.min(cap, Math.max(35, Math.round((report.estimatedT80 + buffer) / 5) * 5));
  }
  return level;
}

/**
 * 质量门禁：按四维评分 + 开局漏斗宽度重摇，直到达标。
 */
const GATE_ATTEMPTS = 16;
const GATE_SEED_STEP = 104729;

function buildGated(
  id: number,
  cols: number,
  rows: number,
  seed: number,
  mask: Uint8Array | undefined,
  isPicture: boolean,
  params: Pick<MasterSpec, 'targetMovable' | 'lockCount' | 'giantScale' | 'midScale'>,
  withBoss: boolean,
): Level | null {
  const targetMovable = params.targetMovable ?? 1;
  let best: Level | null = null;
  let bestRank = -Infinity;
  for (let attempt = 0; attempt < GATE_ATTEMPTS; attempt++) {
    const lv = generateMasterLevel({
      id,
      cols,
      rows,
      seed: seed + attempt * GATE_SEED_STEP,
      mask,
      withBoss,
      ...params,
    });
    if (!lv) continue;
    const rank =
      lv.report.totalScore -
      Math.max(0, lv.report.initialMovable - (targetMovable + 1)) * 10 -
      (isPicture && (lv.report.arrows < 85 || lv.report.arrows > 130) ? 20 : 0);
    if (rank > bestRank) {
      best = lv;
      bestRank = rank;
    }
    const arrowsOk = !isPicture || (lv.report.arrows >= 85 && lv.report.arrows <= 130);
    if (lv.report.passes && lv.report.initialMovable <= targetMovable + 1 && arrowsOk) return lv;
  }
  return best;
}

function buildLevel(spec: LevelSpec): Level | null {
  const chapter = chapterOf(spec.id);
  const step = stepOf(spec.id);
  const world = worldOf(spec.id);
  const isPicture = !!spec.shape && spec.shape !== 'board';

  // 主力算法：四阶段多尺度巨蟒包络 + 多锁群落 + 单线漏斗手术。
  const master = buildGated(
    spec.id,
    spec.cols,
    spec.rows,
    spec.seed,
    spec.mask,
    isPicture,
    masterParamsFor(spec.id, world),
    hasBossArrow(spec.id),
  );
  if (master) return finishLevel(master, spec, chapter, step);

  // 兜底：反向构造器（理论上不会走到，保底可玩）。
  const base = generateLevel(spec);
  return finishLevel(base, spec, chapter, step);
}

/** Levels are generated deterministically and cached; first call costs ~5ms. */
export function getLevel(id: number): Level {
  const clamped = Math.max(1, Math.floor(id));
  if (isChallenge(clamped)) {
    const hit = cache.get(clamped);
    if (hit) return hit;
    const challenge = getChallengeLevel();
    cache.set(clamped, challenge);
    return challenge;
  }
  const main = Math.min(LEVEL_COUNT, clamped);
  const hit = cache.get(main);
  if (hit) return hit;
  const spec = specFor(main);
  const level = buildLevel(spec);
  if (!level) {
    // 生成兜底：极小概率规格过紧，放松重试一次。
    const relaxed = buildLevel({ ...spec, targetArrows: Math.floor(spec.targetArrows * 0.85) });
    if (!relaxed) throw new Error(`level ${main} generation failed`);
    cache.set(main, relaxed);
    return relaxed;
  }
  cache.set(main, level);
  return level;
}

/**
 * 一个关卡可能由多张盘组成（世界二起的 Boss 三连打，规则书 §5）：
 * Part 1 预热多锁盘（无 Boss）→ Part 2 Boss 登场 → Part 3 终极单线 Boss。
 */
export function getLevelParts(id: number): Level[] {
  const clamped = Math.max(1, Math.floor(id));
  if (!isBoss(clamped) || worldOf(clamped) < 2) return [getLevel(clamped)];
  const hit = bossCache.get(clamped);
  if (hit) return hit;
  const spec = specFor(clamped);
  const parts: Level[] = [];
  const world = worldOf(clamped);
  const cap = WORLDS[world - 1].bossTimeCap;
  for (let part = 1; part <= 3; part++) {
    const t = (part - 1) / 2;
    const cols = Math.round(lerp(13, 16, (world - 2) / 3 + t * 0.15));
    const rows = Math.round(lerp(20, 25, (world - 2) / 3 + t * 0.15));
    const gated = buildGated(
      clamped,
      cols,
      rows,
      spec.seed + part * 7919,
      undefined,
      false,
      {
        targetMovable: part === 1 ? 2 : part === 2 ? 2 : 1,
        lockCount: part === 3 ? 3 : 2,
        giantScale: [18, 28],
        midScale: [10, 18],
      },
      part >= 2,
    );
    const built = gated ?? getLevel(clamped);
    built.id = clamped;
    built.part = part;
    built.mode = 'boss';
    built.chapter = chapterOf(clamped);
    built.step = stepOf(clamped);
    const bossKey = `${clamped}:${part}`;
    if (BOSS_PART_TIME_OVERRIDES[bossKey] !== undefined) {
      built.timeLimit = BOSS_PART_TIME_OVERRIDES[bossKey];
    } else {
      const report = scoreLevel(built);
      built.timeLimit = Math.min(cap, Math.max(45, Math.round((report.estimatedT80 + 16) / 5) * 5));
    }
    parts.push(built);
  }
  bossCache.set(clamped, parts);
  return parts;
}

export function levelName(id: number): string {
  if (isChallenge(id)) return '挑战 · 千层箭阵';
  if (isMajorPicture(id)) {
    const idx = Math.floor(id / 10) - 1;
    const def = MAJOR_SHAPES[((idx % MAJOR_SHAPES.length) + MAJOR_SHAPES.length) % MAJOR_SHAPES.length];
    return `第 ${id} 关 · ${def.name}`;
  }
  return `第 ${id} 关`;
}

/** 关卡归属的世界名（UI 章节条用）。 */
export function worldName(id: number): string {
  return WORLDS[worldOf(id) - 1].name;
}

export { solveGreedy, freeAtStartCount };
