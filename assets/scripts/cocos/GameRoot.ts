import {
  _decorator,
  Camera,
  Color,
  Component,
  Graphics,
  Label,
  Node,
  ResolutionPolicy,
  Sprite,
  UITransform,
  Vec2,
  Vec3,
  view,
  tween,
  UIOpacity,
} from 'cc';
import {
  BONUS_CHALLENGE_ID,
  CHAPTER_COUNT,
  CHAPTER_SIZE,
  LEVEL_COUNT,
  chapterOf,
  getLevelParts,
  isChallenge,
  isMajorPicture,
  isMinorPicture,
  isSprint,
  isZen,
  stepOf,
  worldOf,
} from '../core/levels';
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
} from '../core/energy';
import { Arrow, Level } from '../core/types';
import { Assets } from './Assets';
import { BoardView } from './BoardView';
import { I18n, Lang } from './I18n';
import { loadSave, persist, SaveData, totalStars } from './SaveStore';
import { Sfx } from './Sfx';
import { BTN_STYLES, ButtonStyleName, C, WORLD_THEMES } from './Theme';
import {
  bump,
  makeBadge,
  makeButton,
  makeIcon,
  makeLabel,
  makePanel,
  makeRibbon,
  makeSprite,
  newNode,
  popIn,
  pulseIdle,
  setOpacity,
  setSize,
} from './UIKit';
import { Platform } from './Platform';

const { ccclass } = _decorator;

/** Hints granted per rewarded ad. */
const HINTS_PER_AD = 1;

type RibbonTone = 'blue' | 'gold' | 'red' | 'green' | 'purple';

interface ModalButton {
  text: string;
  style?: ButtonStyleName;
  primary?: boolean;
  icon?: string;
  onClick: () => void;
}

interface ModalOptions {
  title: string;
  tone?: RibbonTone;
  lines?: string[];
  stars?: number;
  extraHeight?: number;
  content?: (panel: Node, topY: number) => void;
  buttons?: ModalButton[];
  rowButtons?: ModalButton[];
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
  private chapterHeader: Node | null = null;
  private overlay: Node | null = null;
  private adLayer: Node | null = null;
  private toast: Node | null = null;
  private toastLabel: Label | null = null;

  private board: BoardView | null = null;
  private boardNode: Node | null = null;
  private boardMat: Node | null = null;

  private hudLevel: Label | null = null;
  private modeBadgeWrap: Node | null = null;
  private timerLabel: Label | null = null;
  private timerNode: Node | null = null;
  private heartsContainer: Node | null = null;
  private heartNodes: Node[] = [];
  private progressGfx: Graphics | null = null;
  private progressLabel: Label | null = null;
  private progressW = 470;
  private hintBadge: Label | null = null;
  private hintBadgeBg: Graphics | null = null;
  private zoomLabel: Label | null = null;
  private zoom = 1;

  private homeChip: Label | null = null;
  private homeWorldLabel: Label | null = null;
  private homeWorldBg: Graphics | null = null;
  private homeStarLabel: Label | null = null;
  private levelsTotal: Label | null = null;

  private level: Level | null = null;
  private hearts = 3;
  private heartMax = 3;
  private timeLeft = 0;
  private mistakes = 0;
  private running = false;
  private paused = false;
  private adPlaying = false;
  private energyLabel: Label | null = null;
  private energyNextBadge: Node | null = null;
  private energyNextLabel: Label | null = null;
  private energyTick = 0;
  private hintId: number | null = null;
  private hintUntil = 0;
  private clock = 0;

  private bossParts: Level[] = [];
  private bossIndex = 0;
  private reviveCount = 0;
  private mistakesBase = 0;
  private chapterPage = 1;

  // ---------------------------------------------------------------- helpers

  private worldTitle(wIdx: number): string {
    const wt = WORLD_THEMES[Math.max(0, Math.min(WORLD_THEMES.length - 1, wIdx))];
    return I18n.lang === 'zh' ? wt.zhName : wt.enName;
  }

  private formatLevelTitle(id: number): string {
    return isChallenge(id) ? I18n.t('tower1000') : I18n.t('levelN', { n: id });
  }

  // ---------------------------------------------------------------- lifecycle

  protected onLoad(): void {
    view.setDesignResolutionSize(720, 1280, ResolutionPolicy.FIXED_WIDTH);
    const size = view.getVisibleSize();
    this.W = size.width;
    this.H = size.height;
    setSize(this.node, this.W, this.H);

    const canvasNode = this.node.parent;
    if (canvasNode) {
      setSize(canvasNode, this.W, this.H);
      const camNode = canvasNode.getChildByName('Camera');
      const cam = camNode?.getComponent(Camera);
      if (cam) {
        cam.projection = Camera.ProjectionType.ORTHO;
        cam.orthoHeight = this.H / 2;
        camNode?.setPosition(0, 0, 1000);
      }
    }

    this.save = loadSave();
    I18n.setLang(this.save.lang);
    this.sfx.enabled = this.save.sound;
    this.sfx.attach(this.node);

    const loading = makeLabel(this.node, I18n.t('loading'), 32, C.white, {
      name: 'loading',
      outlineColor: C.royalDark,
      outlineWidth: 3,
    });

    void Assets.preload().then(() => {
      loading.node.destroy();
      this.buildAll();
      this.showHome();
    });
  }

  private buildAll(): void {
    this.buildBackground();
    this.buildScreens();
  }

  private buildScreens(): void {
    this.home?.destroy();
    this.game?.destroy();
    this.levels?.destroy();
    this.overlay?.destroy();
    this.toast?.destroy();
    this.home = null;
    this.game = null;
    this.levels = null;
    this.overlay = null;
    this.toast = null;

    this.buildHome();
    this.buildGame();
    this.buildLevels();
    this.buildOverlay();
    this.buildToast();
  }

  private switchLanguage(nextLang: Lang): void {
    this.save.lang = nextLang;
    I18n.setLang(nextLang);
    persist(this.save);
    this.buildScreens();
    this.showHome();
    this.showSettings();
  }

  protected update(dt: number): void {
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
    const bgFrame = Assets.frame('bg');
    if (bgFrame) {
      const aspect = 720 / 1560;
      const drawW = Math.max(this.W, this.H * aspect);
      const drawH = Math.max(this.H, this.W / aspect);
      makeSprite(n, bgFrame, drawW, drawH, 'bg-sprite');
    } else {
      const g = n.addComponent(Graphics);
      g.fillColor = C.skyMid;
      g.rect(-this.W / 2, -this.H / 2, this.W, this.H);
      g.fill();
    }
  }

  // ---------------------------------------------------------------- home

  private buildHome(): void {
    const home = newNode('home', this.node);
    setSize(home, this.W, this.H);
    this.home = home;

    const top = this.H / 2;
    const bot = -this.H / 2;

    const topY = top - 78;

    const gear = makeButton(home, {
      w: 84,
      h: 84,
      radius: 26,
      style: 'blue',
      shadowOffset: 7,
      icon: 'gear',
      iconSize: 46,
      onClick: () => {
        this.sfx.play('click');
        this.showSettings();
      },
    });
    gear.node.setPosition(-this.W / 2 + 68, topY, 0);

    // Star total pill
    const starPill = makePanel(home, 174, 64, {
      radius: 32,
      fill: C.cream,
      bevel: C.boardFrameDark,
      bevelHeight: 5,
      border: C.white,
      borderWidth: 3.5,
      shadow: new Color(10, 32, 68, 60),
      shadowOffset: 9,
    });
    starPill.setPosition(this.W / 2 - 318, topY, 0);
    makeIcon(starPill, 'star', 42).setPosition(-54, 1, 0);
    this.homeStarLabel = makeLabel(starPill, '0', 30, C.goldText, {
      width: 100,
      height: 44,
    });
    this.homeStarLabel.node.setPosition(20, 1, 0);

    // Energy pill
    const energyPill = makePanel(home, 188, 64, {
      radius: 32,
      fill: C.cream,
      bevel: C.boardFrameDark,
      bevelHeight: 5,
      border: C.white,
      borderWidth: 3.5,
      shadow: new Color(10, 32, 68, 60),
      shadowOffset: 9,
    });
    energyPill.setPosition(this.W / 2 - 120, topY, 0);
    makeIcon(energyPill, 'bolt', 42).setPosition(-58, 1, 0);
    this.energyLabel = makeLabel(energyPill, `${ENERGY_MAX}/${ENERGY_MAX}`, 29, C.ink, {
      width: 108,
      height: 44,
    });
    this.energyLabel.node.setPosition(16, 1, 0);
    energyPill.on(Node.EventType.TOUCH_START, () => energyPill.setScale(0.96, 0.94, 1));
    energyPill.on(Node.EventType.TOUCH_END, () => {
      energyPill.setScale(1, 1, 1);
      this.sfx.play('click');
      this.showEnergyModal(false);
    });
    energyPill.on(Node.EventType.TOUCH_CANCEL, () => energyPill.setScale(1, 1, 1));

    const nextBadge = makeBadge(home, '', C.royalDark, C.goldLight, 118, 30, 18, C.royalRim);
    nextBadge.node.setPosition(this.W / 2 - 120, topY - 48, 0);
    nextBadge.node.active = false;
    this.energyNextBadge = nextBadge.node;
    this.energyNextLabel = nextBadge.label;

    // 3D Western-Casual Game Logo (English default, switches to logo-zh in Chinese)
    const isZh = I18n.lang === 'zh';
    const logoFrame = Assets.frame(isZh ? 'logo-zh' : 'logo') ?? Assets.frame('logo');
    const logoW = Math.min(640, this.W * 0.9);
    const logoH = logoW * (isZh ? 320 / 980 : 360 / 980);
    if (logoFrame) {
      const logo = makeSprite(home, logoFrame, logoW, logoH, 'logo');
      const ly = top - this.H * 0.2;
      logo.node.setPosition(0, ly, 0);
      tween(logo.node)
        .repeatForever(
          tween(logo.node)
            .to(2.1, { position: new Vec3(0, ly + 8, 0) }, { easing: 'sineInOut' })
            .to(2.1, { position: new Vec3(0, ly, 0) }, { easing: 'sineInOut' }),
        )
        .start();
    }

    // Glowing sunlit pedestal stage behind hero mascot
    const heroY = top - this.H * 0.455;
    const stageNode = newNode('hero-stage', home);
    stageNode.setPosition(0, heroY, 0);
    const sg = stageNode.addComponent(Graphics);
    sg.fillColor = new Color(255, 255, 255, 42);
    sg.circle(0, 0, 192);
    sg.fill();
    sg.fillColor = new Color(255, 252, 232, 85);
    sg.circle(0, 0, 148);
    sg.fill();
    sg.strokeColor = new Color(255, 232, 130, 165);
    sg.lineWidth = 5;
    sg.circle(0, 0, 148);
    sg.stroke();

    const mascotFrame = Assets.frame('mascot');
    if (mascotFrame) {
      const mw = Math.min(416, this.W * 0.6);
      const mascot = makeSprite(home, mascotFrame, mw, mw * (580 / 640), 'mascot');
      mascot.node.setPosition(0, heroY + 6, 0);
      tween(mascot.node)
        .repeatForever(
          tween(mascot.node)
            .to(1.65, { position: new Vec3(0, heroY + 22, 0), scale: new Vec3(1.03, 0.98, 1) }, { easing: 'sineInOut' })
            .to(1.65, { position: new Vec3(0, heroY + 4, 0), scale: new Vec3(0.99, 1.02, 1) }, { easing: 'sineInOut' }),
        )
        .start();
    }

    // World & Next Level indicator pill
    const chipY = top - this.H * 0.66;
    const worldPill = newNode('home-world-pill', home);
    setSize(worldPill, 420, 56);
    worldPill.setPosition(0, chipY, 0);
    this.homeWorldBg = worldPill.addComponent(Graphics);
    this.homeWorldLabel = makeLabel(worldPill, this.worldTitle(0), 21, C.white, {
      width: 220,
      height: 40,
      outlineColor: C.royalDark,
      outlineWidth: 3,
    });
    this.homeWorldLabel.node.setPosition(-88, 1, 0);

    const lvPill = makePanel(worldPill, 164, 44, {
      radius: 22,
      fill: C.cream,
      border: C.white,
      borderWidth: 2,
    });
    lvPill.setPosition(116, 1, 0);
    this.homeChip = makeLabel(lvPill, this.formatLevelTitle(1), 24, C.ink, { width: 154, height: 40 });
    this.homeChip.node.setPosition(0, 1, 0);

    // Giant Juicy Emerald 3D Play CTA
    const play = makeButton(home, {
      w: Math.min(580, this.W * 0.82),
      h: 118,
      radius: 36,
      style: 'green',
      shadowOffset: 10,
      text: I18n.t('play'),
      textSize: 50,
      icon: 'play',
      iconSize: 50,
      onClick: () => {
        this.sfx.play('click');
        this.startLevel(Math.min(this.save.unlocked, LEVEL_COUNT), true);
      },
    });
    play.node.setPosition(0, top - this.H * 0.758, 0);
    pulseIdle(play.node, 0.026, 1.8);

    // Bottom 3-button Western casual action dock
    const navY = bot + this.H * 0.118;
    const navs: { icon: string; text: string; style: ButtonStyleName; onClick: () => void }[] = [
      { icon: 'levels', text: I18n.t('levels'), style: 'blue', onClick: () => this.showLevels() },
      {
        icon: 'star',
        text: I18n.t('challenge'),
        style: 'purple',
        onClick: () => this.startLevel(BONUS_CHALLENGE_ID, true),
      },
      { icon: 'help', text: I18n.t('howToPlay'), style: 'gold', onClick: () => this.showHowto() },
    ];
    navs.forEach((item, i) => {
      const x = (i - 1) * 196;
      const b = makeButton(home, {
        w: 166,
        h: 112,
        radius: 28,
        style: item.style,
        shadowOffset: 8,
        icon: item.icon,
        iconSize: 48,
        onClick: () => {
          this.sfx.play('click');
          item.onClick();
        },
      });
      b.node.setPosition(x, navY, 0);
      if (b.icon) b.icon.setPosition(0, 16, 0);
      makeLabel(b.node, item.text, 20, C.white, {
        width: 158,
        height: 30,
        outlineColor: BTN_STYLES[item.style].outline,
        outlineWidth: 3,
      }).node.setPosition(0, -30, 0);
    });

    makeLabel(home, 'v1.0', 18, new Color(255, 255, 255, 165), {
      width: 200,
      height: 24,
      display: false,
    }).node.setPosition(0, bot + 24, 0);
  }

  private paintHomeWorldPill(levelId: number): void {
    const g = this.homeWorldBg;
    if (!g) return;
    const wIdx = Math.max(0, Math.min(WORLD_THEMES.length - 1, worldOf(levelId) - 1));
    const theme = WORLD_THEMES[wIdx];
    const w = 420;
    const h = 56;
    const r = h / 2 - 1;
    g.clear();
    g.fillColor = new Color(10, 30, 62, 65);
    g.roundRect(-w / 2, -h / 2 - 5, w, h, r);
    g.fill();
    g.fillColor = theme.bannerDark;
    g.roundRect(-w / 2, -h / 2 - 3, w, h, r);
    g.fill();
    g.fillColor = theme.banner;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.fill();
    g.lineWidth = 3;
    g.strokeColor = C.white;
    g.roundRect(-w / 2, -h / 2, w, h, r);
    g.stroke();

    if (this.homeWorldLabel) {
      this.homeWorldLabel.string = this.worldTitle(wIdx);
      this.homeWorldLabel.outlineColor = theme.bannerDark;
    }
  }

  // ---------------------------------------------------------------- game screen

  private buildGame(): void {
    const game = newNode('game', this.node);
    setSize(game, this.W, this.H);
    this.game = game;

    const top = this.H / 2;
    const bot = -this.H / 2;

    // Top Royal-Blue Glossy Header Dock
    const headerH = 212;
    const header = newNode('hud-dock', game);
    header.setPosition(0, top - headerH / 2, 0);
    const hg = header.addComponent(Graphics);
    hg.fillColor = new Color(8, 28, 60, 82);
    hg.roundRect(-this.W / 2 - 6, -headerH / 2 - 12, this.W + 12, headerH + 28, 34);
    hg.fill();
    hg.fillColor = C.royalDark;
    hg.roundRect(-this.W / 2 - 4, -headerH / 2 - 6, this.W + 8, headerH + 28, 34);
    hg.fill();
    hg.fillColor = C.royal;
    hg.roundRect(-this.W / 2 - 4, -headerH / 2, this.W + 8, headerH + 28, 32);
    hg.fill();
    hg.fillColor = C.royalTop;
    hg.rect(-this.W / 2, 10, this.W, headerH / 2 + 10);
    hg.fill();
    hg.lineWidth = 3.5;
    hg.strokeColor = C.royalRim;
    hg.roundRect(-this.W / 2 - 4, -headerH / 2, this.W + 8, headerH + 28, 32);
    hg.stroke();

    // Pause button (top-left)
    const pause = makeButton(game, {
      w: 78,
      h: 78,
      radius: 24,
      style: 'blue',
      shadowOffset: 6,
      icon: 'pause',
      iconSize: 38,
      onClick: () => {
        this.sfx.play('click');
        this.showPause();
      },
    });
    pause.node.setPosition(-this.W / 2 + 64, top - 64, 0);

    // Level Title (top-center)
    this.hudLevel = makeLabel(game, this.formatLevelTitle(1), 40, C.white, {
      width: 300,
      height: 56,
      outlineColor: C.royalDark,
      outlineWidth: 4,
      shadowColor: new Color(0, 0, 0, 75),
      shadowOffset: new Vec2(0, -3),
    });
    this.hudLevel.node.setPosition(-12, top - 58, 0);

    // Mode / World pill badge (top-right)
    this.modeBadgeWrap = newNode('mode-badge', game);
    this.modeBadgeWrap.setPosition(this.W / 2 - 104, top - 62, 0);

    // Row 2: Hearts tray + Clock timer pill
    const row2Y = top - 122;
    this.heartsContainer = newNode('hearts-box', game);
    this.heartsContainer.setPosition(-122, row2Y, 0);
    this.rebuildHeartIcons(3);

    const timerPill = makePanel(game, 174, 46, {
      radius: 23,
      fill: C.royalDark,
      border: C.royalRim,
      borderWidth: 2.5,
    });
    timerPill.setPosition(128, row2Y, 0);
    makeIcon(timerPill, 'clock', 34).setPosition(-58, 0, 0);
    this.timerLabel = makeLabel(timerPill, '02:00', 26, C.white, {
      width: 102,
      height: 36,
      outlineColor: new Color(8, 24, 54, 255),
      outlineWidth: 2,
    });
    this.timerLabel.node.setPosition(18, 0, 0);
    this.timerNode = timerPill;

    // Row 3: Progress Bar + cleared count
    const barY = top - 178;
    const barW = Math.min(this.W - 210, 480);
    this.progressW = barW;
    const barTrack = makePanel(game, barW + 8, 26, {
      radius: 13,
      fill: C.royalDark,
      border: new Color(115, 200, 255, 160),
      borderWidth: 2,
    });
    barTrack.setPosition(-46, barY, 0);
    const fill = newNode('fill', barTrack);
    setSize(fill, barW, 18);
    this.progressGfx = fill.addComponent(Graphics);
    this.drawProgress(0);

    this.progressLabel = makeLabel(game, '0/0', 22, C.goldLight, {
      width: 108,
      height: 32,
      outlineColor: C.royalDark,
      outlineWidth: 2,
    });
    this.progressLabel.node.setPosition(barW / 2 + 16, barY, 0);

    // Framed Warm-Cream Puzzle Stage Mat
    this.boardMat = newNode('board-mat', game);
    this.boardNode = newNode('board', game);
    this.board = this.boardNode.addComponent(BoardView);
    this.board.onArrowCleared = (arrow) => this.onCleared(arrow);
    this.board.onArrowBlocked = (arrow, blocker) => this.onBlocked(arrow, blocker);

    // Bottom Floating Glossy Control Dock
    const dockY = bot + 86;
    const dockW = Math.min(this.W - 36, 672);
    const dock = makePanel(game, dockW, 122, {
      radius: 36,
      fill: C.cream,
      bevel: C.boardFrameDark,
      bevelHeight: 8,
      border: C.white,
      borderWidth: 4,
      shadow: new Color(10, 32, 68, 72),
      shadowOffset: 14,
    });
    dock.setPosition(0, dockY, 0);

    // Hint Button (Gold 3D)
    const hintBtn = makeButton(dock, {
      w: 158,
      h: 84,
      radius: 26,
      style: 'gold',
      shadowOffset: 7,
      icon: 'bulb',
      iconSize: 38,
      text: I18n.t('hint'),
      textSize: 26,
      onClick: () => {
        this.sfx.play('click');
        this.useHint();
      },
    });
    hintBtn.node.setPosition(-dockW / 2 + 100, 2, 0);

    const badgeNode = newNode('hint-badge', hintBtn.node);
    badgeNode.setPosition(70, 36, 0);
    this.hintBadgeBg = badgeNode.addComponent(Graphics);
    this.hintBadge = makeLabel(badgeNode, '3', 22, C.white, {
      width: 54,
      height: 36,
      outlineColor: new Color(90, 20, 15, 255),
      outlineWidth: 2,
    });
    this.hintBadge.node.setPosition(0, 1, 0);

    // Center Zoom Capsule
    const zoomWrap = makePanel(dock, 240, 78, {
      radius: 39,
      fill: C.boardFrame,
      border: C.white,
      borderWidth: 2.5,
    });
    zoomWrap.setPosition(0, 0, 0);

    const zoomMinus = makeButton(zoomWrap, {
      w: 60,
      h: 60,
      radius: 30,
      style: 'cream',
      shadowOffset: 4,
      text: '−',
      textSize: 38,
      systemFont: true,
      onClick: () => this.zoomBoard(0.86),
    });
    zoomMinus.node.setPosition(-80, 2, 0);

    const zoomReset = newNode('zoom-reset', zoomWrap);
    setSize(zoomReset, 90, 54);
    this.zoomLabel = makeLabel(zoomReset, '100%', 23, C.ink, {
      width: 90,
      height: 34,
      display: false,
      bold: true,
    });
    zoomReset.on(Node.EventType.TOUCH_END, () => this.resetZoom());

    const zoomPlus = makeButton(zoomWrap, {
      w: 60,
      h: 60,
      radius: 30,
      style: 'cream',
      shadowOffset: 4,
      text: '+',
      textSize: 36,
      systemFont: true,
      onClick: () => this.zoomBoard(1.16),
    });
    zoomPlus.node.setPosition(80, 2, 0);

    // Restart Button (Blue 3D)
    const restartBtn = makeButton(dock, {
      w: 158,
      h: 84,
      radius: 26,
      style: 'blue',
      shadowOffset: 7,
      icon: 'restart',
      iconSize: 34,
      text: I18n.t('restart'),
      textSize: I18n.lang === 'en' ? 23 : 26,
      onClick: () => {
        this.sfx.play('click');
        this.confirmRestart();
      },
    });
    restartBtn.node.setPosition(dockW / 2 - 100, 2, 0);

    game.active = false;
  }

  private rebuildHeartIcons(max: number): void {
    const box = this.heartsContainer;
    if (!box) return;
    box.removeAllChildren();
    this.heartNodes = [];
    const spacing = max > 3 ? 38 : 48;
    const size = max > 3 ? 36 : 44;
    for (let i = 0; i < max; i++) {
      const h = makeIcon(box, 'heart', size);
      h.setPosition((i - (max - 1) / 2) * spacing, 0, 0);
      this.heartNodes.push(h);
    }
  }

  private paintBoardMat(cx: number, cy: number, bw: number, bh: number): void {
    const mat = this.boardMat;
    if (!mat) return;
    mat.setPosition(cx, cy, 0);
    const padX = 22;
    const padY = 22;
    const mw = Math.min(this.W - 28, bw + padX * 2);
    const mh = bh + padY * 2;
    setSize(mat, mw, mh);
    const g = mat.getComponent(Graphics) || mat.addComponent(Graphics);
    g.clear();
    const r = 32;

    g.fillColor = new Color(11, 36, 74, 65);
    g.roundRect(-mw / 2, -mh / 2 - 12, mw, mh, r);
    g.fill();
    g.fillColor = C.boardFrameDark;
    g.roundRect(-mw / 2, -mh / 2 - 6, mw, mh, r);
    g.fill();
    g.fillColor = C.boardMat;
    g.roundRect(-mw / 2, -mh / 2, mw, mh, r);
    g.fill();
    g.lineWidth = 4;
    g.strokeColor = C.white;
    g.roundRect(-mw / 2, -mh / 2, mw, mh, r);
    g.stroke();
  }

  private updateModeBadge(level: Level): void {
    const wrap = this.modeBadgeWrap;
    if (!wrap) return;
    wrap.removeAllChildren();

    if (this.bossParts.length > 1) {
      makeBadge(
        wrap,
        I18n.t('modeBoss', { n: this.bossIndex + 1 }),
        C.red,
        C.white,
        156,
        40,
        19,
        C.redDark,
      );
    } else if (isChallenge(level.id)) {
      makeBadge(wrap, I18n.t('modeChallenge'), C.purple, C.white, 152, 40, 19, C.purpleDark);
    } else if (isSprint(level.id)) {
      makeBadge(wrap, I18n.t('modeSprint'), C.orange, C.white, 142, 40, 19, C.orangeDark);
    } else if (isZen(level.id)) {
      makeBadge(wrap, I18n.t('modeZen'), C.green, C.white, 134, 40, 19, C.greenDark);
    } else if (isMajorPicture(level.id) || isMinorPicture(level.id)) {
      makeBadge(wrap, I18n.t('modeArt'), C.purple, C.white, 126, 40, 19, C.purpleDark);
    } else {
      const wIdx = Math.max(0, Math.min(WORLD_THEMES.length - 1, worldOf(level.id) - 1));
      const wt = WORLD_THEMES[wIdx];
      makeBadge(wrap, this.worldTitle(wIdx), wt.banner, C.white, 166, 38, 17, wt.bannerDark);
    }
  }

  private drawProgress(ratio: number): void {
    const g = this.progressGfx;
    if (!g) return;
    const w = this.progressW;
    const h = 18;
    g.clear();
    const clamped = Math.max(0, Math.min(1, ratio));
    const fw = clamped * w;
    if (fw <= 2) return;
    const r = Math.max(0, Math.min(h / 2 - 1, fw / 2 - 1));
    g.fillColor = clamped >= 0.99 ? C.green : C.yellow;
    g.roundRect(-w / 2, -h / 2, fw, h, r);
    g.fill();
    g.fillColor = new Color(255, 255, 255, 115);
    g.roundRect(-w / 2 + 2, 1, Math.max(0, fw - 4), h * 0.36, Math.max(0, r * 0.6));
    g.fill();
  }

  // ---------------------------------------------------------------- levels

  private buildLevels(): void {
    const root = newNode('levels', this.node);
    setSize(root, this.W, this.H);
    this.levels = root;

    const top = this.H / 2;

    const topY = top - 78;
    const back = makeButton(root, {
      w: 84,
      h: 84,
      radius: 26,
      style: 'blue',
      shadowOffset: 7,
      icon: 'back',
      iconSize: 42,
      onClick: () => {
        this.sfx.play('click');
        this.showHome();
      },
    });
    back.node.setPosition(-this.W / 2 + 68, topY, 0);

    makeLabel(root, I18n.t('levelMap'), 40, C.white, {
      width: 280,
      height: 60,
      outlineColor: C.royalDark,
      outlineWidth: 4,
      shadowColor: new Color(0, 0, 0, 80),
      shadowOffset: new Vec2(0, -3),
    }).node.setPosition(-12, topY, 0);

    const starPill = makePanel(root, 174, 64, {
      radius: 32,
      fill: C.cream,
      bevel: C.boardFrameDark,
      bevelHeight: 5,
      border: C.white,
      borderWidth: 3.5,
      shadow: new Color(10, 32, 68, 60),
      shadowOffset: 9,
    });
    starPill.setPosition(this.W / 2 - 112, topY, 0);
    makeIcon(starPill, 'star', 42).setPosition(-54, 1, 0);
    this.levelsTotal = makeLabel(starPill, '0', 30, C.goldText, { width: 100, height: 44 });
    this.levelsTotal.node.setPosition(20, 1, 0);

    this.chapterHeader = newNode('chapter-header', root);
    this.chapterHeader.setPosition(0, top - 232, 0);

    const gridCardW = Math.min(this.W - 44, 660);
    const gridCardH = 564;
    const gridCardY = top - 622;
    const gridCard = makePanel(root, gridCardW, gridCardH, {
      radius: 34,
      fill: C.cream,
      bevel: C.boardFrameDark,
      bevelHeight: 8,
      border: C.white,
      borderWidth: 4,
      shadow: new Color(10, 32, 68, 72),
      shadowOffset: 14,
    });
    gridCard.setPosition(0, gridCardY, 0);

    this.levelGrid = newNode('grid', gridCard);
    this.levelGrid.setPosition(0, 0, 0);

    // Bottom Full-Width Bonus Challenge Card
    const bonusY = gridCardY - gridCardH / 2 - 96;
    const bonusCard = makePanel(root, gridCardW, 128, {
      radius: 32,
      fill: C.purple,
      bevel: C.purpleDark,
      bevelHeight: 8,
      border: new Color(212, 191, 255, 255),
      borderWidth: 4,
      highlight: true,
      shadow: new Color(18, 12, 54, 85),
      shadowOffset: 14,
    });
    bonusCard.setPosition(0, Math.max(-this.H / 2 + 88, bonusY), 0);
    makeIcon(bonusCard, 'star', 62).setPosition(-gridCardW / 2 + 56, 2, 0);
    makeLabel(bonusCard, I18n.t('challengeTitle'), 28, C.white, {
      width: 340,
      height: 44,
      align: 0,
      outlineColor: C.purpleDark,
      outlineWidth: 3,
    }).node.setPosition(-gridCardW / 2 + 272, 18, 0);
    makeLabel(bonusCard, I18n.t('challengeSub'), 19, new Color(235, 224, 255, 255), {
      width: 340,
      height: 30,
      align: 0,
    }).node.setPosition(-gridCardW / 2 + 272, -22, 0);

    const bonusPlay = makeButton(bonusCard, {
      w: 138,
      h: 74,
      radius: 24,
      style: 'gold',
      shadowOffset: 6,
      text: I18n.t('challengeBtn'),
      textSize: 28,
      onClick: () => {
        this.sfx.play('click');
        this.startLevel(BONUS_CHALLENGE_ID, true);
      },
    });
    bonusPlay.node.setPosition(gridCardW / 2 - 94, 2, 0);

    this.fillLevelGrid();
    root.active = false;
  }

  private fillLevelGrid(): void {
    const grid = this.levelGrid;
    const header = this.chapterHeader;
    if (!grid || !header) return;
    grid.removeAllChildren();
    header.removeAllChildren();

    const from = (this.chapterPage - 1) * CHAPTER_SIZE + 1;
    const to = from + CHAPTER_SIZE - 1;
    const wIdx = Math.max(0, Math.min(WORLD_THEMES.length - 1, Math.floor((this.chapterPage - 1) / 5)));
    const wt = WORLD_THEMES[wIdx];
    const got = this.chapterStars(this.chapterPage);

    const cardW = Math.min(this.W - 44, 660);
    const card = makePanel(header, cardW, 152, {
      radius: 30,
      fill: C.cream,
      bevel: C.boardFrameDark,
      bevelHeight: 7,
      border: C.white,
      borderWidth: 4,
      shadow: new Color(10, 32, 68, 65),
      shadowOffset: 12,
    });

    const bannerW = cardW - 16;
    const banner = makePanel(card, bannerW, 50, {
      radius: 22,
      fill: wt.banner,
      bevel: wt.bannerDark,
      bevelHeight: 4,
      highlight: true,
    });
    banner.setPosition(0, 44, 0);
    makeLabel(banner, I18n.t('worldBanner', { w: wIdx + 1, name: this.worldTitle(wIdx) }), 25, C.white, {
      width: bannerW - 24,
      height: 40,
      outlineColor: wt.bannerDark,
      outlineWidth: 3,
    }).node.setPosition(0, 1, 0);

    const navY = -12;
    const prev = makeButton(card, {
      w: 64,
      h: 56,
      radius: 20,
      style: this.chapterPage > 1 ? 'blue' : 'cream',
      shadowOffset: 5,
      text: '‹',
      textSize: 38,
      onClick: () => {
        if (this.chapterPage <= 1) return;
        this.sfx.play('click');
        this.chapterPage--;
        this.fillLevelGrid();
      },
    });
    prev.node.setPosition(-cardW / 2 + 58, navY, 0);
    prev.setEnabled(this.chapterPage > 1);

    const next = makeButton(card, {
      w: 64,
      h: 56,
      radius: 20,
      style: this.chapterPage < CHAPTER_COUNT ? 'blue' : 'cream',
      shadowOffset: 5,
      text: '›',
      textSize: 38,
      onClick: () => {
        if (this.chapterPage >= CHAPTER_COUNT) return;
        this.sfx.play('click');
        this.chapterPage++;
        this.fillLevelGrid();
      },
    });
    next.node.setPosition(cardW / 2 - 58, navY, 0);
    next.setEnabled(this.chapterPage < CHAPTER_COUNT);

    makeLabel(card, I18n.t('chapterTitle', { c: this.chapterPage, total: CHAPTER_COUNT }), 28, C.ink, {
      width: 280,
      height: 40,
    }).node.setPosition(0, navY + 6, 0);

    const progW = 360;
    const progY = -48;
    const pTrack = makePanel(card, progW, 22, {
      radius: 11,
      fill: C.boardFrame,
      border: C.boardFrameDark,
      borderWidth: 2,
    });
    pTrack.setPosition(-28, progY, 0);
    const pg = newNode('ch-fill', pTrack).addComponent(Graphics);
    const ratio = Math.min(1, got / 60);
    if (ratio > 0) {
      const fw = Math.max(14, ratio * (progW - 6));
      pg.fillColor = got >= 42 ? C.green : C.yellow;
      pg.roundRect(-(progW - 6) / 2, -8, fw, 16, 7);
      pg.fill();
    }
    const tickX = -(progW - 6) / 2 + (42 / 60) * (progW - 6);
    pg.strokeColor = new Color(255, 255, 255, 210);
    pg.lineWidth = 2.5;
    pg.moveTo(tickX, -8);
    pg.lineTo(tickX, 8);
    pg.stroke();

    makeLabel(card, `${got}/60 ★`, 21, C.goldText, { width: 110, height: 28 }).node.setPosition(
      progW / 2 + 26,
      progY,
      0,
    );

    const cols = 5;
    const rows = 4;
    const gap = 16;
    const cellW = Math.min(112, (cardW - 56 - (cols - 1) * gap) / cols);
    const startX = -((cols - 1) * (cellW + gap)) / 2;
    const startY = ((rows - 1) * (cellW + gap)) / 2 + 4;

    for (let i = from; i <= to; i++) {
      const col = (i - from) % cols;
      const row = Math.floor((i - from) / cols);
      const x = startX + col * (cellW + gap);
      const y = startY - row * (cellW + gap);

      const step = stepOf(i);
      const tag = step === 18 ? '⚔' : step === 13 ? '⚡' : step === 19 ? '✿' : '';
      const tagColor = step === 18 ? C.red : step === 13 ? C.orange : C.green;

      if (i > this.save.unlocked && !isChallenge(i)) {
        const lockedTile = makePanel(grid, cellW, cellW, {
          radius: 24,
          fill: new Color(224, 236, 248, 255),
          bevel: new Color(188, 206, 224, 255),
          bevelHeight: 5,
          border: new Color(206, 222, 238, 255),
          borderWidth: 2,
        });
        lockedTile.setPosition(x, y, 0);
        makeIcon(lockedTile, 'lock', 34).setPosition(0, 10, 0);
        makeLabel(lockedTile, String(i), 20, C.inkFaint, { width: cellW, height: 26 }).node.setPosition(
          0,
          -26,
          0,
        );
        lockedTile.on(Node.EventType.TOUCH_END, () => {
          this.sfx.play('click');
          this.showToast(I18n.t('toastLocked'));
        });
        if (tag) {
          makeLabel(lockedTile, tag, 18, new Color(138, 158, 182, 210), {
            width: 30,
            height: 24,
          }).node.setPosition(cellW / 2 - 18, cellW / 2 - 18, 0);
        }
        continue;
      }

      const isCurrent = i === this.save.unlocked;
      const b = makeButton(grid, {
        w: cellW,
        h: cellW,
        radius: 24,
        style: isCurrent ? 'gold' : 'blue',
        shadowOffset: 6,
        text: String(i),
        textSize: 36,
        onClick: () => {
          this.sfx.play('click');
          this.startLevel(i, true);
        },
      });
      b.node.setPosition(x, y, 0);
      if (b.label) b.label.node.setPosition(0, 12, 0);
      if (isCurrent) pulseIdle(b.node, 0.04, 1.5);

      if (tag) {
        const tBadge = makePanel(b.node, 34, 30, {
          radius: 12,
          fill: tagColor,
          border: C.white,
          borderWidth: 2,
        });
        tBadge.setPosition(cellW / 2 - 14, cellW / 2 - 12, 0);
        makeLabel(tBadge, tag, 18, C.white, { width: 32, height: 24 }).node.setPosition(0, 1, 0);
      }

      const stars = this.save.stars[i] ?? 0;
      for (let s = 0; s < 3; s++) {
        const frame = Assets.frame(s < stars ? 'star' : 'star-empty');
        if (!frame) continue;
        const sp = makeSprite(b.node, frame, 23, 23);
        sp.node.setPosition((s - 1) * 26, -32, 0);
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
    const bg = makePanel(t, 580, 68, {
      radius: 34,
      fill: new Color(18, 48, 92, 242),
      border: C.royalRim,
      borderWidth: 3,
      shadow: new Color(8, 22, 48, 90),
      shadowOffset: 8,
    });
    setSize(bg, 580, 68);
    this.toastLabel = makeLabel(t, '', 24, C.white, {
      width: 548,
      height: 50,
      outlineColor: new Color(8, 22, 48, 255),
      outlineWidth: 2,
    });
    t.setPosition(0, -this.H * 0.24, 0);
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
    this.toast.setScale(0.92, 0.92, 1);
    tween(this.toast)
      .to(0.16, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
      .start();
    tween(op)
      .delay(1.35)
      .to(0.25, { opacity: 0 })
      .call(() => {
        if (this.toast) this.toast.active = false;
      })
      .start();
  }

  private updateEnergyPill(): void {
    const now = Date.now();
    const synced = syncEnergy(this.save, now);
    if (synced.energy !== this.save.energy || synced.energyAt !== this.save.energyAt) {
      this.save.energy = synced.energy;
      this.save.energyAt = synced.energyAt;
      persist(this.save);
    }
    if (this.energyLabel) {
      this.energyLabel.string = `${this.save.energy}/${ENERGY_MAX}`;
      this.energyLabel.color = this.save.energy <= 1 ? C.red : C.ink;
    }
    const next = energyNextInMs(this.save, now);
    if (this.energyNextBadge && this.energyNextLabel) {
      this.energyNextBadge.active = next > 0;
      if (next > 0) this.energyNextLabel.string = formatEnergyClock(next);
    }
  }

  private updateHintBadge(): void {
    const zero = this.save.hints <= 0;
    if (this.hintBadge) {
      this.hintBadge.string = zero ? '+' : String(this.save.hints);
    }
    const g = this.hintBadgeBg;
    if (g) {
      g.clear();
      const w = 48;
      const h = 36;
      const r = h / 2 - 1;
      g.fillColor = zero ? C.red : C.green;
      g.roundRect(-w / 2, -h / 2, w, h, r);
      g.fill();
      g.lineWidth = 3;
      g.strokeColor = C.white;
      g.roundRect(-w / 2, -h / 2, w, h, r);
      g.stroke();
    }
  }

  private updateTimer(): void {
    if (!this.timerLabel) return;
    if (this.level && this.level.timeLimit === 0) {
      this.timerLabel.string = '∞';
      this.timerLabel.color = C.goldLight;
      return;
    }
    const t = Math.max(0, Math.ceil(this.timeLeft));
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    this.timerLabel.string = `${mm}:${ss}`;
    const low = t <= 20;
    this.timerLabel.color = low ? new Color(255, 148, 142, 255) : C.white;
    if (this.timerNode) {
      const s = low ? 1.05 : 1;
      this.timerNode.setScale(s, s, 1);
    }
  }

  private updateHearts(breakLatest = false): void {
    this.heartNodes.forEach((node, i) => {
      const alive = i < this.hearts;
      const sp = node.getComponent(Sprite);
      if (sp) sp.color = alive ? C.white : new Color(110, 145, 185, 130);
      const s = alive ? 1 : 0.78;
      node.setScale(s, s, 1);
      if (breakLatest && i === this.hearts) {
        bump(node, 1.32, 0.24);
      }
    });
  }

  private updateProgressHud(): void {
    const total = this.board?.total ?? 1;
    const remaining = this.board?.remaining ?? 0;
    const done = Math.max(0, total - remaining);
    this.drawProgress(done / Math.max(1, total));
    if (this.progressLabel) {
      this.progressLabel.string = `${done}/${total}`;
    }
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
    const nextLv = Math.min(this.save.unlocked, LEVEL_COUNT);
    if (this.homeChip) this.homeChip.string = this.formatLevelTitle(nextLv);
    this.paintHomeWorldPill(nextLv);
    if (this.homeStarLabel) this.homeStarLabel.string = String(totalStars(this.save));
  }

  private showLevels(): void {
    this.unscheduleAllCallbacks();
    this.closeModal();
    this.running = false;
    if (this.board) this.board.inputEnabled = false;
    if (this.home) this.home.active = false;
    if (this.game) this.game.active = false;
    if (this.levels) this.levels.active = true;
    this.chapterPage = chapterOf(Math.min(this.save.unlocked, LEVEL_COUNT));
    if (this.levelsTotal) this.levelsTotal.string = String(totalStars(this.save));
    this.fillLevelGrid();
  }

  private startLevel(id: number, fromUI = false): void {
    this.unscheduleAllCallbacks();
    if (!canStartLevel(this.save, Date.now())) {
      this.showEnergyModal(true);
      return;
    }
    if (!this.checkChapterGate(id)) return;

    this.bossParts = getLevelParts(id);
    this.bossIndex = 0;
    this.reviveCount = 0;
    this.mistakes = 0;
    this.enterPart(0, fromUI);
  }

  private enterPart(index: number, fromUI = false, restart = false): void {
    const part = this.bossParts[index] ?? this.bossParts[0];
    this.bossIndex = index;
    this.level = part;
    this.mistakesBase = this.mistakes;
    if (index === 0 || restart) {
      this.heartMax = isSprint(part.id) ? 5 : 3;
      this.hearts = this.heartMax;
      this.rebuildHeartIcons(this.heartMax);
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
      this.hudLevel.string = this.formatLevelTitle(part.id);
    }
    this.updateModeBadge(part);

    const topInset = 230;
    const bottomInset = 178;
    const availW = this.W - 72;
    const availH = Math.max(240, this.H - topInset - bottomInset - 28);
    const cell = Math.min(Math.floor(availW / part.cols), Math.floor(availH / part.rows), 86);
    const bw = cell * part.cols;
    const bh = cell * part.rows;
    const boardCenterY = this.H / 2 - topInset - (this.H - topInset - bottomInset) / 2;

    this.paintBoardMat(0, boardCenterY, bw, bh);

    if (this.boardNode && this.board) {
      this.board.inputEnabled = true;
      this.boardNode.setPosition(0, boardCenterY, 0);
      this.zoom = 1;
      this.boardNode.setScale(1, 1, 1);
      if (this.zoomLabel) this.zoomLabel.string = '100%';
      this.board.layout(bw, bh);
      this.board.setLevel(part);
      this.board.setHint(null);
    }

    this.updateHintBadge();
    this.updateHearts();
    this.updateProgressHud();
    this.updateTimer();

    if (fromUI) this.sfx.play('click');
    if (!this.save.seenHowto) {
      this.save.seenHowto = true;
      persist(this.save);
      this.scheduleOnce(() => this.showHowto(), 0.45);
    }
  }

  private checkChapterGate(id: number): boolean {
    if (id <= 1 || id > LEVEL_COUNT || stepOf(id) !== 0) return true;
    const entering = chapterOf(id);
    const prev = entering - 1;
    const need = 42;
    const got = this.chapterStars(prev);
    if (got >= need || this.save.chapterPasses[String(prev)]) return true;
    this.showModal({
      title: I18n.t('chapterGateTitle', { n: entering }),
      tone: 'blue',
      lines: [
        I18n.t('chapterGateLine1', { need, got }),
        I18n.t('chapterGateLine2'),
      ],
      buttons: [
        {
          text: I18n.t('prevChapter'),
          style: 'blue',
          onClick: () => {
            this.closeModal();
            this.chapterPage = prev;
            this.showLevels();
          },
        },
        {
          text: I18n.t('freePassAd'),
          style: 'gold',
          onClick: () =>
            this.runRewardedAd(
              () => {
                this.save.chapterPasses[String(prev)] = true;
                persist(this.save);
                this.showToast(I18n.t('chapterUnlocked'));
                this.closeModal();
                this.startLevel(id, true);
              },
              I18n.t('toastAdPass'),
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

  private onCleared(arrow: Arrow): void {
    if (!this.running) return;
    this.sfx.play('pop', 0.9);
    if (this.hintId === arrow.id) this.hintId = null;

    this.updateProgressHud();
    if ((this.board?.remaining ?? 0) === 0) this.win();
  }

  private onBlocked(arrow: Arrow, blocker: Arrow | null): void {
    if (!this.running) return;
    this.mistakes++;
    this.sfx.play('thud');
    if (this.save.haptics) Platform.vibrate();
    if (this.level && isZen(this.level.id)) {
      const color = blocker ? I18n.arrowColorName(blocker.color) : '';
      this.showToast(
        blocker ? I18n.t('toastZenBlocked', { color }) : I18n.t('toastZenGeneric'),
      );
      void arrow;
      return;
    }
    this.hearts--;
    this.updateHearts(true);
    if (this.hearts <= 0) {
      this.lose('hearts');
      return;
    }
    if (arrow.isBoss) {
      this.showToast(I18n.t('toastBossWide'));
    } else if (blocker?.isBoss) {
      this.showToast(I18n.t('toastBlockedBoss'));
    } else if (blocker) {
      this.showToast(I18n.t('toastBlockedColor', { color: I18n.arrowColorName(blocker.color) }));
    } else {
      this.showToast(I18n.t('toastBlockedGeneric'));
    }
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

  private resetZoom(): void {
    this.sfx.play('click');
    this.zoom = 1;
    if (this.zoomLabel) this.zoomLabel.string = '100%';
    if (this.boardNode) this.boardNode.setScale(1, 1, 1);
  }

  private confirmRestart(): void {
    if (!this.running) return;
    this.paused = true;
    this.showModal({
      title: I18n.t('restartTitle'),
      tone: 'blue',
      lines: [I18n.t('restartBody')],
      buttons: [
        {
          text: I18n.t('restartConfirm'),
          style: 'blue',
          onClick: () => {
            this.closeModal();
            this.paused = false;
            this.startLevel(this.level ? this.level.id : 1);
          },
        },
        { text: I18n.t('keepPlaying'), style: 'cream', onClick: () => this.closeModal() },
      ],
    });
  }

  // ---------------------------------------------------------------- end states

  private win(): void {
    if (!this.level) return;
    this.running = false;
    if (this.board) {
      this.board.inputEnabled = false;
      this.board.celebrate();
    }
    const id = this.level.id;

    if (this.bossParts.length > 1 && this.bossIndex < this.bossParts.length - 1) {
      const cleared = this.bossIndex + 1;
      this.sfx.play('win');
      this.scheduleOnce(() => {
        this.showModal({
          title: I18n.t('bossPartTitle', { n: cleared }),
          tone: 'gold',
          lines: [I18n.t('bossPartBody')],
          buttons: [
            {
              text: I18n.t('nextStage'),
              style: 'green',
              onClick: () => {
                this.closeModal();
                this.enterPart(this.bossIndex + 1, false);
              },
            },
          ],
        });
      }, 0.65);
      return;
    }

    const total = this.bossParts.reduce((n, p) => n + p.arrows.length, 0);
    const star3 = Math.max(1, Math.round(total * 0.05));
    const star2 = Math.max(2, Math.round(total * 0.18));
    const stars = this.mistakes <= star3 ? 3 : this.mistakes <= star2 ? 2 : 1;

    this.save.stars[id] = Math.max(this.save.stars[id] ?? 0, stars);
    if (!isChallenge(id)) {
      this.save.unlocked = Math.max(this.save.unlocked, Math.min(LEVEL_COUNT, id + 1));
    }
    persist(this.save);
    this.sfx.play('win');

    const isLast = id >= LEVEL_COUNT;
    this.scheduleOnce(() => this.showWinModal(id, stars, isLast), 0.95);
  }

  private showWinModal(id: number, stars: number, isLast: boolean): void {
    const buttons: ModalButton[] = [];
    if (stars < 3) {
      buttons.push({
        text: I18n.t('doubleStarsAd'),
        style: 'gold',
        icon: 'star',
        onClick: () => this.doubleStars(id, stars, isLast),
      });
    }
    buttons.push(
      isLast
        ? { text: I18n.t('backToLevels'), style: 'green', onClick: () => this.showLevels() }
        : {
            text: I18n.t('nextLevel'),
            style: 'green',
            icon: 'play',
            onClick: () => this.startLevel(Math.min(LEVEL_COUNT, id + 1), true),
          },
    );

    const statCopy =
      stars === 3
        ? I18n.t('winPerfect')
        : this.mistakes > 0
          ? I18n.t('winBumps', { n: this.mistakes })
          : I18n.t('winGreat');

    this.showModal({
      title: isLast ? I18n.t('allClearedTitle') : I18n.t('victoryTitle'),
      tone: 'gold',
      lines: [statCopy],
      stars,
      buttons,
      rowButtons: [
        { text: I18n.t('replay'), style: 'cream', onClick: () => this.startLevel(id, true) },
        { text: I18n.t('home'), style: 'cream', onClick: () => this.showHome() },
      ],
    });
  }

  private doubleStars(id: number, stars: number, isLast: boolean): void {
    this.runRewardedAd(
      () => {
        const doubled = Math.min(3, stars * 2);
        this.save.stars[id] = Math.max(this.save.stars[id] ?? 0, doubled);
        persist(this.save);
        this.sfx.play('coin');
        this.showToast(I18n.t('toastStarsDoubled', { n: doubled }));
        this.closeModal();
        this.scheduleOnce(() => this.showWinModal(id, doubled, isLast), 0.35);
      },
      I18n.t('toastAdDouble'),
    );
  }

  private lose(reason: 'hearts' | 'time'): void {
    if (!this.running) return;
    this.running = false;
    if (this.board) this.board.inputEnabled = false;
    this.paused = false;
    this.sfx.play('lose');
    const spent = spendEnergy(this.save, Date.now());
    if (spent) {
      this.save.energy = spent.energy;
      this.save.energyAt = spent.energyAt;
      persist(this.save);
    }
    const id = this.level ? this.level.id : 1;
    const maxRevives = id <= 100 ? 1 : 2;
    const canRevive = this.reviveCount < maxRevives;
    const buttons: ModalButton[] = [];
    if (canRevive) {
      buttons.push({
        text: this.reviveCount === 0 ? I18n.t('reviveAd') : I18n.t('reviveAd2'),
        style: 'green',
        icon: 'heart',
        onClick: () => this.revive(reason),
      });
    }
    buttons.push({
      text: I18n.t('tryAgain'),
      style: canRevive ? 'blue' : 'green',
      icon: 'restart',
      onClick: () => this.restartCurrentPart(),
    });
    this.scheduleOnce(() => {
      this.showModal({
        title: reason === 'time' ? I18n.t('timesUpTitle') : I18n.t('outOfHeartsTitle'),
        tone: 'red',
        extraHeight: 96,
        content: (panel, topY) => {
          const badge = makePanel(panel, 104, 104, {
            radius: 52,
            fill: new Color(255, 232, 232, 255),
            border: new Color(242, 130, 126, 255),
            borderWidth: 3,
          });
          badge.setPosition(0, topY - 40, 0);
          makeIcon(badge, reason === 'time' ? 'clock' : 'heart', 62);
        },
        lines: [reason === 'time' ? I18n.t('loseTimeBody') : I18n.t('loseHeartsBody')],
        buttons,
        rowButtons: [
          { text: I18n.t('backToLevels'), style: 'cream', onClick: () => this.showLevels() },
          { text: I18n.t('home'), style: 'cream', onClick: () => this.showHome() },
        ],
      });
    }, 0.4);
  }

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

  private revive(reason: 'hearts' | 'time'): void {
    if (!this.level) return;
    const attempt = this.reviveCount;
    const grant = (): void => {
      this.closeModal();
      this.reviveCount++;
      if (attempt === 0) {
        this.hearts = Math.min(this.heartMax, 3);
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
      this.showToast(attempt === 0 ? I18n.t('toastRevive1') : I18n.t('toastRevive2'));
    };
    if (attempt === 0) {
      this.runRewardedAd(grant, I18n.t('toastAdRevive1'));
    } else {
      this.runRewardedAds(2, grant, I18n.t('toastAdRevive2'));
    }
  }

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
      title: I18n.t('pauseTitle'),
      tone: 'blue',
      extraHeight: 158,
      content: (p, topY) => {
        this.buildSettingRows(p, topY, false);
      },
      buttons: [
        { text: I18n.t('resume'), style: 'green', icon: 'play', onClick: () => this.closeModal() },
      ],
      rowButtons: [
        {
          text: I18n.t('restartConfirm'),
          style: 'blue',
          onClick: () => {
            this.closeModal();
            this.paused = false;
            this.startLevel(this.level ? this.level.id : 1);
          },
        },
        { text: I18n.t('home'), style: 'cream', onClick: () => this.showHome() },
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

  private ribbonPalette(tone: RibbonTone): { fill: Color; dark: Color; rim: Color } {
    switch (tone) {
      case 'gold':
        return { fill: C.yellow, dark: C.yellowDark, rim: C.goldLight };
      case 'red':
        return { fill: C.red, dark: C.redDark, rim: new Color(255, 175, 170, 255) };
      case 'green':
        return { fill: C.green, dark: C.greenDark, rim: C.greenLight };
      case 'purple':
        return { fill: C.purple, dark: C.purpleDark, rim: new Color(214, 194, 255, 255) };
      default:
        return { fill: C.blue, dark: C.blueDark, rim: C.blueLight };
    }
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

    const panelW = Math.min(this.W - 64, 624);
    const lines = opts.lines ?? [];
    const buttons = opts.buttons ?? [];
    const rowButtons = opts.rowButtons ?? [];

    let contentH = 68;
    if (opts.stars !== undefined) contentH += 146;
    contentH += opts.extraHeight ?? 0;
    contentH += lines.length * 46;
    contentH += 22;
    const buttonsH = buttons.length * 102 + (rowButtons.length ? 92 : 0);
    const panelH = contentH + buttonsH + 34;

    const panel = makePanel(this.overlay, panelW, panelH, {
      radius: 38,
      fill: C.cream,
      bevel: C.boardFrameDark,
      bevelHeight: 10,
      border: C.white,
      borderWidth: 5,
      shadow: new Color(6, 22, 48, 125),
      shadowOffset: 18,
    });
    panel.on(Node.EventType.TOUCH_START, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });
    panel.on(Node.EventType.TOUCH_END, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });

    const rp = this.ribbonPalette(opts.tone ?? 'blue');
    const ribbon = makeRibbon(panel, opts.title, Math.min(panelW - 76, 468), 76, rp.fill, rp.dark, rp.rim, 34);
    ribbon.setPosition(0, panelH / 2 + 2, 0);

    let y = panelH / 2 - 68;

    if (opts.stars !== undefined) {
      const glow = newNode('star-glow', panel);
      glow.setPosition(0, y - 58, 0);
      const gg = glow.addComponent(Graphics);
      gg.fillColor = new Color(255, 224, 110, 75);
      gg.circle(0, 0, 108);
      gg.fill();
      gg.fillColor = new Color(255, 240, 170, 95);
      gg.circle(0, 0, 72);
      gg.fill();

      for (let i = 0; i < 3; i++) {
        const earned = i < opts.stars;
        const frame = Assets.frame(earned ? 'star' : 'star-empty');
        if (!frame) continue;
        const sz = i === 1 ? 120 : 102;
        const sp = makeSprite(panel, frame, sz, sz);
        sp.node.setPosition((i - 1) * 124, y - (i === 1 ? 50 : 62), 0);
        sp.node.setScale(0.25, 0.25, 1);
        tween(sp.node)
          .delay(0.12 + i * 0.16)
          .to(0.32, { scale: new Vec3(1, 1, 1) }, { easing: 'backOut' })
          .start();
      }
      y -= 146;
    }

    if (opts.content) {
      opts.content(panel, y);
      y -= opts.extraHeight ?? 0;
    }

    for (const line of lines) {
      makeLabel(panel, line, 23, C.inkSoft, {
        width: panelW - 68,
        height: 42,
      }).node.setPosition(0, y - 10, 0);
      y -= 46;
    }

    let by = -panelH / 2 + 34 + (rowButtons.length ? 92 : 0) + (buttons.length - 1) * 102 + 44;
    for (const btn of buttons) {
      const style: ButtonStyleName = btn.style ?? (btn.primary ? 'green' : 'cream');
      const b = makeButton(panel, {
        w: panelW - 84,
        h: 84,
        radius: 26,
        style,
        shadowOffset: 8,
        icon: btn.icon,
        iconSize: 40,
        text: btn.text,
        textSize: style === 'cream' ? 30 : 34,
        onClick: () => {
          this.sfx.play('click');
          btn.onClick();
        },
      });
      b.node.setPosition(0, by, 0);
      by -= 102;
    }

    if (rowButtons.length) {
      const rw = (panelW - 84 - (rowButtons.length - 1) * 18) / rowButtons.length;
      const ry = -panelH / 2 + 72;
      rowButtons.forEach((btn, i) => {
        const x = (i - (rowButtons.length - 1) / 2) * (rw + 18);
        const style: ButtonStyleName = btn.style ?? 'cream';
        const b = makeButton(panel, {
          w: rw,
          h: 74,
          radius: 24,
          style,
          shadowOffset: 6,
          text: btn.text,
          textSize: 27,
          onClick: () => {
            this.sfx.play('click');
            btn.onClick();
          },
        });
        b.node.setPosition(x, ry, 0);
      });
    }

    popIn(panel, 0.02);
    return panel;
  }

  private buildSettingRows(p: Node, topY: number, showFull: boolean): void {
    const panelW = Math.min(this.W - 64, 624);
    const rowW = panelW - 76;

    const rows = [
      { text: I18n.t('soundFx'), on: this.save.sound, icon: this.save.sound ? 'sound' : 'sound-off' },
      { text: I18n.t('haptics'), on: this.save.haptics, icon: 'bolt' },
    ];

    rows.forEach((row, i) => {
      const y = topY - 38 - i * 80;
      const tray = makePanel(p, rowW, 66, {
        radius: 22,
        fill: C.creamWarm,
        border: C.creamDeep,
        borderWidth: 2,
      });
      tray.setPosition(0, y, 0);
      makeIcon(tray, row.icon, 36).setPosition(-rowW / 2 + 40, 0, 0);
      const rowLbl = makeLabel(tray, row.text, 26, C.ink, { width: 250, height: 42, align: 0 });
      rowLbl.node.getComponent(UITransform)?.setAnchorPoint(0, 0.5);
      rowLbl.node.setPosition(-rowW / 2 + 76, 0, 0);
      const sw = makeButton(tray, {
        w: 118,
        h: 48,
        radius: 24,
        style: row.on ? 'green' : 'cream',
        shadowOffset: 4,
        text: row.on ? I18n.t('on') : I18n.t('off'),
        textSize: 22,
        onClick: () => {
          let nextVal: boolean;
          if (i === 0) {
            this.save.sound = !this.save.sound;
            this.sfx.enabled = this.save.sound;
            nextVal = this.save.sound;
          } else {
            this.save.haptics = !this.save.haptics;
            nextVal = this.save.haptics;
          }
          persist(this.save);
          this.sfx.play('click');
          sw.setText(nextVal ? I18n.t('on') : I18n.t('off'));
          sw.repaintStyle(nextVal ? 'green' : 'cream');
        },
      });
      sw.node.setPosition(rowW / 2 - 76, 2, 0);
    });

    if (showFull) {
      // Language selector row (English <-> 中文)
      const langY = topY - 38 - 160;
      const langTray = makePanel(p, rowW, 66, {
        radius: 22,
        fill: C.creamWarm,
        border: C.creamDeep,
        borderWidth: 2,
      });
      langTray.setPosition(0, langY, 0);
      makeIcon(langTray, 'levels', 34).setPosition(-rowW / 2 + 40, 0, 0);
      const langLbl = makeLabel(langTray, I18n.t('language'), 26, C.ink, { width: 230, height: 42, align: 0 });
      langLbl.node.getComponent(UITransform)?.setAnchorPoint(0, 0.5);
      langLbl.node.setPosition(-rowW / 2 + 76, 0, 0);
      const langBtn = makeButton(langTray, {
        w: 148,
        h: 48,
        radius: 24,
        style: 'blue',
        shadowOffset: 4,
        text: I18n.t('langName'),
        textSize: 22,
        onClick: () => {
          this.sfx.play('click');
          this.switchLanguage(this.save.lang === 'en' ? 'zh' : 'en');
        },
      });
      langBtn.node.setPosition(rowW / 2 - 90, 2, 0);

      const stat = makePanel(p, rowW, 54, {
        radius: 20,
        fill: C.boardFrame,
        border: C.white,
        borderWidth: 2,
      });
      stat.setPosition(0, topY - 270, 0);
      makeLabel(
        stat,
        I18n.t('progressStat', {
          u: this.save.unlocked,
          total: LEVEL_COUNT,
          stars: totalStars(this.save),
        }),
        22,
        C.ink,
        { width: rowW - 24, height: 38 },
      );
    }
  }

  private showHowto(): void {
    const wasRunning = this.running;
    if (wasRunning) this.paused = true;
    this.showModal({
      title: I18n.t('howToTitle'),
      tone: 'blue',
      lines: [I18n.t('howTo1'), I18n.t('howTo2'), I18n.t('howTo3')],
      extraHeight: 82,
      content: (panel, topY) => {
        const tip = makePanel(panel, 536, 72, {
          radius: 24,
          fill: C.creamWarm,
          border: C.yellow,
          borderWidth: 2.5,
        });
        tip.setPosition(0, topY - 36, 0);
        makeIcon(tip, 'bulb', 42).setPosition(-218, 0, 0);
        makeLabel(tip, I18n.t('howToTip'), 21, C.goldText, {
          width: 438,
          height: 44,
          align: 0,
        }).node.setPosition(28, 0, 0);
      },
      buttons: [
        {
          text: I18n.t('letsPlay'),
          style: 'green',
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
    this.showModal({
      title: I18n.t('settingsTitle'),
      tone: 'blue',
      extraHeight: 308,
      content: (p, topY) => {
        this.buildSettingRows(p, topY, true);
      },
      buttons: [
        {
          text: I18n.t('done'),
          style: 'green',
          onClick: () => {
            this.closeModal();
            if (wasRunning) this.paused = false;
          },
        },
      ],
      rowButtons: [
        {
          text: I18n.t('resetProgress'),
          style: 'cream',
          onClick: () => this.confirmResetProgress(),
        },
      ],
    });
  }

  private confirmResetProgress(): void {
    this.showModal({
      title: I18n.t('resetTitle'),
      tone: 'red',
      lines: [I18n.t('resetBody')],
      buttons: [
        {
          text: I18n.t('resetConfirm'),
          style: 'red',
          onClick: () => {
            this.save.unlocked = 1;
            this.save.stars = {};
            this.save.hints = 3;
            this.save.chapterPasses = {};
            const refilled = refillEnergy(this.save, Date.now());
            this.save.energy = refilled.energy;
            this.save.energyAt = refilled.energyAt;
            persist(this.save);
            this.closeModal();
            this.showHome();
            this.showToast(I18n.t('resetDone'));
          },
        },
        { text: I18n.t('cancel'), style: 'cream', onClick: () => this.showSettings() },
      ],
    });
  }

  private showHintModal(): void {
    this.paused = true;
    this.showModal({
      title: I18n.t('outOfHintsTitle'),
      tone: 'gold',
      lines: [I18n.t('hintsAdBody', { n: HINTS_PER_AD })],
      extraHeight: 108,
      content: (panel, topY) => {
        const pill = makePanel(panel, 312, 84, {
          radius: 42,
          fill: C.creamWarm,
          border: C.yellow,
          borderWidth: 3,
        });
        pill.setPosition(0, topY - 46, 0);
        makeIcon(pill, 'bulb', 50).setPosition(-72, 0, 0);
        makeLabel(pill, I18n.t('hintsLeft', { n: this.save.hints }), 30, C.goldText, {
          width: 190,
          height: 54,
        }).node.setPosition(34, 0, 0);
      },
      buttons: [
        {
          text: I18n.t('watchAdHint', { n: HINTS_PER_AD }),
          style: 'gold',
          icon: 'bulb',
          onClick: () => {
            this.runRewardedAd(() => {
              this.save.hints += HINTS_PER_AD;
              persist(this.save);
              this.updateHintBadge();
              this.closeModal();
              this.sfx.play('coin');
              this.showToast(I18n.t('hintGranted', { n: HINTS_PER_AD }));
            });
          },
        },
        { text: I18n.t('notNow'), style: 'cream', onClick: () => this.closeModal() },
      ],
    });
  }

  // ---------------------------------------------------------------- energy & ads

  private runRewardedAd(onReward: () => void, cancelMsg = I18n.t('toastAdCancel')): void {
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

  private showEnergyModal(blocked: boolean): void {
    const wasRunning = this.running;
    if (wasRunning) this.paused = true;
    this.updateEnergyPill();
    const full = this.save.energy >= ENERGY_MAX;
    const next = energyNextInMs(this.save, Date.now());
    const regenMin = Math.round(ENERGY_REGEN_MS / 60000);
    this.showModal({
      title: blocked ? I18n.t('outOfEnergyTitle') : I18n.t('energyTitle'),
      tone: 'gold',
      lines: [
        full
          ? I18n.t('energyFullLine', { n: ENERGY_MAX, max: ENERGY_MAX })
          : I18n.t('energyRegenLine', { m: regenMin, t: formatEnergyClock(next) }),
        I18n.t('energyRuleLine'),
      ],
      extraHeight: 112,
      content: (panel, topY) => {
        const pill = makePanel(panel, 312, 84, {
          radius: 42,
          fill: C.creamWarm,
          border: C.yellow,
          borderWidth: 3,
        });
        pill.setPosition(0, topY - 46, 0);
        makeIcon(pill, 'bolt', 50).setPosition(-72, 0, 0);
        makeLabel(pill, `${this.save.energy} / ${ENERGY_MAX}`, 36, C.goldText, {
          width: 174,
          height: 56,
        }).node.setPosition(34, 0, 0);
      },
      buttons: [
        {
          text: full ? I18n.t('energyFullBtn') : I18n.t('watchAdEnergy'),
          style: full ? 'cream' : 'green',
          icon: full ? undefined : 'bolt',
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
                this.showToast(I18n.t('energyGranted'));
              },
              I18n.t('toastAdEnergy'),
            );
          },
        },
        { text: blocked ? I18n.t('later') : I18n.t('gotIt'), style: 'cream', onClick: () => this.closeModal() },
      ],
    });
  }

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
    dg.fillColor = new Color(10, 22, 42, 240);
    dg.rect(-this.W / 2, -this.H / 2, this.W, this.H);
    dg.fill();
    dim.on(Node.EventType.TOUCH_START, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });
    dim.on(Node.EventType.TOUCH_END, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });

    const panel = makePanel(layer, 560, 620, {
      radius: 38,
      fill: C.cream,
      bevel: C.boardFrameDark,
      bevelHeight: 10,
      border: C.white,
      borderWidth: 5,
      shadow: new Color(6, 20, 44, 120),
      shadowOffset: 16,
    });
    panel.on(Node.EventType.TOUCH_START, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });
    panel.on(Node.EventType.TOUCH_END, (e: { propagationStopped: boolean }) => {
      e.propagationStopped = true;
    });

    const ribbon = makeRibbon(panel, I18n.t('adTitle'), 400, 72, C.blue, C.blueDark, C.blueLight, 32);
    ribbon.setPosition(0, 312, 0);

    const ringNode = newNode('ad-ring', panel);
    ringNode.setPosition(0, 124, 0);
    const ringGfx = ringNode.addComponent(Graphics);
    const drawRing = (progress: number): void => {
      ringGfx.clear();
      const R = 68;
      ringGfx.lineWidth = 14;
      ringGfx.strokeColor = C.boardFrame;
      ringGfx.circle(0, 0, R);
      ringGfx.stroke();
      ringGfx.strokeColor = progress >= 1 ? C.green : C.blue;
      ringGfx.lineCap = Graphics.LineCap.ROUND;
      const start = Math.PI / 2;
      const end = start - Math.PI * 2 * Math.min(1, progress);
      ringGfx.arc(0, 0, R, start, end, false);
      ringGfx.stroke();
    };
    drawRing(0);

    const countLabel = makeLabel(ringNode, '5', 52, C.ink, { width: 120, height: 120 });
    countLabel.node.setPosition(0, 0, 0);

    makeLabel(panel, I18n.t('adBody'), 23, C.inkSoft, {
      width: 480,
      height: 82,
    }).node.setPosition(0, -18, 0);

    const totalSec = 5;
    let elapsed = 0;
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
      w: 380,
      h: 86,
      radius: 26,
      style: 'green',
      shadowOffset: 8,
      text: I18n.t('adWait', { s: 5 }),
      textSize: 30,
      onClick: () => {
        if (ready) {
          rewarded = true;
          close();
        }
      },
    });
    rewardBtn.node.setPosition(0, -156, 0);
    rewardBtn.setEnabled(false);

    const closeBtn = makeButton(panel, {
      w: 170,
      h: 64,
      radius: 22,
      style: 'cream',
      shadowOffset: 5,
      text: I18n.t('adClose'),
      textSize: 25,
      onClick: () => close(),
    });
    closeBtn.node.setPosition(0, -250, 0);

    const tick = (): void => {
      elapsed += 0.1;
      const p = Math.min(1, elapsed / totalSec);
      drawRing(p);
      const left = Math.max(0, Math.ceil(totalSec - elapsed));
      if (left > 0) {
        countLabel.string = String(left);
        rewardBtn.setText(I18n.t('adWait', { s: left }));
      } else if (!ready) {
        ready = true;
        countLabel.string = '✓';
        countLabel.color = C.green;
        rewardBtn.setText(I18n.t('adClaim'));
        rewardBtn.setEnabled(true);
        this.unschedule(tick);
      }
    };

    this.schedule(tick, 0.1);
    popIn(panel, 0.02);
  }
}
