import { analyzeLevel, solveGreedy } from '../assets/scripts/core/levelgen';
import { LEVEL_COUNT, getLevel } from '../assets/scripts/core/levels';
const rows: string[] = [];
for (let id = 1; id <= LEVEL_COUNT; id++) {
  if (![1, 5, 10, 15, 20, 30, 40, 50, 60].includes(id)) continue;
  const l = getLevel(id);
  const s = analyzeLevel(l);
  rows.push(`| ${id} | ${l.cols}×${l.rows} | ${s.arrows} | ${s.avgLength.toFixed(1)} | ${(s.fillRatio*100).toFixed(0)}% | ${s.freeAtStart} | ${Math.round(l.timeLimit/60*10)/10} 分钟 | ${solveGreedy(l).solved ? '✓' : '✗'} |`);
}
console.log(rows.join('\n'));
