/**
 * Core rule-engine test suite (no browser, no Cocos).
 *
 * Covers: level integrity, determinism, solvability, monotonicity, the
 * "arrow head must sit on a straight run" rule, colouring, and generation
 * performance under random specs.
 *
 * Run: npm run test:core
 */
import { Rng } from '../assets/scripts/core/rng';
import {
  analyzeLevel,
  arrowsFreeAtStart,
  generateLevel,
  GenOptions,
  solveGreedy,
} from '../assets/scripts/core/levelgen';
import { LEVEL_COUNT, getLevel, specFor } from '../assets/scripts/core/levels';
import { cellKey, corridorCells, DIR_VECTORS, Level } from '../assets/scripts/core/types';

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
  timings.push({ name, ms: Math.round((performance.now() - t0) * 10) / 10 });
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

function assertLevelIntegrity(level: Level, label: string): void {
  check(level.arrows.length >= 6, `${label}: at least 6 arrows`, `got ${level.arrows.length}`);
  check(level.cols >= 6 && level.cols <= 16, `${label}: cols sane`);
  check(level.rows >= 8 && level.rows <= 22, `${label}: rows sane`);
  check(level.timeLimit >= 60 && level.timeLimit <= 480, `${label}: time limit sane`);

  const occupied = new Map<number, number>();
  let overlap = 0;
  let outOfBounds = 0;
  let gaps = 0;
  let short = 0;
  let misaligned = 0;
  let shortRun = 0;

  for (const a of level.arrows) {
    if (a.cells.length < 2) short++;
    if (a.color < 0 || a.color > 8) check(false, `${label}: colour in palette`);
    const d = DIR_VECTORS[a.dir];
    const dx = a.cells[1].x - a.cells[0].x;
    const dy = a.cells[1].y - a.cells[0].y;
    if (dx !== -d.x || dy !== -d.y) misaligned++;

    // straight cells behind the head (head + stem)
    let run = 1;
    for (let i = 2; i < a.cells.length; i++) {
      const px = a.cells[i - 1].x - a.cells[i].x;
      const py = a.cells[i - 1].y - a.cells[i].y;
      if (px === d.x && py === d.y) run++;
      else break;
    }
    // 2-cell arrows are allowed, everything longer must have >= 2 straight cells
    if (a.cells.length >= 3 && run < 2) shortRun++;

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
  check(shortRun === 0, `${label}: head has a straight stem`, `${shortRun} corners at head`);
  check(arrowsFreeAtStart(level) >= 1, `${label}: at least one free arrow at start`);
  check(level.solution.length === level.arrows.length, `${label}: solution covers every arrow`);
}

console.log('\n[2] 60 shipped levels: integrity');
{
  const t0 = performance.now();
  for (let id = 1; id <= LEVEL_COUNT; id++) {
    const level = getLevel(id);
    assertLevelIntegrity(level, `L${id}`);
    check(level.id === id, `L${id}: id stamped`);
    const solved = solveGreedy(level);
    check(solved.solved, `L${id}: greedy solve clears the board`);
    check(solved.order.length === level.arrows.length, `L${id}: solve order complete`);

    // The stored construction order must be legal too.
    let legal = true;
    const alive = new Set(level.arrows.map((a) => a.id));
    const occ = new Set<number>();
    for (const a of level.arrows) for (const c of a.cells) occ.add(cellKey(c));
    for (const idOfArrow of level.solution) {
      const a = level.arrows.find((x) => x.id === idOfArrow);
      if (!a) {
        legal = false;
        break;
      }
      const blocked = corridorCells(level, a).some((c) => occ.has(cellKey(c)));
      if (blocked) {
        legal = false;
        break;
      }
      for (const c of a.cells) occ.delete(cellKey(c));
      alive.delete(idOfArrow);
    }
    check(legal && alive.size === 0, `L${id}: generated solution order is legal`);
  }
  timings.push({ name: 'generate+validate 60 levels', ms: Math.round(performance.now() - t0) });
  console.log(`  60 levels validated in ${Math.round(performance.now() - t0)}ms`);
}

console.log('\n[3] Determinism');
{
  const a = generateLevel(specFor(1));
  const b = generateLevel(specFor(1));
  check(fingerprint(a) === fingerprint(b), 'same seed → identical level');
  const c = generateLevel(specFor(2));
  check(fingerprint(a) !== fingerprint(c), 'different level id → different layout');
  check(getLevel(7) === getLevel(7), 'level cache returns the same object');
}

console.log('\n[4] Monotonicity (random legal orders)');
{
  const rng = new Rng(2024);
  for (const id of [1, 12, 27, 44, 60]) {
    const level = getLevel(id);
    for (let round = 0; round < 12; round++) {
      const alive = new Set(level.arrows.map((a) => a.id));
      const occ = new Set<number>();
      const owner = new Map<number, number>();
      for (const a of level.arrows) {
        for (const c of a.cells) {
          occ.add(cellKey(c));
          owner.set(cellKey(c), a.id);
        }
      }
      let steps = 0;
      while (alive.size > 0) {
        const free = level.arrows.filter(
          (a) =>
            alive.has(a.id) &&
            corridorCells(level, a).every((c) => {
              const o = owner.get(cellKey(c));
              return o === undefined || !alive.has(o);
            }),
        );
        if (!free.length) break;
        const pick = free[rng.int(free.length)];
        for (const c of pick.cells) occ.delete(cellKey(c));
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

console.log('\n[6] Colour separation');
{
  let adjacentSame = 0;
  let totalPairs = 0;
  for (let id = 1; id <= LEVEL_COUNT; id++) {
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
    `${((adjacentSame / totalPairs) * 100).toFixed(1)}%`,
  );
}

console.log('\n[7] Stats');
{
  const rows: string[] = [];
  for (const id of [1, 10, 20, 30, 40, 50, 60]) {
    const l = getLevel(id);
    const s = analyzeLevel(l);
    rows.push(
      `  L${String(id).padStart(2)}  ${l.cols}x${l.rows}  arrows=${s.arrows}  fill=${(s.fillRatio * 100).toFixed(0)}%  free=${s.freeAtStart}  time=${l.timeLimit}s`,
    );
  }
  console.log(rows.join('\n'));
}

console.log('\n[8] Timing');
for (const t of timings) console.log(`  ${t.name}: ${t.ms}ms`);

console.log(`\n${passed} checks passed, ${failures.length} failed`);
if (failures.length) {
  console.log(failures.map((f) => `  - ${f}`).join('\n'));
  process.exit(1);
}