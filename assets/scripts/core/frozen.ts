/**
 * 冰冻箭规则 — 规则书 §4（v1.1 唯一新机制），纯逻辑、引擎无关。
 *
 * 规则：被冰封的箭无法起飞，但照常阻挡其它箭的航道；
 *       与它身体任意格「上下左右相邻」的箭累计飞走 2 支（去重）即解冻。
 *
 * 无死局证明：解冻条件是「邻居飞走数」的单调函数，飞箭只会让计数上升、
 * 让航道变空 —— 冰冻只是给依赖图加边，不影响「任何合法操作都不会把局面
 * 弄坏」的核心不变量。贪心模拟仍是完备的可解性判定。
 */
import { Arrow, Level, bossShadowCells, canArrowEscape, cellKey } from './types';
import { Rng } from './rng';

/** 每支箭身体四邻域内不同箭的集合（冰冻解冻的计数来源；含 Boss 影子格）。 */
export function frozenAdjacencies(level: Pick<Level, 'arrows' | 'cols' | 'rows'>): Map<number, Set<number>> {
  const owners = new Map<number, number>();
  for (const a of level.arrows) {
    for (const c of a.cells) owners.set(cellKey(c), a.id);
    for (const c of bossShadowCells(level, a)) owners.set(cellKey(c), a.id);
  }
  const adj = new Map<number, Set<number>>();
  for (const a of level.arrows) adj.set(a.id, new Set());
  const deltas = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (const a of level.arrows) {
    for (const c of a.cells) {
      for (const d of deltas) {
        const key = cellKey({ x: c.x + d.x, y: c.y + d.y });
        const other = owners.get(key);
        if (other !== undefined && other !== a.id) adj.get(a.id)!.add(other);
      }
    }
  }
  return adj;
}

/**
 * 生成后处理：给关卡撒冰冻。
 * 约束：
 *  - 只冻结「四邻不同箭数 ≥2」的箭（保证解冻可达）；
 *  - 不冻结开局已自由的箭（开局自由集不被冰冻清空，首步永远有得点）；
 *  - 数量不足时尽量接近 count，允许少给。
 */
export function applyFreeze(level: Level, count: number, rng: Rng): number {
  if (count <= 0) return 0;
  const adj = frozenAdjacencies(level);

  // 开局自由箭：航道无阻挡的箭不许冻结（Boss 影子格也算阻挡；忽略自身占位）。
  const occ = new Map<number, number>();
  for (const a of level.arrows) {
    for (const c of a.cells) occ.set(cellKey(c), a.id);
    for (const c of bossShadowCells(level, a)) occ.set(cellKey(c), a.id);
  }
  const corridorBlocked = (a: Arrow): boolean =>
    !canArrowEscape(level, a, (c) => occ.get(cellKey(c)) !== undefined && occ.get(cellKey(c)) !== a.id);

  const isCandidate = (a: Arrow): boolean =>
    !a.frozen && !a.isBoss && (adj.get(a.id)?.size ?? 0) >= 2 && corridorBlocked(a);

  let pool = level.arrows.filter(isCandidate);
  // 打乱后尽量多冻；死锁用「每轮只解一支」修复并拉黑，再补冻一轮。
  // （旧预防规则「冻结时需 ≥2 非冻结邻居」对长巨蟒盘过度保守：
  //   长箭四邻常只有 2 条邻居，冻一支后邻居立刻不达标，密度上不去。）
  for (let i = pool.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const blacklisted = new Set<number>();
  let applied = 0;
  for (let round = 0; round < 2 && applied < count; round++) {
    for (const a of pool) {
      if (applied >= count) break;
      if (a.frozen || blacklisted.has(a.id)) continue;
      a.frozen = true;
      applied++;
    }
    // 修复：解到可解为止（每轮只解一支，尽量保住密度）。
    for (let guard = applied + 2; guard > 0; guard--) {
      const { solved, alive } = solveGreedyFrozen(level);
      if (solved) break;
      const stuck = level.arrows.find((x) => x.frozen && alive.has(x.id));
      if (!stuck) break;
      stuck.frozen = false;
      blacklisted.add(stuck.id);
      applied--;
    }
    if (applied >= count) break;
    pool = level.arrows.filter(isCandidate);
  }
  return applied;
}

/** 已飞走 removedIds 这些箭后，frozenId 是否解冻（去重邻居 ≥2）。 */
export function isUnfrozen(frozenId: number, removedIds: Set<number>, adj: Map<number, Set<number>>): boolean {
  let hits = 0;
  for (const n of adj.get(frozenId) ?? []) {
    if (removedIds.has(n)) hits++;
    if (hits >= 2) return true;
  }
  return false;
}

/**
 * 带冰冻的贪心可解性判定（完备：每步只会释放格子、抬高解冻计数）。
 * 返回 { solved, order, alive }；alive = 卡死的箭（含互相冰冻成环者），
 * order 同时是运行时「提示」可用的顺序来源。
 */
export function solveGreedyFrozen(level: Level): {
  solved: boolean;
  order: number[];
  alive: Set<number>;
} {
  const adj = frozenAdjacencies(level);
  const alive = new Set(level.arrows.map((a) => a.id));
  const removed = new Set<number>();
  const occ = new Map<number, number>();
  for (const a of level.arrows) {
    for (const c of a.cells) occ.set(cellKey(c), a.id);
    for (const c of bossShadowCells(level, a)) occ.set(cellKey(c), a.id);
  }
  const order: number[] = [];

  let progress = true;
  while (progress && alive.size > 0) {
    progress = false;
    for (const a of level.arrows) {
      if (!alive.has(a.id)) continue;
      if (a.frozen && !isUnfrozen(a.id, removed, adj)) continue;
      const blocked = (c: { x: number; y: number }): boolean => {
        const owner = occ.get(cellKey(c));
        return owner !== undefined && owner !== a.id;
      };
      if (!canArrowEscape(level, a, blocked)) continue;
      for (const c of a.cells) occ.delete(cellKey(c));
      for (const c of bossShadowCells(level, a)) occ.delete(cellKey(c));
      alive.delete(a.id);
      removed.add(a.id);
      order.push(a.id);
      progress = true;
    }
  }
  return { solved: alive.size === 0, order, alive };
}

/** 开局真正可飞的箭数（冰冻箭不算 —— 它们不是合法首步）。 */
export function freeAtStartCount(level: Level): number {
  const adj = frozenAdjacencies(level);
  const occ = new Map<number, number>();
  for (const a of level.arrows) {
    for (const c of a.cells) occ.set(cellKey(c), a.id);
    for (const c of bossShadowCells(level, a)) occ.set(cellKey(c), a.id);
  }
  let free = 0;
  for (const a of level.arrows) {
    if (a.frozen && !isUnfrozen(a.id, new Set(), adj)) continue;
    if (
      canArrowEscape(level, a, (c) => occ.get(cellKey(c)) !== undefined && occ.get(cellKey(c)) !== a.id)
    ) {
      free++;
    }
  }
  return free;
}
