import { writeFileSync } from 'node:fs';
import { LEVEL_COUNT, specFor } from '../assets/scripts/core/levels';
import { generateLevel } from '../assets/scripts/core/levelgen';
import { scoreLevel } from '../assets/scripts/core/scoring';

const out: Record<number, number> = {};
const rows: string[] = [];
for (let id = 1; id <= LEVEL_COUNT; id++) {
  let bestSeed = 0;
  let bestScore = -1;
  let bestTotal = 0;
  for (let k = 0; k < 10; k++) {
    const spec = specFor(id);
    const seed = spec.seed + k * 104729;
    const level = generateLevel({ ...spec, seed });
    level.id = id;
    const report = scoreLevel(level);
    if (report.total > bestScore) {
      bestScore = report.total;
      bestSeed = seed;
      bestTotal = report.total;
    }
    if (report.total >= 90 && report.gates.length === 0) break;
  }
  out[id] = bestSeed;
  rows.push(`${String(id).padStart(2)} ${String(bestTotal).padStart(3)} seed=${bestSeed}`);
  console.log(rows[rows.length - 1]);
}
const body = `/** Seed overrides selected by tools/optimize-seeds.ts. */\nexport const SEED_OVERRIDES: Record<number, number> = ${JSON.stringify(out, null, 2)};\n`;
writeFileSync('assets/scripts/core/levelSeeds.ts', body);
console.log('wrote assets/scripts/core/levelSeeds.ts');
