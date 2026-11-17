/** Render a cggen candidate as ASCII so a human can eyeball the tangles. */
import { generateCgLevel, puzzleMetrics } from '../assets/scripts/core/cggen';
import { corridorCells } from '../assets/scripts/core/types';

const seed = Number(process.argv[2] ?? 783);
const level = generateCgLevel({
  id: 501,
  cols: 9,
  rows: 14,
  seed,
  arrowsTarget: 20,
  minLen: 4,
  maxLen: 9,
  pocketDepth: 3,
  chainLen: 7,
  faninCount: 2,
  gateDoors: 3,
  fillTarget: 0.9,
});
if (!level) {
  console.log('generation failed');
  process.exit(1);
}

const HEADS = ['^', '>', 'v', '<'];
const grid: string[][] = [];
for (let y = 0; y < level.rows; y++) grid.push(new Array(level.cols).fill('·'));
for (const a of level.arrows) {
  const letter = String.fromCharCode(65 + (a.id % 26));
  const second = String.fromCharCode(97 + (a.id % 26));
  a.cells.forEach((c, i) => {
    grid[c.y][c.x] = i === 0 ? HEADS[a.dir] : i === 1 ? second : letter;
  });
}
console.log(`seed ${seed}  arrows=${level.arrows.length}`);
console.log((level as any).motifs);
console.log(puzzleMetrics(level));
console.log(grid.map((r) => r.join(' ')).join('\n'));

// Dependency summary: who waits on whom.
const deps: string[] = [];
for (const a of level.arrows) {
  const occ = new Map<number, number>();
  for (const o of level.arrows) {
    if (o.id === a.id) continue;
    for (const c of o.cells) occ.set(c.y * level.cols + c.x, o.id);
  }
  const ids = new Set<number>();
  for (const c of corridorCells(level, a)) {
    const o = occ.get(c.y * level.cols + c.x);
    if (o !== undefined) ids.add(o);
  }
  if (ids.size) deps.push(`${a.id}${HEADS[a.dir]} waits [${[...ids].join(',')}]`);
}
console.log(deps.slice(0, 40).join('\n'));

const dirCounts = [0, 0, 0, 0];
for (const a of level.arrows) dirCounts[a.dir]++;
console.log('dirs [up,right,down,left] =', dirCounts.join(','));
