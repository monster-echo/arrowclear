import { mkdirSync, writeFileSync } from 'node:fs';
import { LEVEL_COUNT, getLevel } from '../assets/scripts/core/levels';
import { scoreLevel } from '../assets/scripts/core/scoring';

const reports = [];
for (let id = 1; id <= LEVEL_COUNT; id++) {
  reports.push(scoreLevel(getLevel(id)));
}

const pad = (v: string | number, n: number): string => String(v).padStart(n, ' ');
const rows = reports.map((r) => {
  const gates = r.gates.length ? r.gates.map((g) => g.id).join(',') : '-';
  return [
    pad(r.id, 2),
    pad(r.shape.padEnd(8), 8),
    pad(`${r.arrows}`, 4),
    pad(`${(r.fill * 100).toFixed(0)}%`, 4),
    pad(`${r.dependency.freeAtStart}`, 3),
    pad(r.dependency.chainDepth.toFixed(0), 4),
    pad(`${(r.dependency.forcedRatio * 100).toFixed(0)}%`, 4),
    pad(r.dependency.uniqueChains.length, 3),
    pad(r.distribution.avgLength.toFixed(1), 4),
    pad(r.distribution.avgTurns.toFixed(2), 5),
    pad(r.distribution.maxStraight, 3),
    pad(r.subscores.distribution, 4),
    pad(r.subscores.difficulty, 4),
    pad(r.subscores.unique, 4),
    pad(r.subscores.pacing, 4),
    pad(r.subscores.clarity, 4),
    pad(r.subscores.time, 4),
    pad(r.total, 4),
    gates,
  ].join(' ');
});

console.log('id shape    n    fill free depth forced U  len  turn str  dist diff uniq pace clar time  total gates');
console.log(rows.join('\n'));
const passed = reports.filter((r) => r.passed).length;
console.log(`\n${passed}/${reports.length} levels >= 90.`);
console.log(`avg: dist=${(reports.reduce((s, r) => s + r.subscores.distribution, 0) / reports.length).toFixed(1)} ` +
  `diff=${(reports.reduce((s, r) => s + r.subscores.difficulty, 0) / reports.length).toFixed(1)} ` +
  `uniq=${(reports.reduce((s, r) => s + r.subscores.unique, 0) / reports.length).toFixed(1)} ` +
  `pace=${(reports.reduce((s, r) => s + r.subscores.pacing, 0) / reports.length).toFixed(1)} ` +
  `time=${(reports.reduce((s, r) => s + r.subscores.time, 0) / reports.length).toFixed(1)} ` +
  `total=${(reports.reduce((s, r) => s + r.total, 0) / reports.length).toFixed(1)}`);

mkdirSync('.tmp', { recursive: true });
writeFileSync('.tmp/score-report.json', JSON.stringify(reports, null, 2));
console.log('report: .tmp/score-report.json');
