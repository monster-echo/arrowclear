import {
  Arrow,
  Cell,
  DIR_VECTORS,
  Level,
  canArrowEscape,
  cellKey,
  corridorCells,
} from '../../assets/scripts/core/types';
import { ARROW_PALETTE } from '../../assets/scripts/core/palette';
import { computeSnakedPolylinePoints } from '../../assets/scripts/core/snake';
import { frozenAdjacencies, isUnfrozen } from '../../assets/scripts/core/frozen';
import { MasterReport } from '../../assets/scripts/core/arrowscore';

/**
 * Paper-style canvas renderer.
 *
 * There is deliberately no board/panel: the level is a silhouette of thin ink
 * arrows floating on a blank sheet. As arrows leave, their cells become small
 * grey dots, so the picture slowly turns into a dot ghost.
 */

interface FlyFx {
  arrow: Arrow;
  t: number;
  dur: number;
}

interface RailPoint {
  x: number;
  y: number;
  s: number;
}

interface DotFx {
  x: number;
  y: number;
  t: number;
  delay: number;
}

interface BlockFx {
  arrowId: number;
  blockerId: number | null;
  corridor: Cell[];
  t: number;
  dur: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  cell: number;
}

const INK = '#22252D';
const DOT = '#B9BEC9';
const RED = '#D64A42';
const HINT = '#D6A23F';
/** Boss 箭专属蓝与大眼表情色（参考实现 #2B7FFF）。 */
const BOSS_BLUE = '#2578F4';
const BOSS_EYE_DARK = '#0F172A';
/** 冰壳与图案关底色（与 Cocos 端 BoardView 保持同一观感）。 */
const ICE_SHELL = 'rgba(202, 235, 250, 0.8)';
const ICE_CRACK = 'rgba(96, 165, 210, 0.92)';
const PICTURE_TINTS = [
  'rgba(198, 226, 245, 0.9)',
  'rgba(245, 214, 220, 0.9)',
  'rgba(212, 238, 217, 0.9)',
  'rgba(247, 231, 200, 0.9)',
  'rgba(223, 216, 245, 0.9)',
  'rgba(214, 233, 244, 0.9)',
  'rgba(240, 222, 214, 0.9)',
  'rgba(216, 240, 231, 0.9)',
];

function pictureTintFor(shape: string | undefined): string {
  if (!shape) return PICTURE_TINTS[0];
  let h = 0;
  for (let i = 0; i < shape.length; i++) h = (h * 31 + shape.charCodeAt(i)) >>> 0;
  return PICTURE_TINTS[h % PICTURE_TINTS.length];
}

const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.2;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  W = 0;
  H = 0;

  private level: Level | null = null;
  private occupancy = new Map<number, Arrow>();
  private layout: Rect = { x: 0, y: 0, w: 0, h: 0, cell: 40 };
  private insets = { top: 120, bottom: 100 };

  private fitCell = 40;
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  private dots = new Map<number, DotFx>();
  private maskCells: Cell[] = [];
  private edgeSegments: [number, number, number, number][] = [];
  private maskArea = 1;
  private flying: FlyFx[] = [];
  private blockFx: BlockFx | null = null;
  private hintId: number | null = null;
  private hoverId: number | null = null;
  private shakeT = 0;
  /** X-Ray 透视叠加（v3 精妙度剖析四图层）。 */
  private xray: MasterReport | null = null;
  /** 冰冻运行态：邻接表 / 已飞箭 / 仍冻结的箭集合（解冻后移除）。 */
  private frozenAdj = new Map<number, Set<number>>();
  private removedIds = new Set<number>();
  private activeFrozen = new Set<number>();
  private tint = PICTURE_TINTS[0];

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('2d canvas unavailable');
    this.ctx = ctx;
    this.resize();
  }

  setLevel(level: Level): void {
    this.level = level;
    this.occupancy.clear();
    for (const a of level.arrows) {
      for (const c of a.cells) this.occupancy.set(cellKey(c), a);
      // Boss 双倍宽：影子格同样命中 Boss。
      if (a.isBoss) {
        for (const c of a.cells) {
          if (c.x + 1 < level.cols) this.occupancy.set(cellKey({ x: c.x + 1, y: c.y }), a);
        }
      }
    }
    this.dots.clear();
    this.flying = [];
    this.blockFx = null;
    this.hintId = null;
    this.maskCells = [];
    this.edgeSegments = [];
    this.frozenAdj = frozenAdjacencies(level);
    this.removedIds = new Set();
    this.activeFrozen = new Set(level.arrows.filter((a) => a.frozen).map((a) => a.id));
    this.tint = pictureTintFor(level.mask ? level.shape : undefined);
    if (level.mask) {
      const at = (x: number, y: number): boolean =>
        x >= 0 && y >= 0 && x < level.cols && y < level.rows && level.mask![y * level.cols + x] === 1;
      for (let y = 0; y < level.rows; y++) {
        for (let x = 0; x < level.cols; x++) {
          if (!at(x, y)) continue;
          this.maskCells.push({ x, y });
          if (!at(x, y - 1)) this.edgeSegments.push([x, y, x + 1, y]);
          if (!at(x, y + 1)) this.edgeSegments.push([x, y + 1, x + 1, y + 1]);
          if (!at(x - 1, y)) this.edgeSegments.push([x, y, x, y + 1]);
          if (!at(x + 1, y)) this.edgeSegments.push([x + 1, y, x + 1, y + 1]);
        }
      }
    } else {
      for (let y = 0; y < level.rows; y++) {
        for (let x = 0; x < level.cols; x++) this.maskCells.push({ x, y });
      }
    }
    this.maskArea = Math.max(1, this.maskCells.length);
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.computeLayout();
  }

  clear(): void {
    this.level = null;
    this.dots.clear();
    this.flying = [];
    this.blockFx = null;
  }

  setInsets(top: number, bottom: number): void {
    this.insets = { top, bottom };
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.computeLayout();
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.W = this.canvas.clientWidth || window.innerWidth;
    this.H = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.W * this.dpr);
    this.canvas.height = Math.round(this.H * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.computeLayout();
  }

  private computeLayout(): void {
    if (!this.level) return;
    const cols = this.level.cols;
    const rows = this.level.rows;
    const availW = Math.max(40, this.W - 64);
    const availH = Math.max(40, this.H - this.insets.top - this.insets.bottom);
    this.fitCell = clamp(Math.min(availW / cols, availH / rows) * 0.96, 7, 36);
    const cell = this.fitCell * this.zoom;
    const w = cols * cell;
    const h = rows * cell;
    const cx = this.W / 2;
    const cy = this.insets.top + availH / 2;
    this.layout = {
      x: cx - w / 2 + this.panX,
      y: cy - h / 2 + this.panY,
      w,
      h,
      cell,
    };
  }

  get cell(): number {
    return this.layout.cell;
  }

  get zoomValue(): number {
    return this.zoom;
  }

  get minZoom(): number {
    return MIN_ZOOM;
  }

  get maxZoom(): number {
    return MAX_ZOOM;
  }

  setZoom(value: number): void {
    this.zoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
    this.clampPan();
    this.computeLayout();
  }

  zoomBy(factor: number): void {
    this.setZoom(this.zoom * factor);
  }

  resetView(): void {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.computeLayout();
  }

  panBy(dx: number, dy: number): void {
    if (this.zoom <= 1.001) return;
    this.panX += dx;
    this.panY += dy;
    this.clampPan();
    this.computeLayout();
  }

  private clampPan(): void {
    if (!this.level) return;
    const availW = Math.max(40, this.W - 64);
    const availH = Math.max(40, this.H - this.insets.top - this.insets.bottom);
    const overflowX = Math.max(0, (this.level.cols * this.fitCell * this.zoom - availW) / 2);
    const overflowY = Math.max(0, (this.level.rows * this.fitCell * this.zoom - availH) / 2);
    this.panX = clamp(this.panX, -overflowX, overflowX);
    this.panY = clamp(this.panY, -overflowY, overflowY);
    if (this.zoom <= 1.001) {
      this.panX = 0;
      this.panY = 0;
    }
  }

  cellCenter(c: Cell): { x: number; y: number } {
    return {
      x: this.layout.x + (c.x + 0.5) * this.layout.cell,
      y: this.layout.y + (c.y + 0.5) * this.layout.cell,
    };
  }

  pointToCell(px: number, py: number): Cell | null {
    if (!this.level) return null;
    const { x, y, cell } = this.layout;
    const cx = Math.floor((px - x) / cell);
    const cy = Math.floor((py - y) / cell);
    if (cx < 0 || cy < 0 || cx >= this.level.cols || cy >= this.level.rows) return null;
    return { x: cx, y: cy };
  }

  hitTest(px: number, py: number): Arrow | null {
    const c = this.pointToCell(px, py);
    if (!c) return null;
    return this.occupancy.get(cellKey(c)) ?? null;
  }

  isFree(arrow: Arrow, alive: Set<number>): boolean {
    if (!this.level) return false;
    // Boss OR 语义：两条射线任一畅通即可飞。
    return canArrowEscape(this.level, arrow, (c) => {
      const owner = this.occupancy.get(cellKey(c));
      return !!owner && alive.has(owner.id) && owner.id !== arrow.id;
    });
  }

  /** 还冻结着（未解冻）？冻结箭不是合法点击/提示目标。 */
  isFrozenActive(arrow: Arrow): boolean {
    return !!arrow.frozen && this.activeFrozen.has(arrow.id);
  }

  /** 合法可飞 = 存活 && 未冻结 && 航道干净。 */
  isPlayable(arrow: Arrow, alive: Set<number>): boolean {
    return alive.has(arrow.id) && !this.isFrozenActive(arrow) && this.isFree(arrow, alive);
  }

  /** 某冻结箭当前已飞走的相邻箭数（0..2，画裂纹用）。 */
  private crackCount(arrowId: number): number {
    let hits = 0;
    for (const n of this.frozenAdj.get(arrowId) ?? []) {
      if (this.removedIds.has(n)) hits++;
    }
    return Math.min(2, hits);
  }

  /**
   * 一支箭飞走后的冰冻结算：返回刚刚解冻的箭 id 列表（供音效/提示）。
   */
  noteRemoved(arrowId: number): number[] {
    this.removedIds.add(arrowId);
    const unfrozen: number[] = [];
    for (const fid of [...this.activeFrozen]) {
      if (isUnfrozen(fid, this.removedIds, this.frozenAdj)) {
        this.activeFrozen.delete(fid);
        unfrozen.push(fid);
      }
    }
    return unfrozen;
  }

  blockerOf(arrow: Arrow, alive: Set<number>): Arrow | null {
    if (!this.level) return null;
    const head = arrow.cells[0];
    const d = DIR_VECTORS[arrow.dir];
    const starts = arrow.isBoss ? [head, { x: head.x + 1, y: head.y }] : [head];
    let best: { steps: number; owner: Arrow } | null = null;
    for (const st of starts) {
      let x = st.x + d.x;
      let y = st.y + d.y;
      let steps = 0;
      while (x >= 0 && y >= 0 && x < this.level.cols && y < this.level.rows) {
        const owner = this.occupancy.get(cellKey({ x, y }));
        if (owner && owner.id !== arrow.id && alive.has(owner.id)) {
          if (!best || steps < best.steps) best = { steps, owner };
          break;
        }
        steps++;
        x += d.x;
        y += d.y;
      }
    }
    return best ? best.owner : null;
  }

  setHint(id: number | null): void {
    this.hintId = id;
  }

  setHover(id: number | null): void {
    this.hoverId = id;
  }

  shakeScreen(): void {
    this.shakeT = 0.2;
  }

  /** Red line + red blocker, the causal "you hit this" frame. */
  flashBlocked(arrow: Arrow, blocker: Arrow | null): void {
    if (!this.level) return;
    const corridor = corridorCells(this.level, arrow);
    let cells = corridor;
    if (blocker) {
      const idx = corridor.findIndex((c) => c.x === blocker.cells[0].x && c.y === blocker.cells[0].y);
      if (idx >= 0) cells = corridor.slice(0, idx + 1);
    }
    this.blockFx = {
      arrowId: arrow.id,
      blockerId: blocker ? blocker.id : null,
      corridor: cells,
      t: 0,
      dur: 0.48,
    };
  }

  /** Removes the arrow from occupancy and starts its head-leading exit. */
  flyOut(arrow: Arrow): void {
    for (const c of arrow.cells) {
      const owner = this.occupancy.get(cellKey(c));
      if (owner && owner.id === arrow.id) this.occupancy.delete(cellKey(c));
    }
    if (arrow.isBoss) {
      for (const c of arrow.cells) {
        const key = cellKey({ x: c.x + 1, y: c.y });
        const owner = this.occupancy.get(key);
        if (owner && owner.id === arrow.id) this.occupancy.delete(key);
      }
    }
    const n = arrow.cells.length;
    const cell = this.layout.cell;
    const bodyLen = Math.max(1, n - 1) * cell;
    const exitPad = Math.max(this.W, this.H) + cell * 4;
    const total = bodyLen + exitPad;
    // 大盘提速（规则书 §12）：格子越小飞得越快。
    const speedK = clamp(cell / 22, 0.55, 1);
    const dur = clamp((0.55 + n * 0.03) * speedK, 0.42, 1.05);
    this.flying.push({ arrow, t: 0, dur });

    // The tail is what vacates cells, so dots appear tail-first. Delay is the
    // time it takes the tail to reach each cell's arc position.
    const speed = total / dur;
    for (let i = 0; i < n; i++) {
      const c = arrow.cells[i];
      const key = cellKey(c);
      if (this.dots.has(key)) continue;
      this.dots.set(key, {
        x: c.x,
        y: c.y,
        t: 0,
        delay: ((n - 1 - i) * cell) / speed,
      });
    }
  }

  /** Paper has no confetti; kept for API compatibility. */
  celebrate(): void {
    // Intentionally quiet. The dot ghost is the reward.
  }

  setXRay(report: MasterReport | null): void {
    this.xray = report;
  }

  /** X-Ray 透视四图层：跃迁链 / 连环扣框 / 击尾导流 / 穿针窄门。 */
  private drawXRay(time: number): void {
    const r = this.xray;
    if (!r || !this.level) return;
    const ctx = this.ctx;
    const cell = this.layout.cell;

    // 图层 B：连环扣区域（橙色虚线框 + 标签）。
    for (const kz of r.knotZones) {
      const x0 = this.layout.x + kz.minX * cell + 2;
      const y0 = this.layout.y + kz.minY * cell + 2;
      const w = (kz.maxX - kz.minX + 1) * cell - 4;
      const h = (kz.maxY - kz.minY + 1) * cell - 4;
      ctx.save();
      ctx.strokeStyle = 'rgba(249, 115, 22, 0.92)';
      ctx.fillStyle = 'rgba(249, 115, 22, 0.08)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -((time * 20) % 9);
      ctx.beginPath();
      ctx.roundRect(x0, y0, w, h, 8);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `bold ${Math.max(9, cell * 0.4)}px ui-monospace, monospace`;
      const tw = ctx.measureText(kz.label).width + 10;
      const th = Math.max(15, cell * 0.66);
      ctx.fillStyle = 'rgba(154, 52, 18, 0.92)';
      ctx.beginPath();
      ctx.roundRect(x0, Math.max(2, y0 - th * 0.6), tw, th, 6);
      ctx.fill();
      ctx.fillStyle = '#FFEDD5';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(kz.label, x0 + 5, Math.max(2, y0 - th * 0.6) + th / 2);
      ctx.restore();
    }

    // 图层 C：击尾导流（红虚线指向 + 金色脊线沿巨蟒身体）。
    const byId = new Map(this.level.arrows.map((a) => [a.id, a]));
    for (const tc of r.tailConductions) {
      const attacker = byId.get(tc.attackerId);
      if (!attacker) continue;
      const head = attacker.cells[0];
      const ap = this.cellCenter(head);
      const hp = this.cellCenter(tc.hitCell);
      ctx.save();
      ctx.strokeStyle = '#F43F5E';
      ctx.lineWidth = 2.4;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(ap.x, ap.y);
      ctx.lineTo(hp.x, hp.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#F43F5E';
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, cell * 0.26, 0, Math.PI * 2);
      ctx.fill();
      const giant = byId.get(tc.giantId);
      if (giant) {
        ctx.strokeStyle = '#FACC15';
        ctx.lineWidth = Math.max(3, cell * 0.2);
        ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = -((time * 45) % 11);
        ctx.beginPath();
        const body = [...giant.cells].reverse();
        const from = body.findIndex((c) => c.x === tc.hitCell.x && c.y === tc.hitCell.y);
        for (let i = Math.max(0, from); i < body.length; i++) {
          const p = this.cellCenter(body[i]);
          if (i === Math.max(0, from)) ctx.moveTo(p.x, p.y);
          else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }

    // 图层 D：穿针窄门（绿色虚线走廊 + 红圈夹点）。
    for (const de of r.deceptiveExamples) {
      const a = byId.get(de.arrowId);
      if (!a) continue;
      const head = a.cells[0];
      const sp = this.cellCenter(head);
      const d = DIR_VECTORS[a.dir];
      const ep = { x: sp.x + d.x * (de.raySteps + 1) * cell, y: sp.y + d.y * (de.raySteps + 1) * cell };
      ctx.save();
      ctx.strokeStyle = 'rgba(16, 185, 129, 0.95)';
      ctx.lineWidth = Math.max(2.2, cell * 0.18);
      ctx.setLineDash([6, 4]);
      ctx.lineDashOffset = -((time * 40) % 10);
      ctx.beginPath();
      ctx.moveTo(sp.x, sp.y);
      ctx.lineTo(ep.x, ep.y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#EF4444';
      ctx.lineWidth = 1.8;
      for (const pc of de.pinchCells) {
        const p = this.cellCenter(pc);
        ctx.beginPath();
        ctx.arc(p.x, p.y, cell * 0.34, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 图层 A：前 6 步跃迁链（蓝弧线 + 序号圆点）。
    const chain = r.jumpChain;
    for (let i = 0; i < chain.length - 1; i++) {
      const p1 = this.cellCenter({ x: chain[i].headX, y: chain[i].headY });
      const p2 = this.cellCenter({ x: chain[i + 1].headX, y: chain[i + 1].headY });
      const mx = (p1.x + p2.x) / 2 - (p2.y - p1.y) * 0.16;
      const my = (p1.y + p2.y) / 2 + (p2.x - p1.x) * 0.16;
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.92)';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([5, 4]);
      ctx.lineDashOffset = -((time * 35) % 9);
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.quadraticCurveTo(mx, my, p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
    }
    for (let i = 0; i < chain.length; i++) {
      const p = this.cellCenter({ x: chain[i].headX, y: chain[i].headY });
      const radius = Math.max(8, cell * 0.44);
      ctx.save();
      ctx.fillStyle = i === 0 ? '#F59E0B' : '#4F46E5';
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#FFFFFF';
      ctx.font = `900 ${Math.max(9, cell * 0.42)}px ui-monospace, monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), p.x, p.y + 0.5);
      ctx.restore();
    }
  }

  render(alive: Set<number>, dt: number, time: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    if (!this.level) return;

    ctx.save();
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const s = this.shakeT / 0.2;
      ctx.translate((Math.random() - 0.5) * 5 * s, (Math.random() - 0.5) * 5 * s);
    }

    this.drawPicture();
    this.drawDots(dt);
    this.drawArrows(alive, time);
    this.drawFlying(dt);
    this.drawBlockFx(dt);
    if (this.xray) this.drawXRay(time / 1000);

    ctx.restore();
  }

  // ---------------------------------------------------------------- drawing

  private tracePath(arrow: Arrow, dx = 0, dy = 0): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const pts: { x: number; y: number }[] = [];
    for (let i = arrow.cells.length - 1; i >= 0; i--) {
      const c = arrow.cells[i];
      pts.push({
        x: this.layout.x + (c.x + 0.5) * cell + dx,
        y: this.layout.y + (c.y + 0.5) * cell + dy,
      });
    }
    ctx.beginPath();
    if (!pts.length) return;
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 1) return;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      const a = pts[i - 1];
      const b = pts[i + 1];
      const l1 = Math.abs(p.x - a.x) + Math.abs(p.y - a.y);
      const l2 = Math.abs(b.x - p.x) + Math.abs(b.y - p.y);
      const turn = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
      if (!turn) {
        ctx.lineTo(p.x, p.y);
        continue;
      }
      const r = Math.min(cell * 0.34, l1 / 2, l2 / 2);
      const u1x = (p.x - a.x) / (l1 || 1);
      const u1y = (p.y - a.y) / (l1 || 1);
      const u2x = (b.x - p.x) / (l2 || 1);
      const u2y = (b.y - p.y) / (l2 || 1);
      ctx.lineTo(p.x - u1x * r, p.y - u1y * r);
      ctx.quadraticCurveTo(p.x, p.y, p.x + u2x * r, p.y + u2y * r);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);
  }

  private strokeWidth(): number {
    return clamp(this.layout.cell * 0.185, 2.2, 6.2);
  }

  /** Boss 专用大三角：比 1.55 格宽的身体更宽，保证朝向可读。 */
  private bossHeadPath(cell: number): void {
    const ctx = this.ctx;
    this.roundPoly(
      [
        [cell * 0.98, 0],
        [-cell * 0.22, -cell * 1.05],
        [-cell * 0.22, cell * 1.05],
      ],
      [cell * 0.06, cell * 0.08, cell * 0.08],
    );
  }

  private headPath(cell: number): void {
    const ctx = this.ctx;
    const tip = cell * 0.4;
    const base = -cell * 0.13;
    const half = cell * 0.18;
    this.roundPoly(
      [
        [tip, 0],
        [base, -half],
        [base, half],
      ],
      [cell * 0.035, cell * 0.04, cell * 0.04],
    );
  }

  private roundPoly(pts: [number, number][], radii: number[]): void {
    const ctx = this.ctx;
    const n = pts.length;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const cur = pts[i];
      const prev = pts[(i + n - 1) % n];
      const next = pts[(i + 1) % n];
      const r = radii[i] ?? 2;
      const p1 = this.towards(cur, prev, r);
      const p2 = this.towards(cur, next, r);
      if (i === 0) ctx.moveTo(p1[0], p1[1]);
      else ctx.lineTo(p1[0], p1[1]);
      ctx.quadraticCurveTo(cur[0], cur[1], p2[0], p2[1]);
    }
    ctx.closePath();
  }

  private towards(a: [number, number], b: [number, number], dist: number): [number, number] {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const t = Math.min(0.45, dist / len);
    return [a[0] + dx * t, a[1] + dy * t];
  }

  private drawHead(arrow: Arrow, color: string, alpha = 1, scale = 1, shiftX = 0): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const head = this.cellCenter(arrow.cells[0]);
    head.x += shiftX;
    const v = DIR_VECTORS[arrow.dir];
    const angle = Math.atan2(v.y, v.x);

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(head.x, head.y);
    ctx.rotate(angle);
    if (arrow.isBoss) this.bossHeadPath(cell);
    else this.headPath(cell * scale);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /** Boss 大眼表情：白眼球 + 黑瞳孔 + 怒眉（箭身中段，横跨双倍宽）。 */
  private drawBossFace(arrow: Arrow, alpha = 1, shiftX = 0): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    let sx = 0;
    let sy = 0;
    for (const c of arrow.cells) {
      sx += c.x;
      sy += c.y;
    }
    const mid = this.cellCenter({ x: sx / arrow.cells.length, y: sy / arrow.cells.length });
    mid.x += shiftX;
    const v = DIR_VECTORS[arrow.dir];
    const d = { x: v.x, y: v.y };
    const px = -d.y;
    const py = d.x;
    const eyeOff = cell * 0.4;
    const eyeR = Math.max(3.5, cell * 0.26);
    const browOff = cell * 0.12;
    ctx.save();
    ctx.globalAlpha *= alpha;
    for (const side of [-1, 1]) {
      const ex = mid.x + px * eyeOff * side + d.x * browOff;
      const ey = mid.y + py * eyeOff * side + d.y * browOff;
      ctx.beginPath();
      ctx.arc(ex, ey, eyeR, 0, Math.PI * 2);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      const bossFree = this.isFree(arrow, this.hoverAliveSet ?? new Set<number>());
      if (bossFree) {
        ctx.font = `900 ${Math.floor(eyeR * 1.5)}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#F59E0B';
        ctx.fillText('★', ex, ey + 1);
      } else {
        ctx.beginPath();
        ctx.arc(ex + d.x * eyeR * 0.25, ey + d.y * eyeR * 0.25, eyeR * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = BOSS_EYE_DARK;
        ctx.fill();
      }
      ctx.strokeStyle = BOSS_EYE_DARK;
      ctx.lineWidth = Math.max(1.6, cell * 0.07);
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(
        ex - px * eyeR * 0.85 + d.x * eyeR * 0.5,
        ey - py * eyeR * 0.85 + d.y * eyeR * 0.5,
      );
      ctx.lineTo(
        ex + px * eyeR * 0.7 + d.x * eyeR * 1.1,
        ey + py * eyeR * 0.7 + d.y * eyeR * 1.1,
      );
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * A barely-there paper cutout of the silhouette. It is not a board: it fades
   * out as the dot ghost replaces it, so the shape stays readable while arrows
   * are still sparse on its boundary.
   */
  private drawSilhouette(): void {
    if (!this.edgeSegments.length) return;
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const cleared = this.dots.size / this.maskArea;
    const alpha = 0.2 * (1 - cleared * 0.5);
    if (alpha <= 0.01) return;
    ctx.save();
    ctx.strokeStyle = `rgba(70, 76, 88, ${alpha})`;
    ctx.lineWidth = 1.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const [x1, y1, x2, y2] of this.edgeSegments) {
      ctx.moveTo(this.layout.x + x1 * cell, this.layout.y + y1 * cell);
      ctx.lineTo(this.layout.x + x2 * cell, this.layout.y + y2 * cell);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * 图案关揭画（规则书 §6）：已被清空的剪影格子填上「画」的底色，
   * 清盘进度 = 揭画进度。
   */
  private drawPicture(): void {
    if (!this.level || !this.level.mask) return;
    const ctx = this.ctx;
    const cell = this.layout.cell;
    ctx.save();
    ctx.fillStyle = this.tint;
    for (const c of this.maskCells) {
      if (this.occupancy.has(cellKey(c))) continue;
      const p = this.cellCenter(c);
      ctx.fillRect(p.x - cell * 0.46, p.y - cell * 0.46, cell * 0.92, cell * 0.92);
    }
    ctx.restore();
  }

  private drawDots(dt: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const r = clamp(cell * 0.085, 1.6, 4.1);
    ctx.fillStyle = DOT;
    for (const dot of this.dots.values()) {
      dot.t += dt;
      const p = clamp((dot.t - dot.delay) / 0.2, 0, 1);
      if (p <= 0) continue;
      const c = this.cellCenter({ x: dot.x, y: dot.y });
      const s = 0.4 + 0.6 * p;
      ctx.globalAlpha = p;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  private hoverAliveSet: Set<number> | null = null;

  private drawArrow(arrow: Arrow, time: number, alpha = 1): void {
    const ctx = this.ctx;
    const w = this.strokeWidth();
    const isHinted = arrow.id === this.hintId;
    const isHovered = arrow.id === this.hoverId;
    const pulse = 0.5 + 0.5 * Math.sin(time * 5.2);

    if (isHinted) {
      ctx.save();
      ctx.globalAlpha = alpha * (0.1 + pulse * 0.1);
      ctx.strokeStyle = HINT;
      ctx.lineWidth = w + this.layout.cell * 0.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this.tracePath(arrow);
      ctx.stroke();
      ctx.restore();
    } else if (isHovered) {
      ctx.save();
      ctx.globalAlpha = alpha * 0.1;
      ctx.strokeStyle = INK;
      ctx.lineWidth = w + this.layout.cell * 0.12;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this.tracePath(arrow);
      ctx.stroke();
      ctx.restore();
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    const isBoss = !!arrow.isBoss;
    const ink = isBoss ? BOSS_BLUE : ARROW_PALETTE[arrow.color % ARROW_PALETTE.length];
    // Boss 双倍宽：向右偏移半格、线宽约 1.55 格（对应「两条射线都须畅通」）。
    const bossShift = isBoss ? this.layout.cell * 0.5 : 0;
    ctx.strokeStyle = ink;
    ctx.lineWidth = isBoss ? this.layout.cell * 1.48 : w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    this.tracePath(arrow, bossShift, 0);
    ctx.stroke();
    this.drawHead(arrow, ink, alpha, isBoss ? 1.55 : 1, bossShift);
    if (isBoss) this.drawBossFace(arrow, alpha, bossShift);
    // 冰壳：冻结箭加一层半透明冰蓝厚描边，裂纹随解冻进度加深。
    if (this.isFrozenActive(arrow)) {
      const cracks = this.crackCount(arrow.id);
      ctx.strokeStyle = ICE_SHELL;
      ctx.lineWidth = w + this.layout.cell * 0.3;
      this.tracePath(arrow);
      ctx.stroke();
      if (cracks > 0) {
        ctx.strokeStyle = ICE_CRACK;
        ctx.lineWidth = Math.max(1.4, w * 0.28);
        const pts = arrow.cells;
        for (let k = 0; k < cracks && k < 2; k++) {
          const idx = Math.min(pts.length - 1, Math.max(1, Math.floor((pts.length * (k + 1)) / 3)));
          const p = this.cellCenter(pts[idx]);
          const half = this.layout.cell * 0.3;
          ctx.beginPath();
          ctx.moveTo(p.x - half * 0.5, p.y - half);
          ctx.lineTo(p.x + half * 0.4, p.y + half * 0.9);
          ctx.stroke();
        }
      }
    }
    ctx.restore();

    if (isHinted) {
      const head = this.cellCenter(arrow.cells[0]);
      ctx.save();
      ctx.globalAlpha = alpha * (0.45 + pulse * 0.45);
      ctx.fillStyle = HINT;
      ctx.beginPath();
      ctx.arc(head.x, head.y, clamp(this.layout.cell * 0.06, 1.2, 2.6), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawArrows(alive: Set<number>, time: number): void {
    if (!this.level) return;
    this.hoverAliveSet = alive;
    const list = this.level.arrows.filter((a) => alive.has(a.id));
    for (const a of list) {
      if (a.id === this.hintId) continue;
      if (this.blockFx && a.id === this.blockFx.blockerId) continue;
      this.drawArrow(a, time);
    }
    if (this.blockFx && this.blockFx.blockerId !== null) {
      const blocker = this.level.arrows.find((a) => a.id === this.blockFx!.blockerId);
      if (blocker && alive.has(blocker.id)) {
        const p = clamp(this.blockFx.t / this.blockFx.dur, 0, 1);
        const ctx = this.ctx;
        ctx.save();
        ctx.globalAlpha = 1 - Math.max(0, (p - 0.7) / 0.3);
        ctx.strokeStyle = RED;
        ctx.lineWidth = this.strokeWidth() * 1.15;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        this.tracePath(blocker);
        ctx.stroke();
        this.drawHead(blocker, RED);
        ctx.restore();
      }
    }
    const hinted = list.find((a) => a.id === this.hintId);
    if (hinted) this.drawArrow(hinted, time);
  }

  /**
   * Build the rail the arrow travels on: tail -> head along the body, then a
   * straight ray in the facing direction. The visible arrow is a fixed-length
   * window sliding along this rail, so the head leads and the tail follows the
   * original corners instead of the whole rigid shape teleporting.
   */
  private buildRail(arrow: Arrow): { pts: RailPoint[]; bodyLen: number; total: number } {
    const cell = this.layout.cell;
    const pts: RailPoint[] = [];
    let s = 0;
    for (let i = arrow.cells.length - 1; i >= 0; i--) {
      const c = this.cellCenter(arrow.cells[i]);
      if (pts.length) s += Math.hypot(c.x - pts[pts.length - 1].x, c.y - pts[pts.length - 1].y);
      pts.push({ x: c.x, y: c.y, s });
    }
    const bodyLen = s;
    const head = pts[pts.length - 1];
    const v = DIR_VECTORS[arrow.dir];
    const exitPad = Math.max(this.W, this.H) + cell * 4;
    for (let d = cell; d <= exitPad; d += cell) {
      pts.push({
        x: head.x + v.x * d,
        y: head.y + v.y * d,
        s: bodyLen + d,
      });
    }
    return { pts, bodyLen, total: bodyLen + exitPad };
  }

  private pointAt(pts: RailPoint[], s: number): { x: number; y: number } {
    if (s <= 0) return { x: pts[0].x, y: pts[0].y };
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (s <= b.s) {
        const t = b.s === a.s ? 0 : (s - a.s) / (b.s - a.s);
        return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      }
    }
    const last = pts[pts.length - 1];
    return { x: last.x, y: last.y };
  }

  private bodyPath(pts: RailPoint[], s0: number, s1: number): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = [];
    out.push(this.pointAt(pts, s0));
    for (const p of pts) {
      if (p.s > s0 && p.s < s1) out.push({ x: p.x, y: p.y });
    }
    out.push(this.pointAt(pts, s1));
    return out;
  }

  private drawFlying(dt: number): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    for (const f of this.flying) {
      f.t += dt;
      const p = Math.min(1, f.t / f.dur);
      const { total } = this.buildRail(f.arrow);
      const d = total * p;
      const outline = computeSnakedPolylinePoints(
        f.arrow,
        d / cell,
        cell,
        this.layout.x,
        this.layout.y,
      );
      const alpha = p > 0.9 ? 1 - (p - 0.9) / 0.1 : 1;

      const isBoss = !!f.arrow.isBoss;
      const flyColor = isBoss ? BOSS_BLUE : ARROW_PALETTE[f.arrow.color % ARROW_PALETTE.length];
      ctx.save();
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.strokeStyle = flyColor;
      ctx.lineWidth = isBoss ? this.strokeWidth() * 2.3 : this.strokeWidth();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      for (let i = 0; i < outline.length; i++) {
        if (i === 0) ctx.moveTo(outline[i].x, outline[i].y);
        else ctx.lineTo(outline[i].x, outline[i].y);
      }
      ctx.stroke();

      const head = outline[outline.length - 1] ?? this.cellCenter(f.arrow.cells[0]);
      const v = DIR_VECTORS[f.arrow.dir];
      const angle = Math.atan2(v.y, v.x);
      ctx.translate(head.x, head.y);
      ctx.rotate(angle);
      this.headPath(isBoss ? cell * 1.8 : cell);
      ctx.fillStyle = flyColor;
      ctx.fill();
      ctx.restore();
    }
    this.flying = this.flying.filter((f) => f.t < f.dur);
  }

  private drawBlockFx(dt: number): void {
    const fx = this.blockFx;
    if (!fx) return;
    fx.t += dt;
    const p = clamp(fx.t / fx.dur, 0, 1);
    if (p >= 1) {
      this.blockFx = null;
      return;
    }

    const ctx = this.ctx;
    const cell = this.layout.cell;
    const arrow = this.level?.arrows.find((a) => a.id === fx.arrowId);
    if (!arrow || !fx.corridor.length) return;

    ctx.save();
    ctx.globalAlpha = 0.85 * (1 - Math.max(0, (p - 0.55) / 0.45));
    ctx.strokeStyle = RED;
    ctx.lineWidth = clamp(this.strokeWidth() * 0.55, 1, 2.4);
    ctx.lineCap = 'round';
    ctx.setLineDash([cell * 0.22, cell * 0.18]);
    ctx.beginPath();
    for (let i = 0; i < fx.corridor.length; i++) {
      const c = this.cellCenter(fx.corridor[i]);
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    const end = this.cellCenter(fx.corridor[fx.corridor.length - 1]);
    ctx.globalAlpha = 0.9 * (1 - p);
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(end.x, end.y, Math.max(2, cell * 0.13), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
