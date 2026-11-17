/** Per-level generator parameters selected by optimization scripts. */
export interface LevelTuning {
  seed?: number;
  laneMax?: number;
  laneTail?: number;
  laneSegMin?: number;
  laneSegMax?: number;
  remote?: boolean;
}
export const LEVEL_TUNING: Record<number, LevelTuning> = {};
