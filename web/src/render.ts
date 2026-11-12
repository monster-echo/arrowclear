import { Arrow, Cell, DIR_VECTORS, Level, cellKey, corridorCells } from '../../assets/scripts/core/types';
import { ARROW_COLORS } from './theme';

interface FlyFx {
  arrow: Arrow;
  color: string;
  t: number;
  dur: number;
  dist: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  gravity: number;
  shape: 'dot' | 'rect';
}

type Rect = { x: number; y: number; w: number; h: number; cell: number };

const EASE_BACK = (t: number): number => {
  const c = 1.7;
  return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
};

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  W = 0;
  H = 0;

  private level: Level | null = null;
  private occupancy = new Map<number, Arrow>();
  private layout: Rect = { x: 0, y: 0, w: 0, h: 0, cell: 40 };
  private insets = { top: 132, bottom: 96 };

  private introT = 0;
  private flying: FlyFx[] = [];
  private particles: Particle[] = [];
  private confetti: Particle[] = [];
  private hintId: number | null = null;
  private hintT = 0;
  private hoverId: number | null = null;
  private shakeT = 0;

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
    for (const a of level.arrows) for (const c of a.cells) this.occupancy.set(cellKey(c), a);
    this.flying = [];
    this.particles = [];
    this.confetti = [];
    this.hintId = null;
    this.hintT = 0;
    this.introT = 0;
    this.computeLayout();
  }

  clear(): void {
    this.level = null;
    this.flying = [];
    this.particles = [];
    this.confetti = [];
  }

  setInsets(top: number, bottom: number): void {
    this.insets = { top, bottom };
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
    const pad = 16;
    const availW = this.W - pad * 2;
    const availH = this.H - this.insets.top - this.insets.bottom;
    const cell = Math.max(
      18,
      Math.min(46, Math.floor(Math.min(availW / this.level.cols, availH / this.level.rows))),
    );
    const w = cell * this.level.cols;
    const h = cell * this.level.rows;
    this.layout = {
      x: Math.round((this.W - w) / 2),
      y: Math.round(this.insets.top + (availH - h) / 2),
      w,
      h,
      cell,
    };
  }

  get cell(): number {
    return this.layout.cell;
  }

  cellCenter(c: Cell): { x: number; y: number } {
    return {
      x: this.layout.x + (c.x + 0.5) * this.layout.cell,
      y: this.layout.y + (c.y + 0.5) * this.layout.cell,
    };
  }

  pointToCell(px: number, py: number): Cell | null {
    const { x, y, cell } = this.layout;
    if (!this.level) return null;
    const cx = Math.floor((px - x) / cell);
    const cy = Math.floor((py - y) / cell);
    if (cx < 0 || cy < 0 || cx >= this.level.cols || cy >= this.level.rows) return null;
    return { x: cx, y: cy };
  }

  hitTest(px: number, py: number): Arrow | null {
    const c = this.pointToCell(px, py);
    if (!c) return null;
    const direct = this.occupancy.get(cellKey(c));
    if (direct) return direct;
    // Forgiving fallback: nearest arrow cell within ~0.9 cell.
    let best: Arrow | null = null;
    let bestD = 0.9;
    for (const [key, arrow] of this.occupancy) {
      const ax = key % 4096;
      const ay = Math.floor(key / 4096);
      const d = Math.hypot(ax - c.x, ay - c.y);
      if (d < bestD) {
        bestD = d;
        best = arrow;
      }
    }
    return best;
  }

  isFree(arrow: Arrow, alive: Set<number>): boolean {
    if (!this.level) return false;
    const cor = corridorCells(this.level, arrow);
    for (const c of cor) {
      const owner = this.occupancy.get(cellKey(c));
      if (owner && alive.has(owner.id) && owner.id !== arrow.id) return false;
    }
    return true;
  }

  setHint(id: number | null): void {
    this.hintId = id;
    this.hintT = 0;
  }

  setHover(id: number | null): void {
    this.hoverId = id;
  }

  shakeScreen(): void {
    this.shakeT = 0.22;
  }

  /** Removes the arrow from the occupancy map and starts its exit animation. */
  flyOut(arrow: Arrow): void {
    for (const c of arrow.cells) {
      const owner = this.occupancy.get(cellKey(c));
      if (owner && owner.id === arrow.id) this.occupancy.delete(cellKey(c));
    }
    const v = DIR_VECTORS[arrow.dir];
    const dist = Math.hypot(this.layout.w, this.layout.h) * 0.9;
    this.flying.push({
      arrow,
      color: ARROW_COLORS[arrow.color % ARROW_COLORS.length],
      t: 0,
      dur: 0.45,
      dist,
    });
    this.burst(arrow, v);
  }

  private burst(arrow: Arrow, v: Cell): void {
    const head = this.cellCenter(arrow.cells[0]);
    const color = ARROW_COLORS[arrow.color % ARROW_COLORS.length];
    const n = 9;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 150;
      this.particles.push({
        x: head.x + v.x * this.layout.cell * 0.4,
        y: head.y + v.y * this.layout.cell * 0.4,
        vx: Math.cos(a) * speed + v.x * 120,
        vy: Math.sin(a) * speed + v.y * 120,
        life: 0.45 + Math.random() * 0.3,
        max: 0.75,
        size: this.layout.cell * (0.05 + Math.random() * 0.07),
        color,
        rot: 0,
        vr: 0,
        gravity: 120,
        shape: 'dot',
      });
    }
  }

  celebrate(): void {
    const colors = ARROW_COLORS;
    for (let i = 0; i < 110; i++) {
      this.confetti.push({
        x: Math.random() * this.W,
        y: -20 - Math.random() * this.H * 0.35,
        vx: (Math.random() - 0.5) * 90,
        vy: 120 + Math.random() * 220,
        life: 2.6 + Math.random() * 1.2,
        max: 3.8,
        size: 5 + Math.random() * 7,
        color: colors[Math.floor(Math.random() * colors.length)],
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 8,
        gravity: 90,
        shape: 'rect',
      });
    }
  }

  render(alive: Set<number>, dt: number, time: number): void {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    this.introT += dt;
    this.hintT += dt;

    ctx.save();
    if (this.shakeT > 0) {
      this.shakeT -= dt;
      const s = this.shakeT / 0.22;
      ctx.translate((Math.random() - 0.5) * 8 * s, (Math.random() - 0.5) * 8 * s);
    }

    if (this.level) {
      this.drawPanel();
      this.drawArrows(alive, time);
      this.drawFlying(dt);
      this.drawParticles(dt);
    }
    this.drawConfetti(dt);
    ctx.restore();
  }

  // ---------------------------------------------------------------- drawing

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private drawPanel(): void {
    const ctx = this.ctx;
    const { x, y, w, h, cell } = this.layout;
    const pad = cell * 0.34;
    ctx.save();
    ctx.shadowColor = 'rgba(18, 64, 94, 0.16)';
    ctx.shadowBlur = 28;
    ctx.shadowOffsetY = 14;
    this.roundRect(x - pad, y - pad, w + pad * 2, h + pad * 2, cell * 0.62);
    ctx.fillStyle = 'rgba(255,255,255,0.42)';
    ctx.fill();
    ctx.restore();

    ctx.save();
    this.roundRect(x - pad, y - pad, w + pad * 2, h + pad * 2, cell * 0.62);
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.clip();

    // faint cell dots so empty space is readable
    ctx.fillStyle = 'rgba(110,160,185,0.18)';
    for (let cy = 0; cy < this.level!.rows; cy++) {
      for (let cx = 0; cx < this.level!.cols; cx++) {
        ctx.beginPath();
        ctx.arc(x + (cx + 0.5) * cell, y + (cy + 0.5) * cell, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const glow = ctx.createLinearGradient(0, y - pad, 0, y + h * 0.45);
    glow.addColorStop(0, 'rgba(255,255,255,0.35)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - pad, y - pad, w + pad * 2, h * 0.55);
    ctx.restore();
  }

  private tracePath(arrow: Arrow, dx = 0, dy = 0): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    ctx.beginPath();
    for (let i = arrow.cells.length - 1; i >= 0; i--) {
      const c = arrow.cells[i];
      const px = this.layout.x + (c.x + 0.5) * cell + dx;
      const py = this.layout.y + (c.y + 0.5) * cell + dy;
      if (i === arrow.cells.length - 1) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  }

  private drawHead(arrow: Arrow, color: string, alpha = 1): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const head = this.cellCenter(arrow.cells[0]);
    const v = DIR_VECTORS[arrow.dir];
    const angle = Math.atan2(v.y, v.x);
    const w = Math.max(7, cell * 0.41);

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(head.x, head.y);
    ctx.rotate(angle);
    this.headPath(cell);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /**
   * Arrow head in local space (pointing +x): a slim rounded triangle whose base
   * overlaps the round line cap, so the head reads as part of the stroke.
   */
  private headPath(cell: number): void {
    const ctx = this.ctx;
    const tip = cell * 0.64;
    const base = -cell * 0.21;
    const half = cell * 0.3;
    this.roundPoly(
      [
        [tip, 0],
        [base, -half],
        [base, half],
      ],
      [cell * 0.05, cell * 0.07, cell * 0.07],
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
      const r = radii[i] ?? 4;
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

  private drawArrow(arrow: Arrow, alpha: number, time: number, hinted: boolean): void {
    const ctx = this.ctx;
    const cell = this.layout.cell;
    const w = Math.max(7, cell * 0.41);
    const color = ARROW_COLORS[arrow.color % ARROW_COLORS.length];

    const delay = Math.min(0.28, arrow.id * 0.012);
    const p = Math.max(0, Math.min(1, (this.introT - delay) / 0.4));
    if (p <= 0) return;
    const scale = 0.55 + 0.45 * EASE_BACK(p);
    const cx = this.layout.x + this.layout.w / 2;
    const cy = this.layout.y + this.layout.h / 2;

    ctx.save();
    ctx.globalAlpha = alpha * Math.min(1, p * 1.6);
    if (p < 1) {
      const cc = this.arrowCenter(arrow);
      ctx.translate(cc.x, cc.y);
      ctx.scale(scale, scale);
      ctx.translate(-cc.x, -cc.y);
    }

    if (hinted) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 7);
      ctx.strokeStyle = `rgba(255,255,255,${0.35 + pulse * 0.45})`;
      ctx.lineWidth = w + cell * (0.2 + pulse * 0.12);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this.tracePath(arrow);
      ctx.stroke();
    }

    if (this.hoverId === arrow.id) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = w + cell * 0.16;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      this.tracePath(arrow);
      ctx.stroke();
    }

    // body
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    this.tracePath(arrow);
    ctx.stroke();

    // candy gloss
    ctx.strokeStyle = 'rgba(255,255,255,0.20)';
    ctx.lineWidth = w * 0.34;
    this.tracePath(arrow, 0, -w * 0.17);
    ctx.stroke();

    this.drawHead(arrow, color);

    ctx.restore();
    void cx;
    void cy;
  }

  private arrowCenter(arrow: Arrow): Cell {
    let sx = 0;
    let sy = 0;
    for (const c of arrow.cells) {
      sx += c.x;
      sy += c.y;
    }
    const n = arrow.cells.length;
    return this.cellCenter({ x: sx / n, y: sy / n });
  }

  private drawArrows(alive: Set<number>, time: number): void {
    if (!this.level) return;
    const list = this.level.arrows.filter((a) => alive.has(a.id));
    const hinted = list.find((a) => a.id === this.hintId);
    for (const a of list) {
      if (a.id === this.hintId) continue;
      this.drawArrow(a, 1, time, false);
    }
    if (hinted) {
      // Hinted arrow is drawn last so its glow sits above the crowd.
      const bob = Math.sin(time * 6) * 0.02;
      this.drawArrow(hinted, 1, time, true);
      void bob;
    }
  }

  private drawFlying(dt: number): void {
    const ctx = this.ctx;
    for (const f of this.flying) {
      f.t += dt;
      const p = Math.min(1, f.t / f.dur);
      const v = DIR_VECTORS[f.arrow.dir];
      const eased = p * p;
      const dist = f.dist * eased;
      const alpha = 1 - Math.pow(p, 2.4);
      if (p >= 1) continue;

      const dx = v.x * dist;
      const dy = v.y * dist;
      const cell = this.layout.cell;
      const w = Math.max(7, cell * 0.41);

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      // motion trail
      for (let k = 1; k <= 3; k++) {
        const back = (k / 3) * cell * 0.9 * (1 - p);
        ctx.globalAlpha = alpha * 0.16 * (1 - k / 4);
        this.tracePath(f.arrow, dx - v.x * back, dy - v.y * back);
        ctx.stroke();
      }
      ctx.globalAlpha = alpha;
      this.tracePath(f.arrow, dx, dy);
      ctx.stroke();
      ctx.fillStyle = f.color;
      const head = this.cellCenter(f.arrow.cells[0]);
      const hx = head.x + v.x * dist;
      const hy = head.y + v.y * dist;
      const angle = Math.atan2(v.y, v.x);
      ctx.translate(hx, hy);
      ctx.rotate(angle);
      this.headPath(cell);
      ctx.fill();
      ctx.restore();
    }
    this.flying = this.flying.filter((f) => f.t < f.dur);
  }

  private drawParticles(dt: number): void {
    const ctx = this.ctx;
    for (const p of this.particles) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const a = Math.max(0, p.life / p.max);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private drawConfetti(dt: number): void {
    const ctx = this.ctx;
    for (const p of this.confetti) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      ctx.save();
      ctx.globalAlpha = Math.min(1, p.life);
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
      ctx.restore();
    }
    this.confetti = this.confetti.filter((p) => p.life > 0);
  }
}