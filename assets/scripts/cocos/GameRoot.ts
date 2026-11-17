import {
  _decorator,
  Color,
  Component,
  Graphics,
  Label,
  Node,
  ResolutionPolicy,
  Sprite,
  Vec3,
  view,
  tween,
  UIOpacity,
} from 'cc';
import {
  CHAPTER_COUNT,
  CHAPTER_SIZE,
  LEVEL_COUNT,
  chapterOf,
  getLevel,
  getLevelParts,
  isChallenge,
  isSprint,
  isZen,
  levelName,
  stepOf,
} from '../core/levels';
import {
  ENERGY_MAX,
  ENERGY_REGEN_MS,
  canStartLevel,
  energyNextInMs,
  formatEnergyClock,
  grantEnergy,
  refundEnergy,
  spendEnergy,
  syncEnergy,
} from '../core/energy';
import { Arrow, Level } from '../core/types';
import { Assets } from './Assets';
import { BoardView } from './BoardView';
import { loadSave, persist, SaveData, totalStars } from './SaveStore';
import { Sfx } from './Sfx';
import { ARROW_NAMES, C, FONT } from './Theme';
import {
  ButtonHandle,
  makeButton,
  makeIcon,
  makeLabel,
  makePanel,
  makeSprite,
  newNode,
  popIn,
  setOpacity,
  setSize,
} from './UIKit';
import { Platform } from './Platform';

const { ccclass } = _decorator;

/** 看一次激励广告补充的提示次数。 */
const HINTS_PER_AD = 1;

interface ModalButton {
  text: string;
  primary?: boolean;
  onClick: () => void;
}

interface ModalOptions {
  title: string;
  lines?: string[];
  stars?: number;
  extraHeight?: number;
  content?: (panel: Node, topY: number) => void;
  buttons?: ModalButton[];
}

@ccclass('GameRoot')
export class GameRoot extends Component {
  private W = 720;
  private H = 1280;

  private save: SaveData = loadSave();
  private sfx = new Sfx();

  private home: Node | null = null;
  private game: Node | null = null;
  private levels: Node | null = null;
  private levelGrid: Node | null = null;
  private overlay: Node | null = null;
  private adLayer: Node | null = null;
  private toast: Node | null = null;
  private toastLabel: Label | null = null;

  private board: BoardView | null = null;
  private boardNode: Node | null = null;

  private hudLevel: Label | null = null;
  private timerLabel: Label | null = null;
  private timerNode: Node | null = null;
  private heartNodes: Node[] = [];
  private progressGfx: Graphics | null = null;
  private progressW = 600;
  private hintBadge: Label | null = null;
  private zoomLabel: Label | null = null;
  private zoom = 1;
  private homeChip: Label | null = null;
  private levelsTotal: Label | null = null;
  private soundIconNode: Node | null = null;

  private level: Level | null = null;
  private hearts = 3;
  private timeLeft = 0;
  private mistakes = 0;
  private running = false;
  private paused = false;
  private adPlaying = false;
  private energyPill: ButtonHandle | null = null;
  private energyNextLabel: Label | null = null;
  private energyTick = 0;
  private hintId: number | null = null;
  private hintUntil = 0;
  private clock = 0;
  // —— 500 关结构运行态 ——
  /** Boss 三连打（规则书 §5）：本关的部件队列与当前下标。 */
  private bossParts: Level[] = [];
  private bossIndex = 0;
  /** 本次尝试链内已复活次数（规则书 §10 递增方案）。 */
  private reviveCount = 0;
  /** 进入当前盘面时的撞墙数快照（Boss 重开当前小关时回退到这里）。 */
  private mistakesBase = 0;
  /** 冻结箭提示 toast 的节流时钟。 */
  private frozenToastAt = -10;
  /** 关卡选择页当前显示的章（1..25）。 */
  private chapterPage = 1;
  private chapterLabel: Label | null = null;

  // ---------------------------------------------------------------- lifecycle

  protected onLoad(): void {
    view.setDesignResolutionSize(720, 1280, ResolutionPolicy.FIXED_WIDTH);
    const size = view.getVisibleSize();
    this.W = size.width;
    this.H = size.height;

    this.save = loadSave();
    this.sfx.enabled = this.save.sound;
    this.sfx.attach(this.node);

    const loading = makeLabel(this.node, '加载中…', 30, C.inkSoft, { name: 'loading' });

    void Assets.preload().then(() => {
      loading.node.destroy();
      this.build();
    });
  }

  private build(): void {
    this.buildBackground();
    this.buildHome();
    this.buildGame();
    this.buildLevels();
    this.buildOverlay();
    this.buildToast();
    this.showHome();
  }

  protected update(dt: number): void {
    // 体力倒计时与离线恢复：不在对局中时每半秒刷一次体力条。
    if (!this.running) {
      this.energyTick -= dt;
      if (this.energyTick <= 0) {
        this.energyTick = 0.5;
        this.updateEnergyPill();
      }
    }

    if (!this.running || this.paused) return;

    this.clock += dt;
    this.timeLeft -= dt;
    if (this.timeLeft < 0) this.timeLeft = 0;
    this.updateTimer();
    // 禅意关（规则书 §5）无时限：timeLimit 0 时不判负。
    if (this.level && this.level.timeLimit > 0 && this.timeLeft <= 0) {
      this.lose('time');
      return;
    }

    if (this.hintId !== null && this.clock > this.hintUntil) {
      this.hintId = null;
      this.board?.setHint(null);
    }
  }

  // ---------------------------------------------------------------- background

  private buildBackground(): void {
    const n = newNode('background', this.node);
    n.setPosition(0, 0, 0);
    const g = n.addComponent(Graphics);
    g.fillColor = new Color(245, 246, 250, 255);
    g.rect(-this.W / 2, -this.H / 2, this.W, this.H);
    g.fill();
  }

  // ---------------------------------------------------------------- home

  private buildHome(): void {
    const home = newNode('home', this.node);
    setSize(home, this.W, this.H);
    this.home = home;

    const top = this.H / 2;

    const gear = makeButton(home, {
      w: 96,
      h: 96,
      radius: 26,
      fill: C.white,
      shadow: new Color(30, 80, 110, 38),
      shadowOffset: 6,
      icon: 'gear',
      iconSize: 50,
      onClick: () => {
        this.sfx.play('click');
        this.showSettings();
      },
    });
    gear.node.setPosition(-this.W / 2 + 78, top - 78, 0);

    // 体力条（右上）：点击弹体力说明 + 看广告补体力。
    const energyPill = makeButton(home, {
      w: 236,
      h: 80,
      radius: 40,
      fill: C.white,
      shadow: new Color(30, 80, 110, 34),
      shadowOffset: 6,
      icon: 'bolt',
      iconSize: 40,
      text: `${ENERGY_MAX}/${ENERGY_MAX}`,
      textSize: 32,
      textColor: C.ink,
      onClick: () => {
        this.sfx.play('click');
        this.showEnergyModal(false);
      },
    });
    energyPill.node.setPosition(this.W / 2 - 128, top - 78, 0);
    energyPill.label?.node.setPosition(-14, 0, 0);
    this.energyPill = energyPill;
    this.energyNextLabel = makeLabel(energyPill.node, '', 18, C.inkSoft, {
      width: 74,
      height: 40,
    });
    this.energyNextLabel.node.setPosition(74, 0, 0);

    const logoFrame = Assets.frame('logo');
    const logoW = Math.min(600, this.W * 0.84);
    if (logoFrame) {
      const logo = makeSprite(home, logoFrame, logoW, logoW * (150 / 490), 'logo');
      logo.node.setPosition(0, top - this.H * 0.17, 0);
    } else {
      makeLabel(home, '一箭清空', 96, C.orange).node.setPosition(0, top - this.H * 0.17, 0);
    }

    const mascotFrame = Assets.frame('mascot');
    if (mascotFrame) {
      const mascot = makeSprite(home, mascotFrame, logoW * 0.84, logoW * 0.84 * (270 / 300), 'mascot');
      const baseY = top - this.H * 0.43;
      mascot.node.setPosition(0, baseY, 0);
      tween(mascot.node)
        .repeatForever(
          tween(mascot.node)
            .to(1.8, { position: new Vec3(0, baseY + 16, 0) }, { easing: 'sineInOut' })
            .to(1.8, { position: new Vec3(0, baseY, 0) }, { easing: 'sineInOut' }),
        )
        .start();
    }

    const chip = makePanel(home, 220, 62, { radius: 31, fill: new Color(255, 255, 255, 190) });
    chip.setPosition(0, top - this.H * 0.675, 0);
    this.homeChip = makeLabel(chip, '第 1 关', 32, C.inkSoft, { width: 220, height: 62 });
    this.homeChip.node.setPosition(0, 0, 0);

    const play = makeButton(home, {
      w: Math.min(640, this.W * 0.88),
      h: 124,
      radius: 34,
      fill: C.blue,
      fillTop: new Color(255, 255, 255, 40),
      shadow: C.blueDark,
      shadowOffset: 9,
      text: '开始游戏',
      textSize: 52,
      icon: 'play',
      iconSize: 60,
      onClick: () => this.startLevel(Math.min(this.save.unlocked, LEVEL_COUNT), true),
    });
    play.node.setPosition(0, top - this.H * 0.755, 0);

    makeLabel(home, '点一下，箭头就会飞出去', 24, new Color(22, 61, 92, 120), {
      width: 600,
      height: 34,
    }).node.setPosition(0, top - this.H * 0.835, 0);

    const navY = -this.H / 2 + this.H * 0.115;
    const navs: { icon: string; text: string; onClick: () => void }[] = [
      { icon: 'levels', text: '关卡', onClick: () => this.showLevels() },
      { icon: 'help', text: '玩法', onClick: () => this.showHowto() },
    ];
    navs.forEach((item, i) => {
      const x = (i - (navs.length - 1) / 2) * 220;
      const b = makeButton(home, {
        w: 108,
        h: 108,
        radius: 30,
        fill: C.white,
        shadow: new Color(30, 80, 110, 32),
        shadowOffset: 6,
        icon: item.icon,
        iconSize: 56,
        onClick: () => {
          this.sfx.play('click');
          item.onClick();
        },
      });
      b.node.setPosition(x, navY, 0);
      makeLabel(home, item.text, 24, C.inkSoft, { width: 140, height: 34 }).node.setPosition(
        x,
        navY - 76,
        0,
      );
    });

    makeLabel(home, 'v0.1.0  ·  Cocos Creator 3.8', 18, new Color(22, 61, 92, 90), {
      width: 500,
      height: 26,
    }).node.setPosition(0, -this.H / 2 + 26, 0);
  }

  // ---------------------------------------------------------------- game screen

  private buildGame(): void {
    const game = newNode('game', this.node);
    setSize(game, this.W, this.H);
    this.game = game;

    const top = this.H / 2;

    const pause = makeButton(game, {
      w: 92,
      h: 92,
      radius: 26,
      fill: C.white,
      shadow: new Color(30, 80, 110, 34),
      shadowOffset: 6,
      icon: 'pause',
      iconSize: 44,
      onClick: () => this.showPause(),
    });
    pause.node.setPosition(-this.W / 2 + 72, top - 76, 0);

    this.hudLevel = makeLabel(game, '第 1 关', FONT.title, C.ink, { width: 420, height: 76 });
    this.hudLevel.node.setPosition(0, top - this.H * 0.095, 0);

    const hearts = newNode('hearts', game);
    this.heartNodes = [];
    for (let i = 0; i < 3; i++) {
      const h = makeIcon(hearts, 'heart', 44);
      h.setPosition(i * 50 - 50, 0, 0);
      this.heartNodes.push(h);
    }
    hearts.setPosition(-120, top - this.H * 0.138, 0);

    const timerWrap = newNode('timer', game);
    makeIcon(timerWrap, 'clock', 34).setPosition(-58, 0, 0);
    this.timerLabel = makeLabel(timerWrap, '02:00', 32, C.inkSoft, { width: 110, height: 40 });
    this.timerLabel.node.setPosition(12, 0, 0);
    timerWrap.setPosition(90, top - this.H * 0.138, 0);
    this.timerNode = timerWrap;

    const barW = Math.min(this.W - 100, 640);
    this.progressW = barW;
    const bar = makePanel(game, barW, 12, { radius: 6, fill: new Color(255, 255, 255, 160) });
    bar.setPosition(0, top - this.H * 0.162, 0);
    const fill = newNode('fill', bar);
    setSize(fill, barW, 12);
    this.progressGfx = fill.addComponent(Graphics);
    this.drawProgress(0);

    this.boardNode = newNode('board', game);
    this.board = this.boardNode.addComponent(BoardView);
    this.boardNode.setPosition(0, 0, 0);
    this.board.onArrowCleared = (arrow) => this.onCleared(arrow);
    this.board.onArrowBlocked = (arrow, blocker) => this.onBlocked(arrow, blocker);
    this.board.onFrozenTap = (arrow) => this.onFrozenTap(arrow);

    const toolY = -this.H / 2 + this.H * 0.075;
    const tools: {
      icon: string;
      text: string;
      x: number;
      onClick: () => void;
      badge?: boolean;
    }[] = [
      { icon: 'bulb', text: '提示', x: -232, onClick: () => this.useHint(), badge: true },
      { icon: 'restart', text: '重来', x: 232, onClick: () => this.confirmRestart() },
    ];
    tools.forEach((item) => {
      const x = item.x;
      const b = makeButton(game, {
        w: 118,
        h: 118,
        radius: 32,
        fill: C.white,
        shadow: new Color(30, 80, 110, 34),
        shadowOffset: 6,
        icon: item.icon,
        iconSize: 58,
        onClick: () => {
          this.sfx.play('click');
          item.onClick();
        },
      });
      b.node.setPosition(x, toolY, 0);
      makeLabel(game, item.text, 22, C.inkSoft, { width: 140, height: 30 }).node.setPosition(
        x,
        toolY - 82,
        0,
      );
      if (item.badge) {
        const badge = makePanel(b.node, 64, 40, { radius: 20, fill: C.yellow });
        badge.setPosition(42, 46, 0);
        this.hintBadge = makeLabel(badge, '3', 22, new Color(122, 76, 0, 255), {
          width: 64,
          height: 40,
        });
        this.hintBadge.node.setPosition(0, 0, 0);
      }
    });

    const zoomMinus = makeButton(game, {
      w: 66,
      h: 66,
      radius: 33,
      fill: C.white,
      shadow: new Color(30, 80, 110, 30),
      shadowOffset: 4,
      text: '−',
      textSize: 40,
      textColor: C.ink,
      systemFont: true,
      onClick: () => this.zoomBoard(0.86),
    });
    zoomMinus.node.setPosition(-54, toolY, 0);
    const zoomPlus = makeButton(game, {
      w: 66,
      h: 66,
      radius: 33,
      fill: C.white,
      shadow: new Color(30, 80, 110, 30),
      shadowOffset: 4,
      text: '+',
      textSize: 38,
      textColor: C.ink,
      systemFont: true,
      onClick: () => this.zoomBoard(1.16),
    });
    zoomPlus.node.setPosition(54, toolY, 0);
    this.zoomLabel = makeLabel(game, '100%', 20, C.inkSoft, {
      width: 100,
      height: 26,
      display: false,
    });
    this.zoomLabel.node.setPosition(0, toolY - 50, 0);
    makeLabel(game, '缩放', 18, C.inkFaint, {
      width: 100,
      height: 24,
      display: false,
    }).node.setPosition(0, toolY - 74, 0);

    game.active = false;
  }

  private drawProgress(ratio: number): void {
    const g = this.progressGfx;
    if (!g) return;
    const w = this.progressW;
    const h = 12;
    g.clear();
    const fw = Math.max(0, Math.min(1, ratio)) * w;
    if (fw <= 0) return;
    g.fillColor = new Color(255, 190, 70, 255);
    g.roundRect(-w / 2, -h / 2, fw, h, h / 2);
    g.fill();
    g.fillColor = new Color(255, 215, 110, 255);
    g.roundRect(-w / 2, -h / 2, fw, h * 0.6, h * 0.3);
    g.fill();
  }

  // ---------------------------------------------------------------- levels

  private buildLevels(): void {
    const root = newNode('levels', this.node);
    setSize(root, this.W, this.H);
    this.levels = root;

    const bg = root.addComponent(Graphics);
    bg.fillColor = new Color(232, 248, 253, 255);
    bg.rect(-this.W / 2, -this.H / 2, this.W, this.H);
    bg.fill();

    const back = makeButton(root, {
      w: 92,
      h: 92,
      radius: 26,
      fill: C.white,
      shadow: new Color(30, 80, 110, 28),
      shadowOffset: 6,
      icon: 'back',
      iconSize: 44,
      onClick: () => {
        this.sfx.play('click');
        this.showHome();
      },
    });
    back.node.setPosition(-this.W / 2 + 72, this.H / 2 - 82, 0);

    makeLabel(root, '选择关卡', FONT.h1, C.ink, { width: 300, height: 70 }).node.setPosition(
      -this.W / 2 + 210,
      this.H / 2 - 92,
      0,
    );

    makeIcon(root, 'star', 40).setPosition(this.W / 2 - 118, this.H / 2 - 92, 0);
    this.levelsTotal = makeLabel(root, '0', 34, new Color(180, 122, 0, 255), {
      width: 90,
      height: 46,
    });
    this.levelsTotal.node.setPosition(this.W / 2 - 66, this.H / 2 - 92, 0);

    // 章节导航：‹ 第 n/25 章 ›（500 关 = 25 章 × 20 关，规则书 §2）。
    const navY = this.H / 2 - 178;
    const prev = makeButton(root, {
      w: 76,
      h: 76,
      radius: 22,
      fill: C.white,
      shadow: new Color(30, 80, 110, 28),
      shadowOffset: 5,
      text: '‹',
      textSize: 44,
      onClick: () => {
        this.sfx.play('click');
        this.chapterPage = Math.max(1, this.chapterPage - 1);
        this.fillLevelGrid();
      },
    });
    prev.node.setPosition(-150, navY, 0);
    const next = makeButton(root, {
      w: 76,
      h: 76,
      radius: 22,
      fill: C.white,
      shadow: new Color(30, 80, 110, 28),
      shadowOffset: 5,
      text: '›',
      textSize: 44,
      onClick: () => {
        this.sfx.play('click');
        this.chapterPage = Math.min(CHAPTER_COUNT, this.chapterPage + 1);
        this.fillLevelGrid();
      },
    });
    next.node.setPosition(150, navY, 0);
    this.chapterLabel = makeLabel(root, '', 30, C.ink, { width: 360, height: 52 });
    this.chapterLabel.node.setPosition(0, navY, 0);

    // 千层箭阵彩蛋关：永远可玩（主线之外，id 501）。
    const bonus = makeButton(root, {
      w: 76,
      h: 76,
      radius: 22,
      fill: new Color(255, 240, 190, 255),
      shadow: new Color(224, 182, 74, 255),
      shadowOffset: 5,
      text: '★',
      textSize: 38,
      onClick: () => this.startLevel(501, true),
    });
    bonus.node.setPosition(this.W / 2 - 76, navY, 0);

    this.levelGrid = newNode('grid', root);
    this.levelGrid.setPosition(0, 0, 0);
    this.fillLevelGrid();
    root.active = false;
  }

  private fillLevelGrid(): void {
    const grid = this.levelGrid;
    if (!grid) return;
    grid.removeAllChildren();

    // 当前章的 20 关（5 列 × 4 行），角色角标：Boss ⚔ / 冲刺 ⚡ / 禅意画关 ✿。
    const from = (this.chapterPage - 1) * CHAPTER_SIZE + 1;
    const to = from + CHAPTER_SIZE - 1;
    if (this.chapterLabel) {
      const got = this.chapterStars(this.chapterPage);
      this.chapterLabel.string = `第 ${this.chapterPage}/${CHAPTER_COUNT} 章 · ${got}/60 星`;
    }

    const cols = 5;
    const gap = 18;
    const cellW = Math.min(122, (this.W - 90 - (cols - 1) * gap) / cols);
    const startX = -((cols - 1) * (cellW + gap)) / 2;
    const gridTop = this.H / 2 - 262;

    for (let i = from; i <= to; i++) {
      const col = (i - from) % cols;
      const row = Math.floor((i - from) / cols);
      const x = startX + col * (cellW + gap);
      const y = gridTop - row * (cellW + gap);

      if (i > this.save.unlocked && !isChallenge(i)) {
        const b = makeButton(grid, {
          w: cellW,
          h: cellW,
          radius: 24,
          fill: new Color(255, 255, 255, 90),
          icon: 'lock',
          iconSize: 32,
          onClick: () => this.showToast('先通过前一关才能解锁哦'),
        });
        b.node.setPosition(x, y, 0);
        continue;
      }

      const isCurrent = i === this.save.unlocked;
      const tag = stepOf(i) === 18 ? '⚔' : stepOf(i) === 13 ? '⚡' : stepOf(i) === 19 ? '✿' : '';
      const b = makeButton(grid, {
        w: cellW,
        h: cellW,
        radius: 24,
        fill: isCurrent ? new Color(255, 240, 190, 255) : C.white,
        shadow: isCurrent ? new Color(224, 182, 74, 255) : new Color(30, 80, 110, 26),
        shadowOffset: 5,
        text: String(i),
        textSize: 36,
        onClick: () => this.startLevel(i, true),
      });
      b.node.setPosition(x, y, 0);
      if (b.label) b.label.node.setPosition(0, 8, 0);
      if (tag) {
        const t = makeLabel(b.node, tag, 24, new Color(120, 130, 145, 255), {
          width: 40,
          height: 30,
        });
        t.node.setPosition(cellW / 2 - 20, cellW / 2 - 20, 0);
      }

      const stars = this.save.stars[i] ?? 0;
      for (let s = 0; s < 3; s++) {
        const frame = Assets.frame(s < stars ? 'star' : 'star-empty');
        if (!frame) continue;
        const sp = makeSprite(b.node, frame, 17, 17);
        sp.node.setPosition(-22 + s * 22, -36, 0);
      }
    }
  }

  // ---------------------------------------------------------------- utilities

  private buildOverlay(): void {
    const overlay = newNode('overlay', this.node);
    setSize(overlay, this.W, this.H);
    overlay.active = false;
    this.overlay = overlay;
  }

  private buildToast(): void {
    const t = newNode('toast', this.node);
    const bg = makePanel(t, 560, 64, { radius: 32, fill: new Color(22, 61, 92, 235) });
    setSize(bg, 560, 64);
    this.toastLabel = makeLabel(t, '', 24, C.white, { width: 540, height: 50 });
    t.setPosition(0, -this.H * 0.18, 0);
    setOpacity(t, 0);
    t.active = false;
    this.toast = t;
  }

  private showToast(message: string): void {
    if (!this.toast) return;
    this.toast.active = true;
    if (this.toastLabel) this.toastLabel.string = message;
    const op = this.toast.getComponent(UIOpacity) || this.toast.addComponent(UIOpacity);
    op.opacity = 255;
    tween(op)
      .delay(1.3)
      .to(0.25, { opacity: 0 })
      .call(() => {
        if (this.toast) this.toast.active = false;
      })
      .start();
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
    this.energyPill?.setText(`${this.save.energy}/${ENERGY_MAX}`);
    if (this.energyNextLabel) {
      const next = energyNextInMs(this.save, now);
      this.energyNextLabel.string = next > 0 ? formatEnergyClock(next) : '';
    }
  }

  /** 刷新提示按钮上的剩余次数角标。 */
  private updateHintBadge(): void {
    if (this.hintBadge) this.hintBadge.string = String(this.save.hints);
  }

  private updateTimer(): void {
    if (!this.timerLabel) return;
    // 禅意关：无时限，显示 ∞。
    if (this.level && this.level.timeLimit === 0) {
      this.timerLabel.string = '∞';
      this.timerLabel.color = C.inkSoft;
      return;
    }
    const t = Math.max(0, Math.ceil(this.timeLeft));
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    this.timerLabel.string = `${mm}:${ss}`;
    this.timerLabel.color = t <= 20 ? C.red : C.inkSoft;
    if (this.timerNode) {
      const s = t <= 20 ? 1.06 : 1;
      this.timerNode.setScale(s, s, 1);
    }
  }

  private updateHearts(): void {
    this.heartNodes.forEach((node, i) => {
      const alive = i < this.hearts;
      const sp = node.getComponent(Sprite);
      if (sp) sp.color = alive ? C.white : new Color(190, 205, 215, 255);
      const s = alive ? 1 : 0.86;
      node.setScale(s, s, 1);
    });
  }

  // ---------------------------------------------------------------- navigation

  private showHome(): void {
    this.unscheduleAllCallbacks();
    this.running = false;
    this.paused = false;
    this.closeModal();
    if (this.board) this.board.inputEnabled = false;
    if (this.home) this.home.active = true;
    if (this.game) this.game.active = false;
    if (this.levels) this.levels.active = false;
    this.board?.setHint(null);
    this.updateHintBadge();
    this.updateEnergyPill();
    if (this.homeChip) {
      this.homeChip.string = `第 ${Math.min(this.save.unlocked, LEVEL_COUNT)} 关`;
    }
  }

  private showLevels(): void {
    this.unscheduleAllCallbacks();
    this.closeModal();
    this.running = false;
    if (this.board) this.board.inputEnabled = false;
    if (this.home) this.home.active = false;
    if (this.game) this.game.active = false;
    if (this.levels) this.levels.active = true;
    // 默认翻到玩家当前进度所在的章。
    this.chapterPage = chapterOf(Math.min(this.save.unlocked, LEVEL_COUNT));
    if (this.levelsTotal) this.levelsTotal.string = String(totalStars(this.save));
    this.fillLevelGrid();
  }

  private startLevel(id: number, fromUI = false): void {
    this.unscheduleAllCallbacks();
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
    this.enterPart(0, fromUI);
  }

  /**
   * 进入一个「盘面」（普通关只有 1 个；Boss 三连打有 3 个，规则书 §5）。
   * 爱心规则：首部件按模式给满（冲刺 5 颗，其余 3 颗）；Boss 后续部件
   * 贯穿不清不补；失败重开当前部件时回满。
   */
  private enterPart(index: number, fromUI = false, restart = false): void {
    const part = this.bossParts[index] ?? this.bossParts[0];
    this.bossIndex = index;
    this.level = part;
    this.mistakesBase = this.mistakes;
    if (index === 0 || restart) {
      this.hearts = isSprint(part.id) ? 5 : 3;
    }
    this.timeLeft = part.timeLimit;
    this.hintId = null;
    this.hintUntil = 0;
    this.paused = false;
    this.running = true;

    this.closeModal();
    if (this.home) this.home.active = false;
    if (this.levels) this.levels.active = false;
    if (this.game) this.game.active = true;

    if (this.hudLevel) {
      const tag =
        this.bossParts.length > 1
          ? ` · Boss ${index + 1}/3`
          : isSprint(part.id)
            ? ' · 冲刺'
            : isZen(part.id)
              ? ' · 禅意'
              : '';
      this.hudLevel.string = `${levelName(part.id)}${tag}`;
    }

    const topInset = this.H * 0.185;
    const bottomInset = this.H * 0.145;
    const availW = this.W - 44;
    const availH = this.H - topInset - bottomInset;
    const cell = Math.min(
      Math.floor(availW / part.cols),
      Math.floor(availH / part.rows),
      88,
    );
    const bw = cell * part.cols;
    const bh = cell * part.rows;

    if (this.boardNode && this.board) {
      this.board.inputEnabled = true;
      this.boardNode.setPosition(0, this.H / 2 - topInset - availH / 2, 0);
      this.zoom = 1;
      this.boardNode.setScale(1, 1, 1);
      if (this.zoomLabel) this.zoomLabel.string = '100%';
      this.board.layout(bw, bh);
      this.board.setLevel(part);
      this.board.setHint(null);
    }

    this.updateHintBadge();
    this.updateHearts();
    this.drawProgress(0);
    this.updateTimer();

    if (fromUI) this.sfx.play('click');
    if (!this.save.seenHowto) {
      this.save.seenHowto = true;
      persist(this.save);
      this.scheduleOnce(() => this.showHowto(), 0.5);
    }
  }

  /** 章首关的星级门禁：不足 42 星 → 回刷或看广告通行（每章限 1 次）。 */
  private checkChapterGate(id: number): boolean {
    if (id <= 1 || stepOf(id) !== 0) return true;
    const entering = chapterOf(id);
    const prev = entering - 1;
    const need = 42;
    const got = this.chapterStars(prev);
    if (got >= need || this.save.chapterPasses[String(prev)]) return true;
    this.showModal({
      title: `第 ${prev} 章星数不足`,
      lines: [`进入下一章需要 ${need} 颗星，当前 ${got} 颗`, '回上一章补星，或看一段广告直接通行'],
      buttons: [
        {
          text: '回上一章',
          primary: true,
          onClick: () => {
            this.closeModal();
            this.chapterPage = prev;
            this.showLevels();
          },
        },
        {
          text: '看广告 通行',
          onClick: () =>
            this.runRewardedAd(
              () => {
                this.save.chapterPasses[String(prev)] = true;
                persist(this.save);
                this.showToast('通行成功，继续冒险！');
                this.closeModal();
                this.startLevel(id, true);
              },
              '要看完整段广告才能通行哦',
            ),
        },
      ],
    });
    return false;
  }

  private chapterStars(chapter: number): number {
    let n = 0;
    for (let i = (chapter - 1) * CHAPTER_SIZE + 1; i <= chapter * CHAPTER_SIZE; i++) {
      n += this.save.stars[i] ?? 0;
    }
    return n;
  }

  /** 点了还冻结着的箭：不扣分，节流提示规则。 */
  private onFrozenTap(_arrow: Arrow): void {
    if (this.clock - this.frozenToastAt < 3) return;
    this.frozenToastAt = this.clock;
    this.showToast('冰封的箭还不能飞，先清掉它旁边的两支箭');
    this.sfx.play('thud', 0.6);
  }

  private onCleared(arrow: Arrow): void {
    if (!this.running) return;
    this.sfx.play('pop', 0.9);
    if (this.hintId === arrow.id) this.hintId = null;

    const total = this.board?.total ?? 1;
    const remaining = this.board?.remaining ?? 0;
    this.drawProgress((total - remaining) / total);
    if (remaining === 0) this.win();
  }

  private onBlocked(arrow: Arrow, blocker: Arrow | null): void {
    if (!this.running) return;
    this.mistakes++;
    this.sfx.play('thud');
    if (this.save.haptics) Platform.vibrate();
    // 禅意关（规则书 §5）：撞墙只计星，不扣爱心、无失败。
    if (this.level && isZen(this.level.id)) {
      const zenName = blocker ? ARROW_NAMES[blocker.color % ARROW_NAMES.length] : '';
      this.showToast(blocker ? `被${zenName}色箭头挡住了（不影响爱心）` : '这支箭暂时飞不出去');
      void arrow;
      return;
    }
    this.hearts--;
    this.updateHearts();
    if (this.hearts <= 0) {
      this.lose('hearts');
      return;
    }
    const name = blocker
      ? blocker.isBoss
        ? '大 Boss'
        : ARROW_NAMES[blocker.color % ARROW_NAMES.length]
      : '';
    this.showToast(
      arrow.isBoss
        ? 'Boss 双倍宽：两条通道都要清空才能飞'
        : blocker
          ? blocker.isBoss
            ? '被大 Boss 挡住了！'
            : `被${name}色箭头挡住了`
          : '这支箭暂时飞不出去',
    );
    void arrow;
  }

  private useHint(): void {
    if (!this.running || this.paused || !this.level || !this.board) return;
    if (this.save.hints <= 0) {
      this.updateHintBadge();
      this.showHintModal();
      return;
    }
    const free = this.level.arrows.filter(
      (a) => this.board!.aliveIds.has(a.id) && this.board!.isPlayable(a),
    );
    if (!free.length) return;
    free.sort((a, b) => b.cells.length - a.cells.length);
    const pick = free.find((a) => a.id !== this.hintId) ?? free[0];
    this.save.hints -= 1;
    persist(this.save);
    this.updateHintBadge();
    this.hintId = pick.id;
    this.hintUntil = this.clock + 4.2;
    this.board.setHint(pick.id);
    this.sfx.play('coin');
  }

  private zoomBoard(factor: number): void {
    this.sfx.play('click');
    this.zoom = Math.max(0.65, Math.min(2.2, this.zoom * factor));
    if (this.zoomLabel) this.zoomLabel.string = `${Math.round(this.zoom * 100)}%`;
    if (this.boardNode) this.boardNode.setScale(this.zoom, this.zoom, 1);
  }

  private toggleSound(): void {
    this.save.sound = !this.save.sound;
    this.sfx.enabled = this.save.sound;
    persist(this.save);
    this.sfx.play('click');
    this.showToast(this.save.sound ? '音效已开启' : '音效已关闭');
  }

  private confirmRestart(): void {
    if (!this.running) return;
    this.paused = true;
    this.showModal({
      title: '重新开始？',
      lines: ['本关进度会清空，爱心恢复满'],
      buttons: [
        {
          text: '重新开始',
          primary: true,
          onClick: () => {
            this.closeModal();
            this.paused = false;
            this.startLevel(this.level ? this.level.id : 1);
          },
        },
        { text: '继续游戏', onClick: () => this.closeModal() },
      ],
    });
  }

  // ---------------------------------------------------------------- end states

  private win(): void {
    if (!this.level) return;
    this.running = false;
    if (this.board) this.board.inputEnabled = false;
    const id = this.level.id;

    // Boss 三连打：先过部件，最后一盘才结算（规则书 §5）。
    if (this.bossParts.length > 1 && this.bossIndex < this.bossParts.length - 1) {
      const cleared = this.bossIndex + 1;
      this.scheduleOnce(() => {
        this.showModal({
          title: `Boss ${cleared}/3 通过！`,
          lines: ['爱心会带进下一小关，稳住'],
          buttons: [
            {
              text: '下一小关',
              primary: true,
              onClick: () => {
                this.closeModal();
                this.enterPart(this.bossIndex + 1, false);
              },
            },
          ],
        });
      }, 0.6);
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
    this.sfx.play('win');

    const isLast = id >= LEVEL_COUNT;
    this.scheduleOnce(() => this.showWinModal(id, stars, isLast), 1.0);
  }

  /** 通关弹窗：未满星时提供「看广告 星数×2」激励位（规则书 §9 位 #4）。 */
  private showWinModal(id: number, stars: number, isLast: boolean): void {
    const buttons: ModalButton[] = [];
    if (stars < 3) {
      buttons.push({
        text: '看广告 星数×2',
        onClick: () => this.doubleStars(id, stars, isLast),
      });
    }
    buttons.push(
      isLast
        ? { text: '返回关卡', primary: true, onClick: () => this.showLevels() }
        : {
            text: '下一关',
            primary: true,
            onClick: () => this.startLevel(Math.min(LEVEL_COUNT, id + 1)),
          },
    );
    this.showModal({
      title: isLast ? '全部通关！' : '通关啦',
      lines: [
        stars === 3
          ? '完美！一次都没撞墙'
          : this.mistakes > 0
            ? `撞墙 ${this.mistakes} 次，再试一次冲击三星`
            : '漂亮，继续保持',
      ],
      stars,
      buttons,
    });
  }

  /** 双倍星：看完激励广告星星 ×2（上限 3 星）。 */
  private doubleStars(id: number, stars: number, isLast: boolean): void {
    this.runRewardedAd(
      () => {
        const doubled = Math.min(3, stars * 2);
        this.save.stars[id] = Math.max(this.save.stars[id] ?? 0, doubled);
        persist(this.save);
        this.sfx.play('coin');
        this.showToast(`星数翻倍，拿到 ${doubled} 星！`);
        this.closeModal();
        this.scheduleOnce(() => this.showWinModal(id, doubled, isLast), 0.35);
      },
      '要看完整段广告才能翻倍哦',
    );
  }

  private lose(reason: 'hearts' | 'time'): void {
    if (!this.running) return;
    this.running = false;
    if (this.board) this.board.inputEnabled = false;
    this.paused = false;
    this.sfx.play('lose');
    // 失败才真正扣体力（通关不扣）。复活成功会把这点退回（首次复活）。
    const spent = spendEnergy(this.save, Date.now());
    if (spent) {
      this.save.energy = spent.energy;
      this.save.energyAt = spent.energyAt;
      persist(this.save);
    }
    const id = this.level ? this.level.id : 1;
    // 复活递增（规则书 §10）：前 100 关限 1 次；之后第 2 次需连看 2 段广告。
    const maxRevives = id <= 100 ? 1 : 2;
    const canRevive = this.reviveCount < maxRevives;
    const buttons: ModalButton[] = [];
    if (canRevive) {
      buttons.push({
        text: this.reviveCount === 0 ? '看广告 复活' : '看 2 段广告 复活',
        primary: true,
        onClick: () => this.revive(reason),
      });
    }
    buttons.push(
      {
        text: '再试一次',
        onClick: () => this.restartCurrentPart(),
      },
      { text: '返回关卡', onClick: () => this.showLevels() },
    );
    this.scheduleOnce(() => {
      this.showModal({
        title: reason === 'time' ? '时间到' : '爱心用尽',
        lines: [
          canRevive
            ? reason === 'time'
              ? '别急，看段广告补足时间继续'
              : '每一次撞墙都会失去一颗爱心'
            : reason === 'time'
              ? '别急，先看清楚每一支箭的出口'
              : '每一次撞墙都会失去一颗爱心',
        ],
        buttons,
      });
    }, 0.4);
  }

  /** 重开当前盘面：Boss 连打从当前小关重来并回满爱心（规则书 §5）。 */
  private restartCurrentPart(): void {
    const id = this.level ? this.level.id : 1;
    this.closeModal();
    this.paused = false;
    this.reviveCount = 0;
    this.mistakes = this.mistakesBase;
    if (this.bossParts.length > 1) {
      this.enterPart(this.bossIndex, false, true);
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
      this.closeModal();
      this.reviveCount++;
      if (attempt === 0) {
        this.hearts = 3;
        if (reason === 'time') {
          this.timeLeft = Math.min(this.level ? this.level.timeLimit : 120, this.timeLeft + 60);
        } else {
          this.timeLeft = Math.max(this.timeLeft, 30);
        }
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
      this.updateEnergyPill();
      if (this.board) this.board.inputEnabled = true;
      this.updateHearts();
      this.updateTimer();
      this.sfx.play('coin');
      this.showToast(attempt === 0 ? '满血复活，继续！' : '复活成功，稳住这波！');
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
    this.showModal({
      title: '暂停',
      buttons: [
        { text: '继续游戏', primary: true, onClick: () => this.closeModal() },
        {
          text: '重来',
          onClick: () => {
            this.closeModal();
            this.paused = false;
            this.startLevel(this.level ? this.level.id : 1);
          },
        },
        { text: '返回首页', onClick: () => this.showHome() },
      ],
    });
  }

  // ---------------------------------------------------------------- modals

  private closeModal(): void {
    if (!this.overlay) return;
    this.overlay.removeAllChildren();
    this.overlay.active = false;
    if (this.running) this.paused = false;
  }

  private showModal(opts: ModalOptions): Node | null {
    if (!this.overlay) return null;
    this.overlay.active = true;
    this.overlay.removeAllChildren();

    const dim = newNode('dim', this.overlay);
    setSize(dim, this.W, this.H);
    const dg = dim.addComponent(Graphics);
    dg.fillColor = C.dim;
    dg.rect(-this.W / 2, -this.H / 2, this.W, this.H);
    dg.fill();
    dim.on(Node.EventType.TOUCH_START, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });
    dim.on(Node.EventType.TOUCH_END, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });

    const panelW = Math.min(this.W - 70, 620);
    const lines = opts.lines ?? [];
    const buttons = opts.buttons ?? [];
    let contentH = 40 + 86;
    contentH += lines.length * 44;
    if (opts.stars !== undefined) contentH += 128;
    contentH += opts.extraHeight ?? 0;
    contentH += 24;
    const buttonsH = buttons.length * 100;
    const panelH = contentH + buttonsH + 30;

    const panel = makePanel(this.overlay, panelW, panelH, {
      radius: 40,
      fill: C.white,
      shadow: new Color(6, 30, 50, 70),
      shadowOffset: 14,
    });
    panel.on(Node.EventType.TOUCH_START, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });
    panel.on(Node.EventType.TOUCH_END, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });

    let y = panelH / 2 - 62;
    const title = makeLabel(panel, opts.title, FONT.h1, C.ink, {
      width: panelW - 60,
      height: 72,
    });
    title.node.setPosition(0, y, 0);
    y -= 86;

    for (const line of lines) {
      makeLabel(panel, line, 26, C.inkSoft, {
        width: panelW - 60,
        height: 40,
      }).node.setPosition(0, y, 0);
      y -= 44;
    }

    if (opts.stars !== undefined) {
      for (let i = 0; i < 3; i++) {
        const frame = Assets.frame(i < opts.stars ? 'star' : 'star-empty');
        if (!frame) continue;
        const sp = makeSprite(panel, frame, 104, 104);
        sp.node.setPosition((i - 1) * 120, y - 48, 0);
        sp.node.setScale(0.3, 0.3, 1);
        tween(sp.node)
          .delay(0.12 + i * 0.15)
          .to(0.3, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
          .start();
      }
      y -= 128;
    }

    if (opts.content) opts.content(panel, y);

    let by = -panelH / 2 + 26 + (buttons.length - 1) * 100 + 44;
    for (const btn of buttons) {
      const b = makeButton(panel, {
        w: panelW - 80,
        h: 84,
        radius: 26,
        fill: btn.primary ? C.blue : new Color(238, 244, 249, 255),
        fillTop: btn.primary ? new Color(255, 255, 255, 40) : undefined,
        shadow: btn.primary ? C.blueDark : new Color(216, 228, 238, 255),
        shadowOffset: 7,
        text: btn.text,
        textSize: btn.primary ? 38 : 32,
        textColor: btn.primary ? C.white : C.inkSoft,
        onClick: () => {
          this.sfx.play('click');
          btn.onClick();
        },
      });
      b.node.setPosition(0, by, 0);
      by -= 100;
    }

    popIn(panel, 0.02);
    return panel;
  }

  private showHowto(): void {
    const wasRunning = this.running;
    if (wasRunning) this.paused = true;
    this.showModal({
      title: '怎么玩',
      lines: [
        '1. 点一支箭，它会朝箭头方向飞出去',
        '2. 前方被别的箭挡住就会撞墙，扣一颗爱心',
        '3. 把棋盘清空即可过关，撞墙越少星星越多',
        '4. 冰封的箭不能飞：先清掉它旁边两支箭',
      ],
      extraHeight: 30,
      content: (panel, topY) => {
        const tip = makePanel(panel, 520, 68, {
          radius: 22,
          fill: new Color(255, 248, 227, 255),
        });
        tip.setPosition(0, topY - 20, 0);
        makeIcon(tip, 'bulb', 36).setPosition(-210, 0, 0);
        makeLabel(tip, '卡住了？用提示高亮一支能飞的箭', 22, new Color(150, 100, 20, 255), {
          width: 420,
          height: 50,
        }).node.setPosition(20, 0, 0);
      },
      buttons: [
        {
          text: '知道了',
          primary: true,
          onClick: () => {
            this.closeModal();
            if (wasRunning) this.paused = false;
          },
        },
      ],
    });
  }

  private showSettings(): void {
    const wasRunning = this.running;
    if (wasRunning) this.paused = true;

    const buildToggle = (panel: Node, y: number, isOn: boolean, onToggle: () => boolean) => {
      const b = makeButton(panel, {
        w: 120,
        h: 56,
        radius: 28,
        fill: isOn ? C.green : new Color(219, 230, 238, 255),
        text: isOn ? '开' : '关',
        textSize: 26,
        textColor: C.white,
        onClick: () => {
          const next = onToggle();
          b.setText(next ? '开' : '关');
          const g = b.node.getComponent(Graphics);
          if (g) {
            g.clear();
            g.fillColor = next ? C.green : new Color(219, 230, 238, 255);
            g.roundRect(-60, -28, 120, 56, 28);
            g.fill();
          }
        },
      });
      b.node.setPosition(0, y, 0);
      return b;
    };

    const panel = this.showModal({
      title: '设置',
      extraHeight: 190,
      content: (p, topY) => {
        const panelW = Math.min(this.W - 70, 620);
        const rows = [
          { text: '音效', on: this.save.sound },
          { text: '震动反馈', on: this.save.haptics },
        ];
        rows.forEach((row, i) => {
          const y = topY - 30 - i * 88;
          makeLabel(p, row.text, 30, C.ink, { width: 300, height: 50, align: 0 }).node.setPosition(
            -panelW / 2 + 160,
            y,
            0,
          );
          buildToggle(p, y, row.on, () => {
            if (i === 0) {
              this.save.sound = !this.save.sound;
              this.sfx.enabled = this.save.sound;
              persist(this.save);
              this.sfx.play('click');
              return this.save.sound;
            }
            this.save.haptics = !this.save.haptics;
            persist(this.save);
            return this.save.haptics;
          }).node.setPosition(panelW / 2 - 170, y, 0);
        });

        makeLabel(p, `已解锁 ${this.save.unlocked} / ${LEVEL_COUNT} 关 · ${totalStars(this.save)} 星`, 22, C.inkSoft, {
          width: 520,
          height: 40,
        }).node.setPosition(0, topY - 192, 0);
      },
      buttons: [
        { text: '完成', primary: true, onClick: () => {
          this.closeModal();
          if (wasRunning) this.paused = false;
        } },
      ],
    });
    void panel;
  }

  /** 提示次数用完：看一段激励广告补充 HINTS_PER_AD 次。 */
  private showHintModal(): void {
    this.paused = true;
    this.showModal({
      title: '提示用完了',
      lines: [`看一段广告，立即补充 ${HINTS_PER_AD} 次提示`],
      extraHeight: 110,
      content: (panel, topY) => {
        const pill = makePanel(panel, 300, 88, {
          radius: 44,
          fill: new Color(255, 248, 227, 255),
        });
        pill.setPosition(0, topY - 44, 0);
        makeIcon(pill, 'bulb', 48).setPosition(-66, 0, 0);
        makeLabel(pill, `剩余 ${this.save.hints} 次`, 32, new Color(168, 107, 0, 255), {
          width: 190,
          height: 64,
        }).node.setPosition(34, 0, 0);
      },
      buttons: [
        {
          text: `看广告 +${HINTS_PER_AD} 次`,
          primary: true,
          onClick: () => {
            this.runRewardedAd(() => {
              this.save.hints += HINTS_PER_AD;
              persist(this.save);
              this.updateHintBadge();
              this.closeModal();
              this.sfx.play('coin');
              this.showToast(`+${HINTS_PER_AD} 次提示`);
            });
          },
        },
        {
          text: '先不用',
          onClick: () => this.closeModal(),
        },
      ],
    });
  }

  // ---------------------------------------------------------------- energy & ads

  /** 统一入口：优先真实激励视频（微信小游戏），否则播演示广告；看完才发奖励。 */
  private runRewardedAd(onReward: () => void, cancelMsg = '要看完整段广告才能领取哦'): void {
    if (this.adPlaying) return;
    this.adPlaying = true;
    const finish = (rewarded: boolean): void => {
      this.adPlaying = false;
      if (rewarded) onReward();
      else this.showToast(cancelMsg);
    };
    if (Platform.showRewardedAd((rewarded) => finish(rewarded))) return;
    this.showSimulatedAd((rewarded) => finish(rewarded));
  }

  /** 体力弹窗：blocked = 因体力不足被拦下时弹出。 */
  private showEnergyModal(blocked: boolean): void {
    const wasRunning = this.running;
    if (wasRunning) this.paused = true;
    this.updateEnergyPill();
    const full = this.save.energy >= ENERGY_MAX;
    const next = energyNextInMs(this.save, Date.now());
    const regenMin = Math.round(ENERGY_REGEN_MS / 60000);
    this.showModal({
      title: blocked ? '体力不足' : '体力',
      lines: [
        full
          ? `体力已满（${ENERGY_MAX}/${ENERGY_MAX}）`
          : `每 ${regenMin} 分钟恢复 1 点 · 下 1 点还有 ${formatEnergyClock(next)}`,
        '通关不扣体力，失败一关扣 1 点',
      ],
      extraHeight: 120,
      content: (panel, topY) => {
        const pill = makePanel(panel, 300, 88, {
          radius: 44,
          fill: new Color(255, 248, 227, 255),
        });
        pill.setPosition(0, topY - 44, 0);
        makeIcon(pill, 'bolt', 48).setPosition(-66, 0, 0);
        makeLabel(pill, `${this.save.energy} / ${ENERGY_MAX}`, 38, new Color(168, 107, 0, 255), {
          width: 170,
          height: 64,
        }).node.setPosition(34, 0, 0);
      },
      buttons: [
        {
          text: full ? '体力已满' : '看广告 +1 体力',
          primary: true,
          onClick: () => {
            if (this.save.energy >= ENERGY_MAX) return;
            this.runRewardedAd(
              () => {
                const granted = grantEnergy(this.save, Date.now());
                this.save.energy = granted.energy;
                this.save.energyAt = granted.energyAt;
                persist(this.save);
                this.updateEnergyPill();
                this.closeModal();
                this.sfx.play('coin');
                this.showToast('+1 体力，出发！');
              },
              '要看完整段广告才能获得体力哦',
            );
          },
        },
        {
          text: blocked ? '稍后再来' : '知道了',
          onClick: () => this.closeModal(),
        },
      ],
    });
  }

  /** 没有真实广告 SDK 时的演示激励视频：倒计时看完才能领奖励。 */
  private showSimulatedAd(onEnd: (rewarded: boolean) => void): void {
    if (!this.adLayer) {
      this.adLayer = newNode('ad-layer', this.node);
      setSize(this.adLayer, this.W, this.H);
    }
    const layer = this.adLayer;
    layer.active = true;
    layer.removeAllChildren();

    const dim = newNode('dim', layer);
    setSize(dim, this.W, this.H);
    const dg = dim.addComponent(Graphics);
    dg.fillColor = new Color(12, 26, 40, 235);
    dg.rect(-this.W / 2, -this.H / 2, this.W, this.H);
    dg.fill();
    dim.on(Node.EventType.TOUCH_START, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });
    dim.on(Node.EventType.TOUCH_END, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });

    const panel = makePanel(layer, 560, 660, {
      radius: 40,
      fill: C.white,
      shadow: new Color(6, 30, 50, 70),
      shadowOffset: 14,
    });
    panel.on(Node.EventType.TOUCH_START, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });
    panel.on(Node.EventType.TOUCH_END, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });

    makeLabel(panel, '广告 · 演示', 28, C.inkSoft, { width: 400, height: 44 }).node.setPosition(
      0,
      250,
      0,
    );
    const ring = makePanel(panel, 128, 128, { radius: 64, fill: new Color(238, 244, 249, 255) });
    ring.setPosition(0, 130, 0);
    const countLabel = makeLabel(ring, '5', 52, C.ink, { width: 128, height: 128 });
    countLabel.node.setPosition(0, 0, 0);
    makeLabel(panel, '观看完整段广告即可领取奖励\n提前关闭将无法获得奖励', 26, C.inkSoft, {
      width: 460,
      height: 80,
    }).node.setPosition(0, -20, 0);

    let left = 5;
    let ready = false;
    let rewarded = false;
    let done = false;

    const close = (): void => {
      if (done) return;
      done = true;
      this.unschedule(tick);
      layer.active = false;
      layer.removeAllChildren();
      onEnd(rewarded);
    };

    const rewardBtn = makeButton(panel, {
      w: 340,
      h: 88,
      radius: 26,
      fill: C.green,
      shadow: new Color(46, 158, 85, 255),
      shadowOffset: 7,
      text: '5 秒后可领取',
      textSize: 32,
      onClick: () => {
        if (ready) {
          rewarded = true;
          close();
        }
      },
    });
    rewardBtn.node.setPosition(0, -180, 0);
    rewardBtn.setEnabled(false);

    const closeBtn = makeButton(panel, {
      w: 88,
      h: 88,
      radius: 26,
      fill: new Color(238, 244, 249, 255),
      icon: 'close',
      iconSize: 40,
      onClick: () => close(),
    });
    closeBtn.node.setPosition(0, -290, 0);

    const tick = (): void => {
      left--;
      if (left > 0) {
        countLabel.string = String(left);
        rewardBtn.setText(`${left} 秒后可领取`);
        this.scheduleOnce(tick, 1);
      } else {
        ready = true;
        countLabel.string = '✓';
        rewardBtn.setText('领取奖励');
        rewardBtn.setEnabled(true);
      }
    };

    this.scheduleOnce(tick, 1);
    popIn(panel, 0.02);
  }
}