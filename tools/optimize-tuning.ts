import { readFileSync, writeFileSync } from 'node:fs';
import { LEVEL_COUNT, specFor } from '../assets/scripts/core/levels';
import { generateLevel } from '../assets/scripts/core/levelgen';
import { SEED_OVERRIDES } from '../assets/scripts/core/levelSeeds';
import { LEVEL_TUNING, LevelTuning } from '../assets/scripts/core/levelTuning';
import { scoreLevel } from '../assets/scripts/core/scoring';

const report = JSON.parse(readFileSync('.tmp/score-report.json', 'utf8'));
const failing = new Set<number>(report.filter((r: { total: number }) => r.total < 90).map((r: { id: number }) => r.id));
const out: Record<number, LevelTuning> = { ...LEVEL_TUNING };
for (let id = 1; id <= LEVEL_COUNT; id++) {
  if (!failing.has(id)) continue;
  let best: LevelTuning = { ...(out[id] ?? {}) };
  let bestScore = -1;
  for (const laneMax of [4, 5, 6]) {
    for (const laneTail of [4, 5, 6]) {
      for (const laneSegMin of [2, 3]) {
        const spec = specFor(id);
        const seed = SEED_OVERRIDES[id] ?? spec.seed;
        const tuning: LevelTuning = { seed, laneMax, laneTail, laneSegMin, laneSegMax: 4 };
        const level = generateLevel({ ...spec, seed, ...tuning });
        level.id = id;
        const r = scoreLevel(level);
        if (r.total > bestScore) {
          bestScore = r.total;
          best = tuning;
        }
      }
    }
  }
  out[id] = best;
  console.log(`${String(id).padStart(2)} best=${bestScore} ${JSON.stringify(best)}`);
}
const body = `/** Per-level generator parameters selected by tools/optimize-tuning.ts. */\nexport interface LevelTuning {\n  seed?: number;\n  laneMax?: number;\n  laneTail?: number;\n  laneSegMin?: number;\n  laneSegMax?: number;\n}\nexport const LEVEL_TUNING: Record<number, LevelTuning> = ${JSON.stringify(out, null, 2)};\n`;
writeFileSync('assets/scripts/core/levelTuning.ts', body);
console.log('done');
