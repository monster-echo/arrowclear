import { readFileSync, writeFileSync } from 'node:fs';
import { LEVEL_COUNT, getLevel, specFor } from '../assets/scripts/core/levels';
import { generateLevel } from '../assets/scripts/core/levelgen';
import { SEED_OVERRIDES } from '../assets/scripts/core/levelSeeds';
import { LEVEL_TUNING, LevelTuning } from '../assets/scripts/core/levelTuning';
import { scoreLevel } from '../assets/scripts/core/scoring';

const finalScore = (level: ReturnType<typeof getLevel>) => {
  let r = scoreLevel(level);
  level.timeLimit = Math.min(480, Math.max(30, Math.round((r.estimatedT80 + 30) / 5) * 5));
  r = scoreLevel(level);
  return r;
};
const report = JSON.parse(readFileSync('.tmp/score-report.json', 'utf8'));
const failing = new Set<number>(report.filter((r: { total: number }) => r.total < 90).map((r: { id: number }) => r.id));
const out: Record<number, LevelTuning> = { ...LEVEL_TUNING };
for (let id = 1; id <= LEVEL_COUNT; id++) {
  if (!failing.has(id)) continue;
  const baseline = finalScore(getLevel(id));
  let bestScore = baseline.total;
  let best: LevelTuning | undefined = out[id];
  for (const laneMax of [3, 4, 5, 6]) {
    for (const laneTail of [3, 4, 5, 6]) {
      for (const laneSegMin of [2, 3]) {
        const spec = specFor(id);
        const seed = SEED_OVERRIDES[id] ?? spec.seed;
        const level = generateLevel({ ...spec, seed, laneMax, laneTail, laneSegMin, laneSegMax: 4 });
        level.id = id;
        const r = finalScore(level);
        if (r.total > bestScore) {
          bestScore = r.total;
          best = { seed, laneMax, laneTail, laneSegMin, laneSegMax: 4 };
        }
      }
    }
  }
  if (best) out[id] = best;
  console.log(`${String(id).padStart(2)} base=${baseline.total} best=${bestScore} ${best ? JSON.stringify(best) : ''}`);
}
const body = `/** Per-level generator parameters selected by tools/optimize-tuning.ts. */\nexport interface LevelTuning {\n  seed?: number;\n  laneMax?: number;\n  laneTail?: number;\n  laneSegMin?: number;\n  laneSegMax?: number;\n}\nexport const LEVEL_TUNING: Record<number, LevelTuning> = ${JSON.stringify(out, null, 2)};\n`;
writeFileSync('assets/scripts/core/levelTuning.ts', body);
console.log('done');
