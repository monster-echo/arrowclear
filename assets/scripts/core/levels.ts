import { generateLevel, GenOptions, solveGreedy } from './levelgen';
import { generateMasterLevel, MasterSpec } from './arrowscore';
import { ACORN_COLS, ACORN_ROWS, acornMask } from './acorn';
import { scoreLevel } from './scoring';
import { getChallengeLevel, CHALLENGE_ID } from './challenge';
import { applyFreeze, solveGreedyFrozen } from './frozen';
import {
  compileShapeScaled,
  festivalForDate,
  MAJOR_SHAPES,
  MINOR_SHAPES,
  proceduralBoardMask,
  ShapeMask,
} from './shapes';
import { Rng } from './rng';
import { Level, LevelMode } from './types';

export interface LevelSpec extends Omit<GenOptions, 'seed'> {
  seed: number;
  /** Pacing variant for this level. */
  mode: LevelMode;
  /** Fraction of arrows to freeze (0 = no frozen arrows). */
  freezeDensity: number;
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
  /** 平均冰冻密度（开局自由箭与禅意关不冻结）。 */
  freezeDensity: number;
}

export const WORLDS: WorldSpec[] = [
  { name: 'Sunny Meadow', timeCap: 180, bossTimeCap: 150, freezeDensity: 0.07 },
  { name: 'Frozen Castle', timeCap: 210, bossTimeCap: 180, freezeDensity: 0.15 },
  { name: 'Art Gallery', timeCap: 210, bossTimeCap: 180, freezeDensity: 0.18 },
  { name: 'World Tour', timeCap: 240, bossTimeCap: 240, freezeDensity: 0.22 },
  { name: 'Royal Throne', timeCap: 300, bossTimeCap: 300, freezeDensity: 0.28 },
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
 * 漏斗手术目标（按世界）：v3 尺度固定（40~65 / 20~36 / 8~16 / 4~9 / 3~6），
 * 难度爬坡由盘面尺寸 + 开局可动数收敛控制。
 */
function masterParamsFor(world: number): Pick<MasterSpec, 'targetMovable'> {
  switch (world) {
    case 1:
      return { targetMovable: 3 };
    case 2:
      return { targetMovable: 2 };
    case 3:
      return { targetMovable: 2 };
    case 4:
      return { targetMovable: 1 };
    default:
      return { targetMovable: 1 };
  }
}

/** 世界三的图案占比 ≥50%：偶数步（0,2,4,8,10,12,14,16,17）也走剪影。 */
function wantsPictureBoard(id: number): boolean {
  if (isMajorPicture(id) || isMinorPicture(id)) return true;
  if (worldOf(id) !== 3) return false;
  const step = stepOf(id);
  if (isBoss(id) || isSprint(id)) return false;
  return step % 2 === 0 || step === 17;
}

function freezeDensityFor(id: number): number {
  // 冰冻箭 L41 首发（规则书 §4）：教学关恰好 2 支（finishLevel 定死数量）。
  if (id === 41) return 0.02;
  if (isZen(id)) return 0;
  const step = stepOf(id);
  if (step <= 1) return 0; // 章首爽关不冻结
  const world = worldOf(id);
  if (world === 1) {
    // 冰冻箭 L41 首发（规则书 §4）：首关固定 2 支，密度缓慢上升。
    if (id < 41) return 0;
    if (id <= 60) return 0.05;
    if (id <= 80) return 0.07;
    return 0.09;
  }
  const base = WORLDS[world - 1].freezeDensity;
  // 章内微爬坡：章首 0.85×，章尾 1.1×。
  const t = step / (CHAPTER_SIZE - 1);
  return base * lerp(0.85, 1.1, t);
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
    freezeDensity: freezeDensityFor(clamped),
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

  // 冰冻（规则书 §4）：撒在「被挡且四邻≥2箭」的箭上，不碰开局自由箭。
  if (spec.freezeDensity > 0 && level.arrows.length > 12) {
    const rng = new Rng(spec.seed ^ 0x5eed);
    let count = Math.round(level.arrows.length * spec.freezeDensity);
    if (spec.id === 41) count = 2; // 首发教学关：恰好 2 支
    applyFreeze(level, count, rng);
  }

  // 时长（规则书 §2）：T80 + 30s，按世界封顶；冲刺减半；禅意无时限。
  const world = worldOf(spec.id);
  const cap = WORLDS[world - 1].timeCap;
  const report = scoreLevel(level);
  if (spec.mode === 'zen') {
    level.timeLimit = 0;
  } else if (spec.mode === 'sprint') {
    const full = Math.min(cap, Math.max(45, report.estimatedT80 + 30));
    level.timeLimit = Math.max(45, Math.round(full / 2 / 5) * 5);
  } else if (spec.mask) {
    // 图案关：3~5 分钟游玩量（180~300s），不受小盘世界封顶约束。
    level.timeLimit = Math.min(300, Math.max(180, Math.round((report.estimatedT80 + 30) / 5) * 5));
  } else {
    level.timeLimit = Math.min(cap, Math.max(30, Math.round((report.estimatedT80 + 30) / 5) * 5));
  }
  return level;
}

/**
 * 质量门禁：按五维评分重摇，直到达标。
 * 低分关不允许出现在正式关卡表里（最多 6 次尝试，取首个达标；全不达标取最佳）。
 */
const GATE_ATTEMPTS = 16;
const GATE_SEED_STEP = 104729;

function buildGated(
  id: number,
  cols: number,
  rows: number,
  seed: number,
  mask: Uint8Array | undefined,
  params: Pick<MasterSpec, 'targetMovable'>,
  withBoss: boolean,
): Level | null {
  // 达标 = 评分过线 && 开局可动 ≤ 目标+1（单线漏斗是本算法招牌，必须卡住）。
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
    // 综合排名：评分为主，可动超标重罚。
    const rank =
      lv.report.totalScore -
      Math.max(0, lv.report.initialMovable - (targetMovable + 1)) * 8 -
      (mask && (lv.report.arrows < 85 || lv.report.arrows > 130) ? 20 : 0);
    if (rank > bestRank) {
      best = lv;
      bestRank = rank;
    }
    const arrowsOk = !mask || (lv.report.arrows >= 85 && lv.report.arrows <= 130);
    if (lv.report.passes && lv.report.initialMovable <= targetMovable + 1 && arrowsOk) return lv;
  }
  return best;
}

function buildLevel(spec: LevelSpec): Level | null {
  const chapter = chapterOf(spec.id);
  const step = stepOf(spec.id);
  const world = worldOf(spec.id);

  // 唯一主力算法：四阶段多尺度巨蟒包络（用户新算法移植）。
  // Boss 变化：教学关与每章中段（step 10）无 Boss，打破千篇一律。
  const master = buildGated(
    spec.id,
    spec.cols,
    spec.rows,
    spec.seed,
    spec.mask,
    masterParamsFor(world),
    spec.id !== 1 && stepOf(spec.id) !== 10,
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
 * 返回按顺序要清空的盘面列表；常规关长度为 1。
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
    // 部件盘面下限 13×20：保证 25+ 支箭，箭量分才够得到达标线。
    const cols = Math.round(lerp(13, 16, (world - 2) / 3 + t * 0.15));
    const rows = Math.round(lerp(20, 25, (world - 2) / 3 + t * 0.15));
    // Boss 三连打也用新算法（四阶段巨蟒包络）：小盘 + 漏斗逐段收紧；
    // 同样过质量门禁，低分部件自动换种子重摇。
    const gated = buildGated(
      clamped,
      cols,
      rows,
      spec.seed + part * 7919,
      undefined,
      { targetMovable: part === 1 ? 3 : part === 2 ? 2 : 1 },
      true,
    );
    const built = gated ?? getLevel(clamped); // 终极兜底：退化为常规盘
    built.id = clamped;
    built.part = part;
    built.mode = 'boss';
    built.chapter = chapterOf(clamped);
    built.step = stepOf(clamped);
    const report = scoreLevel(built);
    built.timeLimit = Math.min(cap, Math.max(45, Math.round((report.estimatedT80 + 20) / 5) * 5));
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

export { solveGreedy, solveGreedyFrozen };
