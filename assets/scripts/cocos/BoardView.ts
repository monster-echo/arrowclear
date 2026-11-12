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
import { Arrow, DIR_VECTORS, Level, cellKey, corridorCells } from '../core/types';
import { ARROW_COLORS } from './Theme';
import { newNode, setSize } from './UIKit';

const { ccclass } = _decorator;

interface ArrowView {
  arrow: Arrow;
  node: Node;
  body: Graphics;
  glowNode: Node;
  glow: Graphics;
  opacity: UIOpacity;
  base: Vec3;
}

const WHITE = new Color(255, 255, 255, 255);

@ccclass('BoardView')
export class BoardView extends Component {
  private level: Level | null = null;
  private alive = new Set<number>();
  private views = new Map<number, ArrowView>();
  private occupancy = new Map<number, Arrow>();
  private panel: Graphics | null = null;
  private root: Node | null = null;

  private cell = 40;
  private bw = 0;
  private bh = 0;
  private hintId: number | null = null;

  /** GameRoot flips this off while paused / after the level ends. */
  inputEnabled = true;
  onArrowCleared: ((arrow: Arrow) => void) | null = null;
  onArrowBlocked: ((arrow: Arrow, blocker: Arrow | null) => void) | null = null;

  /** Called by GameRoot once the board pixel size is known. */
  layout(w: number, h: number): void {
    this.bw = w;
    this.bh = h;
    this.cell = this.level ? w / this.level.cols : w / 10;
    this.buildPanel();
    this.reposition();
  }

  setLevel(level: Level): void {
    this.level = level;
    this.alive = new Set(level.arrows.map((a) => a.id));
    this.hintId = null;
    this.views.clear();
    this.occupancy.clear();
    for (const a of level.arrows) for (const c of a.cells) this.occupancy.set(cellKey(c), a);

    if (this.root) this.root.destroy();
    this.root = newNode('arrows', this.node);

    this.cell = this.bw ? this.bw / level.cols : 40;
    this.buildPanel();
    this.buildArrows();
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

  private buildPanel(): void {
    if (!this.level) return;
    const pad = this.cell * 0.34;
    setSize(this.node, this.bw + pad * 2, this.bh + pad * 2);

    if (!this.panel) {
      this.panel = this.node.addComponent(Graphics);
    }
    const g = this.panel;
    g.clear();
    const w = this.bw + pad * 2;
    const h = this.bh + pad * 2;
    const r = this.cell * 0.62;

    g.fillColor = new Color(24, 70, 100, 30);
    g.roundRect(-w / 2 + 2, -h / 2 - 14, w, h, r);
    g.fill();

    g.fillColor = new Color(255, 255, 255, 105);
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();

    g.lineWidth = 3;
    g.strokeColor = new Color(255, 255, 255, 190);
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.stroke();

    g.fillColor = new Color(110, 160, 185, 44);
    for (let y = 0; y < this.level.rows; y++) {
      for (let x = 0; x < this.level.cols; x++) {
        const p = this.cellCenter(x, y);
        g.circle(p.x, p.y, 1.6);
        g.fill();
      }
    }
  }

  private buildArrows(): void {
    if (!this.level || !this.root) return;
    this.level.arrows.forEach((arrow, i) => {
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

      const color = ARROW_COLORS[arrow.color % ARROW_COLORS.length];
      const view: ArrowView = {
        arrow,
        node,
        body,
        glowNode,
        glow,
        opacity,
        base: new Vec3(centroid.x, centroid.y, 0),
      };
      this.views.set(arrow.id, view);
      this.paintArrow(view, color);
      this.paintGlow(view, color);

      // Staggered pop-in.
      node.setScale(0.55, 0.55, 1);
      opacity.opacity = 0;
      tween(node)
        .delay(Math.min(0.3, i * 0.018))
        .parallel(
          tween(node).to(0.32, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' }),
          tween(opacity).to(0.2, { opacity: 255 }),
        )
        .start();
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

  private paintArrow(view: ArrowView, color: Color): void {
    const g = view.body;
    const pts = this.localCells(view);
    const w = Math.max(8, this.cell * 0.41);
    const dir = DIR_VECTORS[view.arrow.dir];
    const d = { x: dir.x, y: -dir.y };
    g.clear();

    // body, tail -> head
    g.lineWidth = w;
    g.lineCap = Graphics.LineCap.ROUND;
    g.lineJoin = Graphics.LineJoin.ROUND;
    g.strokeColor = color;
    g.fillColor = color;
    g.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    for (let i = pts.length - 2; i >= 0; i--) g.lineTo(pts[i].x, pts[i].y);
    g.stroke();

    // arrow head (rounded triangle)
    const head = pts[0];
    const len = this.cell * 0.4;
    const half = this.cell * 0.33;
    const cx = head.x + d.x * this.cell * 0.2;
    const cy = head.y + d.y * this.cell * 0.2;
    const angle = Math.atan2(d.y, d.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const baseX = cx - cos * this.cell * 0.32;
    const baseY = cy - sin * this.cell * 0.32;
    const tipX = cx + cos * len;
    const tipY = cy + sin * len;
    const p1x = baseX - sin * half;
    const p1y = baseY + cos * half;
    const p2x = baseX + sin * half;
    const p2y = baseY - cos * half;
    this.roundedTriangle(g, tipX, tipY, p1x, p1y, p2x, p2y, this.cell * 0.09);
    g.fill();
  }

  private roundedTriangle(
    g: Graphics,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
    r: number,
  ): void {
    const pts = [
      { x: x1, y: y1 },
      { x: x2, y: y2 },
      { x: x3, y: y3 },
    ];
    const near = (a: { x: number; y: number }, b: { x: number; y: number }) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const t = Math.min(0.45, r / len);
      return { x: a.x + dx * t, y: a.y + dy * t };
    };
    for (let i = 0; i < 3; i++) {
      const cur = pts[i];
      const prev = pts[(i + 2) % 3];
      const next = pts[(i + 1) % 3];
      const a = near(cur, prev);
      const b = near(cur, next);
      if (i === 0) g.moveTo(a.x, a.y);
      else g.lineTo(a.x, a.y);
      g.quadraticCurveTo(cur.x, cur.y, b.x, b.y);
    }
    g.close();
  }

  private paintGlow(view: ArrowView, color: Color): void {
    const g = view.glow;
    const pts = this.localCells(view);
    const w = Math.max(8, this.cell * 0.41);
    g.clear();
    g.lineWidth = w + this.cell * 0.26;
    g.lineCap = Graphics.LineCap.ROUND;
    g.lineJoin = Graphics.LineJoin.ROUND;
    g.strokeColor = new Color(255, 255, 255, 235);
    g.moveTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    for (let i = pts.length - 2; i >= 0; i--) g.lineTo(pts[i].x, pts[i].y);
    g.stroke();
    void color;
  }

  // ---------------------------------------------------------------- gameplay

  isFree(arrow: Arrow): boolean {
    if (!this.level) return false;
    for (const c of corridorCells(this.level, arrow)) {
      const owner = this.occupancy.get(cellKey(c));
      if (owner && this.alive.has(owner.id) && owner.id !== arrow.id) return false;
    }
    return true;
  }

  blockerOf(arrow: Arrow): Arrow | null {
    if (!this.level) return null;
    for (const c of corridorCells(this.level, arrow)) {
      const owner = this.occupancy.get(cellKey(c));
      if (owner && owner !== arrow && this.alive.has(owner.id)) return owner;
    }
    return null;
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
    op.opacity = 60;
    tween(op)
      .repeatForever(tween(op).to(0.42, { opacity: 220 }).to(0.42, { opacity: 60 }))
      .start();
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

    if (this.isFree(arrow)) {
      this.clearArrow(arrow);
    } else {
      this.bumpArrow(arrow);
      this.onArrowBlocked?.(arrow, this.blockerOf(arrow));
    }
  }

  private clearArrow(arrow: Arrow): void {
    this.alive.delete(arrow.id);
    for (const c of arrow.cells) {
      const owner = this.occupancy.get(cellKey(c));
      if (owner && owner.id === arrow.id) this.occupancy.delete(cellKey(c));
    }
    const view = this.views.get(arrow.id);
    if (view) {
      this.views.delete(arrow.id);
      this.flyOut(view);
    }
    if (this.hintId === arrow.id) this.hintId = null;
    this.onArrowCleared?.(arrow);
  }

  private flyOut(view: ArrowView): void {
    const dir = DIR_VECTORS[view.arrow.dir];
    const dist = Math.hypot(this.bw, this.bh) * 1.15;
    const target = new Vec3(
      view.base.x + dir.x * dist,
      view.base.y - dir.y * dist,
      0,
    );
    tween(view.node)
      .to(0.5, { position: target }, { easing: 'quadIn' })
      .call(() => view.node.destroy())
      .start();
    tween(view.opacity).to(0.5, { opacity: 0 }).start();
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
      this.paintArrow(view, ARROW_COLORS[view.arrow.color % ARROW_COLORS.length]);
      this.paintGlow(view, ARROW_COLORS[view.arrow.color % ARROW_COLORS.length]);
    }
  }

  resetHint(): void {
    this.setHint(null);
  }

  clearAll(): void {
    if (this.root) this.root.destroy();
    this.root = null;
    this.views.clear();
    this.occupancy.clear();
    this.alive.clear();
    this.level = null;
    this.hintId = null;
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