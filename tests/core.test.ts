/**
 * Core rule-engine test suite (no browser, no Cocos).
 *
 * Covers: level integrity (sampled across the 500-level structure), the
 * chapter/world/mode layout, determinism, solvability,
 * monotonicity, colouring, energy, and generation performance.
 *
 * Full 500-level sweep lives in `tools/check-levels.ts` (npm run test:levels);
 * this suite samples so it stays fast.
 *
 * Run: npm run test:core
 */
import { Rng } from '../assets/scripts/core/rng';
import { playtestLevel, simulatePlayRun } from '../assets/scripts/core/playtest';
import {
  analyzeLevel,
  arrowsFreeAtStart,
  generateLevel,
  GenOptions,
  solveGreedy,
} from '../assets/scripts/core/levelgen';
import {
  CHAPTER_COUNT,
  LEVEL_COUNT,
  WORLDS,
  chapterOf,
  getLevel,
  getLevelParts,
  hasBossArrow,
  isChallenge,
  levelMode,
  solveGreedy,
  freeAtStartCount,
  specFor,
  stepOf,
  worldOf,
} from '../assets/scripts/core/levels';
import { majorShapeForLevel } from '../assets/scripts/core/shapes';
import {
  ENERGY_COST_PER_LEVEL,
  ENERGY_MAX,
  ENERGY_REGEN_MS,
  ENERGY_WIN_REFUND,
  canStartLevel,
  energyNextInMs,
  formatEnergyClock,
  fullEnergy,
  grantEnergy,
  refundEnergy,
  refillEnergy,
  spendEnergy,
  syncEnergy,
} from '../assets/scripts/core/energy';
import {
  bossShadowCells,
  canArrowEscape,
  cellKey,
  corridorCells,
  DIR_VECTORS,
  Level,
} from '../assets/scripts/core/types';

let passed = 0;
const failures: string[] = [];
const timings: { name: string; ms: number }[] = [];

function check(cond: boolean, name: string, detail = ''): void {
  if (cond) {
    passed++;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function time(name: string, fn: () => void): void {
  const t0 = performance.now();
  fn();
  timings.push({ name, ms: Math.round(performance.now() - t0) * 10 / 10 });
}

function fingerprint(level: Level): string {
  return JSON.stringify({
    cols: level.cols,
    rows: level.rows,
    time: level.timeLimit,
    arrows: level.arrows.map((a) => ({ c: a.cells, d: a.dir, k: a.color })),
  });
}

// ---------------------------------------------------------------- RNG

console.log('\n[1] RNG');
{
  const a = new Rng(42);
  const b = new Rng(42);
  const seqA = Array.from({ length: 20 }, () => a.next());
  const seqB = Array.from({ length: 20 }, () => b.next());
  check(JSON.stringify(seqA) === JSON.stringify(seqB), 'same seed → same sequence');
  const c = new Rng(43);
  check(seqA.some((v, i) => v !== c.next()), 'different seed → different sequence');
  const r = new Rng(7);
  const ints = new Set<number>();
  for (let i = 0; i < 500; i++) ints.add(r.int(10));
  check(ints.size === 10, 'int(10) covers 0..9');
  check(
    Array.from(ints).every((v) => v >= 0 && v < 10),
    'int(10) stays in range',
  );
}

// ---------------------------------------------------------------- integrity

function assertLevelIntegrity(level: Level, label: string, allowCornerHead = false): void {
  check(level.arrows.length >= 6, `${label}: at least 6 arrows`, `got ${level.arrows.length}`);
  check(level.cols >= 6 && level.cols <= 64, `${label}: cols sane`);
  check(level.rows >= 8 && level.rows <= 80, `${label}: rows sane`);
  // 禅意关 timeLimit=0（无时限），其余模式受世界封顶约束。
  if (level.mode === 'zen') {
    check(level.timeLimit === 0, `${label}: zen has no time limit`);
  } else {
    check(level.timeLimit >= 30 && level.timeLimit <= 480, `${label}: time limit sane`);
  }

  const occupied = new Map<number, number>();
  let overlap = 0;
  let outOfBounds = 0;
  let gaps = 0;
  let short = 0;
  let misaligned = 0;

  for (const a of level.arrows) {
    if (a.cells.length < 2) short++;
    if (a.color < 0 || a.color > 11) check(false, `${label}: colour in palette`);
    const d = DIR_VECTORS[a.dir];
    const dx = a.cells[1].x - a.cells[0].x;
    const dy = a.cells[1].y - a.cells[0].y;
    if (dx !== -d.x || dy !== -d.y) misaligned++;

    for (let i = 0; i < a.cells.length; i++) {
      const c = a.cells[i];
      if (c.x < 0 || c.y < 0 || c.x >= level.cols || c.y >= level.rows) outOfBounds++;
      const key = cellKey(c);
      if (occupied.has(key)) overlap++;
      occupied.set(key, a.id);
      if (i > 0) {
        const prev = a.cells[i - 1];
        if (Math.abs(prev.x - c.x) + Math.abs(prev.y - c.y) !== 1) gaps++;
      }
    }
  }

  check(overlap === 0, `${label}: no overlapping cells`, `${overlap} overlaps`);
  check(outOfBounds === 0, `${label}: all cells in bounds`, `${outOfBounds} outside`);
  check(gaps === 0, `${label}: body is 4-connected`, `${gaps} jumps`);
  check(short === 0, `${label}: no 1-cell arrows`, `${short} found`);
  check(misaligned === 0, `${label}: head direction matches stem`, `${misaligned} misaligned`);
  check(freeAtStartCount(level) >= 1, `${label}: at least one free arrow at start`);
  check(arrowsFreeAtStart(level) >= 1, `${label}: plain corridor free arrow exists`);
}

/** 抽样：步长 7 覆盖全结构 + 所有关键角色关。 */
function sampledIds(): number[] {
  const set = new Set<number>();
  for (let id = 1; id <= LEVEL_COUNT; id += 7) set.add(id);
  for (const id of [
    1, 10, 20, 40, 41, 42, 60, 61, 100, 101, 113, 119, 120, 140, 160, 180,
    199, 200, 201, 210, 300, 301, 400, 401, 459, 479, 499, 500,
  ]) {
    set.add(id);
  }
  return [...set].filter((id) => id >= 1 && id <= LEVEL_COUNT).sort((a, b) => a - b);
}

console.log('\n[2] 500 shipped levels: integrity (sampled)');
{
  const t0 = performance.now();
  const ids = sampledIds();
  for (const id of ids) {
    const level = getLevel(id);
    assertLevelIntegrity(level, `L${id}`, isChallenge(id));
    check(level.id === id, `L${id}: id stamped`);
    const solved = solveGreedy(level);
    check(solved.solved, `L${id}: greedy solve clears the board`);
    check(solved.order.length === level.arrows.length, `L${id}: solve order complete`);

    // 存档解只承诺「航道合法」。
    // Boss 箭用 OR 逃逸语义 + 影子占位（与 solveGreedy 完全同口径）。
    let legal = true;
    const occ = new Map<number, number>();
    for (const a of level.arrows) {
      for (const c of a.cells) occ.set(cellKey(c), a.id);
      for (const c of bossShadowCells(level, a)) occ.set(cellKey(c), a.id);
    }
    for (const idOfArrow of level.solution) {
      const a = level.arrows.find((x) => x.id === idOfArrow);
      if (!a) {
        legal = false;
        break;
      }
      const blocked = (c: { x: number; y: number }): boolean => {
        const owner = occ.get(cellKey(c));
        return owner !== undefined && owner !== a.id;
      };
      if (!canArrowEscape(level, a, blocked)) {
        legal = false;
        break;
      }
      for (const c of a.cells) occ.delete(cellKey(c));
      for (const c of bossShadowCells(level, a)) occ.delete(cellKey(c));
    }
    check(legal, `L${id}: generated solution order is corridor-legal`);
  }
  timings.push({ name: `generate+validate ${ids.length} sampled levels`, ms: Math.round(performance.now() - t0) });
  console.log(`  ${ids.length} sampled levels validated in ${Math.round(performance.now() - t0)}ms`);
}

console.log('\n[2b] 500-level structure (rules doc §2)');
{
  check(LEVEL_COUNT === 500, 'structure: 500 levels');
  check(CHAPTER_COUNT === 25, 'structure: 25 chapters');
  check(WORLDS.length === 5, 'structure: 5 worlds');

  // 关卡角色按 step 断言。
  check(levelMode(7) === 'zen', 'L7 (step 6) is a minor zen picture');
  check(levelMode(14) === 'sprint', 'L14 (step 13) is a sprint');
  check(levelMode(19) === 'boss', 'L19 (step 18) is a boss');
  check(levelMode(20) === 'zen', 'L20 (step 19) is a chapter-end zen picture');
  check(levelMode(1) === 'normal', 'L1 is normal');

  // 章节与世界映射。
  check(chapterOf(1) === 1 && chapterOf(20) === 1 && chapterOf(21) === 2, 'chapter boundaries');
  check(chapterOf(500) === 25, 'L500 closes chapter 25');
  check(worldOf(100) === 1 && worldOf(101) === 2 && worldOf(500) === 5, 'world boundaries');

  // 主图案：每 10 关一幅，共 50 幅，无重复 id 集。
  const majorIds = new Set<string>();
  for (let id = 10; id <= 500; id += 10) {
    const level = getLevel(id);
    check(!!level.mask, `L${id}: major picture has a mask`);
    check(!!level.shape && level.shape !== 'board' && level.shape !== 'tangle', `L${id}: shape named`);
    majorIds.add(level.shape!);
  }
  check(majorIds.size === 50, 'structure: 50 distinct major pictures', `${majorIds.size}`);
  check(majorShapeForLevel(500).id === 'throne2', 'L500 artwork is the throne');

  // 大箭头（Boss 箭）不再每关都带：新手前 14 关/禅意/冲刺/图案关无大箭头，整体约 15~30%。
  let bossCount = 0;
  for (let id = 1; id <= LEVEL_COUNT; id++) if (hasBossArrow(id)) bossCount++;
  check(bossCount >= 60 && bossCount <= 160, 'boss arrow appears selectively across 500 levels', `${bossCount}/500`);
  check(getLevel(1).arrows.every((a) => !a.isBoss), 'L1: no boss arrow');
  check(getLevel(10).arrows.every((a) => !a.isBoss), 'L10 picture: no boss arrow');
  check(getLevel(20).arrows.every((a) => !a.isBoss), 'L20 zen: no boss arrow');
  check(getLevel(14).arrows.every((a) => !a.isBoss), 'L14 sprint: no boss arrow');
  check(getLevel(19).arrows.some((a) => a.isBoss), 'L19 boss debut: has boss arrow');

  // Boss 三连打：世界一为单盘，世界二起 3 盘（Part 1 无 Boss，Part 2/3 带 Boss），全部可解。
  const w1Boss = getLevelParts(19);
  check(w1Boss.length === 1, 'L19 (world 1) boss is a single board');
  for (const id of [119, 259, 399, 459, 499]) {
    const parts = getLevelParts(id);
    check(parts.length === 3, `L${id}: boss gauntlet has 3 parts`, `${parts.length}`);
    check(parts[0].arrows.every((a) => !a.isBoss), `L${id} part 1: warm-up without boss arrow`);
    check(parts[2].arrows.some((a) => a.isBoss), `L${id} part 3: climax has boss arrow`);
    parts.forEach((p, i) => {
      check(p.part === i + 1, `L${id} part ${i + 1}: stamped`);
      check(p.mode === 'boss', `L${id} part ${i + 1}: boss mode`);
      check(solveGreedy(p).solved, `L${id} part ${i + 1}: solvable`);
      check(freeAtStartCount(p) >= 1, `L${id} part ${i + 1}: free arrow at start`);
    });
  }

  // 时长纪律：真图案关 180~300s，常规盘严格遵守世界 timeCap，冲刺减半，禅意无时限。
  for (const id of [30, 130, 250, 350, 460]) {
    const level = getLevel(id);
    const cap = WORLDS[worldOf(id) - 1].timeCap;
    if (level.shape && level.shape !== 'board' && level.mode !== 'zen') {
      check(
        level.timeLimit >= 180 && level.timeLimit <= 300,
        `L${id}: picture time in 3~5min band`,
        `${level.timeLimit}s`,
      );
    } else {
      check(level.timeLimit <= cap, `L${id}: time within world cap ${cap}`, `${level.timeLimit}s`);
    }
  }
  for (const id of [15, 115, 216, 315, 415]) {
    const normal = getLevel(id);
    const cap = WORLDS[worldOf(id) - 1].timeCap;
    check(normal.timeLimit <= cap, `L${id}: normal board respects world timeCap ${cap}`, `${normal.timeLimit}s`);
  }
  for (const id of [14, 114, 214, 314, 414]) {
    const sprint = getLevel(id);
    check(sprint.mode === 'sprint', `L${id}: sprint mode`);
    check(sprint.timeLimit >= 45, `L${id}: sprint keeps >=45s floor`);
  }
  for (const id of [20, 120, 220, 320, 420]) {
    check(getLevel(id).timeLimit === 0, `L${id}: zen picture has no timer`);
  }

  // specFor 稳定性与结构字段。
  const s1 = specFor(21);
  check(s1.mode === 'normal', 'specFor(21): normal pacing');
  check(specFor(21).cols <= specFor(39).cols, 'board grows inside a chapter');
  check(specFor(200).cols > specFor(100).cols, 'world size steps up across worlds');
}

console.log('\n[3] Determinism');
{
  const a = generateLevel(specFor(1));
  const b = generateLevel(specFor(1));
  check(fingerprint(a) === fingerprint(b), 'same seed → identical level');
  const c = generateLevel(specFor(2));
  check(fingerprint(a) !== fingerprint(c), 'different level id → different layout');
  check(getLevel(7) === getLevel(7), 'level cache returns the same object');
  check(JSON.stringify(specFor(123)) === JSON.stringify(specFor(123)), 'specFor is deterministic');
}

console.log('\n[4] Monotonicity (random legal orders)');
{
  const rng = new Rng(2024);
  for (const id of [1, 12, 27, 44, 60, 150, 451]) {
    const level = getLevel(id);
    for (let round = 0; round < 8; round++) {
      const alive = new Set(level.arrows.map((a) => a.id));
      const owner = new Map<number, number>();
      for (const a of level.arrows) {
        for (const c of a.cells) owner.set(cellKey(c), a.id);
        for (const c of bossShadowCells(level, a)) owner.set(cellKey(c), a.id);
      }
      let steps = 0;
      while (alive.size > 0) {
        const free = level.arrows.filter(
          (a) =>
            alive.has(a.id) &&
            canArrowEscape(level, a, (c) => {
              const o = owner.get(cellKey(c));
              return o !== undefined && o !== a.id && alive.has(o);
            }),
        );
        if (!free.length) break;
        const pick = free[rng.int(free.length)];
        alive.delete(pick.id);
        steps++;
      }
      check(alive.size === 0, `L${id} random order #${round} clears the board`);
      check(steps === level.arrows.length, `L${id} random order #${round} removes all`);
    }
  }
}

console.log('\n[5] Random spec stress (250 levels)');
{
  const rng = new Rng(99173);
  let generated = 0;
  let errors = 0;
  let unsolvable = 0;
  let badIntegrity = 0;
  const t0 = performance.now();
  for (let i = 0; i < 250; i++) {
    const cols = rng.range(7, 12);
    const rows = rng.range(10, 18);
    const opts: GenOptions = {
      id: 1000 + i,
      cols,
      rows,
      targetArrows: rng.range(8, 22),
      minLen: rng.range(3, 8),
      maxLen: rng.range(8, 15),
      freeTarget: rng.range(2, 7),
      seed: 5000 + i * 131,
    };
    try {
      const level = generateLevel(opts);
      generated++;
      if (!solveGreedy(level).solved) unsolvable++;
      const occupied = new Set<number>();
      let overlap = false;
      for (const a of level.arrows) {
        if (a.cells.length < 2) badIntegrity++;
        const d = DIR_VECTORS[a.dir];
        if (a.cells[1].x - a.cells[0].x !== -d.x || a.cells[1].y - a.cells[0].y !== -d.y) {
          badIntegrity++;
        }
        for (const c of a.cells) {
          if (occupied.has(cellKey(c))) overlap = true;
          occupied.add(cellKey(c));
        }
      }
      if (overlap) badIntegrity++;
    } catch (err) {
      errors++;
      if (errors <= 3) console.error('  generation error:', (err as Error).message);
    }
  }
  const ms = Math.round(performance.now() - t0);
  console.log(`  ${generated}/250 generated, ${ms}ms total, ${(ms / 250).toFixed(1)}ms avg`);
  check(errors === 0, 'stress: no generation exceptions', `${errors} errors`);
  check(unsolvable === 0, 'stress: every level solvable', `${unsolvable} unsolvable`);
  check(badIntegrity === 0, 'stress: every level structurally valid', `${badIntegrity} issues`);
  timings.push({ name: 'generate 250 random levels', ms });
}

console.log('\n[6] Colour separation (sampled)');
{
  let adjacentSame = 0;
  let totalPairs = 0;
  for (let id = 1; id <= LEVEL_COUNT; id += 10) {
    const level = getLevel(id);
    const owner = new Map<number, number>();
    for (const a of level.arrows) for (const c of a.cells) owner.set(cellKey(c), a.id);
    for (const a of level.arrows) {
      for (const c of a.cells) {
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
          [1, 1],
          [1, -1],
        ]) {
          const other = owner.get(cellKey({ x: c.x + dx, y: c.y + dy }));
          if (other === undefined || other === a.id) continue;
          totalPairs++;
          const b = level.arrows.find((x) => x.id === other)!;
          if (b.color === a.color) adjacentSame++;
        }
      }
    }
  }
  console.log(`  ${totalPairs} adjacent pairs, ${adjacentSame} same-colour`);
  check(totalPairs > 0, 'colouring: adjacency computed');
  check(
    adjacentSame / Math.max(1, totalPairs) < 0.02,
    'colouring: <2% adjacent arrows share a colour',
    `${((adjacentSame / Math.max(1, totalPairs)) * 100).toFixed(1)}%`,
  );
}

console.log('\n[7] Energy / 体力');
{
  const T0 = 1_700_000_000_000; // 任意 epoch 毫秒
  const MIN = ENERGY_REGEN_MS;

  const full = fullEnergy(T0);
  check(full.energy === ENERGY_MAX && full.energyAt === T0, 'fullEnergy: 初始满体力');
  check(syncEnergy(full, T0 + 99 * MIN).energy === ENERGY_MAX, 'syncEnergy: 满体力不溢出');
  check(syncEnergy(full, T0 + 99 * MIN).energyAt === T0 + 99 * MIN, 'syncEnergy: 满格时重置计时');

  const spent = spendEnergy(full, T0)!;
  check(!!spent, 'spendEnergy: 满体力可开一关');
  check(spent.energy === ENERGY_MAX - ENERGY_COST_PER_LEVEL, 'spendEnergy: 扣 1 点');
  check(spent.energyAt === T0, 'spendEnergy: 从满格掉落时重开恢复窗口');
  check(energyNextInMs(spent, T0) === MIN, 'energyNextInMs: 刚消耗后要等满一个周期');

  check(syncEnergy(spent, T0 + MIN - 1).energy === 4, 'syncEnergy: 差 1ms 不恢复');
  const one = syncEnergy(spent, T0 + MIN);
  check(one.energy === 5, 'syncEnergy: 一个周期恢复 1 点并触顶');
  check(one.energyAt === T0 + MIN, 'syncEnergy: 触顶重置计时');

  const away = { energy: 4, energyAt: T0 };
  const back = syncEnergy(away, T0 + 2.5 * MIN);
  check(back.energy === ENERGY_MAX, 'syncEnergy: 多点恢复并触顶', `${back.energy}`);
  const low = { energy: 1, energyAt: T0 };
  const lowBack = syncEnergy(low, T0 + 2.5 * MIN);
  check(lowBack.energy === 3, 'syncEnergy: 非触顶恢复累计正确', `${lowBack.energy}`);
  check(lowBack.energyAt === T0 + 2 * MIN, 'syncEnergy: 余量进位，进度不丢');
  check(energyNextInMs(lowBack, T0 + 2.5 * MIN) === 0.5 * MIN, 'energyNextInMs: 半周期后剩半周期');

  const empty = { energy: 0, energyAt: T0 };
  check(spendEnergy(empty, T0 + 10) === null, 'spendEnergy: 0 点拒绝开一关');
  check(!canStartLevel(empty, T0 + 10), 'canStartLevel: 0 点不可开');
  check(canStartLevel(lowBack, T0 + 2.5 * MIN), 'canStartLevel: 有余量可开');

  const again = spendEnergy(lowBack, T0 + 2.5 * MIN)!;
  check(again.energy === 2, 'spendEnergy: 未满时继续扣');
  check(again.energyAt === lowBack.energyAt, 'spendEnergy: 未满时保留恢复进度');

  const won = refundEnergy({ energy: 2, energyAt: T0 }, T0 + 5);
  check(won.energy === 2 + ENERGY_WIN_REFUND, 'refundEnergy: 返还 1 点');
  check(refundEnergy(full, T0).energy === ENERGY_MAX, 'refundEnergy: 已满封顶');
  let cycle = full;
  for (let i = 0; i < 20; i++) {
    const s = spendEnergy(cycle, T0 + i * MIN)!;
    cycle = refundEnergy(s, T0 + i * MIN + 30_000);
  }
  check(cycle.energy === ENERGY_MAX, 'revive loop: 失败+复活循环不亏体力');

  const granted = grantEnergy({ energy: 0, energyAt: T0 }, T0 + 12345);
  check(granted.energy === 1, 'grantEnergy: 广告 +1 点', `${granted.energy}`);
  check(granted.energyAt === T0, 'grantEnergy: 未触顶不重置恢复计时');
  const grantedMid = grantEnergy({ energy: 4, energyAt: T0 }, T0 + 12345);
  check(grantedMid.energy === ENERGY_MAX, 'grantEnergy: 4+1 触顶封顶');
  check(grantedMid.energyAt === T0 + 12345, 'grantEnergy: 触顶重置计时');
  check(
    grantEnergy({ energy: 1, energyAt: T0 }, T0, 2).energy === 3,
    'grantEnergy: 自定义点数直接叠加',
  );
  check(
    grantEnergy({ energy: 2, energyAt: T0 }, T0 + MIN, 1).energy === 4,
    'grantEnergy: 广告点数叠加在离线恢复之上',
  );

  const refilled = refillEnergy({ energy: 0, energyAt: T0 }, T0 + 12345);
  check(refilled.energy === ENERGY_MAX, 'refillEnergy: 回满');
  check(refilled.energyAt === T0 + 12345, 'refillEnergy: 回满重置计时');

  check(formatEnergyClock(0) === '0:00', 'formatEnergyClock: 0');
  check(formatEnergyClock(59_000) === '0:59', 'formatEnergyClock: 59s');
  check(formatEnergyClock(60_000) === '1:00', 'formatEnergyClock: 整分');
  check(formatEnergyClock(MIN) === '6:00', 'formatEnergyClock: 一个恢复周期');
  check(ENERGY_MAX === 5 && MIN === 360_000, 'constants: 5 点体力 / 6 分钟周期');
}

console.log('\n[7b] Playtest & Time Calibration');
{
  for (const id of [1, 2, 14, 19, 21, 250, 452]) {
    const lv = getLevel(id);
    const fast = simulatePlayRun(lv, 'fast', 123);
    const careful = simulatePlayRun(lv, 'careful', 123);
    check(fast.clearTimeSec > 0 && careful.clearTimeSec >= fast.clearTimeSec, `L${id}: playtest tier ordering`);
    const rep = playtestLevel(lv);
    check(rep.score >= 55 && rep.score <= 100, `L${id}: playtest score valid`, `${rep.score}`);
    if (lv.mode === 'zen') {
      check(rep.recommendedTime === 0, `L${id}: zen recommendedTime is 0`);
    } else {
      check(
        lv.timeLimit >= rep.clearTimeMedian && rep.recommendedTime >= rep.clearTimeMedian,
        `L${id}: calibrated time >= T50`,
        `limit=${lv.timeLimit}s rec=${rep.recommendedTime}s T50=${rep.clearTimeMedian}s`,
      );
      check(rep.recommendedTime % 5 === 0, `L${id}: recommendedTime multiple of 5`, `${rep.recommendedTime}s`);
    }
  }
}

console.log('\n[8] Stats');
{
  const rows: string[] = [];
  for (const id of [1, 10, 20, 41, 100, 200, 300, 400, 500]) {
    const l = getLevel(id);
    const s = analyzeLevel(l);
    rows.push(
      `  L${String(id).padStart(3)}  ${l.cols}x${l.rows}  ${String(l.shape ?? 'board').padEnd(9)} ${String(l.mode ?? 'normal').padEnd(6)} arrows=${s.arrows}  fill=${(s.fillRatio * 100).toFixed(0)}%  free=${s.freeAtStart}  time=${l.timeLimit}s`,
    );
  }
  console.log(rows.join('\n'));
}

console.log('\n[9] Timing');
for (const t of timings) console.log(`  ${t.name}: ${t.ms}ms`);

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}
