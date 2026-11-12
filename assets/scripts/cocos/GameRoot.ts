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
import { LEVEL_COUNT, getLevel } from '../core/levels';
import { Arrow, Level } from '../core/types';
import { Assets } from './Assets';
import { BoardView } from './BoardView';
import { loadSave, persist, SaveData, totalStars } from './SaveStore';
import { Sfx } from './Sfx';
import { ARROW_NAMES, C, FONT } from './Theme';
import {
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

interface ModalButton {
  text: string;
  primary?: boolean;
  onClick: () => void;
}

interface ModalOptions {
  title: string;
  lines?: string[];
  stars?: number;
  reward?: number;
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
  private toast: Node | null = null;
  private toastLabel: Label | null = null;
  private comboNode: Node | null = null;
  private comboLabel: Label | null = null;

  private board: BoardView | null = null;
  private boardNode: Node | null = null;

  private hudLevel: Label | null = null;
  private timerLabel: Label | null = null;
  private timerNode: Node | null = null;
  private coinLabels: Label[] = [];
  private heartNodes: Node[] = [];
  private progressGfx: Graphics | null = null;
  private progressW = 600;
  private hintBadge: Label | null = null;
  private homeChip: Label | null = null;
  private levelsTotal: Label | null = null;
  private soundIconNode: Node | null = null;

  private level: Level | null = null;
  private hearts = 3;
  private timeLeft = 0;
  private mistakes = 0;
  private coinsEarned = 0;
  private comboCount = 0;
  private comboTimer = 0;
  private running = false;
  private paused = false;
  private hintId: number | null = null;
  private hintUntil = 0;
  private clock = 0;

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
    if (!this.running || this.paused) return;

    this.clock += dt;
    this.timeLeft -= dt;
    if (this.timeLeft < 0) this.timeLeft = 0;
    this.updateTimer();
    if (this.timeLeft <= 0) {
      this.lose('time');
      return;
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.comboCount = 0;
    }

    if (this.hintId !== null && this.clock > this.hintUntil) {
      this.hintId = null;
      this.board?.setHint(null);
    }
  }

  // ---------------------------------------------------------------- background

  private buildBackground(): void {
    const frame = Assets.frame('bg');
    const n = newNode('background', this.node);
    n.setPosition(0, 0, 0);
    if (frame) {
      const sp = makeSprite(n, frame, 720, 1560);
      const scale = Math.max(this.W / 720, this.H / 1560);
      sp.node.setScale(scale, scale, 1);
    } else {
      const g = n.addComponent(Graphics);
      g.fillColor = new Color(207, 239, 247, 255);
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

    const coinPill = makePanel(home, 186, 84, {
      radius: 42,
      fill: C.white,
      shadow: new Color(30, 80, 110, 34),
      shadowOffset: 6,
    });
    coinPill.setPosition(this.W / 2 - 112, top - 78, 0);
    makeIcon(coinPill, 'coin', 50).setPosition(-52, 2, 0);
    const coinLabel = makeLabel(coinPill, '0', 36, C.ink, { width: 110, height: 60 });
    coinLabel.node.setPosition(16, 2, 0);
    this.coinLabels.push(coinLabel);

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
      { icon: 'shop', text: '商店', onClick: () => this.showShop() },
      { icon: 'help', text: '玩法', onClick: () => this.showHowto() },
    ];
    navs.forEach((item, i) => {
      const x = (i - 1) * 190;
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

    const pill = makePanel(game, 186, 84, {
      radius: 42,
      fill: C.white,
      shadow: new Color(30, 80, 110, 34),
      shadowOffset: 6,
    });
    pill.setPosition(this.W / 2 - 112, top - 76, 0);
    makeIcon(pill, 'coin', 50).setPosition(-52, 2, 0);
    const hudCoin = makeLabel(pill, '0', 36, C.ink, { width: 110, height: 60 });
    hudCoin.node.setPosition(16, 2, 0);
    this.coinLabels.push(hudCoin);

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

    const toolY = -this.H / 2 + this.H * 0.075;
    const tools: { icon: string; text: string; onClick: () => void; badge?: boolean }[] = [
      { icon: 'bulb', text: '提示', onClick: () => this.useHint(), badge: true },
      { icon: 'sound', text: '音效', onClick: () => this.toggleSound() },
      { icon: 'restart', text: '重来', onClick: () => this.confirmRestart() },
    ];
    tools.forEach((item, i) => {
      const x = (i - 1) * 232;
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
        this.hintBadge = makeLabel(badge, '30', 22, new Color(122, 76, 0, 255), {
          width: 64,
          height: 40,
        });
        this.hintBadge.node.setPosition(0, 0, 0);
      }
    });

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

    makeLabel(root, '选择关卡', FONT.h1, C.ink, { width: 400, height: 70 }).node.setPosition(
      0,
      this.H / 2 - 92,
      0,
    );

    makeIcon(root, 'star', 40).setPosition(this.W / 2 - 118, this.H / 2 - 92, 0);
    this.levelsTotal = makeLabel(root, '0', 34, new Color(180, 122, 0, 255), {
      width: 90,
      height: 46,
    });
    this.levelsTotal.node.setPosition(this.W / 2 - 66, this.H / 2 - 92, 0);

    this.levelGrid = newNode('grid', root);
    this.levelGrid.setPosition(0, 0, 0);
    this.fillLevelGrid();
    root.active = false;
  }

  private fillLevelGrid(): void {
    const grid = this.levelGrid;
    if (!grid) return;
    grid.removeAllChildren();

    const cols = 6;
    const gap = 12;
    const cellW = Math.min(104, (this.W - 72 - (cols - 1) * gap) / cols);
    const startX = -((cols - 1) * (cellW + gap)) / 2;
    const gridTop = this.H / 2 - 200;

    for (let i = 1; i <= LEVEL_COUNT; i++) {
      const col = (i - 1) % cols;
      const row = Math.floor((i - 1) / cols);
      const x = startX + col * (cellW + gap);
      const y = gridTop - row * (cellW + gap);

      if (i > this.save.unlocked) {
        const b = makeButton(grid, {
          w: cellW,
          h: cellW,
          radius: 22,
          fill: new Color(255, 255, 255, 90),
          icon: 'lock',
          iconSize: 30,
          onClick: () => this.showToast('先通过前一关才能解锁哦'),
        });
        b.node.setPosition(x, y, 0);
        continue;
      }

      const isCurrent = i === this.save.unlocked;
      const b = makeButton(grid, {
        w: cellW,
        h: cellW,
        radius: 22,
        fill: isCurrent ? new Color(255, 240, 190, 255) : C.white,
        shadow: isCurrent ? new Color(224, 182, 74, 255) : new Color(30, 80, 110, 26),
        shadowOffset: 5,
        text: String(i),
        textSize: 34,
        onClick: () => this.startLevel(i, true),
      });
      b.node.setPosition(x, y, 0);
      if (b.label) b.label.node.setPosition(0, 10, 0);

      const stars = this.save.stars[i] ?? 0;
      for (let s = 0; s < 3; s++) {
        const frame = Assets.frame(s < stars ? 'star' : 'starEmpty');
        if (!frame) continue;
        const sp = makeSprite(b.node, frame, 16, 16);
        sp.node.setPosition(-20 + s * 20, -32, 0);
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

  private showCombo(n: number): void {
    if (!this.comboNode) {
      this.comboNode = newNode('combo', this.node);
      setOpacity(this.comboNode, 0);
      this.comboLabel = makeLabel(this.comboNode, '', 58, C.white, { width: 720, height: 90 });
    }
    if (!this.comboLabel) return;
    this.comboLabel.string = n >= 6 ? `连击 ×${n} 太强了！` : `连击 ×${n}`;
    this.comboNode.setPosition(0, this.H * 0.06, 0);
    const op = this.comboNode.getComponent(UIOpacity) || this.comboNode.addComponent(UIOpacity);
    op.opacity = 255;
    this.comboNode.setScale(0.6, 0.6, 1);
    tween(this.comboNode)
      .to(0.16, { scale: new Vec3(1.12, 1.12, 1) }, { easing: 'backOut' })
      .to(0.1, { scale: new Vec3(1, 1, 1) })
      .start();
    tween(op).delay(0.55).to(0.3, { opacity: 0 }).start();
  }

  private updateCoins(): void {
    for (const label of this.coinLabels) label.string = String(this.save.coins);
    if (this.hintBadge) this.hintBadge.string = String(this.hintCost());
  }

  private hintCost(): number {
    return 30;
  }

  private updateTimer(): void {
    if (!this.timerLabel) return;
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
    this.running = false;
    this.paused = false;
    this.closeModal();
    if (this.board) this.board.inputEnabled = false;
    if (this.home) this.home.active = true;
    if (this.game) this.game.active = false;
    if (this.levels) this.levels.active = false;
    this.board?.setHint(null);
    this.updateCoins();
    if (this.homeChip) {
      this.homeChip.string = `第 ${Math.min(this.save.unlocked, LEVEL_COUNT)} 关`;
    }
  }

  private showLevels(): void {
    this.closeModal();
    this.running = false;
    if (this.board) this.board.inputEnabled = false;
    if (this.home) this.home.active = false;
    if (this.game) this.game.active = false;
    if (this.levels) this.levels.active = true;
    if (this.levelsTotal) this.levelsTotal.string = String(totalStars(this.save));
    this.fillLevelGrid();
  }

  private startLevel(id: number, fromUI = false): void {
    const level = getLevel(id);
    this.level = level;
    this.hearts = 3;
    this.timeLeft = level.timeLimit;
    this.mistakes = 0;
    this.coinsEarned = 0;
    this.comboCount = 0;
    this.comboTimer = 0;
    this.hintId = null;
    this.hintUntil = 0;
    this.clock = 0;
    this.paused = false;
    this.running = true;

    this.closeModal();
    if (this.home) this.home.active = false;
    if (this.levels) this.levels.active = false;
    if (this.game) this.game.active = true;

    if (this.hudLevel) this.hudLevel.string = `第 ${id} 关`;

    const topInset = this.H * 0.185;
    const bottomInset = this.H * 0.145;
    const availW = this.W - 44;
    const availH = this.H - topInset - bottomInset;
    const cell = Math.min(
      Math.floor(availW / level.cols),
      Math.floor(availH / level.rows),
      88,
    );
    const bw = cell * level.cols;
    const bh = cell * level.rows;

    if (this.boardNode && this.board) {
      this.board.inputEnabled = true;
      this.boardNode.setPosition(0, this.H / 2 - topInset - availH / 2, 0);
      this.board.layout(bw, bh);
      this.board.setLevel(level);
      this.board.setHint(null);
    }

    this.updateCoins();
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

  private onCleared(arrow: Arrow): void {
    if (!this.running) return;
    this.comboCount++;
    this.comboTimer = 2.4;
    this.coinsEarned += 1 + (this.comboCount >= 5 ? 1 : 0);
    this.sfx.play('pop', 0.9);
    if (this.comboCount >= 3) this.showCombo(this.comboCount);
    if (this.hintId === arrow.id) this.hintId = null;

    const total = this.board?.total ?? 1;
    const remaining = this.board?.remaining ?? 0;
    this.drawProgress((total - remaining) / total);
    if (remaining === 0) this.win();
  }

  private onBlocked(arrow: Arrow, blocker: Arrow | null): void {
    if (!this.running) return;
    this.hearts--;
    this.mistakes++;
    this.comboCount = 0;
    this.sfx.play('thud');
    if (this.save.haptics) Platform.vibrate();
    this.updateHearts();
    if (this.hearts <= 0) {
      this.lose('hearts');
      return;
    }
    const name = blocker ? ARROW_NAMES[blocker.color % ARROW_NAMES.length] : '';
    this.showToast(blocker ? `被${name}色箭头挡住了` : '这支箭暂时飞不出去');
    void arrow;
  }

  private useHint(): void {
    if (!this.running || this.paused || !this.level || !this.board) return;
    if (this.save.coins < this.hintCost()) {
      this.showToast('金币不足，去商店补充吧');
      this.showShop();
      return;
    }
    const free = this.level.arrows.filter(
      (a) => this.board!.aliveIds.has(a.id) && this.board!.isFree(a),
    );
    if (!free.length) return;
    free.sort((a, b) => b.cells.length - a.cells.length);
    const pick = free.find((a) => a.id !== this.hintId) ?? free[0];
    this.save.coins -= this.hintCost();
    persist(this.save);
    this.updateCoins();
    this.hintId = pick.id;
    this.hintUntil = this.clock + 4.2;
    this.board.setHint(pick.id);
    this.sfx.play('coin');
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
    const total = this.level.arrows.length;
    const star3 = Math.max(1, Math.round(total * 0.05));
    const star2 = Math.max(2, Math.round(total * 0.18));
    const stars = this.mistakes <= star3 ? 3 : this.mistakes <= star2 ? 2 : 1;
    const timeBonus = Math.max(0, Math.floor(this.timeLeft / 8));
    const reward = 15 + stars * 10 + timeBonus + this.coinsEarned;

    this.save.coins += reward;
    this.save.stars[id] = Math.max(this.save.stars[id] ?? 0, stars);
    this.save.unlocked = Math.max(this.save.unlocked, Math.min(LEVEL_COUNT, id + 1));
    persist(this.save);
    this.updateCoins();
    this.sfx.play('win');

    const isLast = id >= LEVEL_COUNT;
    this.scheduleOnce(() => {
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
        reward,
        buttons: isLast
          ? [{ text: '返回关卡', primary: true, onClick: () => this.showLevels() }]
          : [
              {
                text: '下一关',
                primary: true,
                onClick: () => this.startLevel(Math.min(LEVEL_COUNT, id + 1)),
              },
            ],
      });
    }, 0.45);
  }

  private lose(reason: 'hearts' | 'time'): void {
    if (!this.running) return;
    this.running = false;
    if (this.board) this.board.inputEnabled = false;
    this.paused = false;
    this.sfx.play('lose');
    const id = this.level ? this.level.id : 1;
    this.scheduleOnce(() => {
      this.showModal({
        title: reason === 'time' ? '时间到' : '爱心用尽',
        lines: [
          reason === 'time' ? '别急，先看清楚每一支箭的出口' : '每一次撞墙都会失去一颗爱心',
        ],
        buttons: [
          {
            text: '再试一次',
            primary: true,
            onClick: () => {
              this.closeModal();
              this.startLevel(id);
            },
          },
          { text: '返回关卡', onClick: () => this.showLevels() },
        ],
      });
    }, 0.4);
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
    if (opts.reward !== undefined) contentH += 92;
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
        const frame = Assets.frame(i < opts.stars ? 'star' : 'starEmpty');
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

    if (opts.reward !== undefined) {
      const pill = makePanel(panel, 320, 76, {
        radius: 38,
        fill: new Color(255, 248, 227, 255),
      });
      pill.setPosition(0, y - 36, 0);
      makeIcon(pill, 'coin', 44).setPosition(-62, 0, 0);
      makeLabel(pill, `+${opts.reward}`, 36, new Color(168, 107, 0, 255), {
        width: 180,
        height: 60,
      }).node.setPosition(24, 0, 0);
      y -= 92;
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

  private showShop(): void {
    const wasRunning = this.running;
    if (wasRunning) this.paused = true;
    this.showModal({
      title: '金币商店',
      reward: this.save.coins,
      lines: ['提示一次消耗 30 金币', '正式版接入内购与激励视频'],
      buttons: [
        {
          text: '看广告 +50',
          primary: true,
          onClick: () => {
            this.save.coins += 50;
            persist(this.save);
            this.updateCoins();
            this.sfx.play('coin');
            this.showToast('+50 金币（演示版）');
          },
        },
        {
          text: '200 金币换 10 次提示',
          onClick: () => {
            if (this.save.coins < 200) {
              this.showToast('金币不够啦');
              return;
            }
            this.save.coins -= 200;
            persist(this.save);
            this.updateCoins();
            this.showToast('已获得 10 次提示（演示版）');
          },
        },
        {
          text: '关闭',
          onClick: () => {
            this.closeModal();
            if (wasRunning) this.paused = false;
          },
        },
      ],
    });
  }
}