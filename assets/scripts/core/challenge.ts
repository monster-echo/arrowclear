/**
 * 千层箭阵彩蛋关（id 501，主线之外，首页关卡页 ★ 直达）。
 *
 * 由四阶段多尺度巨蟒包络生成器出题：小盘高纠缠，漏斗手术目标开局仅 1 可动。
 * 种子从 23 起顺序扫描，取第一个生成成功的（确定性固化）。
 */
import { generateMasterLevel } from './arrowscore';
import { Level } from './types';

export const CHALLENGE_ID = 501;

const SPEC = {
  cols: 11,
  rows: 17,
  scales: [[8, 12], [5, 9], [4, 6], [3, 7]] as [number, number][],
  targetMovable: 1,
};

let cached: Level | null = null;

export function getChallengeLevel(): Level {
  if (cached) return cached;
  // 与主线同一条质量门禁：优先取达标（score >= gate）的种子，全不达标取最佳。
  let best: Level | null = null;
  let bestScore = -1;
  for (let seed = 23; seed < 23 + 96; seed++) {
    const level = generateMasterLevel({
      ...SPEC,
      id: CHALLENGE_ID,
      seed,
      timeLimit: 360,
    });
    if (!level) continue;
    const score = level.report.totalScore;
    if (score > bestScore) {
      best = level;
      bestScore = score;
    }
    if (level.report.passes) {
      cached = level;
      return level;
    }
  }
  if (best) {
    cached = best;
    return best;
  }
  throw new Error('challenge level generation failed');
}
