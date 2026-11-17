import { ARROW_PALETTE_RGB } from '../core/palette';
import { frozenAdjacencies, isUnfrozen } from '../core/frozen';
import {
  _decorator,
  Color,
  Component,
  EventTouch,
  Graphics,
  Node,
  Tween,
  UITransform,
  UIOpacity,
  Vec3,
  tween,
} from 'cc';
import {
  Arrow,
  Cell,
  DIR_VECTORS,
  Level,
  canArrowEscape,
  cellKey,
  corridorCells,
} from '../core/types';
import { newNode, setSize } from './UIKit';

const { ccclass } = _decorator;

interface ArrowView {
  arrow: Arrow;
  node: Node;
  body: Graphics;
  glowNode: Node;
  glow: Graphics;
  iceNode: Node | null;
  ice: Graphics | null;
  opacity: UIOpacity;
  base: Vec3;
}

interface DotFx {
  x: number;
  y: number;
  t: number;
  delay: number;
}

interface FlyFx {
  arrow: Arrow;
  t: number;
  dur: number;
}

interface BlockFx {
  arrowId: number;
  blockerId: number | null;
  corridor: Cell[];
  t: number;
  dur: number;
}

const INK = new Color(34, 37, 45, 255);
const PALETTE = ARROW_PALETTE_RGB.map(([r, g, b]) => new Color(r, g, b, 255));
const DOT = new Color(185, 190, 201, 255);
const EDGE = new Color(122, 128, 142, 72);
const RED = new Color(214, 74, 66, 255);
const HINT = new Color(214, 162, 63, 255);
/** Boss 箭专属蓝（参考实现 #2B7FFF）与大眼表情色。 */
const BOSS_BLUE = new Color(43, 127, 255, 255);
const BOSS_EYE_DARK = new Color(15, 23, 42, 255);
/** 冰壳：半透明冰蓝加厚描边，裂纹随解冻进度加深。 */
const ICE_SHELL = new Color(202, 235, 250, 205);
const ICE_CRACK = new Color(96, 165, 210, 235);
/** 图案关底色：清空的格子逐渐露出「画」，按剪影 id 稳定取色。 */
const PICTURE_TINTS = [
  new Color(198, 226, 245, 235),
  new Color(245, 214, 220, 235),
  new Color(212, 238, 217, 235),
  new Color(247, 231, 200, 235),
  new Color(223, 216, 245, 235),
  new Color(214, 233, 244, 235),
  new Color(240, 222, 214, 235),
  new Color(216, 240, 231, 235),
];

function pictureTintFor(shape: string | undefined): Color {
  if (!shape) return PICTURE_TINTS[0];
  let h = 0;
  for (let i = 0; i < shape.length; i++) h = (h * 31 + shape.charCodeAt(i)) >>> 0;
  return PICTURE_TINTS[h % PICTURE_TINTS.length];
}

/** Head-leading, tail-following exit animation for one arrow. */
interface RailPoint {
  x: number;
  y: number;
  s: number;
}

@ccclass('BoardView')
export class BoardView extends Component {
  private level: Level | null = null;
  private alive = new Set<number>();
  private views = new Map<number, ArrowView>();
  private occupancy = new Map<number, Arrow>();
  private root: Node | null = null;
  private paper: Graphics | null = null;
  private fx: Graphics | null = null;

  private cell = 40;
  private bw = 0;
  private bh = 0;
  private hintId: number | null = null;

  private dots: DotFx[] = [];
  private flying: FlyFx[] = [];
  private blockFx: BlockFx | null = null;
  private edgeSegments: [number, number, number, number][] = [];
  private maskArea = 1;
  private paperDirty = true;
  /** 冰冻运行态：邻接表 / 已飞箭 / 仍处于冻结的箭（解冻后移除）。 */
  private frozenAdj = new Map<number, Set<number>>();
  private removedIds = new Set<number>();
  private activeFrozen = new Set<number>();
  private pictureTint: Color = PICTURE_TINTS[0];

  /** GameRoot flips this off while paused / after the level ends. */
  inputEnabled = true;
  onArrowCleared: ((arrow: Arrow) => void) | null = null;
  onArrowBlocked: ((arrow: Arrow, blocker: Arrow | null) => void) | null = null;
  /** 点了还冻结着的箭：不扣爱心，交给 GameRoot 提示。 */
  onFrozenTap: ((arrow: Arrow) => void) | null = null;
  /** 一支箭解冻瞬间（演出钩子）。 */
  onArrowUnfrozen: ((arrow: Arrow) => void) | null = null;

  layout(w: number, h: number): void {
    this.bw = w;
    this.bh = h;
    setSize(this.node, w, h);
    this.cell = this.level ? w / this.level.cols : w / 10;
    this.reposition();
    this.paperDirty = true;
  }

  setLevel(level: Level): void {
    this.level = level;
    this.alive = new Set(level.arrows.map((a) => a.id));
    this.hintId = null;
    this.views.clear();
    this.occupancy.clear();
    this.dots = [];
    this.flying = [];
    this.blockFx = null;
    this.edgeSegments = [];
    this.maskArea = 1;
    // 冰冻运行态：邻接表与冻结集合按关卡数据重建。
    this.frozenAdj = frozenAdjacencies(level);
    this.removedIds = new Set();
    this.activeFrozen = new Set(level.arrows.filter((a) => a.frozen).map((a) => a.id));
    this.pictureTint = pictureTintFor(level.mask ? level.shape : undefined);
    for (const a of level.arrows) {
      for (const c of a.cells) this.occupancy.set(cellKey(c), a);
      // Boss 双倍宽：影子格同样命中 Boss。
      if (a.isBoss) {
        for (const c of a.cells) {
          if (c.x + 1 < level.cols) this.occupancy.set(cellKey({ x: c.x + 1, y: c.y }), a);
        }
      }
    }

    if (level.mask) {
      const at = (x: number, y: number): boolean =>
        x >= 0 && y >= 0 && x < level.cols && y < level.rows && level.mask![y * level.cols + x] === 1;
      let area = 0;
      for (let y = 0; y < level.rows; y++) {
        for (let x = 0; x < level.cols; x++) {
          if (!at(x, y)) continue;
          area++;
          if (!at(x, y - 1)) this.edgeSegments.push([x, y, x + 1, y]);
          if (!at(x, y + 1)) this.edgeSegments.push([x, y + 1, x + 1, y + 1]);
          if (!at(x - 1, y)) this.edgeSegments.push([x, y, x, y + 1]);
          if (!at(x + 1, y)) this.edgeSegments.push([x + 1, y, x + 1, y + 1]);
        }
      }
      this.maskArea = Math.max(1, area);
    } else {
      this.maskArea = level.cols * level.rows;
    }

    if (this.root) this.root.destroy();
    this.root = newNode('arrows', this.node);
    const paperNode = newNode('paper', this.root);
    this.paper = paperNode.addComponent(Graphics);

    this.cell = this.bw ? this.bw / level.cols : 40;
    this.buildArrows();
    const fxNode = newNode('flight', this.root);
    this.fx = fxNode.addComponent(Graphics);
    this.paperDirty = true;
  }

  get remaining(): number {
    return this.alive.size;
  }

  get total(): number {
    return this.level ? this.level.arrows.length : 0;
  }

  get aliveIds(): Set<number> {
    return this.alive;
  }

  // ---------------------------------------------------------------- building

  private buildArrows(): void {
    if (!this.level || !this.root) return;
    this.level.arrows.forEach((arrow) => {
      const centroid = this.arrowCentroid(arrow);
      const node = newNode(`arrow-${arrow.id}`, this.root);
      const opacity = node.addComponent(UIOpacity);
      setSize(node, this.cell, this.cell);
      node.setPosition(centroid.x, centroid.y, 0);

      const glowNode = newNode('glow', node);
      const glow = glowNode.addComponent(Graphics);
      glowNode.active = false;

      const bodyNode = newNode('body', node);
      const body = bodyNode.addComponent(Graphics);
      let iceNode: Node | null = null;
      let ice: Graphics | null = null;
      if (arrow.frozen) {
        iceNode = newNode('ice', node);
        ice = iceNode.addComponent(Graphics);
      }
      const view: ArrowView = {
        arrow,
        node,
        body,
        glowNode,
        glow,
        iceNode,
        ice,
        opacity,
        base: new Vec3(centroid.x, centroid.y, 0),
      };
      this.views.set(arrow.id, view);
      this.paintArrow(view);
      this.paintGlow(view);
      if (ice && arrow.frozen) this.paintIce(view, 0);
    });
  }

  private cellCenter(x: number, y: number): { x: number; y: number } {
    return {
      x: -this.bw / 2 + (x + 0.5) * this.cell,
      y: this.bh / 2 - (y + 0.5) * this.cell,
    };
  }

  private arrowCentroid(arrow: Arrow): { x: number; y: number } {
    let sx = 0;
    let sy = 0;
    for (const c of arrow.cells) {
      sx += c.x;
      sy += c.y;
    }
    return this.cellCenter(sx / arrow.cells.length, sy / arrow.cells.length);
  }

  private localCells(view: ArrowView): { x: number; y: number }[] {
    const c = this.arrowCentroid(view.arrow);
    return view.arrow.cells.map((cell) => {
      const p = this.cellCenter(cell.x, cell.y);
      return { x: p.x - c.x, y: p.y - c.y };
    });
  }

  private traceArrow(g: Graphics, view: ArrowView, dx = 0, dy = 0): void {
    const pts = this.localCells(view);
    g.moveTo(pts[pts.length - 1].x + dx, pts[pts.length - 1].y + dy);
    for (let i = pts.length - 2; i >= 0; i--) g.lineTo(pts[i].x + dx, pts[i].y + dy);
  }

  private paintArrow(view: ArrowView): void {
    const g = view.body;
    const pts = this.localCells(view);
    const w = this.strokeWidth();
    g.clear();
    g.lineCap = Graphics.LineCap.ROUND;
    g.lineJoin = Graphics.LineJoin.ROUND;
    const isBoss = !!view.arrow.isBoss;
    const ink = isBoss ? BOSS_BLUE : PALETTE[view.arrow.color % PALETTE.length];
    // Boss 双倍宽：整体向右偏移半格、线宽约 1.55 格 —— 视觉上覆盖两列，
    // 对应它「两条射线都必须畅通」的规则。
    const dx = isBoss ? this.cell * 0.5 : 0;
    g.lineWidth = isBoss ? this.cell * 1.55 : w;
    g.strokeColor = ink;
    g.fillColor = ink;
    const dir = DIR_VECTORS[view.arrow.dir];
    const d = { x: dir.x, y: -dir.y };
    g.moveTo(pts[pts.length - 1].x + dx, pts[pts.length - 1].y);
    for (let i = pts.length - 2; i >= 0; i--) g.lineTo(pts[i].x + dx, pts[i].y);
    g.stroke();
    if (isBoss) {
      this.drawBossHead(g, view, { x: pts[0].x + dx, y: pts[0].y }, d, ink);
      this.drawBossFace(g, view, d, dx);
    } else {
      this.drawHead(g, view, pts[0], d, ink);
    }
  }

  /** Boss 大号箭头。 */
  private drawBossHead(
    g: Graphics,
    view: ArrowView,
    head: { x: number; y: number },
    d: Cell,
    ink: Color,
  ): void {
    const angle = Math.atan2(d.y, d.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    // 大三角必须比 1.55 格宽的身体更宽，否则会被身体盖住看不出朝向。
    const tip = this.cell * 0.98;
    const base = -this.cell * 0.22;
    const half = this.cell * 1.05;
    const map = (x: number, y: number) => ({
      x: head.x + x * cos - y * sin,
      y: head.y + x * sin + y * cos,
    });
    const p = [map(tip, 0), map(base, -half), map(base, half)];
    g.moveTo(p[0].x, p[0].y);
    g.lineTo(p[1].x, p[1].y);
    g.lineTo(p[2].x, p[2].y);
    g.close();
    g.fill();
    void view;
  }

  /** Boss 大眼表情：白眼球 + 黑瞳孔 + 怒眉（画在箭身中段，横跨双倍宽）。 */
  private drawBossFace(g: Graphics, view: ArrowView, d: Cell, dx = 0): void {
    // 身体朝向 d；眼睛沿垂直方向排开，眉毛朝箭头一侧。
    const px = -d.y;
    const py = d.x;
    const eyeOff = this.cell * 0.4;
    const eyeR = Math.max(3.5, this.cell * 0.26);
    const pupilR = eyeR * 0.45;
    const browOff = this.cell * 0.12;
    for (const side of [-1, 1]) {
      const ex = px * eyeOff * side + d.x * browOff + dx;
      const ey = py * eyeOff * side + d.y * browOff;
      g.fillColor = Color.WHITE;
      g.circle(ex, ey, eyeR);
      g.fill();
      g.fillColor = BOSS_EYE_DARK;
      g.circle(ex + d.x * eyeR * 0.25, ey + d.y * eyeR * 0.25, pupilR);
      g.fill();
      // 怒眉。
      g.lineWidth = Math.max(1.6, this.cell * 0.07);
      g.strokeColor = BOSS_EYE_DARK;
      g.moveTo(ex - px * eyeR * 0.85 + d.x * eyeR * 0.5, ey - py * eyeR * 0.85 + d.y * eyeR * 0.5);
      g.lineTo(ex + px * eyeR * 0.7 + d.x * eyeR * 1.1, ey + py * eyeR * 0.7 + d.y * eyeR * 1.1);
      g.stroke();
    }
    void view;
  }

  private drawHead(g: Graphics, view: ArrowView, head: { x: number; y: number }, d: Cell, ink: Color): void {
    const angle = Math.atan2(d.y, d.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const tip = this.cell * 0.4;
    const base = -this.cell * 0.13;
    const half = this.cell * 0.18;
    const map = (x: number, y: number) => ({
      x: head.x + x * cos - y * sin,
      y: head.y + x * sin + y * cos,
    });
    const p = [map(tip, 0), map(base, -half), map(base, half)];
    g.moveTo(p[0].x, p[0].y);
    g.lineTo(p[1].x, p[1].y);
    g.lineTo(p[2].x, p[2].y);
    g.close();
    g.fill();
    void view;
  }

  private strokeWidth(): number {
    return Math.max(2.2, Math.min(6.2, this.cell * 0.185));
  }

  private paintGlow(view: ArrowView): void {
    const g = view.glow;
    const pts = this.localCells(view);
    const w = this.strokeWidth();
    g.clear();
    g.lineWidth = w + this.cell * 0.22;
    g.lineCap = Graphics.LineCap.ROUND;
    g.lineJoin = Graphics.LineJoin.ROUND;
    g.strokeColor = HINT;
    g.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    for (let i = pts.length - 2; i >= 0; i--) g.lineTo(pts[i].x, pts[i].y);
    g.stroke();
  }

  /**
   * 冰壳：加厚的半透明冰蓝描边。cracks = 已飞走的相邻箭数（0/1），
   * 1 条裂纹预示「再清一支就解冻」。
   */
  private paintIce(view: ArrowView, cracks: number): void {
    const g = view.ice;
    if (!g) return;
    const pts = this.localCells(view);
    g.clear();
    const w = this.strokeWidth();
    g.lineWidth = w + this.cell * 0.34;
    g.lineCap = Graphics.LineCap.ROUND;
    g.lineJoin = Graphics.LineJoin.ROUND;
    g.strokeColor = ICE_SHELL;
    g.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    for (let i = pts.length - 2; i >= 0; i--) g.lineTo(pts[i].x, pts[i].y);
    g.stroke();
    // 裂纹：横跨箭身的短线，数量 = cracks。
    g.lineWidth = Math.max(1.5, w * 0.28);
    g.strokeColor = ICE_CRACK;
    for (let k = 0; k < cracks && k < 2; k++) {
      const idx = Math.max(1, Math.floor((pts.length * (k + 1)) / 3));
      const p = pts[Math.min(idx, pts.length - 1)];
      const half = this.cell * 0.34;
      g.moveTo(p.x - half * 0.5, p.y - half);
      g.lineTo(p.x + half * 0.4, p.y + half * 0.9);
      g.stroke();
    }
  }

  /** 某支冻结箭当前已飞走的相邻箭数（0..2）。 */
  private crackCount(arrowId: number): number {
    let hits = 0;
    for (const n of this.frozenAdj.get(arrowId) ?? []) {
      if (this.removedIds.has(n)) hits++;
    }
    return Math.min(2, hits);
  }

  private redrawPaper(): void {
    const g = this.paper;
    if (!g || !this.level) return;
    g.clear();

    // 图案关：已被清空的剪影格子露出「画」的底色（揭画进度即清盘进度）。
    if (this.level.mask) {
      g.fillColor = this.pictureTint;
      for (let y = 0; y < this.level.rows; y++) {
        for (let x = 0; x < this.level.cols; x++) {
          if (this.level.mask[y * this.level.cols + x] !== 1) continue;
          if (this.occupancy.has(cellKey({ x, y }))) continue;
          const p = this.cellCenter(x, y);
          const s = this.cell * 0.92;
          g.rect(p.x - s / 2, p.y - s / 2, s, s);
        }
      }
      g.fill();
      // 剪影轮廓：让「这是一幅画」在开局就可读。
      if (this.edgeSegments.length) {
        g.lineWidth = Math.max(1.2, this.cell * 0.06);
        g.strokeColor = new Color(this.pictureTint.r, this.pictureTint.g, this.pictureTint.b, 160);
        for (const [x1, y1, x2, y2] of this.edgeSegments) {
          const a = this.cellCenter(x1, y1);
          const b = this.cellCenter(x2, y2);
          g.moveTo(a.x, a.y);
          g.lineTo(b.x, b.y);
        }
        g.stroke();
      }
    }

    g.fillColor = DOT;
    let any = false;
    for (const dot of this.dots) {
      const p = Math.max(0, Math.min(1, (dot.t - dot.delay) / 0.2));
      if (p <= 0) continue;
      any = true;
      g.circle(
        -this.bw / 2 + (dot.x + 0.5) * this.cell,
        this.bh / 2 - (dot.y + 0.5) * this.cell,
        Math.max(1.5, this.cell * 0.085) * (0.4 + 0.6 * p),
      );
    }
    if (any) g.fill();
  }

  // ---------------------------------------------------------------- gameplay

  isFree(arrow: Arrow): boolean {
    if (!this.level) return false;
    // Boss OR 语义：头部射线或头右侧射线任一畅通即可飞。
    return canArrowEscape(this.level, arrow, (c) => {
      const owner = this.occupancy.get(cellKey(c));
      return !!owner && this.alive.has(owner.id) && owner.id !== arrow.id;
    });
  }

  /** 还冻结着（未解冻）？冻结箭不是合法点击目标。 */
  isFrozenActive(arrow: Arrow): boolean {
    return !!arrow.frozen && this.activeFrozen.has(arrow.id);
  }

  /** 合法可飞 = 航道干净 && 未被冻结（提示与自动演示都用它）。 */
  isPlayable(arrow: Arrow): boolean {
    return !this.isFrozenActive(arrow) && this.isFree(arrow);
  }

  blockerOf(arrow: Arrow): Arrow | null {
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
        if (owner && owner.id !== arrow.id && this.alive.has(owner.id)) {
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
    if (this.hintId === id) return;
    this.hintId = id;
    for (const view of this.views.values()) {
      const op = view.glowNode.getComponent(UIOpacity) || view.glowNode.addComponent(UIOpacity);
      Tween.stopAllByTarget(op);
      view.glowNode.active = false;
      op.opacity = 0;
    }
    if (id === null) return;
    const view = this.views.get(id);
    if (!view) return;
    view.glowNode.active = true;
    const op = view.glowNode.getComponent(UIOpacity) || view.glowNode.addComponent(UIOpacity);
    op.opacity = 70;
    tween(op)
      .repeatForever(tween(op).to(0.42, { opacity: 210 }).to(0.42, { opacity: 70 }))
      .start();
  }

  flashBlocked(arrow: Arrow, blocker: Arrow | null): void {
    if (!this.level) return;
    const corridor = corridorCells(this.level, arrow);
    let cells = corridor;
    if (blocker) {
      const idx = corridor.findIndex(
        (c) => c.x === blocker.cells[0].x && c.y === blocker.cells[0].y,
      );
      if (idx >= 0) cells = corridor.slice(0, idx + 1);
    }
    this.blockFx = {
      arrowId: arrow.id,
      blockerId: blocker ? blocker.id : null,
      corridor: cells,
      t: 0,
      dur: 0.5,
    };
  }

  private onTouchStart(event: EventTouch): void {
    if (!this.level || !this.inputEnabled) return;
    const ui = event.getUILocation();
    const uiTransform = this.node.getComponent(UITransform);
    if (!uiTransform) return;
    const local = uiTransform.convertToNodeSpaceAR(new Vec3(ui.x, ui.y, 0));
    const cx = Math.floor((local.x + this.bw / 2) / this.cell);
    const cy = Math.floor((this.bh / 2 - local.y) / this.cell);
    if (cx < 0 || cy < 0 || cx >= this.level.cols || cy >= this.level.rows) return;
    const arrow = this.occupancy.get(cellKey({ x: cx, y: cy }));
    if (!arrow || !this.alive.has(arrow.id)) return;

    if (this.isFrozenActive(arrow)) {
      // 冻结箭：抖动反馈，不扣爱心、不算撞墙。
      this.bumpArrow(arrow);
      this.onFrozenTap?.(arrow);
      return;
    }
    if (this.isFree(arrow)) {
      this.clearArrow(arrow);
    } else {
      this.bumpArrow(arrow);
      const blocker = this.blockerOf(arrow);
      this.flashBlocked(arrow, blocker);
      this.onArrowBlocked?.(arrow, blocker);
    }
  }

  private clearArrow(arrow: Arrow): void {
    this.alive.delete(arrow.id);
    for (const c of arrow.cells) {
      const owner = this.occupancy.get(cellKey(c));
      if (owner && owner.id === arrow.id) this.occupancy.delete(cellKey(c));
    }
    if (arrow.isBoss && this.level) {
      for (const c of arrow.cells) {
        const key = cellKey({ x: c.x + 1, y: c.y });
        const owner = this.occupancy.get(key);
        if (owner && owner.id === arrow.id) this.occupancy.delete(key);
      }
    }
    const view = this.views.get(arrow.id);
    if (view) {
      this.views.delete(arrow.id);
      this.flyOut(arrow, view);
    }
    if (this.hintId === arrow.id) this.hintId = null;
    this.removedIds.add(arrow.id);
    this.refreshFrozen(arrow.id);
    this.onArrowCleared?.(arrow);
  }

  /**
   * 一支箭飞走后的冰冻结算：其余冻结箭的裂纹 +1；达到 2 支相邻箭的
   * 立即解冻（冰壳碎裂演出）。
   */
  private refreshFrozen(removedId: number): void {
    if (!this.activeFrozen.size) return;
    for (const frozenId of [...this.activeFrozen]) {
      const view = this.views.get(frozenId);
      if (!view) {
        this.activeFrozen.delete(frozenId);
        continue;
      }
      if (isUnfrozen(frozenId, this.removedIds, this.frozenAdj)) {
        this.activeFrozen.delete(frozenId);
        this.shatterIce(view);
        this.onArrowUnfrozen?.(view.arrow);
      } else {
        this.paintIce(view, this.crackCount(frozenId));
      }
    }
    void removedId;
  }

  /** 冰壳碎裂：淡出 + 轻微弹跳。 */
  private shatterIce(view: ArrowView): void {
    const iceNode = view.iceNode;
    if (!iceNode) return;
    const op = iceNode.getComponent(UIOpacity) || iceNode.addComponent(UIOpacity);
    Tween.stopAllByTarget(op);
    Tween.stopAllByTarget(view.node);
    view.node.setPosition(view.base);
    tween(view.node)
      .to(0.08, { scale: new Vec3(1.12, 1.12, 1) })
      .to(0.14, { scale: new Vec3(1, 1, 1) })
      .start();
    tween(op)
      .to(0.3, { opacity: 0 })
      .call(() => iceNode.destroy())
      .start();
    view.ice = null;
    view.iceNode = null;
  }

  private flyOut(arrow: Arrow, view: ArrowView): void {
    const n = arrow.cells.length;
    const bodyLen = Math.max(1, n - 1) * this.cell;
    const exitPad = Math.hypot(this.bw, this.bh) + this.cell * 4;
    const total = bodyLen + exitPad;
    // 大盘提速（规则书 §12）：格子越小飞得越快，箭越多节奏越紧凑。
    const speedK = Math.max(0.55, Math.min(1, this.cell / 40));
    const dur = Math.min(1.05, Math.max(0.42, (0.55 + n * 0.03) * speedK));
    this.flying.push({ arrow, t: 0, dur });
    const speed = total / dur;
    for (let i = 0; i < n; i++) {
      const c = arrow.cells[i];
      this.dots.push({
        x: c.x,
        y: c.y,
        t: 0,
        delay: ((n - 1 - i) * this.cell) / speed,
      });
    }
    view.node.destroy();
    this.paperDirty = true;
  }

  private bumpArrow(arrow: Arrow): void {
    const view = this.views.get(arrow.id);
    if (!view) return;
    const dir = DIR_VECTORS[arrow.dir];
    const px = -dir.y * 7;
    const py = -dir.x * 7;
    Tween.stopAllByTarget(view.node);
    view.node.setPosition(view.base);
    tween(view.node)
      .to(0.05, { position: new Vec3(view.base.x + px, view.base.y + py, 0) })
      .to(0.05, { position: new Vec3(view.base.x - px, view.base.y - py, 0) })
      .to(0.05, { position: new Vec3(view.base.x + px * 0.6, view.base.y + py * 0.6, 0) })
      .to(0.05, { position: view.base })
      .start();
  }

  private reposition(): void {
    for (const view of this.views.values()) {
      const c = this.arrowCentroid(view.arrow);
      view.base.set(c.x, c.y, 0);
      view.node.setPosition(view.base);
      this.paintArrow(view);
      this.paintGlow(view);
      if (view.ice && this.isFrozenActive(view.arrow)) {
        this.paintIce(view, this.crackCount(view.arrow.id));
      }
    }
  }

  // ---------------------------------------------------------------- flight

  private buildRail(arrow: Arrow): { pts: RailPoint[]; bodyLen: number; total: number } {
    const pts: RailPoint[] = [];
    let s = 0;
    for (let i = arrow.cells.length - 1; i >= 0; i--) {
      const c = this.cellCenter(arrow.cells[i].x, arrow.cells[i].y);
      if (pts.length) s += Math.hypot(c.x - pts[pts.length - 1].x, c.y - pts[pts.length - 1].y);
      pts.push({ x: c.x, y: c.y, s });
    }
    const bodyLen = s;
    const head = pts[pts.length - 1];
    const dir = DIR_VECTORS[arrow.dir];
    const v = { x: dir.x, y: -dir.y };
    const exitPad = Math.hypot(this.bw, this.bh) + this.cell * 4;
    for (let d = this.cell; d <= exitPad; d += this.cell) {
      pts.push({ x: head.x + v.x * d, y: head.y + v.y * d, s: bodyLen + d });
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
    const out: { x: number; y: number }[] = [this.pointAt(pts, s0)];
    for (const p of pts) if (p.s > s0 && p.s < s1) out.push({ x: p.x, y: p.y });
    out.push(this.pointAt(pts, s1));
    return out;
  }

  private drawFlight(dt: number): void {
    const g = this.fx;
    if (!g) return;
    g.clear();
    const w = this.strokeWidth();
    const cell = this.cell;

    for (const f of this.flying) {
      f.t += dt;
      const { pts, bodyLen, total } = this.buildRail(f.arrow);
      const p = Math.min(1, f.t / f.dur);
      const d = total * p;
      const outline = this.bodyPath(pts, d, bodyLen + d);
      g.lineWidth = f.arrow.isBoss ? w * 2.3 : w;
      g.lineCap = Graphics.LineCap.ROUND;
      g.lineJoin = Graphics.LineJoin.ROUND;
      const flyColor = f.arrow.isBoss ? BOSS_BLUE : PALETTE[f.arrow.color % PALETTE.length];
      g.strokeColor = flyColor;
      g.moveTo(outline[0].x, outline[0].y);
      for (let i = 1; i < outline.length; i++) g.lineTo(outline[i].x, outline[i].y);
      g.stroke();

      const head = this.pointAt(pts, bodyLen + d);
      const dir = DIR_VECTORS[f.arrow.dir];
      this.drawHeadAt(g, head, { x: dir.x, y: -dir.y }, flyColor, f.arrow.isBoss ? 1.8 : 1);
    }
    this.flying = this.flying.filter((f) => f.t < f.dur);

    if (this.blockFx) {
      const fx = this.blockFx;
      fx.t += dt;
      const p = Math.min(1, fx.t / fx.dur);
      if (p >= 1) {
        this.blockFx = null;
      } else {
        const blocker = this.level?.arrows.find((a) => a.id === fx.blockerId);
        if (blocker && fx.corridor.length) {
          g.lineWidth = Math.max(1, w * 0.55);
          g.strokeColor = new Color(214, 74, 66, 210);
          const a = this.cellCenter(fx.corridor[0].x, fx.corridor[0].y);
          g.moveTo(a.x, a.y);
          for (let i = 1; i < fx.corridor.length; i++) {
            const c = this.cellCenter(fx.corridor[i].x, fx.corridor[i].y);
            g.lineTo(c.x, c.y);
          }
          g.stroke();
          const end = this.cellCenter(
            fx.corridor[fx.corridor.length - 1].x,
            fx.corridor[fx.corridor.length - 1].y,
          );
          g.fillColor = new Color(214, 74, 66, 220);
          g.circle(end.x, end.y, Math.max(2, cell * 0.13));
          g.fill();
        }
      }
    }
    void w;
  }

  private drawHeadAt(g: Graphics, head: { x: number; y: number }, d: Cell, ink: Color, scale = 1): void {
    const angle = Math.atan2(d.y, d.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const tip = this.cell * 0.4 * scale;
    const base = -this.cell * 0.13 * scale;
    const half = this.cell * 0.18 * scale;
    const map = (x: number, y: number) => ({
      x: head.x + x * cos - y * sin,
      y: head.y + x * sin + y * cos,
    });
    const p = [map(tip, 0), map(base, -half), map(base, half)];
    g.fillColor = ink;
    g.moveTo(p[0].x, p[0].y);
    g.lineTo(p[1].x, p[1].y);
    g.lineTo(p[2].x, p[2].y);
    g.close();
    g.fill();
  }

  // ---------------------------------------------------------------- lifecycle

  protected update(dt: number): void {
    if (!this.level) return;
    let animating = false;
    for (const dot of this.dots) {
      dot.t += dt;
      if (dot.t < dot.delay + 0.22) animating = true;
    }
    if (animating || this.paperDirty) {
      this.redrawPaper();
      this.paperDirty = false;
    }
    if (this.flying.length || this.blockFx) this.drawFlight(dt);
    else if (this.fx) this.fx.clear();
  }

  resetHint(): void {
    this.setHint(null);
  }

  clearAll(): void {
    if (this.root) this.root.destroy();
    this.root = null;
    this.paper = null;
    this.fx = null;
    this.views.clear();
    this.occupancy.clear();
    this.alive.clear();
    this.level = null;
    this.hintId = null;
    this.flying = [];
    this.dots = [];
    this.blockFx = null;
  }

  protected onEnable(): void {
    this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
  }

  protected onDisable(): void {
    this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
  }

  protected onDestroy(): void {
    this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
  }
}