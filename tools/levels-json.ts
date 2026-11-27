/**
 * 全关卡指标 → JSON（供 Excel 汇总用）。
 * 输出：.tmp/levels.json
 */
import { writeFileSync } from 'fs';
import {
  LEVEL_COUNT,
  chapterOf,
  getLevel,
  getLevelParts,
  isBoss,
  stepOf,
  worldOf,
} from '../assets/scripts/core/levels';
import { freeAtStartCount } from '../assets/scripts/core/levelgen';
import { MasterReport } from '../assets/scripts/core/arrowscore';
import { Level } from '../assets/scripts/core/types';

type LevelWithReport = Level & { report?: MasterReport };

function rowFor(level: LevelWithReport, label: string, kind: string): Record<string, unknown> {
  const r = level.report;
  const maskArea = level.mask
    ? level.mask.reduce((a, b) => a + b, 0)
    : level.cols * level.rows;
  const cells = level.arrows.reduce((s, a) => s + a.cells.length, 0);
  return {
    label,
    kind,
    id: level.id,
    world: worldOf(level.id),
    chapter: chapterOf(level.id),
    step: stepOf(level.id),
    mode: level.mode ?? 'normal',
    shape: level.shape ?? 'board',
    cols: level.cols,
    rows: level.rows,
    arrows: level.arrows.length,
    density: r ? r.density : cells / Math.max(1, maskArea),
    depth: r ? r.maxChainDepth : -1,
    score: r ? r.totalScore : -1,
    tier: r ? r.difficultyTier.slice(0, 1) : '-',
    gate: r ? r.gate : 0,
    pass: r ? r.passes : false,
    subHierarchy: r ? r.subScores.hierarchy : -1,
    subAntiZebra: r ? r.subScores.antiZebra : -1,
    subCavity: r ? r.subScores.cavity : -1,
    subTopo: r ? r.subScores.topo : -1,
    maxArrowLen: r ? r.maxArrowLen : -1,
    strictlyOne: r ? r.strictlyOneSteps : -1,
    avgJump: r ? r.avgJumpDist : -1,
    knots: r ? r.interlockingKnotCount : -1,
    initialMovable: r ? r.initialMovable : -1,
    liveMovable: freeAtStartCount(level),
    boss: level.arrows.some((a) => a.isBoss) ? 1 : 0,
    empty: r ? r.emptyCells : -1,
    fillRate: r ? 1 - r.emptyCells / Math.max(1, maskArea) : cells / Math.max(1, maskArea),
    giant: r ? r.giantTrunks : -1,
    deceptive: r ? r.deceptiveClearCount : -1,
    stdLen: r ? r.lengthStdDev : -1,
    zebra: r ? r.zebraParallelRatio : -1,
    time: level.timeLimit,
  };
}

const rows: Record<string, unknown>[] = [];
for (let id = 1; id <= LEVEL_COUNT; id++) {
  if (isBoss(id) && worldOf(id) >= 2) {
    getLevelParts(id).forEach((part, i) => {
      rows.push(rowFor(part as LevelWithReport, `${id}`, `Boss部件${i + 1}/3`));
    });
  } else {
    rows.push(rowFor(getLevel(id) as LevelWithReport, `${id}`, '主线'));
  }
}
rows.push(rowFor(getLevel(501) as LevelWithReport, '501', '彩蛋'));

writeFileSync('.tmp/levels.json', JSON.stringify(rows));
console.log(`rows=${rows.length} -> .tmp/levels.json`);
