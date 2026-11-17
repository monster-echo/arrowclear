import { readFileSync, writeFileSync } from 'node:fs';
import { LEVEL_COUNT, specFor } from '../assets/scripts/core/levels';
import { generateLevel } from '../assets/scripts/core/levelgen';
import { SEED_OVERRIDES } from '../assets/scripts/core/levelSeeds';
import { scoreLevel } from '../assets/scripts/core/scoring';

const report = JSON.parse(readFileSync('.tmp/score-report.json', 'utf8'));
const failing = new Set<number>(report.filter((r: { total: number }) => r.total < 90).map((r: { id: number }) => r.id));
const out: Record<number, number> = { ...SEED_OVERRIDES };
for (let id = 1; id <= LEVEL_COUNT; id++) {
  if (!failing.has(id)) continue;
  let bestSeed = out[id] ?? specFor(id).seed;
  let best = -1;
  for (let k = 0; k < 11; k++) {
    const spec = specFor(id);
    const seed = spec.seed + k * 104729;
    const level = generateLevel({ ...spec, seed });
    level.id = id;
    const r = scoreLevel(level);
    if (r.total > best) { best = r.total; bestSeed = seed; }
    if (r.total >= 90 && r.gates.length === 0) break;
  }
  out[id] = bestSeed;
  console.log(`${String(id).padStart(2)} best=${best} seed=${bestSeed}`);
}
const body = `/** Seed overrides selected by tools/optimize-seeds.ts. */\nexport const SEED_OVERRIDES: Record<number, number> = ${JSON.stringify(out, null, 2)};\n`;
writeFileSync('assets/scripts/core/levelSeeds.ts', body);
console.log('done');
