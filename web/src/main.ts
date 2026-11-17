import {
  CHAPTER_COUNT,
  CHAPTER_SIZE,
  LEVEL_COUNT,
  chapterOf,
  getLevelParts,
  isChallenge,
  isSprint,
  isZen,
  levelName,
  stepOf,
} from '../../assets/scripts/core/levels';
import { Arrow, Level } from '../../assets/scripts/core/types';
import {
  ENERGY_MAX,
  ENERGY_REGEN_MS,
  canStartLevel,
  energyNextInMs,
  formatEnergyClock,
  grantEnergy,
  refundEnergy,
  refillEnergy,
  spendEnergy,
  syncEnergy,
} from '../../assets/scripts/core/energy';
import { Sfx } from './audio';
import { showRewardedAd } from './ads';
import { logoSVG, mascotSVG } from './art';
import { hydrateIcons, icon } from './icons';
import { Renderer } from './render';
import { SaveData, loadSave, persist, totalStars } from './storage';
import { MasterReport } from '../../assets/scripts/core/arrowscore';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

/** 看一次激励广告补充的提示次数。 */
const HINTS_PER_AD = 1;

interface DebugEval {
  totalScore: number;
  tier: string;
  formulaExpression: string;
  summary: string;
  metrics: {
    maxChainDepth: number;
    initialMovableCount: number;
    initialMovableRatio: number;
    crossHalfLockRatio: number;
    avgLockDistance: number;
  };
}
type LevelWithEval = Level & { eval?: DebugEval; report?: MasterReport; motifs?: { layerDepth?: number } };

class Game {
  debugState(): unknown {
    const ev = (this.level as LevelWithEval | null)?.eval;
    return {
      level: this.level?.id,
      alive: this.alive.size,
      total: this.level?.arrows.length,
      hearts: this.hearts,
      energy: this.save.energy,
      energyMax: ENERGY_MAX,
      free: this.level
        ? this.level.arrows.filter((a) => this.alive.has(a.id) && this.renderer.isFree(a, this.alive)).length
        : 0,
      running: this.running,
      screen: this.screen,
      quality: ev ?? null,
    };
  }

  debugLevelQuality(): DebugEval | null {
    return (this.level as LevelWithEval | null)?.eval ?? null;
  }

  /** 当前还存活、可直接点飞的箭数（实时）。 */
  private liveMovable(): number {
    if (!this.level) return 0;
    return this.level.arrows.filter(
      (a) => this.alive.has(a.id) && this.renderer.isPlayable(a, this.alive),
    ).length;
  }

  private updateDebug(level: LevelWithEval): void {
    const panel = $('#debug-panel');
    if (!this.showDebug) {
      panel.classList.add('is-hidden');
      return;
    }
    panel.classList.remove('is-hidden');
    const r = level.report;
    const depth = r?.maxChainDepth ?? (level as LevelWithEval).motifs?.layerDepth;
    $('#dbg-depth').textContent = depth === undefined ? '--' : `${depth} 层`;
    $('#dbg-score').textContent = r
      ? `${r.totalScore} 分 · ${r.difficultyTier.slice(0, 1)}`
      : '--';
    $('#dbg-free').textContent = r ? `${this.liveMovable()} 根（初始 ${r.initialMovable}）` : '--';
    const total = level.arrows.length;
    $('#dbg-progress').textContent = `${total - this.alive.size}/${total}`;
    const cells = level.arrows.reduce((s, a) => s + a.cells.length, 0);
    const area = level.mask ? level.mask.reduce((s, v) => s + v, 0) : level.cols * level.rows;
    $('#dbg-arrows').textContent = `${total} 支 · ${((cells / Math.max(1, area)) * 100).toFixed(1)}%`;
    $('#dbg-formula').textContent = r
      ? `跨度${r.subScores.hierarchy}/斑马${r.subScores.antiZebra}/包络${r.subScores.cavity}/单解${r.subScores.topo} · 最长龙${r.maxArrowLen}格 · 单解${r.strictlyOneSteps}步 · 跃迁${r.avgJumpDist}格`
      : '--';
  }

  /** 每帧刷新「可释放 / 推进」这两个实时指标。 */
  private updateDebugLive(): void {
    if (!this.showDebug) return;
    const panel = $('#debug-panel');
    if (panel.classList.contains('is-hidden')) return;
    const total = this.level ? this.level.arrows.length : 0;
    const report = (this.level as LevelWithEval | null)?.report;
    $('#dbg-free').textContent = report
      ? `${this.liveMovable()} 根（初始 ${report.initialMovable}）`
      : '--';
    $('#dbg-progress').textContent = `${total - this.alive.size}/${total}`;
  }

  /** 自动解密：按当前合法解逐支飞出（90ms 一支），再点一次停止。 */
  private toggleAutoSolve(): void {
    if (this.autoSolveTimer !== null) {
      this.stopAutoSolve();
      return;
    }
    if (!this.running || this.paused || !this.level) return;
    this.sfx.unlock();
    const btn = $('#dbg-autosolve');
    btn.classList.add('is-on');
    btn.textContent = '⏸ 停止解密';
    this.autoSolveTimer = window.setInterval(() => {
      if (!this.running || this.paused || !this.level) {
        this.stopAutoSolve();
        return;
      }
      const pick = this.level.arrows.find(
        (a) => this.alive.has(a.id) && this.renderer.isPlayable(a, this.alive),
      );
      if (!pick) {
        this.stopAutoSolve();
        return;
      }
      this.clearArrow(pick);
    }, 90);
  }

  private stopAutoSolve(): void {
    if (this.autoSolveTimer !== null) {
      clearInterval(this.autoSolveTimer);
      this.autoSolveTimer = null;
    }
    const btn = document.querySelector<HTMLButtonElement>('#dbg-autosolve');
    if (btn) {
      btn.classList.remove('is-on');
      btn.textContent = '▶ 自动解密';
    }
  }

  /** X-Ray 精妙透视：跃迁链 / 连环扣 / 击尾导流 / 穿针窄门 四图层叠加。 */
  private toggleXRay(): void {
    this.xrayOn = !this.xrayOn;
    const btn = document.querySelector<HTMLButtonElement>('#dbg-xray');
    if (btn) {
      btn.classList.toggle('is-on', this.xrayOn);
      btn.textContent = this.xrayOn ? '✨ 透视中' : '✨ 透视';
    }
    const report = (this.level as LevelWithEval | null)?.report ?? null;
    this.renderer.setXRay(this.xrayOn ? report : null);
    if (this.xrayOn && report) {
      this.toast(
        `精妙剖析：单解${report.strictlyOneSteps}步 · 跃迁${report.avgJumpDist}格 · 连环扣${report.interlockingKnotCount}个 · 穿针${report.deceptiveClearCount}处`,
      );
    }
  }

  private toggleDebug(): void {
    this.showDebug = !this.showDebug;
    if (this.showDebug && this.level) this.updateDebug(this.level as LevelWithEval);
    else {
      $('#debug-panel').classList.add('is-hidden');
      this.stopAutoSolve();
    }
  }

  /**
   * DEBUG：把任意关卡（含 Boss 三连打部件）渲染到画布静帧，
   * 不走开局流程、不动存档——批量截图/巡检用。
   */
  debugPreview(id: number, part = 0): boolean {
    const parts = getLevelParts(id);
    const lv = parts[Math.max(0, Math.min(part, parts.length - 1))];
    this.level = lv;
    this.alive = new Set(lv.arrows.map((a) => a.id));
    this.screen = 'game';
    this.running = false;
    this.paused = false;
    this.stopAutoSolve();
    this.clearTimers();
    $('#home').classList.add('is-hidden');
    $('#levels').classList.add('is-hidden');
    $('#hud').classList.remove('is-hidden');
    $('#toolbar').classList.remove('is-hidden');
    this.hideOverlay();
    this.renderer.setLevel(lv);
    this.renderer.resize();
    this.syncInsets();
    this.renderer.render(this.alive, 0.016, performance.now() / 1000);
    return true;
  }

  debugFreeArrowScreenPos(): { x: number; y: number } | null {
    if (!this.level) return null;
    const free = this.level.arrows.filter(
      (a) => this.alive.has(a.id) && this.renderer.isPlayable(a, this.alive),
    );
    if (!free.length) return null;
    const a = free[0];
    const c = a.cells[Math.min(1, a.cells.length - 1)];
    const p = this.renderer.cellCenter(c);
    return { x: p.x, y: p.y };
  }

  private save: SaveData = loadSave();
  private sfx = new Sfx();
  private renderer: Renderer;

  private level: Level | null = null;
  private alive = new Set<number>();
  private hearts = 3;
  private heartMax = 3;
  private timeLeft = 0;
  private mistakes = 0;
  private running = false;
  private paused = false;
  private adPlaying = false;
  private energyTick = 0;
  private hintId: number | null = null;
  private hintUntil = 0;
  private lastFrame = 0;
  private screen: 'home' | 'game' | 'levels' = 'home';
  private tutorialShown = false;
  private timers: number[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private pointerStart = { x: 0, y: 0 };
  private pinchDist = 0;
  private dragMoved = false;
  private showDebug = new URLSearchParams(window.location.search).get('debug') === '1';
  private autoSolveTimer: number | null = null;
  private xrayOn = false;
  // —— 500 关结构运行态 ——
  private bossParts: Level[] = [];
  private bossIndex = 0;
  private reviveCount = 0;
  private mistakesBase = 0;
  private frozenToastAt = -10;
  private chapterPage = 1;

  constructor() {
    this.sfx.setEnabled(this.save.sound);
    this.renderer = new Renderer($<HTMLCanvasElement>('#board'));
    this.bind();
    this.showHome();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- screens

  private showHome(): void {
    this.stopAutoSolve();
    if (this.xrayOn) this.toggleXRay();
    this.clearTimers();
    this.screen = 'home';
    this.running = false;
    this.renderer.clear();
    $('#home').classList.remove('is-hidden');
    $('#levels').classList.add('is-hidden');
    $('#hud').classList.add('is-hidden');
    $('#toolbar').classList.add('is-hidden');
    $('#debug-panel').classList.add('is-hidden');
    this.hideOverlay();
    const next = Math.min(this.save.unlocked, LEVEL_COUNT);
    $('#home-level-chip').textContent = `第 ${next} 关`;
    this.updateEnergyPill();
    const hint = $('#home-hint');
    const stars = totalStars(this.save);
    hint.textContent =
      stars > 0 ? `已获得 ${stars} 颗星 · 继续冲关` : '点击箭头发射，清空整幅图案';
  }

  private showLevels(): void {
    this.stopAutoSolve();
    if (this.xrayOn) this.toggleXRay();
    this.clearTimers();
    this.screen = 'levels';
    $('#home').classList.add('is-hidden');
    $('#levels').classList.remove('is-hidden');
    // 默认翻到玩家当前进度所在的章（25 章 × 20 关，规则书 §2）。
    this.chapterPage = chapterOf(Math.min(this.save.unlocked, LEVEL_COUNT));
    this.buildLevelGrid();
  }

  private buildLevelGrid(): void {
    const grid = $('#level-grid');
    grid.innerHTML = '';
    $('#total-stars').textContent = String(totalStars(this.save));

    // 章节导航条（只插一次）。
    if (!document.querySelector('.chapter-nav')) {
      const nav = document.createElement('div');
      nav.className = 'chapter-nav';
      nav.innerHTML = `
        <button class="icon-btn glass" id="chapter-prev" aria-label="上一章">‹</button>
        <b id="chapter-label"></b>
        <button class="icon-btn glass" id="chapter-next" aria-label="下一章">›</button>
        <button class="icon-btn glass" id="chapter-bonus" aria-label="千层箭阵挑战">★</button>`;
      grid.parentElement?.insertBefore(nav, grid);
      $('#chapter-prev').addEventListener('click', () => {
        this.sfx.click();
        this.chapterPage = Math.max(1, this.chapterPage - 1);
        this.buildLevelGrid();
      });
      $('#chapter-next').addEventListener('click', () => {
        this.sfx.click();
        this.chapterPage = Math.min(CHAPTER_COUNT, this.chapterPage + 1);
        this.buildLevelGrid();
      });
      $('#chapter-bonus').addEventListener('click', () => {
        this.sfx.click();
        this.startLevel(501);
      });
    }

    const from = (this.chapterPage - 1) * CHAPTER_SIZE + 1;
    const to = from + CHAPTER_SIZE - 1;
    const label = $('#chapter-label');
    if (label) {
      let got = 0;
      for (let i = from; i <= to; i++) got += this.save.stars[i] ?? 0;
      label.textContent = `第 ${this.chapterPage}/${CHAPTER_COUNT} 章 · ${got}/60 星`;
    }

    for (let i = from; i <= to; i++) {
      const locked = i > this.save.unlocked;
      const stars = this.save.stars[i] ?? 0;
      const btn = document.createElement('button');
      btn.className = `lv${locked ? ' locked' : ''}${i === this.save.unlocked ? ' current' : ''}`;
      if (locked) {
        btn.innerHTML = `${icon('lock')}`;
      } else {
        const tag = stepOf(i) === 18 ? '⚔' : stepOf(i) === 13 ? '⚡' : stepOf(i) === 19 ? '✿' : '';
        btn.innerHTML = `<span>${i}${tag ? ` <i class="lv-tag">${tag}</i>` : ''}</span><span class="stars">${[0, 1, 2]
          .map((s) => icon(s < stars ? 'star' : 'starEmpty', s < stars ? 'on' : ''))
          .join('')}</span>`;
      }
      btn.addEventListener('click', () => {
        if (locked) {
          this.toast('先通过前一关才能解锁哦');
          return;
        }
        this.sfx.unlock();
        this.sfx.click();
        this.startLevel(i);
      });
      grid.appendChild(btn);
    }
  }

  /** Schedule a UI callback that is cancelled when the screen changes. */
  private later(fn: () => void, ms: number): void {
    this.timers.push(window.setTimeout(fn, ms));
  }

  private clearTimers(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
  }

  private startLevel(id: number): void {
    this.clearTimers();
    // 体力门禁：体力不足 1 点时弹激励广告补体力，不进入关卡。
    // 扣点不在这里：失败才扣（lose()），通关与中途重开都不扣。
    if (!canStartLevel(this.save, Date.now())) {
      this.showEnergyModal(true);
      return;
    }
    // 章门禁（规则书 §7）：章首关需上一章 ≥42 星，或已用广告通行证。
    if (!this.checkChapterGate(id)) return;

    this.bossParts = getLevelParts(id);
    this.bossIndex = 0;
    this.reviveCount = 0;
    this.mistakes = 0;
    this.enterPart(0);
  }

  /**
   * 进入一个「盘面」（普通关 1 个；Boss 三连打 3 个，规则书 §5）。
   * 爱心：首部件按模式给满（冲刺 5 颗）；Boss 后续部件贯穿不清不补；
   * 失败重开当前部件时回满。
   */
  private enterPart(index: number, restart = false): void {
    const part = this.bossParts[index] ?? this.bossParts[0];
    this.bossIndex = index;
    this.level = part;
    this.mistakesBase = this.mistakes;
    this.alive = new Set(part.arrows.map((a) => a.id));
    if (index === 0 || restart) {
      this.heartMax = isSprint(part.id) ? 5 : 3;
      this.hearts = this.heartMax;
    }
    this.timeLeft = part.timeLimit;
    this.hintId = null;
    this.running = true;
    this.paused = false;
    this.screen = 'game';

    $('#home').classList.add('is-hidden');
    $('#levels').classList.add('is-hidden');
    $('#hud').classList.remove('is-hidden');
    $('#toolbar').classList.remove('is-hidden');
    this.hideOverlay();
    const tag =
      this.bossParts.length > 1
        ? ` · Boss ${index + 1}/3`
        : isSprint(part.id)
          ? ' · 冲刺'
          : isZen(part.id)
            ? ' · 禅意'
            : '';
    $('#hud-level').textContent = `${levelName(part.id)}${tag}`;
    this.updateHintBadge();

    this.renderer.setLevel(part);
    this.renderer.resize();
    this.syncInsets();
    this.syncZoomUI();
    this.updateHud();
    this.updateHearts();
    this.updateDebug(part as LevelWithEval);
    this.stopAutoSolve();
    if (this.xrayOn) {
      this.renderer.setXRay((part as LevelWithEval).report ?? null);
    }

    if (!this.save.seenHowto) {
      this.save.seenHowto = true;
      persist(this.save);
      this.later(() => this.showHowto(true), 420);
    }
  }

  /** 章首关的星级门禁：不足 42 星 → 回刷或看广告通行（每章限 1 次）。 */
  private checkChapterGate(id: number): boolean {
    if (id <= 1 || id > LEVEL_COUNT || stepOf(id) !== 0) return true;
    const prev = chapterOf(id) - 1;
    const need = 42;
    let got = 0;
    for (let i = (prev - 1) * CHAPTER_SIZE + 1; i <= prev * CHAPTER_SIZE; i++) {
      got += this.save.stars[i] ?? 0;
    }
    if (got >= need || this.save.chapterPasses[String(prev)]) return true;
    this.showOverlay(`
      <div class="modal">
        <h3>第 ${prev} 章星数不足</h3>
        <p>进入下一章需要 ${need} 颗星，当前 ${got} 颗<br/>回上一章补星，或看一段广告直接通行</p>
        <div class="modal-actions">
          <button class="btn-primary" id="gate-back">回上一章</button>
          <button class="btn-ghost" id="gate-ad">看广告 通行</button>
        </div>
      </div>`);
    $('#gate-back').addEventListener('click', () => {
      this.hideOverlay();
      this.chapterPage = prev;
      this.showLevels();
    });
    $('#gate-ad').addEventListener('click', () => {
      this.runRewardedAd(() => {
        this.save.chapterPasses[String(prev)] = true;
        persist(this.save);
        this.hideOverlay();
        this.toast('通行成功，继续冒险！');
        this.startLevel(id);
      }, '要看完整段广告才能通行哦');
    });
    return false;
  }

  private syncInsets(): void {
    const hud = $('#hud').getBoundingClientRect();
    const bar = $('#toolbar').getBoundingClientRect();
    const top = hud.bottom + 6;
    const bottom = Math.max(80, window.innerHeight - bar.top + 12);
    this.renderer.setInsets(top, bottom);
  }

  // ---------------------------------------------------------------- input

  private bind(): void {
    window.addEventListener('keydown', (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'd' || e.key === 'D') this.toggleDebug();
      if (e.key === 'a' || e.key === 'A') this.toggleAutoSolve();
      if (e.key === 'x' || e.key === 'X') this.toggleXRay();
    });
    $('#debug-close').addEventListener('click', () => {
      this.showDebug = false;
      $('#debug-panel').classList.add('is-hidden');
      this.stopAutoSolve();
    });
    $('#dbg-autosolve').addEventListener('click', () => this.toggleAutoSolve());
    $('#dbg-xray').addEventListener('click', () => this.toggleXRay());
    // 移动端没有键盘：连点 LOGO 5 次（1.2s 内）开关调试面板。
    let logoTaps = 0;
    let logoTapAt = 0;
    document.querySelector('#logo')?.addEventListener('click', () => {
      const now = performance.now();
      if (now - logoTapAt > 1200) logoTaps = 0;
      logoTapAt = now;
      logoTaps++;
      if (logoTaps >= 5) {
        logoTaps = 0;
        this.toggleDebug();
        this.toast(this.showDebug ? 'DEBUG 已开启' : 'DEBUG 已关闭');
      }
    });
    $('#dbg-newsolve').addEventListener('click', () => {
      // 重置本关（重开一份同样的题），常用于反复看自动解。
      if (!this.level) return;
      this.stopAutoSolve();
      this.startLevel(this.level.id);
      this.later(() => this.updateDebug(this.level as LevelWithEval), 120);
    });
    const canvas = $<HTMLCanvasElement>('#board');
    const toLocal = (e: PointerEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      if (!this.running || this.paused || this.screen !== 'game') return;
      canvas.setPointerCapture?.(e.pointerId);
      const p = toLocal(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 1) {
        this.pointerStart = p;
        this.dragMoved = false;
        this.pinchDist = 0;
      } else if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });

    canvas.addEventListener('pointermove', (e) => {
      if (!this.running) return;
      const p = toLocal(e);
      const prev = this.pointers.get(e.pointerId);

      if (prev && this.pointers.size >= 2) {
        this.pointers.set(e.pointerId, p);
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinchDist > 0 && dist > 0) {
          this.renderer.zoomBy(dist / this.pinchDist);
          this.syncZoomUI();
        }
        this.pinchDist = dist;
        return;
      }

      if (prev) {
        this.pointers.set(e.pointerId, p);
        const dx = p.x - prev.x;
        const dy = p.y - prev.y;
        if (Math.hypot(p.x - this.pointerStart.x, p.y - this.pointerStart.y) > 6) {
          this.dragMoved = true;
        }
        if (this.dragMoved && this.renderer.zoomValue > 1.001) {
          this.renderer.panBy(dx, dy);
          canvas.style.cursor = 'grabbing';
        }
        return;
      }

      if (e.pointerType !== 'mouse') return;
      const arrow = this.renderer.hitTest(p.x, p.y);
      this.renderer.setHover(arrow ? arrow.id : null);
      canvas.style.cursor = arrow ? 'pointer' : this.renderer.zoomValue > 1.001 ? 'grab' : 'default';
    });

    const endPointer = (e: PointerEvent): void => {
      const p = toLocal(e);
      const wasOnlyPointer = this.pointers.size === 1;
      const tapped = wasOnlyPointer && !this.dragMoved;
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinchDist = 0;
      if (this.pointers.size === 1) {
        this.pointerStart = [...this.pointers.values()][0];
        this.dragMoved = false;
      }
      if (this.pointers.size === 0) {
        canvas.style.cursor = 'default';
        this.renderer.setHover(null);
      }
      if (tapped && this.running && !this.paused && this.screen === 'game') {
        const arrow = this.renderer.hitTest(p.x, p.y);
        if (arrow) this.tapArrow(arrow);
      }
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', (e) => {
      this.pointers.delete(e.pointerId);
      this.pinchDist = 0;
      this.dragMoved = false;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.running || this.screen !== 'game') return;
        e.preventDefault();
        this.renderer.zoomBy(Math.exp(-e.deltaY * 0.0015));
        this.syncZoomUI();
      },
      { passive: false },
    );

    window.addEventListener('resize', () => {
      this.renderer.resize();
      if (this.screen === 'game') this.syncInsets();
    });
    window.addEventListener('orientationchange', () => setTimeout(() => this.renderer.resize(), 200));

    $('#btn-play').addEventListener('click', () => {
      this.sfx.unlock();
      this.sfx.click();
      this.startLevel(Math.min(this.save.unlocked, LEVEL_COUNT));
    });
    $('#btn-home-settings').addEventListener('click', () => this.showSettings());
    $('#btn-pause').addEventListener('click', () => this.showPause());
    $('#btn-restart').addEventListener('click', () => {
      this.sfx.click();
      this.showRestartConfirm();
    });
    $('#btn-hint').addEventListener('click', () => this.useHint());
    $('#btn-zoom-out').addEventListener('click', () => {
      this.renderer.zoomBy(0.88);
      this.syncZoomUI();
    });
    $('#btn-zoom-in').addEventListener('click', () => {
      this.renderer.zoomBy(1.14);
      this.syncZoomUI();
    });
    const zoomRange = $<HTMLInputElement>('#zoom-range');
    zoomRange.addEventListener('input', () => {
      this.renderer.setZoom(Number(zoomRange.value) / 100);
      this.syncZoomUI();
    });
    $('#btn-nav-levels').addEventListener('click', () => {
      this.sfx.click();
      this.showLevels();
    });
    $('#btn-levels-back').addEventListener('click', () => {
      this.sfx.click();
      this.showHome();
    });
    $('#btn-energy').addEventListener('click', () => {
      this.sfx.click();
      this.showEnergyModal(false);
    });
    $('#btn-nav-howto').addEventListener('click', () => {
      this.sfx.click();
      this.showHowto(false);
    });

    window.addEventListener('keydown', (e) => {
      if (e.key === 'r' || e.key === 'R') this.showRestartConfirm();
      if (e.key === 'h' || e.key === 'H') this.useHint();
      if (e.key === 'Escape') this.showPause();
    });

    this.updateSoundButton();
  }

  private updateSoundButton(): void {
    const el = document.querySelector('#pause-sound');
    if (el) el.classList.toggle('on', this.save.sound);
    const haptics = document.querySelector('#pause-haptics');
    if (haptics) haptics.classList.toggle('on', this.save.haptics);
  }

  private syncZoomUI(): void {
    const range = document.querySelector<HTMLInputElement>('#zoom-range');
    const label = document.querySelector('#zoom-label');
    const pct = Math.round(this.renderer.zoomValue * 100);
    if (range) range.value = String(pct);
    if (label) label.textContent = `${pct}%`;
  }

  // ---------------------------------------------------------------- gameplay

  private tapArrow(arrow: Arrow): void {
    if (!this.level) return;
    // 冻结箭（规则书 §4）：抖动反馈，不扣爱心、不算撞墙。
    if (this.renderer.isFrozenActive(arrow)) {
      const now = performance.now() / 1000;
      if (now - this.frozenToastAt > 3) {
        this.frozenToastAt = now;
        this.toast('冰封的箭还不能飞，先清掉它旁边的两支箭');
        this.sfx.blocked();
        this.renderer.shakeScreen();
      }
      return;
    }
    if (this.renderer.isFree(arrow, this.alive)) {
      this.clearArrow(arrow);
    } else {
      this.blockArrow(arrow);
    }
  }

  private clearArrow(arrow: Arrow): void {
    this.alive.delete(arrow.id);
    this.sfx.whoosh();
    this.renderer.flyOut(arrow);
    this.sfx.clear();
    if (this.hintId === arrow.id) {
      this.hintId = null;
      this.renderer.setHint(null);
    }
    // 冰冻结算：相邻冻结箭裂纹 +1，攒满 2 支自动解冻。
    const unfrozen = this.renderer.noteRemoved(arrow.id);
    if (unfrozen.length) this.toast('冰壳碎裂，箭解冻了！');
    this.updateHud();
    if (this.alive.size === 0) {
      // Let the last arrow leave and the dot ghost settle before the modal.
      this.running = false;
      this.later(() => this.win(), 1000);
    }
  }

  private blockArrow(arrow: Arrow): void {
    this.mistakes++;
    this.sfx.blocked();
    const blocker = this.renderer.blockerOf(arrow, this.alive);
    this.renderer.flashBlocked(arrow, blocker);
    this.renderer.shakeScreen();
    // 禅意关（规则书 §5）：撞墙只计星，不扣爱心、无失败。
    if (this.level && isZen(this.level.id)) {
      this.toast('被挡住了（禅意关不扣爱心）');
      return;
    }
    this.hearts--;
    this.updateHearts(true);
    if (this.save.haptics && navigator.vibrate) navigator.vibrate(30);
    this.toast(arrow.isBoss ? 'Boss 双倍宽：两条通道都要清空才能飞' : this.blockedReason(arrow));
    if (this.hearts <= 0) {
      this.lose('hearts');
    }
  }

  private blockedReason(arrow: Arrow): string {
    const blocker = this.renderer.blockerOf(arrow, this.alive);
    if (!blocker) return '被挡住了';
    if (blocker.isBoss) return '被大 Boss 挡住了！';
    return '被另一支箭挡住了';
  }

  /** 刷新工具栏提示按钮上的剩余次数。 */
  private updateHintBadge(): void {
    $('#hint-cost').textContent = String(this.save.hints);
    $('#hint-cost').classList.toggle('zero', this.save.hints <= 0);
  }

  private useHint(): void {
    if (!this.running || this.paused || !this.level) return;
    if (this.save.hints <= 0) {
      this.updateHintBadge();
      this.showHintModal();
      return;
    }
    const free = this.level.arrows.filter(
      (a) => this.alive.has(a.id) && this.renderer.isPlayable(a, this.alive),
    );
    if (!free.length) return;
    free.sort((a, b) => b.cells.length - a.cells.length);
    const pick = free.find((a) => a.id !== this.hintId) ?? free[0];
    this.save.hints -= 1;
    persist(this.save);
    this.hintId = pick.id;
    this.hintUntil = performance.now() + 4200;
    this.renderer.setHint(pick.id);
    this.sfx.hint();
    this.updateHintBadge();
  }

  /** 提示次数用完：看一段激励广告补充 HINTS_PER_AD 次。 */
  private showHintModal(): void {
    this.paused = true;
    this.showOverlay(`
      <div class="modal">
        <h3>提示用完了</h3>
        <div class="reward">${icon('bulb')}<span>剩余 ${this.save.hints} 次</span></div>
        <p>看一段广告，立即补充 ${HINTS_PER_AD} 次提示</p>
        <div class="modal-actions">
          <button class="btn-primary" id="hint-ad">看广告 +${HINTS_PER_AD} 次</button>
          <button class="btn-ghost" id="hint-close">先不用</button>
        </div>
      </div>`);
    $('#hint-ad').addEventListener('click', () => {
      this.runRewardedAd(() => {
        this.save.hints += HINTS_PER_AD;
        persist(this.save);
        this.hideOverlay();
        this.paused = false;
        this.updateHintBadge();
        this.sfx.coin();
        this.toast(`+${HINTS_PER_AD} 次提示`);
      });
    });
    $('#hint-close').addEventListener('click', () => {
      this.hideOverlay();
      this.paused = false;
    });
  }

  private win(): void {
    if (!this.level) return;
    this.stopAutoSolve();
    this.running = false;
    const id = this.level.id;

    // Boss 三连打：先过部件，最后一盘才结算（规则书 §5）。
    if (this.bossParts.length > 1 && this.bossIndex < this.bossParts.length - 1) {
      const cleared = this.bossIndex + 1;
      this.later(() => {
        this.showOverlay(`
        <div class="modal">
          <h3>Boss ${cleared}/3 通过！</h3>
          <p>爱心会带进下一小关，稳住</p>
          <div class="modal-actions">
            <button class="btn-primary" id="boss-next">下一小关</button>
          </div>
        </div>`);
        $('#boss-next').addEventListener('click', () => {
          this.hideOverlay();
          this.enterPart(this.bossIndex + 1);
        });
      }, 600);
      return;
    }

    // 星级：按全部部件的箭数合计折算撞墙阈值（Boss），单部件关即本关箭数。
    const total = this.bossParts.reduce((n, p) => n + p.arrows.length, 0);
    const star3 = Math.max(1, Math.round(total * 0.05));
    const star2 = Math.max(2, Math.round(total * 0.18));
    const stars = this.mistakes <= star3 ? 3 : this.mistakes <= star2 ? 2 : 1;

    this.save.stars[id] = Math.max(this.save.stars[id] ?? 0, stars);
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(LEVEL_COUNT, id + 1));
    persist(this.save);
    this.sfx.win();
    this.renderer.celebrate();

    const isLast = id >= LEVEL_COUNT;
    this.later(() => this.showWinModal(id, stars, isLast), 420);
  }

  /** 通关弹窗：未满星时提供「看广告 星数×2」激励位（规则书 §9 位 #4）。 */
  private showWinModal(id: number, stars: number, isLast: boolean): void {
    this.showOverlay(`
        <div class="modal">
          <h3>${isLast ? '全部通关！' : '通关啦'}</h3>
          <div class="stars-big" id="win-stars">
            ${[0, 1, 2].map((i) => icon('star', i < stars ? 'on' : '')).join('')}
          </div>
          <p>${stars === 3 ? '完美！一次都没撞墙' : this.mistakes > 0 ? `撞墙 ${this.mistakes} 次，再试一次冲击三星` : '漂亮，继续保持'}</p>
          <div class="modal-actions">
            ${
              stars < 3
                ? `<button class="btn-ghost" id="win-double">看广告 星数×2</button>`
                : ''
            }
            ${
              isLast
                ? `<button class="btn-primary" id="win-levels">返回关卡</button>`
                : `<button class="btn-primary" id="win-next">下一关</button>`
            }
            <div class="btn-row">
              <button class="btn-ghost" id="win-replay">重玩</button>
              <button class="btn-ghost" id="win-home">首页</button>
            </div>
          </div>
        </div>`);
    const s = document.querySelectorAll('#win-stars svg');
    s.forEach((el, i) => {
      if (i < stars) setTimeout(() => el.classList.add('on'), 120 + i * 170);
    });
    $('#win-double')?.addEventListener('click', () => {
      this.runRewardedAd(() => {
        const doubled = Math.min(3, stars * 2);
        this.save.stars[id] = Math.max(this.save.stars[id] ?? 0, doubled);
        persist(this.save);
        this.sfx.coin();
        this.toast(`星数翻倍，拿到 ${doubled} 星！`);
        this.hideOverlay();
        this.later(() => this.showWinModal(id, doubled, isLast), 350);
      }, '要看完整段广告才能翻倍哦');
    });
    $('#win-next')?.addEventListener('click', () => this.startLevel(Math.min(LEVEL_COUNT, id + 1)));
    $('#win-levels')?.addEventListener('click', () => this.showLevels());
    $('#win-replay').addEventListener('click', () => this.startLevel(id));
    $('#win-home').addEventListener('click', () => this.showHome());
  }

  private lose(reason: 'hearts' | 'time'): void {
    this.stopAutoSolve();
    this.running = false;
    this.sfx.lose();
    // 失败才真正扣体力（通关不扣）。复活成功会把这点退回（首次复活）。
    const spent = spendEnergy(this.save, Date.now());
    if (spent) {
      this.save.energy = spent.energy;
      this.save.energyAt = spent.energyAt;
      persist(this.save);
    }
    const title = reason === 'time' ? '时间到' : '爱心用尽';
    const sub =
      reason === 'time'
        ? '别急，先看清楚每一支箭的出口'
        : '每一次撞墙都会失去一颗爱心';
    // 复活递增（规则书 §10）：前 100 关限 1 次；之后第 2 次需连看 2 段广告。
    const id = this.level ? this.level.id : 1;
    const maxRevives = id <= 100 ? 1 : 2;
    const canRevive = this.reviveCount < maxRevives;
    const reviveText = this.reviveCount === 0 ? '看广告 复活' : '看 2 段广告 复活';
    this.later(() => {
      this.showOverlay(`
        <div class="modal">
          <h3>${title}</h3>
          <p>${sub}</p>
          <div class="modal-actions">
            ${canRevive ? `<button class="btn-primary" id="lose-revive">${reviveText}</button>` : ''}
            <button class="btn-ghost" id="lose-retry">再试一次</button>
            <div class="btn-row">
              <button class="btn-ghost" id="lose-home">首页</button>
              <button class="btn-ghost" id="lose-levels">关卡</button>
            </div>
          </div>
        </div>`);
      $('#lose-revive')?.addEventListener('click', () => this.revive(reason));
      $('#lose-retry').addEventListener('click', () => this.restartCurrentPart());
      $('#lose-home').addEventListener('click', () => this.showHome());
      $('#lose-levels').addEventListener('click', () => this.showLevels());
    }, 380);
  }

  /** 重开当前盘面：Boss 连打从当前小关重来并回满爱心（规则书 §5）。 */
  private restartCurrentPart(): void {
    const id = this.level ? this.level.id : 1;
    this.hideOverlay();
    this.paused = false;
    this.reviveCount = 0;
    this.mistakes = this.mistakesBase;
    if (this.bossParts.length > 1) {
      this.enterPart(this.bossIndex, true);
    } else {
      this.startLevel(id);
    }
  }

  /**
   * 看完激励广告复活（规则书 §10 递增方案）：
   *  - 第 1 次：1 段广告，爱心回 3 + 补足时间 + 退还失败扣的体力；
   *  - 第 2 次：连看 2 段广告，爱心回 2 + 补时 45s（不退体力）。
   */
  private revive(reason: 'hearts' | 'time'): void {
    if (!this.level) return;
    const attempt = this.reviveCount;
    const grant = (): void => {
      this.hideOverlay();
      this.reviveCount++;
      if (attempt === 0) {
        this.hearts = 3;
        if (reason === 'time') this.timeLeft = Math.min(this.level!.timeLimit, this.timeLeft + 60);
        else this.timeLeft = Math.max(this.timeLeft, 30);
        const refunded = refundEnergy(this.save, Date.now());
        this.save.energy = refunded.energy;
        this.save.energyAt = refunded.energyAt;
        persist(this.save);
      } else {
        this.hearts = 2;
        this.timeLeft += 45;
      }
      this.running = true;
      this.paused = false;
      this.updateHearts();
      this.updateTimer();
      this.sfx.hint();
      this.toast(attempt === 0 ? '满血复活，继续！' : '复活成功，稳住这波！');
    };
    if (attempt === 0) {
      this.runRewardedAd(grant, '要看完整段广告才能复活哦');
    } else {
      this.runRewardedAds(2, grant, '要看完整两段广告才能复活哦');
    }
  }

  /** 连看 n 段激励广告：全部看完才发奖，中途放弃不发。 */
  private runRewardedAds(count: number, onReward: () => void, failMsg: string): void {
    const chain = (left: number): void => {
      this.runRewardedAd(() => {
        if (left > 1) chain(left - 1);
        else onReward();
      }, failMsg);
    };
    chain(count);
  }

  private showPause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.showOverlay(`
      <div class="modal">
        <h3>暂停</h3>
        <div style="width:100%">
          <div class="setting"><span>音效</span><div class="switch ${this.save.sound ? 'on' : ''}" id="pause-sound"></div></div>
          <div class="setting"><span>震动反馈</span><div class="switch ${this.save.haptics ? 'on' : ''}" id="pause-haptics"></div></div>
        </div>
        <div class="modal-actions">
          <button class="btn-primary" id="pause-resume">继续游戏</button>
          <div class="btn-row">
            <button class="btn-ghost" id="pause-restart">重来</button>
            <button class="btn-ghost" id="pause-home">首页</button>
          </div>
        </div>
      </div>`);
    $('#pause-sound').addEventListener('click', () => {
      this.save.sound = !this.save.sound;
      this.sfx.setEnabled(this.save.sound);
      persist(this.save);
      this.updateSoundButton();
      this.sfx.click();
    });
    $('#pause-haptics').addEventListener('click', () => {
      this.save.haptics = !this.save.haptics;
      persist(this.save);
      this.updateSoundButton();
    });
    $('#pause-resume').addEventListener('click', () => this.resume());
    $('#pause-restart').addEventListener('click', () => {
      this.hideOverlay();
      this.paused = false;
      this.startLevel(this.level!.id);
    });
    $('#pause-home').addEventListener('click', () => {
      this.paused = false;
      this.showHome();
    });
  }

  private resume(): void {
    this.paused = false;
    this.hideOverlay();
  }

  private showRestartConfirm(): void {
    if (!this.running || !this.level) return;
    this.paused = true;
    this.showOverlay(`
      <div class="modal">
        <h3>重新开始？</h3>
        <p>本关进度会清空，但爱心会恢复满</p>
        <div class="modal-actions">
          <button class="btn-primary" id="restart-yes">重新开始</button>
          <button class="btn-ghost" id="restart-no">继续游戏</button>
        </div>
      </div>`);
    $('#restart-yes').addEventListener('click', () => {
      this.paused = false;
      this.startLevel(this.level!.id);
    });
    $('#restart-no').addEventListener('click', () => this.resume());
  }

  // ---------------------------------------------------------------- overlays

  private showOverlay(html: string): void {
    const o = $('#overlay');
    o.innerHTML = html;
    o.classList.remove('is-hidden');
  }

  private hideOverlay(): void {
    const o = $('#overlay');
    o.classList.add('is-hidden');
    o.innerHTML = '';
  }

  private showHowto(fromGame: boolean): void {
    if (fromGame) this.paused = true;
    this.showOverlay(`
      <div class="modal">
        <h3>怎么玩</h3>
        <p style="text-align:left;line-height:1.9;font-size:15px">
          1. 点击一支箭，它会朝箭头方向飞出去<br/>
          2. 前方被别的箭挡住就会撞墙，扣一颗爱心<br/>
          3. 把整幅图案清空即可过关，撞墙越少星星越多<br/>
          4. 冰封的箭不能飞：先清掉它旁边两支箭
        </p>
        <div class="reward" style="font-size:18px">${icon('bulb')}<span>卡住了？用提示高亮一支能飞的箭</span></div>
        <div class="modal-actions">
          <button class="btn-primary" id="howto-ok">知道了</button>
        </div>
      </div>`);
    $('#howto-ok').addEventListener('click', () => {
      if (fromGame) this.resume();
      else this.hideOverlay();
    });
  }

  private showSettings(): void {
    this.showOverlay(`
      <div class="modal">
        <h3>设置</h3>
        <div style="width:100%">
          <div class="setting"><span>音效</span><div class="switch ${this.save.sound ? 'on' : ''}" data-switch="sound"></div></div>
          <div class="setting"><span>震动反馈</span><div class="switch ${this.save.haptics ? 'on' : ''}" data-switch="haptics"></div></div>
          <div class="setting"><span>已解锁关卡</span><b>${this.save.unlocked} / ${LEVEL_COUNT}</b></div>
          <div class="setting"><span>累计星星</span><b>${totalStars(this.save)} / ${LEVEL_COUNT * 3}</b></div>
        </div>
        <div class="modal-actions">
          <button class="btn-primary" id="settings-close">完成</button>
          <button class="btn-ghost" id="settings-reset">重置进度</button>
        </div>
      </div>`);
    const o = $('#overlay');
    o.querySelectorAll<HTMLElement>('[data-switch]').forEach((sw) => {
      sw.addEventListener('click', () => {
        const key = sw.dataset.switch as 'sound' | 'haptics';
        this.save[key] = !this.save[key];
        sw.classList.toggle('on', this.save[key]);
        this.sfx.setEnabled(this.save.sound);
        this.updateSoundButton();
        persist(this.save);
        this.sfx.click();
      });
    });
    $('#settings-close').addEventListener('click', () => this.hideOverlay());
    $('#settings-reset').addEventListener('click', () => {
      if (!confirm('确定要清空所有关卡进度吗？')) return;
      this.save.unlocked = 1;
      this.save.stars = {};
      this.save.hints = 3;
      this.save.chapterPasses = {};
      const refilled = refillEnergy(this.save, Date.now());
      this.save.energy = refilled.energy;
      this.save.energyAt = refilled.energyAt;
      persist(this.save);
      this.hideOverlay();
      this.showHome();
      this.toast('进度已重置');
    });
  }

  // ---------------------------------------------------------------- energy & ads

  /** 统一入口：播激励广告，看完才发奖励；重复点击在播广告期间会被忽略。 */
  private runRewardedAd(onReward: () => void, cancelMsg = '要看完整段广告才能领取哦'): void {
    if (this.adPlaying) return;
    this.adPlaying = true;
    void showRewardedAd().then((rewarded) => {
      this.adPlaying = false;
      if (rewarded) onReward();
      else this.toast(cancelMsg);
    });
  }

  /** 结算离线恢复并刷新首页体力条。 */
  private updateEnergyPill(): void {
    const now = Date.now();
    const synced = syncEnergy(this.save, now);
    if (synced.energy !== this.save.energy || synced.energyAt !== this.save.energyAt) {
      this.save.energy = synced.energy;
      this.save.energyAt = synced.energyAt;
      persist(this.save);
    }
    $('#energy-count').textContent = `${this.save.energy}/${ENERGY_MAX}`;
    const pill = $('#btn-energy');
    pill.classList.toggle('low', this.save.energy <= 1);
    const next = energyNextInMs(this.save, now);
    $('#energy-next').textContent = next > 0 ? formatEnergyClock(next) : '';
  }

  /** 体力弹窗：blocked = 因体力不足被拦下时弹出。 */
  private showEnergyModal(blocked: boolean): void {
    this.updateEnergyPill();
    const full = this.save.energy >= ENERGY_MAX;
    const next = energyNextInMs(this.save, Date.now());
    const regenMin = Math.round(ENERGY_REGEN_MS / 60000);
    const line = full
      ? `体力已满（${ENERGY_MAX}/${ENERGY_MAX}）。失败一关才扣体力。`
      : `${this.save.energy}/${ENERGY_MAX} · 下 1 点 ${formatEnergyClock(next)} 后恢复（每 ${regenMin} 分钟 1 点）`;
    this.showOverlay(`
      <div class="modal">
        <h3>${blocked ? '体力不足' : '体力'}</h3>
        <div class="reward">${icon('bolt')}<span>${this.save.energy} / ${ENERGY_MAX}</span></div>
        <p>${line}<br/>通关不扣体力，失败一关扣 1 点。</p>
        <div class="modal-actions">
          <button class="btn-primary" id="energy-ad"${full ? ' disabled' : ''}>看广告 +1 体力</button>
          <button class="btn-ghost" id="energy-close">${blocked ? '稍后再来' : '知道了'}</button>
        </div>
      </div>`);
    $('#energy-ad')?.addEventListener('click', () => {
      if (($('#energy-ad') as HTMLButtonElement).disabled) return;
      this.runRewardedAd(() => {
        const granted = grantEnergy(this.save, Date.now());
        this.save.energy = granted.energy;
        this.save.energyAt = granted.energyAt;
        persist(this.save);
        this.updateEnergyPill();
        this.hideOverlay();
        this.sfx.coin();
        this.toast('+1 体力，出发！');
      }, '要看完整段广告才能获得体力哦');
    });
    $('#energy-close').addEventListener('click', () => this.hideOverlay());
  }

  // ---------------------------------------------------------------- hud

  private updateHud(): void {
    if (this.level) {
      const done = this.level.arrows.length - this.alive.size;
      const pct = (done / this.level.arrows.length) * 100;
      $('#hud-progress').style.width = `${pct.toFixed(1)}%`;
    }
    this.updateTimer();
  }

  private updateTimer(): void {
    const el = $('#hud-timer');
    // 禅意关：无时限，显示 ∞。
    if (this.level && this.level.timeLimit === 0) {
      el.querySelector('b')!.textContent = '∞';
      el.classList.remove('low');
      return;
    }
    const t = Math.max(0, Math.ceil(this.timeLeft));
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    el.querySelector('b')!.textContent = `${mm}:${ss}`;
    el.classList.toggle('low', t <= 20);
  }

  private updateHearts(breakOne = false): void {
    const box = $('#hud-hearts');
    const max = this.heartMax;
    const lost = max - Math.max(0, this.hearts);
    if (box.children.length !== max) {
      box.innerHTML = Array.from({ length: max }, () => icon('heart')).join('');
    }
    Array.from(box.children).forEach((el, i) => {
      const isLost = i >= max - lost;
      if (isLost) {
        el.classList.add('lost');
        if (breakOne && i === max - lost) {
          el.classList.add('breaking');
          setTimeout(() => el.classList.remove('breaking'), 460);
        }
      } else {
        el.classList.remove('lost');
      }
    });
  }

  private toast(msg: string): void {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout((el as unknown as { _t: number })._t);
    (el as unknown as { _t: number })._t = window.setTimeout(() => el.classList.remove('show'), 1600);
  }

  // ---------------------------------------------------------------- loop

  private loop(now: number): void {
    const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0.016;
    this.lastFrame = now;

    if (this.screen === 'game' && this.running && !this.paused) {
      this.timeLeft -= dt;
      if (this.hintId !== null && now > this.hintUntil) {
        this.hintId = null;
        this.renderer.setHint(null);
      }
      // 禅意关（timeLimit 0）无时限，永不判负。
      if (this.level && this.level.timeLimit > 0 && this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.updateTimer();
        this.lose('time');
      }
      if (Math.floor(now / 250) !== Math.floor((now - dt * 1000) / 250)) this.updateTimer();
    } else if (this.screen !== 'game') {
      // 首页/关卡页：体力倒计时与离线恢复，每半秒刷一次。
      this.energyTick -= dt;
      if (this.energyTick <= 0) {
        this.energyTick = 0.5;
        this.updateEnergyPill();
      }
    }

    if (this.showDebug) this.updateDebugLive();
    this.renderer.render(this.alive, dt, now / 1000);
    requestAnimationFrame(this.loop);
  }
}

// ---------------------------------------------------------------- bootstrap

hydrateIcons();
$('#logo').innerHTML = logoSVG();
$('#mascot').innerHTML = mascotSVG();

document.addEventListener('gesturestart', (e) => e.preventDefault());
window.addEventListener('contextmenu', (e) => e.preventDefault());

const game = new Game();
// Debug handle used by the QA harness (tools/cdp.mjs).
(window as unknown as { __arrowGame: unknown }).__arrowGame = game;

export {};