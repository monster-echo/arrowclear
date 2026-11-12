import { analyzeLevel, solveGreedy } from '../assets/scripts/core/levelgen';
import { LEVEL_COUNT, getLevel } from '../assets/scripts/core/levels';

let failures = 0;
const rows: string[] = [];

const t0 = Date.now();
for (let id = 1; id <= LEVEL_COUNT; id++) {
  const level = getLevel(id);
  const stats = analyzeLevel(level);
  const solved = solveGreedy(level);
  if (!solved.solved) {
    failures++;
    console.error(`level ${id} is NOT solvable`);
  }
  if (stats.freeAtStart < 1) {
    failures++;
    console.error(`level ${id} has no free arrow at start`);
  }
  const cells = level.arrows.reduce((n, a) => n + a.cells.length, 0);
  rows.push(
    [
      String(id).padStart(2, '0'),
      `${level.cols}x${level.rows}`,
      `arrows=${String(stats.arrows).padStart(2)}`,
      `cells=${String(cells).padStart(3)}`,
      `fill=${(stats.fillRatio * 100).toFixed(0)}%`,
      `len=${stats.avgLength.toFixed(1)}`,
      `free=${stats.freeAtStart}`,
      `turns=${stats.turns}`,
      `time=${level.timeLimit}s`,
    ].join('  '),
  );
}
console.log(rows.join('\n'));
console.log(`\ngenerated ${LEVEL_COUNT} levels in ${Date.now() - t0}ms, failures=${failures}`);
if (failures > 0) process.exit(1);