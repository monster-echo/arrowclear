/** Solve helper for playtesting seed 527: full greedy order + free counts. */
import { getChallengeLevel } from '../assets/scripts/core/challenge';
import { corridorCells } from '../assets/scripts/core/types';
import { solveGreedy } from '../assets/scripts/core/levelgen';

const level = getChallengeLevel();
const greedy = solveGreedy(level);
const alive = new Set(level.arrows.map((a) => a.id));
const occ = new Set<number>();
for (const a of level.arrows) for (const c of a.cells) occ.add(c.y * level.cols + c.x);

const steps: { id: number; head: { x: number; y: number }; free: number }[] = [];
for (const id of greedy.order) {
  let free = 0;
  const freeIds: number[] = [];
  for (const a of level.arrows) {
    if (!alive.has(a.id)) continue;
    if (corridorCells(level, a).every((c) => !occ.has(c.y * level.cols + c.x))) {
      free++;
      freeIds.push(a.id);
    }
  }
  steps.push({ id, head: level.arrows[id].cells[0], free });
  for (const c of level.arrows[id].cells) occ.delete(c.y * level.cols + c.x);
  alive.delete(id);
}

console.log(JSON.stringify(steps.map((s) => ({ ...s, freeIds: undefined }))));
// Compact per-step: id, head cell, how many arrows were flyable before this click.
