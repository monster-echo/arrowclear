/**
 * 体力（能量）系统 — 纯逻辑，引擎无关。
 *
 * 规则（失败才扣的体力模型）：
 *  - 上限 ENERGY_MAX 点；开局前至少要有 1 点（门禁），否则引导看激励广告；
 *  - 通关、中途重开都不扣；**失败一关扣 1 点**，看广告复活会把这点退回；
 *  - 体力不满时每 ENERGY_REGEN_MS 恢复 1 点，离线也照算；
 *  - 看一段激励广告 +ENERGY_AD_GRANT 点。
 *
 * 存档只存 `{ energy, energyAt }`：energyAt 是「上一次体力变动（消耗/回满）或
 * 恢复到上限」的时刻（ms 时间戳）。恢复进度用它现算，不落盘。
 */

export const ENERGY_MAX = 5;
/** 每恢复 1 点体力的间隔（毫秒）：6 分钟。 */
export const ENERGY_REGEN_MS = 6 * 60_000;
/** 失败一关消耗的体力（开一关/重开/通关都不扣）。 */
export const ENERGY_COST_PER_LEVEL = 1;
/** 复活等场景返还的体力（与消耗一致 → 复活退回这次的扣点）。 */
export const ENERGY_WIN_REFUND = 1;
/** 激励广告奖励：看一次 +1 点。 */
export const ENERGY_AD_GRANT = 1;

export interface EnergyState {
  /** 当前体力（0..ENERGY_MAX）。 */
  energy: number;
  /** 上次体力变动 / 触顶的时刻（ms epoch）。 */
  energyAt: number;
}

export function fullEnergy(now: number): EnergyState {
  return { energy: ENERGY_MAX, energyAt: now };
}

function clampEnergy(n: number): number {
  return Math.max(0, Math.min(ENERGY_MAX, Math.floor(n)));
}

/** 把离线恢复结算进状态：满则重置计时，未满则按经过时间补点。 */
export function syncEnergy(state: EnergyState, now: number): EnergyState {
  const energy = clampEnergy(state.energy);
  if (energy >= ENERGY_MAX) return { energy: ENERGY_MAX, energyAt: now };
  const gained = Math.floor((now - state.energyAt) / ENERGY_REGEN_MS);
  if (gained <= 0) return { energy, energyAt: state.energyAt };
  const next = Math.min(ENERGY_MAX, energy + gained);
  return {
    energy: next,
    // 触顶则重新计时；否则保留恢复窗口的整余数，进度不丢。
    energyAt: next >= ENERGY_MAX ? now : state.energyAt + gained * ENERGY_REGEN_MS,
  };
}

/** 当前体力是否足够开始一关。 */
export function canStartLevel(state: EnergyState, now: number): boolean {
  return syncEnergy(state, now).energy >= ENERGY_COST_PER_LEVEL;
}

/** 消耗体力开一关；不足返回 null。满状态消耗时重置恢复计时。 */
export function spendEnergy(state: EnergyState, now: number): EnergyState | null {
  const s = syncEnergy(state, now);
  if (s.energy < ENERGY_COST_PER_LEVEL) return null;
  return {
    energy: clampEnergy(s.energy - ENERGY_COST_PER_LEVEL),
    // 只有从满格掉下来时才重开恢复窗口；未满时继续累计现有进度。
    energyAt: s.energy >= ENERGY_MAX ? now : s.energyAt,
  };
}

/** 通关返还体力（封顶）。 */
export function refundEnergy(state: EnergyState, now: number): EnergyState {
  const s = syncEnergy(state, now);
  const energy = clampEnergy(s.energy + ENERGY_WIN_REFUND);
  return { energy, energyAt: energy >= ENERGY_MAX ? now : s.energyAt };
}

/** 激励广告发体力：+amount 点（默认 ENERGY_AD_GRANT），封顶且不重置恢复进度。 */
export function grantEnergy(
  state: EnergyState,
  now: number,
  amount = ENERGY_AD_GRANT,
): EnergyState {
  const s = syncEnergy(state, now);
  const energy = clampEnergy(s.energy + amount);
  return { energy, energyAt: energy >= ENERGY_MAX ? now : s.energyAt };
}

/** 直接回满（用于重置进度等场景）。 */
export function refillEnergy(state: EnergyState, now: number): EnergyState {
  void state;
  return fullEnergy(now);
}

/** 距离下一点体力恢复还有多少毫秒（已满返回 0）。 */
export function energyNextInMs(state: EnergyState, now: number): number {
  const s = syncEnergy(state, now);
  if (s.energy >= ENERGY_MAX) return 0;
  return Math.max(0, s.energyAt + ENERGY_REGEN_MS - now);
}

/** 把毫秒格式化成 m:ss（体力条倒计时用）。 */
export function formatEnergyClock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
