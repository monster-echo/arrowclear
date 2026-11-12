import { getLevel } from '../assets/scripts/core/levels';
import { DIR_VECTORS } from '../assets/scripts/core/types';

for (const id of [1, 2, 3]) {
  const lvl = getLevel(id);
  let bad = 0;
  let shortRun = 0;
  for (const a of lvl.arrows) {
    const d = DIR_VECTORS[a.dir];
    const dx = a.cells[1].x - a.cells[0].x;
    const dy = a.cells[1].y - a.cells[0].y;
    if (dx !== -d.x || dy !== -d.y) bad++;
    // straight cells behind the head
    let run = 1;
    for (let i = 2; i < a.cells.length; i++) {
      const px = a.cells[i - 1].x - a.cells[i].x;
      const py = a.cells[i - 1].y - a.cells[i].y;
      if (px === d.x && py === d.y) run++;
      else break;
    }
    if (run < 2) shortRun++;
  }
  console.log(`level ${id}: arrows=${lvl.arrows.length} dirMismatch=${bad} straightRun<2=${shortRun}`);
}
