import { solveGreedyFrozen } from '../assets/scripts/core/frozen';
import { freeAtStartCount } from '../assets/scripts/core/frozen';
import {
  LEVEL_COUNT,
  getLevelParts,
  isChallenge,
  getLevel,
  levelMode,
} from '../assets/scripts/core/levels';

let failures = 0;
const rows: string[] = [];

const t0 = Date.now();
for (let id = 1; id <= LEVEL_COUNT; id++) {
  const mode = levelMode(id);
  const parts = getLevelParts(id);
  parts.forEach((level, i) => {
    const label = parts.length > 1 ? `${id}(${level.part ?? i + 1}/3)` : String(id);
    const solved = solveGreedyFrozen(level);
    if (!solved.solved) {
      failures++;
      console.error(`level ${label} is NOT solvable`);
    }
    const free = freeAtStartCount(level);
    if (free < 1) {
      failures++;
      console.error(`level ${label} has no free arrow at start`);
    }
    const frozen = level.arrows.filter((a) => a.frozen).length;
    const cells = level.arrows.reduce((n, a) => n + a.cells.length, 0);
    const maskArea = level.mask
      ? level.mask.reduce((a, b) => a + b, 0)
      : level.cols * level.rows;
    rows.push(
      [
        label.padStart(6),
        `${level.cols}x${level.rows}`.padEnd(8),
        mode.padEnd(6),
        `${level.shape ?? 'board'}`.padEnd(9),
        `arrows=${String(level.arrows.length).padStart(3)}`,
        `fill=${((cells / Math.max(1, maskArea)) * 100).toFixed(0)}%`,
        `free=${String(free).padStart(2)}`,
        `frozen=${String(frozen).padStart(3)}`,
        `time=${level.timeLimit}s`,
      ].join('  '),
    );
  });
}
console.log(rows.join('\n'));
console.log(
  `\ngenerated ${LEVEL_COUNT} levels in ${Date.now() - t0}ms, failures=${failures}`,
);
// Bonus challenge level must also stay solvable.
const bonus = getLevel(isChallenge(0) ? 0 : 501);
if (!solveGreedyFrozen(bonus).solved) {
  failures++;
  console.error('bonus challenge level is NOT solvable');
}
if (failures > 0) process.exit(1);
