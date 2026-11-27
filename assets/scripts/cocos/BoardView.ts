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
import { ARROW_PALETTE_CASUAL } from './Theme';
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

interface SparkFx {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  color: Color;
  t: number;
  dur: number;
  gravity: number;
}

const PALETTE = ARROW_PALETTE_CASUAL;
const DOT = new Color(196, 206, 220, 255);
const SHADOW_COLOR = new Color(18, 45, 82, 34);
const RED = new Color(242, 76, 70, 255);
const HINT = new Color(255, 198, 42, 255);
const BOSS_BLUE = new Color(36, 128, 248, 255);
const BOSS_OUTLINE = new Color(16, 62, 134, 255);
const BOSS_SHEEN = new Color(140, 220, 255, 115);
const BOSS_EYE_DARK = new Color(15, 29, 54, 255);
const BOSS_STAR_GOLD = new Color(255, 196, 28, 255);

const CONFETTI_COLORS = [
  new Color(255, 199, 44, 255),
  new Color(55, 202, 74, 255),
  new Color(46, 155, 247, 255),
  new Color(242, 82, 76, 255),
  new Color(148, 102, 247, 255),
  new Color(255, 140, 46, 255),
];

/** Warm soft pastel picture-reveal tints on the ivory board mat. */
const PICTURE_TINTS = [
  new Color(198, 232, 252, 235),
  new Color(252, 214, 224, 235),
  new Color(210, 244, 216, 235),
  new Color(255, 236, 198, 235),
  new Color(228, 216, 252, 235),
  new Color(204, 240, 242, 235),
  new Color(248, 224, 208, 235),
  new Color(212, 244, 232, 235),
];

function pictureTintFor(shape: string | undefined): Color {
  if (!shape) return PICTURE_TINTS[0];
  let h = 0;
  for (let i = 0; i < shape.length; i++) h = (h * 31 + shape.charCodeAt(i)) >>> 0;
  return PICTURE_TINTS[h % PICTURE_TINTS.length];
}

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
  private sparks: SparkFx[] = [];
  private blockFx: BlockFx | null = null;
  private edgeSegments: [number, number, number, number][] = [];
  private maskArea = 1;
  private paperDirty = true;
  private pictureTint: Color = PICTURE_TINTS[0];

  /** GameRoot flips this off while paused / after the level ends. */
  inputEnabled = true;
  onArrowCleared: ((arrow: Arrow) => void) | null = null;
  onArrowBlocked: ((arrow: Arrow, blocker: Arrow | null) => void) | null = null;

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
    this.sparks = [];
    this.blockFx = null;
    this.edgeSegments = [];
    this.maskArea = 1;
    this.pictureTint = pictureTintFor(level.mask ? level.shape : undefined);
    for (const a of level.arrows) {
      for (const c of a.cells) this.occupancy.set(cellKey(c), a);
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
      this.paintArrow(view);
      this.paintGlow(view);
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

  /** Smooth rounded-bend path from tail to head. */
  private traceSmoothPts(g: Graphics, pts: { x: number; y: number }[], dx = 0, dy = 0): void {
    if (!pts.length) return;
    const rev: { x: number; y: number }[] = [];
    for (let i = pts.length - 1; i >= 0; i--) {
      rev.push({ x: pts[i].x + dx, y: pts[i].y + dy });
    }
    g.moveTo(rev[0].x, rev[0].y);
    if (rev.length === 1) return;
    for (let i = 1; i < rev.length - 1; i++) {
      const a = rev[i - 1];
      const p = rev[i];
      const b = rev[i + 1];
      const l1 = Math.abs(p.x - a.x) + Math.abs(p.y - a.y);
      const l2 = Math.abs(b.x - p.x) + Math.abs(b.y - p.y);
      const turn = (p.x - a.x) * (b.y - p.y) - (p.y - a.y) * (b.x - p.x) !== 0;
      if (!turn) {
        g.lineTo(p.x, p.y);
        continue;
      }
      const r = Math.min(this.cell * 0.34, l1 / 2, l2 / 2);
      const u1x = (p.x - a.x) / (l1 || 1);
      const u1y = (p.y - a.y) / (l1 || 1);
      const u2x = (b.x - p.x) / (l2 || 1);
      const u2y = (b.y - p.y) / (l2 || 1);
      g.lineTo(p.x - u1x * r, p.y - u1y * r);
      g.quadraticCurveTo(p.x, p.y, p.x + u2x * r, p.y + u2y * r);
    }
    const last = rev[rev.length - 1];
    g.lineTo(last.x, last.y);
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
    const dx = isBoss ? this.cell * 0.5 : 0;
    const dir = DIR_VECTORS[view.arrow.dir];
    const d = { x: dir.x, y: -dir.y };
    const drop = Math.max(1.5, this.cell * 0.08);

    // Soft tactile drop shadow on the cream mat
    g.lineWidth = isBoss ? this.cell * 1.62 : w + 1.2;
    g.strokeColor = SHADOW_COLOR;
    this.traceSmoothPts(g, pts, dx, -drop);
    g.stroke();

    if (isBoss) {
      // Crisp navy cartoon outline on giant Boss arrow
      g.lineWidth = this.cell * 1.68;
      g.strokeColor = BOSS_OUTLINE;
      this.traceSmoothPts(g, pts, dx, 0);
      g.stroke();
    }

    // Main vibrant arrow body
    g.lineWidth = isBoss ? this.cell * 1.48 : w;
    g.strokeColor = ink;
    g.fillColor = ink;
    this.traceSmoothPts(g, pts, dx, 0);
    g.stroke();

    if (isBoss) {
      // Glossy top sheen along boss body
      g.lineWidth = this.cell * 0.42;
      g.strokeColor = BOSS_SHEEN;
      this.traceSmoothPts(g, pts, dx - this.cell * 0.28, this.cell * 0.14);
      g.stroke();
      this.drawBossHead(g, { x: pts[0].x + dx, y: pts[0].y }, d, ink);
      this.drawBossFace(g, view.arrow, d, dx);
    } else {
      this.drawHead(g, pts[0], d, ink);
    }
  }

  private drawBossHead(g: Graphics, head: { x: number; y: number }, d: Cell, ink: Color): void {
    const angle = Math.atan2(d.y, d.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const map = (x: number, y: number) => ({
      x: head.x + x * cos - y * sin,
      y: head.y + x * sin + y * cos,
    });

    // Navy outline behind triangle
    const oTip = this.cell * 1.1;
    const oBase = -this.cell * 0.28;
    const oHalf = this.cell * 1.16;
    const op = [map(oTip, 0), map(oBase, -oHalf), map(oBase, oHalf)];
    g.fillColor = BOSS_OUTLINE;
    g.moveTo(op[0].x, op[0].y);
    g.lineTo(op[1].x, op[1].y);
    g.lineTo(op[2].x, op[2].y);
    g.close();
    g.fill();

    // Main blue arrowhead
    const tip = this.cell * 0.96;
    const base = -this.cell * 0.2;
    const half = this.cell * 1.02;
    const p = [map(tip, 0), map(base, -half), map(base, half)];
    g.fillColor = ink;
    g.moveTo(p[0].x, p[0].y);
    g.lineTo(p[1].x, p[1].y);
    g.lineTo(p[2].x, p[2].y);
    g.close();
    g.fill();
  }

  /** Expressive Boss cartoon eyes: focused pupils when blocked, golden sparkle-eyes when unlocked! */
  private drawBossFace(g: Graphics, arrow: Arrow, d: Cell, dx = 0): void {
    const px = -d.y;
    const py = d.x;
    const eyeOff = this.cell * 0.4;
    const eyeR = Math.max(4, this.cell * 0.28);
    const pupilR = eyeR * 0.48;
    const browOff = this.cell * 0.12;
    const free = this.isFree(arrow);

    for (const side of [-1, 1]) {
      const ex = px * eyeOff * side + d.x * browOff + dx;
      const ey = py * eyeOff * side + d.y * browOff;

      // White sclera + crisp outline
      g.fillColor = BOSS_EYE_DARK;
      g.circle(ex, ey, eyeR + 1.5);
      g.fill();
      g.fillColor = Color.WHITE;
      g.circle(ex, ey, eyeR);
      g.fill();

      if (free) {
        // Golden star-sparkle eye when Boss is ready to fly!
        g.fillColor = BOSS_STAR_GOLD;
        const sr = eyeR * 0.62;
        g.moveTo(ex, ey + sr);
        g.lineTo(ex + sr * 0.3, ey + sr * 0.3);
        g.lineTo(ex + sr, ey);
        g.lineTo(ex + sr * 0.3, ey - sr * 0.3);
        g.lineTo(ex, ey - sr);
        g.lineTo(ex - sr * 0.3, ey - sr * 0.3);
        g.lineTo(ex - sr, ey);
        g.lineTo(ex - sr * 0.3, ey + sr * 0.3);
        g.close();
        g.fill();
      } else {
        const pupX = ex + d.x * eyeR * 0.22;
        const pupY = ey + d.y * eyeR * 0.22;
        g.fillColor = BOSS_EYE_DARK;
        g.circle(pupX, pupY, pupilR);
        g.fill();
        // Eye catchlight
        g.fillColor = Color.WHITE;
        g.circle(pupX - pupilR * 0.35, pupY + pupilR * 0.35, pupilR * 0.34);
        g.fill();
      }

      // Expressive brow
      g.lineWidth = Math.max(2, this.cell * 0.08);
      g.strokeColor = BOSS_EYE_DARK;
      g.moveTo(ex - px * eyeR * 0.85 + d.x * eyeR * 0.55, ey - py * eyeR * 0.85 + d.y * eyeR * 0.55);
      g.lineTo(ex + px * eyeR * 0.72 + d.x * eyeR * 1.05, ey + py * eyeR * 0.72 + d.y * eyeR * 1.05);
      g.stroke();
    }
  }

  private drawHead(g: Graphics, head: { x: number; y: number }, d: Cell, ink: Color): void {
    const angle = Math.atan2(d.y, d.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const tip = this.cell * 0.42;
    const base = -this.cell * 0.14;
    const half = this.cell * 0.21;
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

  private strokeWidth(): number {
    return Math.max(2.6, Math.min(7.2, this.cell * 0.21));
  }

  private paintGlow(view: ArrowView): void {
    const g = view.glow;
    const pts = this.localCells(view);
    const w = this.strokeWidth();
    const dx = view.arrow.isBoss ? this.cell * 0.5 : 0;
    g.clear();
    g.lineWidth = (view.arrow.isBoss ? this.cell * 1.65 : w) + this.cell * 0.34;
    g.lineCap = Graphics.LineCap.ROUND;
    g.lineJoin = Graphics.LineJoin.ROUND;
    g.strokeColor = HINT;
    this.traceSmoothPts(g, pts, dx, 0);
    g.stroke();
  }

  private redrawPaper(): void {
    const g = this.paper;
    if (!g || !this.level) return;
    g.clear();

    if (this.level.mask) {
      g.fillColor = this.pictureTint;
      for (let y = 0; y < this.level.rows; y++) {
        for (let x = 0; x < this.level.cols; x++) {
          if (this.level.mask[y * this.level.cols + x] !== 1) continue;
          if (this.occupancy.has(cellKey({ x, y }))) continue;
          const p = this.cellCenter(x, y);
          const s = this.cell * 0.94;
          g.roundRect(p.x - s / 2, p.y - s / 2, s, s, Math.max(2, this.cell * 0.14));
        }
      }
      g.fill();
      if (this.edgeSegments.length) {
        g.lineWidth = Math.max(1.4, this.cell * 0.065);
        g.strokeColor = new Color(
          Math.max(0, this.pictureTint.r - 40),
          Math.max(0, this.pictureTint.g - 40),
          Math.max(0, this.pictureTint.b - 40),
          145,
        );
        for (const [x1, y1, x2, y2] of this.edgeSegments) {
          const ax = -this.bw / 2 + x1 * this.cell;
          const ay = this.bh / 2 - y1 * this.cell;
          const bx = -this.bw / 2 + x2 * this.cell;
          const by = this.bh / 2 - y2 * this.cell;
          g.moveTo(ax, ay);
          g.lineTo(bx, by);
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
        Math.max(1.6, this.cell * 0.09) * (0.4 + 0.6 * p),
      );
    }
    if (any) g.fill();
  }

  // ---------------------------------------------------------------- gameplay

  isFree(arrow: Arrow): boolean {
    if (!this.level) return false;
    return canArrowEscape(this.level, arrow, (c) => {
      const owner = this.occupancy.get(cellKey(c));
      return !!owner && this.alive.has(owner.id) && owner.id !== arrow.id;
    });
  }

  isPlayable(arrow: Arrow): boolean {
    return this.isFree(arrow);
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
    op.opacity = 85;
    tween(op)
      .repeatForever(tween(op).to(0.4, { opacity: 225 }).to(0.4, { opacity: 85 }))
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

  /** Victory confetti burst across the board! */
  celebrate(): void {
    for (let i = 0; i < 48; i++) {
      const angle = (Math.PI * 0.15) + Math.random() * (Math.PI * 0.7);
      const speed = 220 + Math.random() * 340;
      const side = i % 2 === 0 ? -1 : 1;
      this.sparks.push({
        x: side * (this.bw * 0.25) + (Math.random() - 0.5) * 90,
        y: -this.bh * 0.1 + (Math.random() - 0.5) * 80,
        vx: Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1) * 0.7,
        vy: Math.sin(angle) * speed,
        r: 5 + Math.random() * 6,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        t: 0,
        dur: 0.9 + Math.random() * 0.5,
        gravity: 680,
      });
    }
  }

  private spawnClearSparks(arrow: Arrow): void {
    const head = this.cellCenter(arrow.cells[0].x, arrow.cells[0].y);
    const col = arrow.isBoss ? BOSS_BLUE : PALETTE[arrow.color % PALETTE.length];
    const count = arrow.isBoss ? 14 : 6;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
      const spd = 70 + Math.random() * 110;
      this.sparks.push({
        x: head.x + (arrow.isBoss ? this.cell * 0.5 : 0),
        y: head.y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd,
        r: Math.max(2.5, this.cell * (arrow.isBoss ? 0.18 : 0.12)),
        color: i % 2 === 0 ? col : BOSS_STAR_GOLD,
        t: 0,
        dur: 0.32 + Math.random() * 0.16,
        gravity: 160,
      });
    }
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
    this.spawnClearSparks(arrow);
    const view = this.views.get(arrow.id);
    if (view) {
      this.views.delete(arrow.id);
      this.flyOut(arrow, view);
    }
    if (this.hintId === arrow.id) this.hintId = null;

    // Refresh any surviving Boss arrow so its eyes light up gold the moment it becomes free!
    for (const v of this.views.values()) {
      if (v.arrow.isBoss) this.paintArrow(v);
    }
    this.onArrowCleared?.(arrow);
  }

  private flyOut(arrow: Arrow, view: ArrowView): void {
    const n = arrow.cells.length;
    const bodyLen = Math.max(1, n - 1) * this.cell;
    const exitPad = Math.hypot(this.bw, this.bh) + this.cell * 4;
    const total = bodyLen + exitPad;
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
    const px = -dir.y * 8;
    const py = -dir.x * 8;
    Tween.stopAllByTarget(view.node);
    view.node.setPosition(view.base);
    tween(view.node)
      .to(0.045, { position: new Vec3(view.base.x + px, view.base.y + py, 0) })
      .to(0.045, { position: new Vec3(view.base.x - px, view.base.y - py, 0) })
      .to(0.045, { position: new Vec3(view.base.x + px * 0.55, view.base.y + py * 0.55, 0) })
      .to(0.045, { position: view.base })
      .start();
  }

  private reposition(): void {
    for (const view of this.views.values()) {
      const c = this.arrowCentroid(view.arrow);
      view.base.set(c.x, c.y, 0);
      view.node.setPosition(view.base);
      this.paintArrow(view);
      this.paintGlow(view);
    }
  }

  // ---------------------------------------------------------------- flight & fx

  private buildRail(arrow: Arrow): { pts: RailPoint[]; bodyLen: number; total: number } {
    const pts: RailPoint[] = [];
    let s = 0;
    const dx = arrow.isBoss ? this.cell * 0.5 : 0;
    for (let i = arrow.cells.length - 1; i >= 0; i--) {
      const c = this.cellCenter(arrow.cells[i].x, arrow.cells[i].y);
      c.x += dx;
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
      g.lineWidth = f.arrow.isBoss ? this.cell * 1.48 : w;
      g.lineCap = Graphics.LineCap.ROUND;
      g.lineJoin = Graphics.LineJoin.ROUND;
      const flyColor = f.arrow.isBoss ? BOSS_BLUE : PALETTE[f.arrow.color % PALETTE.length];
      g.strokeColor = flyColor;
      g.moveTo(outline[0].x, outline[0].y);
      for (let i = 1; i < outline.length; i++) g.lineTo(outline[i].x, outline[i].y);
      g.stroke();

      const head = this.pointAt(pts, bodyLen + d);
      const dir = DIR_VECTORS[f.arrow.dir];
      this.drawHeadAt(g, head, { x: dir.x, y: -dir.y }, flyColor, f.arrow.isBoss ? 2.2 : 1);
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
          const alpha = Math.round(230 * (1 - Math.max(0, (p - 0.5) / 0.5)));
          g.lineWidth = Math.max(2, w * 0.72);
          g.strokeColor = new Color(RED.r, RED.g, RED.b, alpha);
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
          g.fillColor = new Color(RED.r, RED.g, RED.b, alpha);
          g.circle(end.x, end.y, Math.max(3, cell * 0.18 * (1 + p * 0.5)));
          g.fill();
        }
      }
    }

    // Juicy clear sparkles & victory confetti
    for (const s of this.sparks) {
      s.t += dt;
      if (s.t >= s.dur) continue;
      s.vy -= s.gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      const k = 1 - s.t / s.dur;
      g.fillColor = new Color(s.color.r, s.color.g, s.color.b, Math.round(255 * k));
      g.circle(s.x, s.y, s.r * (0.45 + 0.55 * k));
      g.fill();
    }
    this.sparks = this.sparks.filter((s) => s.t < s.dur);
  }

  private drawHeadAt(g: Graphics, head: { x: number; y: number }, d: Cell, ink: Color, scale = 1): void {
    const angle = Math.atan2(d.y, d.x);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const tip = this.cell * 0.42 * scale;
    const base = -this.cell * 0.14 * scale;
    const half = this.cell * 0.21 * scale;
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
    if (this.flying.length || this.blockFx || this.sparks.length) this.drawFlight(dt);
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
    this.sparks = [];
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
