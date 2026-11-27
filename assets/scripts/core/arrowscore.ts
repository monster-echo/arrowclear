/**
 * arrowscore.ts — 《Arrows Out · 大师级连环扣》生成器（v3 重写版）。
 *
 * 忠实移植自用户提供的最新参考实现（buildCandidateBoard / evaluateBoardQuality /
 * buildMasterpieceHighlightData / evaluateOrientationPuzzleScore v3），逻辑原样：
 *   阶段 1  中心偏下 Boss 箭 + 6 座护城河桥 + 1 座 19 格 G 螺旋 + 内锁
 *   阶段 2A 2~3 条 40~65 格「超巨型过山龙」（末端削笔回溯，挽救率 90%+）
 *   阶段 2B 5 条 20~36 格次级巨蟒
 *   阶段 2C 中层钩子（8~16）+ 紧凑层（4~9 / 3~6，MRV 死角起笔）
 *   阶段 3  统一残余吸收（尾接 → 头延 → 双格配对 → 借尾），6 pass
 *   阶段 4  三 pass 单线漏斗手术（目标开局可动 = targetMovable）
 *   （v3 已删除向心极化手术与碎箭焊接）
 *
 * 工程适配（不改变算法行为）：
 *   1. Math.random → 确定性 Rng（mulberry32），同种子同关卡；
 *   2. 参考 22×34 硬编码 → 锚点/尝试次数按盘面面积比例缩放；
 *   3. mask 剪影支持（图案关）；
 *   4. 输出转项目 Arrow 约定（头前尾后 + Dir 枚举）。
 */
import { assignColors, solveGreedy } from './levelgen';
import { Rng } from './rng';
import { Arrow, Cell, Dir, DIR_VECTORS, Level } from './types';

/** 参考盘 22×34：锚点与尝试次数的缩放基准。 */
const REF_W = 22;
const REF_H = 34;

interface Vec {
  x: number;
  y: number;
}

/** 内部工作箭：cells 从尾到头（与参考一致），isBoss 双倍宽。 */
interface WorkArrow {
  id: number;
  cells: Cell[];
  dir: Vec;
  isBoss: boolean;
  layerDepth: number;
}

export interface MasterSpec {
  id: number;
  cols: number;
  rows: number;
  seed: number;
  /** 行主序剪影（1=可放）；无 mask 则满盘。 */
  mask?: Uint8Array;
  /** 漏斗手术目标：开局最大可动箭数（参考为 1）。 */
  targetMovable?: number;
  /** 是否放置 Boss 箭（默认 true）。 */
  withBoss?: boolean;
  /** 棋盘内放置的结构化连环锁数量（螺旋锁/门闩锁/双钩锁/嵌套锁）。 */
  lockCount?: number;
  /** 巨蟒与次级巨蟒长度区间缩放（默认 [40,65] / [20,36]）。 */
  giantScale?: [number, number];
  midScale?: [number, number];
  timeLimit?: number;
}

/** X-Ray 透视：击尾导流样本。 */
export interface TailConduction {
  attackerId: number;
  giantId: number;
  hitCell: Cell;
  traceSteps: number;
}

/** X-Ray 透视：穿针假阻挡样本。 */
export interface DeceptiveExample {
  arrowId: number;
  stepIndex: number;
  pinchGateCount: number;
  raySteps: number;
  pinchCells: Cell[];
}

/** X-Ray 透视：连环扣区域。 */
export interface KnotZone {
  arrowId: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  label: string;
  priority: number;
}

/** X-Ray 透视：前 6 步跃迁链。 */
export interface JumpStep {
  arrowId: number;
  stepIndex: number;
  distToNext: number;
  headX: number;
  headY: number;
}

export interface MasterReport {
  arrows: number;
  maxChainDepth: number;
  initialMovable: number;
  emptyCells: number;
  /** v3 四维评分（0~100）与等级。 */
  totalScore: number;
  difficultyTier: string;
  /** 本盘面的达标线。 */
  gate: number;
  passes: boolean;
  subScores: { hierarchy: number; antiZebra: number; cavity: number; topo: number };
  maxArrowLen: number;
  giantTrunks: number;
  lengthStdDev: number;
  zebraParallelRatio: number;
  nestedCavities: number;
  density: number;
  /** 精妙度指标（v3）。 */
  strictlyOneSteps: number;
  atMostTwoSteps: number;
  avgJumpDist: number;
  deceptiveClearCount: number;
  interlockingKnotCount: number;
  /** X-Ray 透视数据。 */
  jumpChain: JumpStep[];
  tailConductions: TailConduction[];
  deceptiveExamples: DeceptiveExample[];
  knotZones: KnotZone[];
}

const DIR_VECS: readonly Vec[] = DIR_VECTORS;

/* ------------------------------------------------------------------ */
/* 生成器主体                                                          */
/* ------------------------------------------------------------------ */

class Master {
  readonly w: number;
  readonly h: number;
  /** 列主序占用：occ[x][y] = arrowId | null（与参考一致）。 */
  readonly occ: (number | null)[][];
  /** 列主序 mask。 */
  readonly mask: boolean[][];
  readonly list: WorkArrow[] = [];
  readonly idToArrow = new Map<number, WorkArrow>();
  readonly rng: Rng;
  nextId = 1;
  /** 复用型扁平占用缓冲（热循环免分配）。 */
  private flatOcc = new Int16Array(2048);

  constructor(spec: MasterSpec) {
    this.w = spec.cols;
    this.h = spec.rows;
    this.rng = new Rng(spec.seed);
    this.occ = Array.from({ length: this.w }, () => Array<number | null>(this.h).fill(null));
    this.mask = Array.from({ length: this.w }, () => Array<boolean>(this.h).fill(true));
    if (spec.mask) {
      for (let x = 0; x < this.w; x++) {
        for (let y = 0; y < this.h; y++) {
          this.mask[x][y] = spec.mask[y * this.w + x] === 1;
        }
      }
    }
  }

  private ensureFlat(size: number): Int16Array {
    if (this.flatOcc.length < size) this.flatOcc = new Int16Array(size);
    this.flatOcc.fill(0, 0, size);
    return this.flatOcc;
  }

  private canEscapeFlat(a: WorkArrow, flat: Int16Array): boolean {
    const head = a.cells[a.cells.length - 1];
    const dx = a.dir.x;
    const dy = a.dir.y;
    const lanes = a.isBoss ? 2 : 1;
    for (let l = 0; l < lanes; l++) {
      let cx = head.x + l + dx;
      let cy = head.y + dy;
      while (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
        const occupant = flat[cy * this.w + cx];
        if (occupant !== 0 && occupant !== a.id) return false;
        cx += dx;
        cy += dy;
      }
    }
    return true;
  }

  inMask(x: number, y: number): boolean {
    return x >= 0 && x < this.w && y >= 0 && y < this.h && this.mask[x][y];
  }

  /** 箭尖前方第 1 步是否直接刺出画外。 */
  pointsDirectlyOut(cells: Cell[], dir: Vec): boolean {
    const head = cells[cells.length - 1];
    return !this.inMask(head.x + dir.x, head.y + dir.y);
  }

  /** 箭尖朝向与画心向量的点积（-1 朝外 ~ +1 朝内）。 */
  inwardDot(cells: Cell[], dir: Vec): number {
    const head = cells[cells.length - 1];
    const cx = (this.w - 1) / 2;
    const cy = (this.h - 1) / 2;
    const vx = cx - head.x;
    const vy = cy - head.y;
    const d = Math.hypot(vx, vy) || 1;
    return (dir.x * vx + dir.y * vy) / d;
  }

  /** 外圈背离禁令（v3：边带 2/3）。 */
  pointingTowardNearestEdge(cells: Cell[], dir: Vec): boolean {
    const head = cells[cells.length - 1];
    if (head.x <= 2 && dir.x < 0) return true;
    if (head.x >= this.w - 3 && dir.x > 0) return true;
    if (head.y <= 2 && dir.y < 0) return true;
    if (head.y >= this.h - 3 && dir.y > 0) return true;
    return false;
  }

  /** 箭身不得与自身航道相交；头与前段方向必须一致。 */
  selfValid(cells: Cell[], dir: Vec): boolean {
    if (!cells || cells.length < 2) return false;
    const head = cells[cells.length - 1];
    const prev = cells[cells.length - 2];
    if (head.x - prev.x !== dir.x || head.y - prev.y !== dir.y) return false;
    const bodySet = new Set<number>();
    for (let i = 0; i < cells.length - 1; i++) bodySet.add(cells[i].y * 4096 + cells[i].x);
    let cx = head.x + dir.x;
    let cy = head.y + dir.y;
    while (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
      if (bodySet.has(cy * 4096 + cx)) return false;
      cx += dir.x;
      cy += dir.y;
    }
    return true;
  }

  /** 强制带拐角（No Straight Bars）。 */
  hasCorner(cells: Cell[]): boolean {
    if (cells.length <= 2) return true;
    for (let i = 2; i < cells.length; i++) {
      const dx1 = cells[i - 1].x - cells[i - 2].x;
      const dy1 = cells[i - 1].y - cells[i - 2].y;
      const dx2 = cells[i].x - cells[i - 1].x;
      const dy2 = cells[i].y - cells[i - 1].y;
      if (dx1 !== dx2 || dy1 !== dy2) return true;
    }
    return false;
  }

  /** 反平行邻居计数（生长权重用）。 */
  parallelNeighbors(x: number, y: number, dx: number, dy: number): number {
    let count = 0;
    const sideDirs = dx !== 0 ? [{ x: 0, y: -1 }, { x: 0, y: 1 }] : [{ x: -1, y: 0 }, { x: 1, y: 0 }];
    for (const s of sideDirs) {
      const nx = x + s.x;
      const ny = y + s.y;
      if (!this.inMask(nx, ny)) continue;
      const nbId = this.occ[nx][ny];
      if (nbId === null) continue;
      const nb = this.idToArrow.get(nbId);
      if (!nb) continue;
      const idx = nb.cells.findIndex((c) => c.x === nx && c.y === ny);
      if (idx === -1) continue;
      const p = nb.cells[idx - 1];
      const n = nb.cells[idx + 1];
      if (
        (p && Math.abs(p.x - nx) === Math.abs(dx) && Math.abs(p.y - ny) === Math.abs(dy)) ||
        (n && Math.abs(n.x - nx) === Math.abs(dx) && Math.abs(n.y - ny) === Math.abs(dy))
      ) {
        count++;
      }
    }
    return count;
  }

  /** 逃逸信息：Boss 双列 AND（任一被挡即不可飞）；含最近阻挡格与畅通步数。 */
  escapeInfoOn(
    occ: (number | null)[][],
    a: WorkArrow,
  ): { canEscape: boolean; blockerId: number | null; blockCell: Cell | null; freeSteps: number } {
    const head = a.cells[a.cells.length - 1];
    const dir = a.dir;
    const lanes = a.isBoss ? [head, { x: head.x + 1, y: head.y }] : [head];
    let minFreeSteps = Infinity;
    let closestBlockerId: number | null = null;
    let closestBlockCell: Cell | null = null;
    for (const start of lanes) {
      let cx = start.x + dir.x;
      let cy = start.y + dir.y;
      let steps = 0;
      while (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
        const occupant = occ[cx][cy];
        if (occupant !== null && occupant !== a.id) {
          if (steps < minFreeSteps) {
            minFreeSteps = steps;
            closestBlockerId = occupant;
            closestBlockCell = { x: cx, y: cy };
          }
          break;
        }
        cx += dir.x;
        cy += dir.y;
        steps++;
      }
    }
    if (closestBlockerId !== null) {
      return { canEscape: false, blockerId: closestBlockerId, blockCell: closestBlockCell, freeSteps: minFreeSteps };
    }
    return { canEscape: true, blockerId: null, blockCell: null, freeSteps: Math.max(this.w, this.h) + 6 };
  }

  escapeInfo(a: WorkArrow): { canEscape: boolean; blockerId: number | null; blockCell: Cell | null; freeSteps: number } {
    return this.escapeInfoOn(this.occ, a);
  }

  private stampIn(a: WorkArrow): void {
    for (const c of a.cells) {
      this.occ[c.x][c.y] = a.id;
      if (a.isBoss && c.x + 1 < this.w) this.occ[c.x + 1][c.y] = a.id;
    }
  }

  private stampOut(a: WorkArrow): void {
    for (const c of a.cells) {
      this.occ[c.x][c.y] = null;
      if (a.isBoss && c.x + 1 < this.w && this.occ[c.x + 1][c.y] === a.id) this.occ[c.x + 1][c.y] = null;
    }
  }

  /** 贪心可解性判定（扁平缓冲 + 从 list 重建占用）。 */
  solvable(): boolean {
    const n = this.list.length;
    if (n <= 1) return true;
    const flat = this.ensureFlat(this.w * this.h);
    for (const a of this.list) {
      for (const c of a.cells) {
        const idx = c.y * this.w + c.x;
        flat[idx] = a.id;
        if (a.isBoss && c.x + 1 < this.w) flat[idx + 1] = a.id;
      }
    }
    const removed = new Uint8Array(n);
    let remaining = n;
    let progress = true;
    while (remaining > 0 && progress) {
      progress = false;
      for (let i = 0; i < n; i++) {
        if (removed[i]) continue;
        const a = this.list[i];
        if (this.canEscapeFlat(a, flat)) {
          for (const c of a.cells) {
            const idx = c.y * this.w + c.x;
            flat[idx] = 0;
            if (a.isBoss && c.x + 1 < this.w) flat[idx + 1] = 0;
          }
          removed[i] = 1;
          remaining--;
          progress = true;
        }
      }
    }
    return remaining === 0;
  }

  /** 拓扑剥洋葱深度（扁平缓冲；同时标注 layerDepth）。 */
  topologicalDepths(): number {
    const n = this.list.length;
    const flat = this.ensureFlat(this.w * this.h);
    for (const a of this.list) {
      for (const c of a.cells) {
        const idx = c.y * this.w + c.x;
        flat[idx] = a.id;
        if (a.isBoss && c.x + 1 < this.w) flat[idx + 1] = a.id;
      }
    }
    const removed = new Uint8Array(n);
    let remaining = n;
    let layer = 0;
    while (remaining > 0) {
      const batch: number[] = [];
      for (let i = 0; i < n; i++) {
        if (!removed[i] && this.canEscapeFlat(this.list[i], flat)) batch.push(i);
      }
      if (!batch.length) break;
      for (const idx of batch) {
        const a = this.list[idx];
        a.layerDepth = layer;
        for (const c of a.cells) {
          const ci = c.y * this.w + c.x;
          flat[ci] = 0;
          if (a.isBoss && c.x + 1 < this.w) flat[ci + 1] = 0;
        }
        removed[idx] = 1;
        remaining--;
      }
      layer++;
    }
    return layer;
  }

  /* -------------------------------------------------------------- */
  /* 精妙度算子（v3）                                                 */
  /* -------------------------------------------------------------- */

  /** 迷惑性走廊：夹壁 / 收窄门 / 擦头角 → 幻觉分与窄门格列表。 */
  deceptiveCorridor(
    a: WorkArrow,
    occ: (number | null)[][],
    idToArrow: Map<number, WorkArrow>,
    requireAliveInOcc: boolean,
  ): { isDeceptive: boolean; raySteps: number; pinchGateCount: number; illusionScore: number; pinchCells: Cell[] } {
    const head = a.cells[a.cells.length - 1];
    const dir = a.dir;
    const perp1 = { x: -dir.y, y: dir.x };
    const perp2 = { x: dir.y, y: -dir.x };

    let cx = head.x + dir.x;
    let cy = head.y + dir.y;
    let raySteps = 0;
    let flankWallCount = 0;
    let pinchGateCount = 0;
    let nearMissCornerOrHead = 0;
    const myDepth = a.layerDepth || 0;
    const pinchCells: Cell[] = [];

    while (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
      raySteps++;
      let leftOcc = false;
      let rightOcc = false;
      for (let side = 0; side < 2; side++) {
        const p = side === 0 ? perp1 : perp2;
        const nx = cx + p.x;
        const ny = cy + p.y;
        if (!this.inMask(nx, ny)) continue;
        const nbId = occ[nx][ny];
        if (nbId === null || nbId === a.id) continue;
        const nb = idToArrow.get(nbId);
        if (!requireAliveInOcc && nb && (nb.layerDepth || 0) < myDepth) continue;

        if (side === 0) leftOcc = true;
        else rightOcc = true;
        flankWallCount++;

        if (nb && raySteps >= 3) {
          const nbHead = nb.cells[nb.cells.length - 1];
          const nbTail = nb.cells[0];
          if ((nbHead.x === nx && nbHead.y === ny) || (nbTail.x === nx && nbTail.y === ny)) {
            nearMissCornerOrHead += 2;
            if (pinchCells.length < 6) pinchCells.push({ x: nx, y: ny });
          }
        }
      }
      if (leftOcc && rightOcc) pinchGateCount++;
      cx += dir.x;
      cy += dir.y;
    }

    const isDeceptive = raySteps >= 5 && (pinchGateCount >= 2 || (flankWallCount >= 5 && nearMissCornerOrHead >= 2));
    const illusionScore =
      raySteps >= 5
        ? pinchGateCount * 42 + flankWallCount * 14 + nearMissCornerOrHead * 35 + Math.min(raySteps, 18) * 6
        : 0;
    return { isDeceptive, raySteps, pinchGateCount, illusionScore, pinchCells };
  }

  /** v3 朝向解谜分：向心×140 + 尾缆传导 + 身体传导 + 首距×14 + 幻觉 + 命中×45。 */
  orientationScore(candidate: WorkArrow): number {
    const cells = candidate.cells;
    const head = cells[cells.length - 1];
    const dir = candidate.dir;
    if (this.pointingTowardNearestEdge(cells, dir)) return -1800;

    const headInwardDot = this.inwardDot(cells, dir);
    let cx = head.x + dir.x;
    let cy = head.y + dir.y;
    let rayDist = 0;
    let firstHitDist = -1;
    let tailWireBonus = 0;
    let bodyConductionCells = 0;
    const hitArrowIds = new Set<number>();

    while (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
      rayDist++;
      const bid = this.occ[cx][cy];
      if (bid !== null && bid !== candidate.id) {
        const blocker = this.idToArrow.get(bid);
        if (blocker) {
          const hitIdx = blocker.cells.findIndex((c) => c.x === cx && c.y === cy);
          if (hitIdx !== -1) {
            const remainingBody = blocker.cells.length - 1 - hitIdx;
            bodyConductionCells = Math.max(bodyConductionCells, remainingBody);
            if (firstHitDist === -1) {
              firstHitDist = rayDist;
              const bHead = blocker.cells[blocker.cells.length - 1];
              const headDist = Math.hypot(head.x - bHead.x, head.y - bHead.y);
              if (blocker.cells.length >= 6 && hitIdx <= Math.floor(blocker.cells.length * 0.28)) {
                tailWireBonus += headDist * 22.0 + remainingBody * 26.0;
              }
            }
          }
        }
        hitArrowIds.add(bid);
      }
      cx += dir.x;
      cy += dir.y;
    }

    if (hitArrowIds.size === 0) return -1500 + headInwardDot * 40;
    const dec = this.deceptiveCorridor(candidate, this.occ, this.idToArrow, false);
    return (
      headInwardDot * 140 +
      tailWireBonus +
      bodyConductionCells * 18 +
      firstHitDist * 14 +
      dec.illusionScore +
      hitArrowIds.size * 45
    );
  }

  /* -------------------------------------------------------------- */
  /* 生成管线（v3）                                                   */
  /* -------------------------------------------------------------- */

  private commitArrow(pts: Cell[], dir: Vec, isBoss = false): boolean {
    const cand: WorkArrow = { id: this.nextId, cells: pts, dir, isBoss, layerDepth: 0 };
    this.list.push(cand);
    if (!this.solvable()) {
      this.list.pop();
      return false;
    }
    this.idToArrow.set(this.nextId, cand);
    for (const p of pts) {
      this.occ[p.x][p.y] = this.nextId;
      if (isBoss && p.x + 1 < this.w) this.occ[p.x + 1][p.y] = this.nextId;
    }
    this.nextId++;
    return true;
  }

  private tryCommitFixed(pts: Cell[], isBoss = false): boolean {
    for (const p of pts) {
      if (!this.inMask(p.x, p.y) || this.occ[p.x][p.y] !== null) return false;
      if (isBoss && (p.x + 1 >= this.w || !this.inMask(p.x + 1, p.y) || this.occ[p.x + 1][p.y] !== null)) return false;
    }
    if (pts.length < 2) return false;
    const head = pts[pts.length - 1];
    const prev = pts[pts.length - 2];
    const dir = { x: head.x - prev.x, y: head.y - prev.y };
    return this.selfValid(pts, dir) && this.commitArrow(pts, dir, isBoss);
  }

  /** MRV 最小剩余自由度起笔：18 采样取死角，源头减少碎洞。 */
  private pickMRVSeed(): Cell | null {
    let bestX = -1;
    let bestY = -1;
    let bestDeg = 99;
    for (let sample = 0; sample < 18; sample++) {
      const rx = this.rng.int(this.w);
      const ry = this.rng.int(this.h);
      if (!this.inMask(rx, ry) || this.occ[rx][ry] !== null) continue;
      let deg = 0;
      for (const d of DIR_VECS) {
        if (this.inMask(rx + d.x, ry + d.y) && this.occ[rx + d.x][ry + d.y] === null) deg++;
      }
      if (deg > 0 && deg < bestDeg) {
        bestDeg = deg;
        bestX = rx;
        bestY = ry;
        if (deg === 1) break;
      }
    }
    return bestX !== -1 ? { x: bestX, y: bestY } : null;
  }

  /** 末端削笔回溯：每方向取最长合法形态，双向按分择优提交。 */
  private rescueAndCommitPath(rawPath: Cell[], minL: number): boolean {
    const cands: { seq: Cell[]; dir: Vec; score: number }[] = [];
    for (const baseSeq of [rawPath, [...rawPath].reverse()]) {
      const maxTrim = Math.min(8, baseSeq.length - minL);
      for (let trim = 0; trim <= maxTrim; trim++) {
        const seq = trim === 0 ? baseSeq : baseSeq.slice(0, baseSeq.length - trim);
        if (seq.length < minL || !this.hasCorner(seq)) continue;
        const head = seq[seq.length - 1];
        const prev = seq[seq.length - 2];
        const dir = { x: head.x - prev.x, y: head.y - prev.y };
        if (this.pointsDirectlyOut(seq, dir) || this.pointingTowardNearestEdge(seq, dir) || !this.selfValid(seq, dir)) continue;
        const cand: WorkArrow = { id: this.nextId, cells: seq, dir, isBoss: false, layerDepth: 0 };
        this.list.push(cand);
        const ok = this.solvable();
        this.list.pop();
        if (ok) {
          const score = this.orientationScore(cand) + seq.length * 12;
          cands.push({ seq, dir, score });
          break; // 当前方向最长合法形态即可
        }
      }
    }
    if (cands.length > 0) {
      cands.sort((a, b) => b.score - a.score);
      return this.commitArrow(cands[0].seq, cands[0].dir, false);
    }
    return false;
  }

  /** v3 多尺度生长：MRV 起笔 + 二步开阔度前瞻 + 新直行/拐弯权重。 */
  private growLayer(minL: number, maxL: number, attempts: number, allowCompact: boolean, maxCount = Infinity): number {
    let placedCount = 0;
    for (let att = 0; att < attempts; att++) {
      if (placedCount >= maxCount) break;
      const seed = allowCompact ? this.pickMRVSeed() : { x: this.rng.int(this.w), y: this.rng.int(this.h) };
      if (!seed || !this.inMask(seed.x, seed.y) || this.occ[seed.x][seed.y] !== null) continue;

      const targetLen = this.rng.range(minL, maxL);
      const path: Cell[] = [{ x: seed.x, y: seed.y }];
      const inPath = new Set<number>([seed.y * 4096 + seed.x]);
      let lastDir: Vec | null = null;
      let straightRun = 0;

      for (let step = 1; step < targetLen; step++) {
        const curr = path[path.length - 1];
        const validNext: { x: number; y: number; d: Vec; weight: number }[] = [];
        for (const d of DIR_VECS) {
          const nx = curr.x + d.x;
          const ny = curr.y + d.y;
          if (!this.inMask(nx, ny) || this.occ[nx][ny] !== null || inPath.has(ny * 4096 + nx)) continue;
          if (!allowCompact) {
            let selfTouch = 0;
            for (const nd of DIR_VECS) {
              const tx = nx + nd.x;
              const ty = ny + nd.y;
              if (!(tx === curr.x && ty === curr.y) && inPath.has(ty * 4096 + tx)) selfTouch++;
            }
            if (selfTouch > 0) continue;
          }

          // 二步开阔度前瞻：超长巨蟒避免钻进死胡同。
          let onwardOpen = 0;
          for (const nd of DIR_VECS) {
            if (this.inMask(nx + nd.x, ny + nd.y) && this.occ[nx + nd.x][ny + nd.y] === null && !inPath.has((ny + nd.y) * 4096 + nx + nd.x)) {
              onwardOpen++;
            }
          }
          if (targetLen >= 35 && step < targetLen - 2 && onwardOpen === 0) continue;

          const isSame = lastDir && d.x === lastDir.x && d.y === lastDir.y;
          let weight = isSame ? (straightRun < 3 ? 42 : straightRun >= 5 ? 0.5 : 14) : straightRun >= 2 ? 48 : 6;
          if (targetLen >= 35) weight *= 1 + onwardOpen * 0.45;
          const pCount = this.parallelNeighbors(nx, ny, d.x, d.y);
          if (pCount > 0) weight *= Math.pow(0.12, pCount);
          validNext.push({ x: nx, y: ny, d, weight });
        }
        if (validNext.length === 0) break;
        let r = this.rng.next() * validNext.reduce((s, v) => s + v.weight, 0);
        let pick = validNext[0];
        for (const v of validNext) {
          r -= v.weight;
          if (r <= 0) {
            pick = v;
            break;
          }
        }
        path.push({ x: pick.x, y: pick.y });
        inPath.add(pick.y * 4096 + pick.x);
        straightRun = lastDir && pick.d.x === lastDir.x && pick.d.y === lastDir.y ? straightRun + 1 : 1;
        lastDir = pick.d;
      }

      if (path.length >= minL) {
        if (minL >= 18) {
          if (this.rescueAndCommitPath(path, minL)) placedCount++;
        } else if (allowCompact || this.hasCorner(path)) {
          const cands: { seq: Cell[]; dir: Vec; score: number }[] = [];
          for (const seq of [path, [...path].reverse()]) {
            const head = seq[seq.length - 1];
            const prev = seq[seq.length - 2];
            const dir = { x: head.x - prev.x, y: head.y - prev.y };
            if (this.pointsDirectlyOut(seq, dir) || this.pointingTowardNearestEdge(seq, dir) || !this.selfValid(seq, dir)) continue;
            const cand: WorkArrow = { id: this.nextId, cells: seq, dir, isBoss: false, layerDepth: 0 };
            this.list.push(cand);
            const ok = this.solvable();
            this.list.pop();
            if (ok) cands.push({ seq, dir, score: this.orientationScore(cand) });
          }
          if (cands.length > 0) {
            cands.sort((a, b) => b.score - a.score);
            if (this.commitArrow(cands[0].seq, cands[0].dir, false)) placedCount++;
          }
        }
      }
    }
    return placedCount;
  }

  /** 统一残余空格吸收器（尾接 → 头延 → 双格配对 → 借尾），6 pass。 */
  private fillResidual(): void {
    for (let pass = 0; pass < 6; pass++) {
      const allowOutward = pass >= 4;
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          if (!this.inMask(x, y) || this.occ[x][y] !== null) continue;
          let done = false;

          // (a) 并入邻居箭尾或延伸邻居箭尖（优先选仍被阻挡的方向，避免凭空增加开局可飞箭）。
          for (const d of DIR_VECS) {
            const nx = x + d.x;
            const ny = y + d.y;
            if (!this.inMask(nx, ny) || this.occ[nx][ny] === null) continue;
            const arr = this.idToArrow.get(this.occ[nx][ny]!);
            if (!arr || arr.isBoss) continue;
            if (arr.cells[0].x === nx && arr.cells[0].y === ny) {
              arr.cells.unshift({ x, y });
              if (this.selfValid(arr.cells, arr.dir) && this.solvable()) {
                this.occ[x][y] = arr.id;
                done = true;
                break;
              }
              arr.cells.shift();
            }
            const head = arr.cells[arr.cells.length - 1];
            if (head.x === nx && head.y === ny) {
              const newDir = { x: x - head.x, y: y - head.y };
              const grown = [...arr.cells, { x, y }];
              if (this.pointsDirectlyOut(grown, newDir) && !allowOutward) continue;
              const oldDir = arr.dir;
              arr.cells.push({ x, y });
              arr.dir = newDir;
              this.occ[x][y] = arr.id;
              if (
                this.selfValid(arr.cells, arr.dir) &&
                (!this.escapeInfo(arr).canEscape || allowOutward) &&
                this.solvable()
              ) {
                done = true;
                break;
              }
              arr.cells.pop();
              arr.dir = oldDir;
              this.occ[x][y] = null;
            }
          }
          if (done) continue;

          // (b) 相邻双空格配对，或向长箭借 1 格箭尾（优先被挡方向，减少漏斗漏箭）。
          for (const d of DIR_VECS) {
            const nx = x + d.x;
            const ny = y + d.y;
            if (!this.inMask(nx, ny)) continue;
            if (this.occ[nx][ny] === null) {
              const pair = [
                [{ x, y }, { x: nx, y: ny }],
                [{ x: nx, y: ny }, { x, y }],
              ] as Cell[][];
              const blockedSeqs: { seq: Cell[]; dir: Vec }[] = [];
              const freeSeqs: { seq: Cell[]; dir: Vec }[] = [];
              for (const seq of pair) {
                const dir = { x: seq[1].x - seq[0].x, y: seq[1].y - seq[0].y };
                if (this.pointsDirectlyOut(seq, dir) && !allowOutward) continue;
                const probe: WorkArrow = { id: this.nextId, cells: seq, dir, isBoss: false, layerDepth: 0 };
                if (this.escapeInfo(probe).canEscape) freeSeqs.push({ seq, dir });
                else blockedSeqs.push({ seq, dir });
              }
              for (const c of [...blockedSeqs, ...freeSeqs]) {
                if (!allowOutward && freeSeqs.includes(c)) continue;
                if (this.commitArrow(c.seq, c.dir, false)) {
                  done = true;
                  break;
                }
              }
            } else if (allowOutward) {
              const nb = this.idToArrow.get(this.occ[nx][ny]!);
              if (nb && !nb.isBoss && nb.cells.length >= 3 && nb.cells[0].x === nx && nb.cells[0].y === ny) {
                const borrowed = nb.cells.shift()!;
                const pair = [
                  [borrowed, { x, y }],
                  [{ x, y }, borrowed],
                ] as Cell[][];
                for (const seq of pair) {
                  const dir = { x: seq[1].x - seq[0].x, y: seq[1].y - seq[0].y };
                  if (this.selfValid(nb.cells, nb.dir) && this.commitArrow(seq, dir, false)) {
                    done = true;
                    break;
                  }
                }
                if (!done) {
                  nb.cells.unshift(borrowed);
                  this.occ[borrowed.x][borrowed.y] = nb.id;
                }
              }
            }
            if (done) break;
          }
        }
      }
    }
  }

  /**
   * 工程适配·孤立格纵劈吸收（v3 精简满铺在大盘留 30~80 个空格，
   * 评分按填充率惩罚；此术只做「邻箭纵劈 + 空格并入」填洞，不改变 v3 生成特性）。
   */
  private splitAbsorbIsolated(): void {
    for (let guard = 0; guard < 4; guard++) {
      let any = false;
      for (let y = 0; y < this.h; y++) {
        for (let x = 0; x < this.w; x++) {
          if (!this.inMask(x, y) || this.occ[x][y] !== null) continue;
          const mids: { arr: WorkArrow; idx: number }[] = [];
          for (const d of DIR_VECS) {
            const nx = x + d.x;
            const ny = y + d.y;
            if (!this.inMask(nx, ny)) continue;
            const id = this.occ[nx][ny];
            if (id === null) continue;
            const arr = this.idToArrow.get(id);
            if (!arr) continue;
            const idx = arr.cells.findIndex((c) => c.x === nx && c.y === ny);
            if (!arr.isBoss && idx >= 1 && idx <= arr.cells.length - 3) mids.push({ arr, idx });
          }
          if (!mids.length) continue;
          mids.sort((a, b) => b.arr.cells.length - a.arr.cells.length);

          const e = { x, y };
          for (const { arr, idx } of mids) {
            const tailPart = arr.cells.slice(0, idx + 1);
            const headPart = arr.cells.slice(idx + 1);
            const cutCell = tailPart[tailPart.length - 1];
            const tailPrev = tailPart[tailPart.length - 2];
            if (tailPrev.x === cutCell.x && tailPrev.y === cutCell.y) continue;
            const newDir = { x: e.x - cutCell.x, y: e.y - cutCell.y };
            if (newDir.x === 0 && newDir.y === 0) continue;

            const oldCells = [...arr.cells];
            const oldDir = arr.dir;
            const T: WorkArrow = { id: this.nextId, cells: [...tailPart, e], dir: newDir, isBoss: false, layerDepth: 0 };
            arr.cells = headPart;

            this.list.push(T);
            this.occ[e.x][e.y] = T.id;
            for (const c of tailPart) this.occ[c.x][c.y] = T.id;

            if (this.selfValid(T.cells, newDir) && this.selfValid(arr.cells, arr.dir) && this.solvable()) {
              this.idToArrow.set(T.id, T);
              this.nextId++;
              any = true;
              break;
            }
            this.list.pop();
            this.occ[e.x][e.y] = null;
            for (let i = 0; i < tailPart.length; i++) {
              const c = tailPart[i];
              this.occ[c.x][c.y] = arr.id;
            }
            arr.cells = oldCells;
            arr.dir = oldDir;
          }
        }
      }
      if (!any) break;
    }
  }

  /**
   * 单线漏斗手术（压制开局可动数到目标值）。
   * 工程适配：4 种手术（调头 / 借尾拐头 / 并入受阻长箭 / 借尾延伸），
   * 仍有进展就继续（≤14），稳定压到目标「单线突破口」。
   */
  funnelSurgery(target: number): void {
    let lastMovable = Infinity;
    for (let pass = 0; pass < 14; pass++) {
      const movable = this.list.filter((a) => !a.isBoss && this.escapeInfo(a).canEscape);
      if (movable.length <= target) break;
      if (movable.length >= lastMovable && pass >= 6) break;
      lastMovable = movable.length;

      for (const arr of movable) {
        if (this.list.filter((a) => !a.isBoss && this.escapeInfo(a).canEscape).length <= target) break;

        // 手术 1：首尾调头。
        const rev = [...arr.cells].reverse();
        const revDir = {
          x: rev[rev.length - 1].x - rev[rev.length - 2].x,
          y: rev[rev.length - 1].y - rev[rev.length - 2].y,
        };
        if (!this.pointsDirectlyOut(rev, revDir) && this.selfValid(rev, revDir)) {
          const oldC = arr.cells;
          const oldD = arr.dir;
          this.stampOut(arr);
          arr.cells = rev;
          arr.dir = revDir;
          this.stampIn(arr);
          if (!this.escapeInfo(arr).canEscape && this.solvable()) continue;
          this.stampOut(arr);
          arr.cells = oldC;
          arr.dir = oldD;
          this.stampIn(arr);
        }

        // 手术 2：借邻居 1 格箭尾拐头（允许借出后邻居 ≥2 格）。
        const head = arr.cells[arr.cells.length - 1];
        let fixed = false;
        for (const d of DIR_VECS) {
          const nx = head.x + d.x;
          const ny = head.y + d.y;
          if (!this.inMask(nx, ny) || this.occ[nx][ny] === null) continue;
          const nb = this.idToArrow.get(this.occ[nx][ny]!);
          if (!nb || nb.id === arr.id || nb.isBoss || nb.cells.length < 3) continue;
          if (nb.cells[0].x === nx && nb.cells[0].y === ny) {
            const borrowed = nb.cells.shift()!;
            const oldDir = arr.dir;
            arr.cells.push(borrowed);
            arr.dir = { x: borrowed.x - head.x, y: borrowed.y - head.y };
            this.occ[borrowed.x][borrowed.y] = arr.id;
            if (
              !this.pointsDirectlyOut(arr.cells, arr.dir) &&
              this.selfValid(arr.cells, arr.dir) &&
              this.selfValid(nb.cells, nb.dir) &&
              !this.escapeInfo(arr).canEscape &&
              this.solvable()
            ) {
              fixed = true;
              break;
            }
            arr.cells.pop();
            arr.dir = oldDir;
            nb.cells.unshift(borrowed);
            this.occ[borrowed.x][borrowed.y] = nb.id;
          }
        }
        if (fixed) continue;

        // 手术 3：自由箭（≤8 格）并入相邻受阻长箭尾部，既消自由箭又造长蛇。
        if (arr.cells.length <= 8) {
          for (const seq of [arr.cells, [...arr.cells].reverse()]) {
            const endPt = seq[seq.length - 1];
            let merged = false;
            for (const d of DIR_VECS) {
              const nx = endPt.x + d.x;
              const ny = endPt.y + d.y;
              if (!this.inMask(nx, ny) || this.occ[nx][ny] === null) continue;
              const nb = this.idToArrow.get(this.occ[nx][ny]!);
              if (!nb || nb.id === arr.id || nb.isBoss || this.escapeInfo(nb).canEscape) continue;
              if (nb.cells[0].x === nx && nb.cells[0].y === ny) {
                const oldNbCells = [...nb.cells];
                const idx = this.list.indexOf(arr);
                nb.cells = [...seq, ...nb.cells];
                for (const c of seq) this.occ[c.x][c.y] = nb.id;
                if (idx !== -1) this.list.splice(idx, 1);
                if (this.selfValid(nb.cells, nb.dir) && !this.escapeInfo(nb).canEscape && this.solvable()) {
                  this.idToArrow.delete(arr.id);
                  merged = true;
                  break;
                }
                nb.cells = oldNbCells;
                for (const c of seq) this.occ[c.x][c.y] = arr.id;
                if (idx !== -1) this.list.splice(idx, 0, arr);
              }
            }
            if (merged) {
              fixed = true;
              break;
            }
          }
        }
        if (fixed) continue;
      }
    }
  }

  /**
   * 原子放置一个多箭连环锁模组（任一箭越界/重叠/不可解则整组回滚）。
   * 返回成功放置时新增的箭数（0 表示失败）。
   */
  private tryCommitLockCluster(
    ax: number,
    ay: number,
    bw: number,
    bh: number,
    rot: number,
    flip: boolean,
    groups: readonly (readonly [number, number][])[],
  ): number {
    const transform = (lx: number, ly: number): Cell => {
      const fx = flip ? bw - 1 - lx : lx;
      switch (rot & 3) {
        case 1:
          return { x: ax + (bh - 1 - ly), y: ay + fx };
        case 2:
          return { x: ax + (bw - 1 - fx), y: ay + (bh - 1 - ly) };
        case 3:
          return { x: ax + ly, y: ay + (bw - 1 - fx) };
        default:
          return { x: ax + fx, y: ay + ly };
      }
    };

    const built: WorkArrow[] = [];
    const usedKeys = new Set<number>();
    for (const grp of groups) {
      if (grp.length < 2) return 0;
      const pts = grp.map(([lx, ly]) => transform(lx, ly));
      for (const p of pts) {
        const k = p.y * 4096 + p.x;
        if (!this.inMask(p.x, p.y) || this.occ[p.x][p.y] !== null || usedKeys.has(k)) return 0;
        usedKeys.add(k);
      }
      const head = pts[pts.length - 1];
      const prev = pts[pts.length - 2];
      const dir = { x: head.x - prev.x, y: head.y - prev.y };
      if (!this.selfValid(pts, dir)) return 0;
      built.push({ id: this.nextId + built.length, cells: pts, dir, isBoss: false, layerDepth: 0 });
    }

    // 优先保证模组的「最外层解锁入口」朝向棋盘内侧，方便后续长蛇把它包入深层依赖链。
    const pin = built[built.length - 1];
    if (this.pointsDirectlyOut(pin.cells, pin.dir)) return 0;

    for (const a of built) this.list.push(a);
    if (!this.solvable()) {
      for (let i = 0; i < built.length; i++) this.list.pop();
      return 0;
    }
    for (const a of built) {
      this.idToArrow.set(a.id, a);
      for (const p of a.cells) this.occ[p.x][p.y] = a.id;
    }
    this.nextId += built.length;
    return built.length;
  }

  /** 阶段 1：可选 Boss + 6 护城河桥 + 多组互锁结构（螺旋锁/门闩锁/双钩锁/嵌套锁）。 */
  private placeFixedStructures(withBoss: boolean, lockCount: number): void {
    const fx = (r: number): number => Math.max(1, Math.min(this.w - 2, Math.round(r * this.w)));
    const fy = (r: number): number => Math.max(1, Math.min(this.h - 2, Math.round(r * this.h)));

    if (withBoss) {
      const bossLen = this.h <= 25 ? 5 : 6;
      const pointUp = this.rng.next() < 0.5;
      for (let tryBoss = 0; tryBoss < 6; tryBoss++) {
        const bx = Math.max(2, Math.min(this.w - 4, Math.round(this.w * (0.34 + this.rng.next() * 0.24))));
        const by = Math.max(2, Math.min(this.h - bossLen - 2, Math.round(this.h * (0.28 + this.rng.next() * 0.26))));
        const bossCells: Cell[] = Array.from({ length: bossLen }, (_, i) => ({
          x: bx,
          y: pointUp ? by + (bossLen - 1 - i) : by + i,
        }));
        if (this.tryCommitFixed(bossCells, true)) break;
      }
    }

    // 6 座护城河桥（上 2 / 左右各 1 / 下 2，尾贴边、尖内拐）。
    const b = (x0: number, x1: number, yEdge: number, inward: number): Cell[] => {
      const cells: Cell[] = [];
      const step = x1 >= x0 ? 1 : -1;
      for (let x = x0; x !== x1 + step; x += step) cells.push({ x, y: yEdge });
      for (let i = 1; i <= 2; i++) cells.push({ x: x1, y: yEdge + inward * i });
      return cells;
    };
    const v = (y0: number, y1: number, xEdge: number, inward: number): Cell[] => {
      const cells: Cell[] = [];
      const step = y1 >= y0 ? 1 : -1;
      for (let y = y0; y !== y1 + step; y += step) cells.push({ x: xEdge, y });
      for (let i = 1; i <= 2; i++) cells.push({ x: xEdge + inward * i, y: y1 });
      return cells;
    };
    this.tryCommitFixed(b(fx(0.09), fx(0.32), 0, 1));
    this.tryCommitFixed(b(fx(0.86), fx(0.64), 0, 1));
    this.tryCommitFixed(v(fy(0.12), fy(0.24), 0, 1));
    this.tryCommitFixed(v(fy(0.15), fy(0.26), this.w - 1, -1));
    this.tryCommitFixed(b(fx(0.14), fx(0.36), this.h - 1, -1));
    this.tryCommitFixed(b(fx(0.86), fx(0.64), this.h - 1, -1));

    // 4 种经过拓扑验证的满铺互锁模组（每组内部全无空格、多段连锁解锁，最后一支为外口门闩）。
    const LOCK_MOTIFS: { bw: number; bh: number; groups: [number, number][][] }[] = [
      // (0) 螺旋核心锁（5×5）：外门闩 → 14 格螺旋 → 3 格内芯 A → 3 格内芯 B
      {
        bw: 5,
        bh: 5,
        groups: [
          [[2, 2], [2, 3], [1, 3], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [4, 2], [4, 3]],
          [[3, 3], [3, 2], [3, 1]],
          [[1, 2], [1, 1], [2, 1]],
          [[0, 4], [1, 4], [2, 4], [3, 4], [4, 4]],
        ],
      },
      // (1) 门闩卡槽锁（5×5）：拔掉 1 根门闩，U 槽 + 3 支并行内箭同时连发
      {
        bw: 5,
        bh: 5,
        groups: [
          [[0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [4, 2], [4, 3]],
          [[1, 1], [1, 2], [1, 3]],
          [[2, 1], [2, 2], [2, 3]],
          [[3, 1], [3, 2], [3, 3]],
          [[4, 4], [3, 4], [2, 4], [1, 4], [0, 4]],
        ],
      },
      // (2) 双钩太极互锁（5×5）：4 段逐层剥离
      {
        bw: 5,
        bh: 5,
        groups: [
          [[2, 4], [1, 4], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [4, 1], [4, 2], [4, 3]],
          [[2, 2], [2, 1], [1, 1], [1, 2], [1, 3], [2, 3], [3, 3]],
          [[3, 1], [3, 2]],
          [[3, 4], [4, 4]],
        ],
      },
      // (3) 回字双层嵌套锁（6×6）：外门闩 → 15 格回字外墙 → 11 格中钩 + 内芯
      {
        bw: 6,
        bh: 6,
        groups: [
          [[0, 5], [0, 4], [0, 3], [0, 2], [0, 1], [0, 0], [1, 0], [2, 0], [3, 0], [4, 0], [5, 0], [5, 1], [5, 2], [5, 3], [5, 4]],
          [[4, 2], [4, 1], [3, 1], [2, 1], [1, 1], [1, 2], [1, 3], [1, 4], [2, 4], [3, 4], [4, 4]],
          [[2, 2], [3, 2]],
          [[2, 3], [3, 3], [4, 3]],
          [[1, 5], [2, 5], [3, 5], [4, 5], [5, 5]],
        ],
      },
    ];

    // 按棋盘分区生成候选锚点，确保多把锁均匀分散而非堆在一起。
    const sectorsX = this.w >= 28 ? 3 : 2;
    const sectorsY = this.h >= 38 ? 4 : this.h >= 28 ? 3 : 2;
    const slots: { sx: number; sy: number }[] = [];
    for (let gy = 0; gy < sectorsY; gy++) {
      for (let gx = 0; gx < sectorsX; gx++) {
        slots.push({ sx: gx, sy: gy });
      }
    }
    for (let i = slots.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }

    const placedCenters: Cell[] = [];
    let locksPlaced = 0;
    const targetLocks = Math.max(1, lockCount);
    const maxAttempts = targetLocks * 10 + 12;

    for (let att = 0; att < maxAttempts && locksPlaced < targetLocks; att++) {
      const motifIdx = (att < 4 ? att : this.rng.int(LOCK_MOTIFS.length)) % LOCK_MOTIFS.length;
      const motif = LOCK_MOTIFS[motifIdx];
      const slot = slots[att % slots.length];
      const cellW = Math.max(1, Math.floor((this.w - 4) / sectorsX));
      const cellH = Math.max(1, Math.floor((this.h - 4) / sectorsY));
      const ax = Math.max(2, Math.min(this.w - motif.bw - 2, 2 + slot.sx * cellW + this.rng.int(Math.max(1, cellW - 2))));
      const ay = Math.max(2, Math.min(this.h - motif.bh - 2, 2 + slot.sy * cellH + this.rng.int(Math.max(1, cellH - 2))));

      const cx = ax + motif.bw / 2;
      const cy = ay + motif.bh / 2;
      if (placedCenters.some((p) => Math.hypot(p.x - cx, p.y - cy) < 5.2)) continue;

      const rotBase = this.rng.int(4);
      const flip = this.rng.next() < 0.5;
      let committed = false;
      for (let r = 0; r < 4; r++) {
        if (this.tryCommitLockCluster(ax, ay, motif.bw, motif.bh, (rotBase + r) & 3, flip, motif.groups) > 0) {
          placedCenters.push({ x: cx, y: cy });
          locksPlaced++;
          committed = true;
          break;
        }
      }
      void committed;
    }
  }

  /** 生成主流程。 */
  generate(spec: MasterSpec): void {
    const areaK = (this.w * this.h) / (REF_W * REF_H);
    const attempts = [220, 200, 360, 420, 400].map((n) => Math.max(30, Math.round(n * Math.min(1.6, Math.max(0.5, areaK)))));
    const giantMax = Math.max(1, Math.round(3 * Math.min(1.8, Math.max(0.6, areaK))));
    const midMax = Math.max(2, Math.round(5 * Math.min(1.8, Math.max(0.6, areaK))));
    const defaultLocks = Math.max(2, Math.min(7, Math.round((this.w * this.h) / 220)));

    this.placeFixedStructures(spec.withBoss !== false, spec.lockCount ?? defaultLocks);

    const [gMin, gMax] = spec.giantScale ?? [40, 65];
    const [mMin, mMax] = spec.midScale ?? [20, 36];
    this.growLayer(gMin, gMax, attempts[0], false, giantMax);
    this.growLayer(mMin, mMax, attempts[1], false, midMax);
    this.growLayer(8, 16, attempts[2], false);
    this.growLayer(4, 9, attempts[3], true);
    this.growLayer(3, 6, attempts[4], true);

    this.fillResidual();
    // 工程适配：孤立格纵劈吸收后再补一轮满铺（大盘空格清零）。
    this.splitAbsorbIsolated();
    this.fillResidual();
    this.funnelSurgery(spec.targetMovable ?? 1);
  }

  /* -------------------------------------------------------------- */
  /* 三合一剖析与四维评分（v3）                                       */
  /* -------------------------------------------------------------- */

  /** 三合一剖析：剥洋葱模拟 + 跃迁链 + 击尾导流 + 穿针样本 + 连环扣区域。 */
  masterpieceHighlight(): {
    jumpChain: JumpStep[];
    tailConductions: TailConduction[];
    deceptiveExamples: DeceptiveExample[];
    knotZones: KnotZone[];
    maxChainDepth: number;
    nestedCavities: number;
    metrics: {
      avgJumpDist: number;
      strictlyOneSteps: number;
      atMostTwoSteps: number;
      deceptiveClearCount: number;
      interlockingKnotCount: number;
    };
  } {
    const activeList = this.list;
    const simOcc = this.occ.map((col) => col.slice());
    const idToArrow = this.idToArrow;

    const maxChainDepth = this.topologicalDepths();
    const critFanoutMap = new Map<number, number>();
    for (const a of activeList) critFanoutMap.set(a.id, 0);

    let totalJumpDist = 0;
    let jumpCount = 0;
    const tailConductions: TailConduction[] = [];

    for (const a of activeList) {
      const head = a.cells[a.cells.length - 1];
      let cx = head.x + a.dir.x;
      let cy = head.y + a.dir.y;
      let maxD = -1;
      let critBlocker: WorkArrow | null = null;
      let critDist = 0;
      let firstBlockerChecked = false;

      while (cx >= 0 && cx < this.w && cy >= 0 && cy < this.h) {
        const bid = this.occ[cx][cy];
        if (bid !== null && bid !== a.id) {
          const bArrow = idToArrow.get(bid);
          if (bArrow) {
            const bDepth = bArrow.layerDepth || 0;
            const bHead = bArrow.cells[bArrow.cells.length - 1];
            const d = Math.hypot(head.x - bHead.x, head.y - bHead.y);
            if (bDepth > maxD || (bDepth === maxD && d > critDist)) {
              maxD = bDepth;
              critBlocker = bArrow;
              critDist = d;
            }
            if (!firstBlockerChecked) {
              firstBlockerChecked = true;
              const hitIdx = bArrow.cells.findIndex((c) => c.x === cx && c.y === cy);
              if (bArrow.cells.length >= 9 && hitIdx !== -1 && hitIdx <= Math.floor(bArrow.cells.length * 0.3)) {
                tailConductions.push({
                  attackerId: a.id,
                  giantId: bArrow.id,
                  hitCell: { x: cx, y: cy },
                  traceSteps: bArrow.cells.length - 1 - hitIdx,
                });
              }
            }
          }
        }
        cx += a.dir.x;
        cy += a.dir.y;
      }
      if (critBlocker) {
        critFanoutMap.set(critBlocker.id, (critFanoutMap.get(critBlocker.id) || 0) + 1);
        totalJumpDist += critDist;
        jumpCount++;
      }
    }
    tailConductions.sort((p, q) => q.traceSteps - p.traceSteps);

    // 单趟逐步剥离模拟。
    const remaining = new Set(activeList);
    const orderedSequence: { arrow: WorkArrow; stepIndex: number }[] = [];
    const deceptiveExamples: DeceptiveExample[] = [];
    let strictlyOneSteps = 0;
    let atMostTwoSteps = 0;
    let deceptiveClearCount = 0;

    while (remaining.size > 0) {
      const movableNow: WorkArrow[] = [];
      for (const a of remaining) {
        if (this.escapeInfoOn(simOcc, a).canEscape) movableNow.push(a);
      }
      if (movableNow.length === 0) break;
      if (movableNow.length === 1) strictlyOneSteps++;
      if (movableNow.length <= 2) atMostTwoSteps++;

      movableNow.sort((p, q) => (critFanoutMap.get(p.id) || 0) - (critFanoutMap.get(q.id) || 0));
      const picked = movableNow[0];
      const stepIndex = orderedSequence.length + 1;
      const dec = this.deceptiveCorridor(picked, simOcc, idToArrow, true);

      if (dec.isDeceptive) {
        deceptiveClearCount++;
        if (deceptiveExamples.length < 4) {
          deceptiveExamples.push({
            arrowId: picked.id,
            stepIndex,
            pinchGateCount: dec.pinchGateCount,
            raySteps: dec.raySteps,
            pinchCells: dec.pinchCells,
          });
        }
      }
      orderedSequence.push({ arrow: picked, stepIndex });
      for (const c of picked.cells) {
        simOcc[c.x][c.y] = null;
        if (picked.isBoss && c.x + 1 < this.w && simOcc[c.x + 1][c.y] === picked.id) simOcc[c.x + 1][c.y] = null;
      }
      remaining.delete(picked);
    }

    // 回字包络与连环扣区域。
    const knotZones: KnotZone[] = [];
    let nestedCavities = 0;
    let multiTurnHookCount = 0;
    for (const a of activeList) {
      let turns = 0;
      for (let i = 2; i < a.cells.length; i++) {
        if (
          a.cells[i].x - a.cells[i - 1].x !== a.cells[i - 1].x - a.cells[i - 2].x ||
          a.cells[i].y - a.cells[i - 1].y !== a.cells[i - 1].y - a.cells[i - 2].y
        ) {
          turns++;
        }
      }
      if (turns >= 3) multiTurnHookCount++;
      if (a.cells.length < 6) continue;

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      const selfSet = new Set<number>();
      for (const c of a.cells) {
        minX = Math.min(minX, c.x);
        maxX = Math.max(maxX, c.x);
        minY = Math.min(minY, c.y);
        maxY = Math.max(maxY, c.y);
        selfSet.add(c.y * 4096 + c.x);
      }
      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      if (bw >= 3 && bh >= 3) {
        const innerIds = new Set<number>();
        for (let x = minX; x <= maxX; x++) {
          for (let y = minY; y <= maxY; y++) {
            const o = this.occ[x][y];
            if (!selfSet.has(y * 4096 + x) && o !== null) innerIds.add(o);
          }
        }
        if (innerIds.size > 0) nestedCavities++;
        if (innerIds.size >= 2 && turns >= 3 && bw <= 10 && bh <= 10) {
          knotZones.push({
            arrowId: a.id,
            minX,
            maxX,
            minY,
            maxY,
            label: turns >= 4 ? `回字螺旋扣(包${innerIds.size}箭)` : `U形连环扣(包${innerIds.size}箭)`,
            priority: innerIds.size * 10 + turns,
          });
        }
      }
    }
    knotZones.sort((p, q) => q.priority - p.priority);

    const headOf = (a: WorkArrow): Cell => a.cells[a.cells.length - 1];
    const chain = orderedSequence.slice(0, 6).map((item, idx, arr) => {
      let distToNext = 0;
      if (idx + 1 < arr.length) {
        const p1 = headOf(item.arrow);
        const p2 = headOf(arr[idx + 1].arrow);
        distToNext = Number(Math.hypot(p2.x - p1.x, p2.y - p1.y).toFixed(1));
      }
      const h = headOf(item.arrow);
      return { arrowId: item.arrow.id, stepIndex: item.stepIndex, distToNext, headX: h.x, headY: h.y };
    });

    const avgJumpDist = jumpCount > 0 ? Number((totalJumpDist / jumpCount).toFixed(1)) : 0;
    const interlockingKnotCount = Math.round(tailConductions.length * 0.5 + multiTurnHookCount * 0.6);

    return {
      jumpChain: chain,
      tailConductions: tailConductions.slice(0, 5),
      deceptiveExamples,
      knotZones: knotZones.slice(0, 5),
      maxChainDepth,
      nestedCavities,
      metrics: {
        avgJumpDist,
        strictlyOneSteps,
        atMostTwoSteps,
        deceptiveClearCount,
        interlockingKnotCount,
      },
    };
  }

  /** v3 四维评分（形态跨度 / 反斑马线 / 回字包络 / 深层单解）。 */
  evaluateQuality(): MasterReport {
    const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
    const N = Math.max(1, this.list.length);

    let area = 0;
    let occupiedCells = 0;
    for (let x = 0; x < this.w; x++) {
      for (let y = 0; y < this.h; y++) {
        if (!this.mask[x][y]) continue;
        area++;
        if (this.occ[x][y] !== null) occupiedCells++;
      }
    }
    const emptyCells = area - occupiedCells;

    const lengths = this.list.map((a) => a.cells.length);
    const maxArrowLen = lengths.length ? Math.max(...lengths) : 0;
    const meanLen = lengths.reduce((s, v) => s + v, 0) / N;
    const stdDev = Math.sqrt(lengths.reduce((s, v) => s + (v - meanLen) ** 2, 0) / N);
    const giantCount = lengths.filter((l) => l >= 16).length;
    const hierarchyScore = Math.min(25, Math.round(Math.min(12, giantCount * 2.2) + Math.min(13, stdDev * 1.8)));

    let totalSegs = 0;
    let parallelPairs = 0;
    for (const a of this.list) {
      for (let i = 1; i < a.cells.length; i++) {
        const c = a.cells[i];
        const p = a.cells[i - 1];
        totalSegs++;
        if (this.parallelNeighbors(c.x, c.y, c.x - p.x, c.y - p.y) >= 2) parallelPairs++;
      }
    }
    const zebraRatio = totalSegs > 0 ? parallelPairs / totalSegs : 0;
    // 标定适配：满铺盘逐段平行率天然 ~0.5；以 0.5 为满分线、0.85 为零点。
    const antiZebraScore = Math.max(0, Math.min(25, Math.round(25 * (1 - Math.max(0, zebraRatio - 0.5) / 0.35))));

    const simData = this.masterpieceHighlight();
    const cavityScore = Math.min(25, Math.round(simData.nestedCavities * 1.4));

    const initialMovableCount = this.list.filter((a) => this.escapeInfo(a).canEscape).length;
    const m = simData.metrics;
    const singleBonus = Math.min(11, Math.round((m.strictlyOneSteps / N) * 18));
    const jumpBonus = Math.min(6, Math.round(m.avgJumpDist * 0.5));
    const decBonus = Math.min(5, Math.round(m.deceptiveClearCount * 0.8));
    // 标定适配：可动惩罚 ×5→×2.2、基线 5→8（大盘 3-pass 漏斗压不到 1 时仍可得分）。
    const topoScore = Math.round(
      Math.max(0, Math.min(25, 8 + singleBonus + jumpBonus + decBonus - Math.max(0, (initialMovableCount - 1) * 2.2))),
    );

    // 标定适配：惩罚按填充率计（≥99% 不罚，封顶 30），而非绝对空格数。
    const fillRate = 1 - emptyCells / Math.max(1, area);
    const emptyPenalty = fillRate >= 0.99 ? 0 : Math.min(30, Math.round((1 - fillRate) * 500));
    const totalScore = Math.max(0, Math.min(100, hierarchyScore + antiZebraScore + cavityScore + topoScore - emptyPenalty));
    const difficultyTier = totalScore >= 85 ? 'S级 · 殿堂神作' : totalScore >= 75 ? 'A级 · 烧脑精妙' : 'B级 · 标准耐玩';
    const gate = area >= 1200 ? 70 : area >= 600 ? 68 : 65;

    return {
      arrows: this.list.length,
      maxChainDepth: simData.maxChainDepth,
      initialMovable: initialMovableCount,
      emptyCells,
      totalScore,
      difficultyTier,
      gate,
      passes: totalScore >= gate,
      subScores: { hierarchy: hierarchyScore, antiZebra: antiZebraScore, cavity: cavityScore, topo: topoScore },
      maxArrowLen,
      giantTrunks: giantCount,
      lengthStdDev: Math.round(stdDev * 10) / 10,
      zebraParallelRatio: Math.round(zebraRatio * 1000) / 10,
      nestedCavities: simData.nestedCavities,
      density: Math.round((this.list.length / Math.max(1, area)) * 1000) / 1000,
      strictlyOneSteps: m.strictlyOneSteps,
      atMostTwoSteps: m.atMostTwoSteps,
      avgJumpDist: m.avgJumpDist,
      deceptiveClearCount: m.deceptiveClearCount,
      interlockingKnotCount: m.interlockingKnotCount,
      jumpChain: simData.jumpChain,
      tailConductions: simData.tailConductions,
      deceptiveExamples: simData.deceptiveExamples,
      knotZones: simData.knotZones,
    };
  }
}

/* ------------------------------------------------------------------ */
/* 对外入口：生成项目 Level（头前尾后 + Dir 枚举）。                    */
/* ------------------------------------------------------------------ */

function vecToDir(v: Vec): Dir {
  if (v.x === 1) return 1;
  if (v.x === -1) return 3;
  if (v.y === 1) return 2;
  return 0;
}

export function generateMasterLevel(
  spec: MasterSpec,
): (Level & { report: MasterReport }) | null {
  const m = new Master(spec);
  m.generate(spec);
  if (m.list.length < 8) return null;

  // 转换为项目约定：cells 头前尾后（参考实现是尾到头）。
  const arrows: Arrow[] = m.list.map((a, i) => ({
    id: i,
    color: 0,
    cells: [...a.cells].reverse(),
    dir: vecToDir(a.dir),
    isBoss: a.isBoss || undefined,
  }));
  assignColors(arrows, spec.cols, spec.rows);

  const level: Level & { report: MasterReport } = {
    id: spec.id,
    cols: spec.cols,
    rows: spec.rows,
    arrows,
    timeLimit: spec.timeLimit ?? 0,
    seed: spec.seed,
    solution: [],
    mask: spec.mask,
    report: m.evaluateQuality(),
  };
  const greedy = solveGreedy(level);
  if (!greedy.solved) return null;
  level.solution = greedy.order;
  return level;
}
