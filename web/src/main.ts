import { LEVEL_COUNT, getLevel } from '../../assets/scripts/core/levels';
import { Arrow, Level, corridorCells, cellKey } from '../../assets/scripts/core/types';
import { Sfx } from './audio';
import { logoSVG, mascotSVG } from './art';
import { hydrateIcons, icon } from './icons';
import { Renderer } from './render';
import { SaveData, loadSave, persist, totalStars } from './storage';
import { ARROW_COLORS, UI } from './theme';

const $ = <T extends HTMLElement>(sel: string): T => document.querySelector(sel) as T;

class Game {
  debugState(): unknown {
    return {
      level: this.level?.id,
      alive: this.alive.size,
      total: this.level?.arrows.length,
      hearts: this.hearts,
      free: this.level
        ? this.level.arrows.filter((a) => this.alive.has(a.id) && this.renderer.isFree(a, this.alive)).length
        : 0,
      running: this.running,
      screen: this.screen,
    };
  }

  debugFreeArrowScreenPos(): { x: number; y: number } | null {
    if (!this.level) return null;
    const free = this.level.arrows.filter(
      (a) => this.alive.has(a.id) && this.renderer.isFree(a, this.alive),
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
  private timeLeft = 0;
  private mistakes = 0;
  private coinsEarned = 0;
  private combo = 0;
  private comboT = 0;
  private running = false;
  private paused = false;
  private hintId: number | null = null;
  private hintUntil = 0;
  private lastFrame = 0;
  private screen: 'home' | 'game' | 'levels' = 'home';
  private tutorialShown = false;

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
    this.screen = 'home';
    this.running = false;
    this.renderer.clear();
    $('#home').classList.remove('is-hidden');
    $('#levels').classList.add('is-hidden');
    $('#hud').classList.add('is-hidden');
    $('#toolbar').classList.add('is-hidden');
    this.hideOverlay();
    const next = Math.min(this.save.unlocked, LEVEL_COUNT);
    $('#home-level-chip').textContent = `第 ${next} 关`;
    $('#home-coins').textContent = String(this.save.coins);
    const hint = $('#home-hint');
    const stars = totalStars(this.save);
    hint.textContent =
      stars > 0 ? `已获得 ${stars} 颗星 · 继续冲关` : '点击箭头发射，清空整块棋盘';
  }

  private showLevels(): void {
    this.screen = 'levels';
    $('#home').classList.add('is-hidden');
    $('#levels').classList.remove('is-hidden');
    this.buildLevelGrid();
  }

  private buildLevelGrid(): void {
    const grid = $('#level-grid');
    grid.innerHTML = '';
    $('#total-stars').textContent = String(totalStars(this.save));
    for (let i = 1; i <= LEVEL_COUNT; i++) {
      const locked = i > this.save.unlocked;
      const stars = this.save.stars[i] ?? 0;
      const btn = document.createElement('button');
      btn.className = `lv${locked ? ' locked' : ''}${i === this.save.unlocked ? ' current' : ''}`;
      if (locked) {
        btn.innerHTML = `${icon('lock')}`;
      } else {
        btn.innerHTML = `<span>${i}</span><span class="stars">${[0, 1, 2]
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

  private startLevel(id: number): void {
    const level = getLevel(id);
    this.level = level;
    this.alive = new Set(level.arrows.map((a) => a.id));
    this.hearts = 3;
    this.timeLeft = level.timeLimit;
    this.mistakes = 0;
    this.coinsEarned = 0;
    this.combo = 0;
    this.comboT = 0;
    this.hintId = null;
    this.running = true;
    this.paused = false;
    this.screen = 'game';

    $('#home').classList.add('is-hidden');
    $('#levels').classList.add('is-hidden');
    $('#hud').classList.remove('is-hidden');
    $('#toolbar').classList.remove('is-hidden');
    this.hideOverlay();
    $('#hud-level').textContent = `第 ${id} 关`;
    $('#hud-coins').querySelector('b')!.textContent = String(this.save.coins);
    $('#hint-cost').textContent = String(this.hintCost());

    this.renderer.setLevel(level);
    this.renderer.resize();
    this.syncInsets();
    this.updateHud(true);
    this.updateHearts();

    if (!this.save.seenHowto) {
      this.save.seenHowto = true;
      persist(this.save);
      setTimeout(() => this.showHowto(true), 420);
    }
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
    const canvas = $<HTMLCanvasElement>('#board');
    const toLocal = (e: PointerEvent): { x: number; y: number } => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('pointerdown', (e) => {
      this.sfx.unlock();
      if (!this.running || this.paused || this.screen !== 'game') return;
      const p = toLocal(e);
      const arrow = this.renderer.hitTest(p.x, p.y);
      if (arrow) this.tapArrow(arrow);
    });

    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || !this.running) return;
      const p = toLocal(e);
      const arrow = this.renderer.hitTest(p.x, p.y);
      this.renderer.setHover(arrow ? arrow.id : null);
      canvas.style.cursor = arrow ? 'pointer' : 'default';
    });

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
    $('#btn-sound').addEventListener('click', () => {
      this.save.sound = !this.save.sound;
      this.sfx.setEnabled(this.save.sound);
      persist(this.save);
      this.updateSoundButton();
      this.sfx.click();
    });
    $('#btn-nav-levels').addEventListener('click', () => {
      this.sfx.click();
      this.showLevels();
    });
    $('#btn-levels-back').addEventListener('click', () => {
      this.sfx.click();
      this.showHome();
    });
    $('#btn-nav-shop').addEventListener('click', () => {
      this.sfx.click();
      this.showShop();
    });
    $('#btn-home-coins').addEventListener('click', () => {
      this.sfx.click();
      this.showShop();
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
    const el = $('#btn-sound .tool-ico');
    el.innerHTML = icon(this.save.sound ? 'sound' : 'soundOff');
  }

  // ---------------------------------------------------------------- gameplay

  private tapArrow(arrow: Arrow): void {
    if (!this.level) return;
    if (this.renderer.isFree(arrow, this.alive)) {
      this.clearArrow(arrow);
    } else {
      this.blockArrow(arrow);
    }
  }

  private clearArrow(arrow: Arrow): void {
    this.alive.delete(arrow.id);
    this.renderer.flyOut(arrow);
    this.combo++;
    this.comboT = 2.4;
    this.coinsEarned += 1 + (this.combo >= 5 ? 1 : 0);
    this.sfx.clear(this.combo);
    if (this.hintId === arrow.id) {
      this.hintId = null;
      this.renderer.setHint(null);
    }
    this.updateHud(false);
    if (this.combo >= 3) this.showCombo(this.combo);
    if (this.alive.size === 0) this.win();
  }

  private blockArrow(arrow: Arrow): void {
    this.hearts--;
    this.mistakes++;
    this.combo = 0;
    this.sfx.blocked();
    this.renderer.shakeScreen();
    this.updateHearts(true);
    if (this.save.haptics && navigator.vibrate) navigator.vibrate(30);
    this.toast(this.blockedReason(arrow));
    if (this.hearts <= 0) {
      this.lose('hearts');
    }
  }

  private blockedReason(arrow: Arrow): string {
    if (!this.level) return '被挡住了';
    const dims = this.level;
    const cor = corridorCells(dims, arrow);
    let blocker: Arrow | undefined;
    for (const c of cor) {
      const id = this.arrowAt(c.x, c.y);
      if (id !== null && id !== arrow.id && this.alive.has(id)) {
        blocker = this.level.arrows.find((a) => a.id === id);
        break;
      }
    }
    if (!blocker) return '被挡住了';
    return `被${this.colorName(blocker.color)}箭头挡住了`;
  }

  private arrowAt(x: number, y: number): number | null {
    if (!this.level) return null;
    for (const a of this.level.arrows) {
      if (!this.alive.has(a.id)) continue;
      for (const c of a.cells) if (c.x === x && c.y === y) return a.id;
    }
    return null;
  }

  private colorName(i: number): string {
    return ['红', '橙', '黄', '绿', '青', '蓝', '靛', '紫', '粉'][i % 9];
  }

  private hintCost(): number {
    return 30;
  }

  private useHint(): void {
    if (!this.running || this.paused || !this.level) return;
    if (this.save.coins < this.hintCost()) {
      this.toast('金币不足，去商店补充吧');
      this.showShop();
      return;
    }
    const free = this.level.arrows.filter(
      (a) => this.alive.has(a.id) && this.renderer.isFree(a, this.alive),
    );
    if (!free.length) return;
    free.sort((a, b) => b.cells.length - a.cells.length);
    const pick = free.find((a) => a.id !== this.hintId) ?? free[0];
    this.save.coins -= this.hintCost();
    persist(this.save);
    this.hintId = pick.id;
    this.hintUntil = performance.now() + 4200;
    this.renderer.setHint(pick.id);
    this.sfx.hint();
    this.updateHud(true);
  }

  private win(): void {
    if (!this.level) return;
    this.running = false;
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
    this.sfx.win();
    this.renderer.celebrate();
    this.updateHud(true);

    const isLast = id >= LEVEL_COUNT;
    setTimeout(() => {
      this.showOverlay(`
        <div class="modal">
          <h3>${isLast ? '全部通关！' : '通关啦'}</h3>
          <div class="stars-big" id="win-stars">
            ${[0, 1, 2].map((i) => icon('star', i < stars ? 'on' : '')).join('')}
          </div>
          <p>${stars === 3 ? '完美！一次都没撞墙' : this.mistakes > 0 ? `撞墙 ${this.mistakes} 次，再试一次冲击三星` : '漂亮，继续保持'}</p>
          <div class="reward">${icon('coin')}<span>+${reward}</span></div>
          <div class="modal-actions">
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
      $('#win-next')?.addEventListener('click', () => this.startLevel(Math.min(LEVEL_COUNT, id + 1)));
      $('#win-levels')?.addEventListener('click', () => this.showLevels());
      $('#win-replay').addEventListener('click', () => this.startLevel(id));
      $('#win-home').addEventListener('click', () => this.showHome());
    }, 420);
  }

  private lose(reason: 'hearts' | 'time'): void {
    this.running = false;
    this.sfx.lose();
    const title = reason === 'time' ? '时间到' : '爱心用尽';
    const sub =
      reason === 'time'
        ? '别急，先看清楚每一支箭的出口'
        : '每一次撞墙都会失去一颗爱心';
    setTimeout(() => {
      this.showOverlay(`
        <div class="modal">
          <h3>${title}</h3>
          <p>${sub}</p>
          <div class="modal-actions">
            <button class="btn-primary" id="lose-retry">再试一次</button>
            <div class="btn-row">
              <button class="btn-ghost" id="lose-home">首页</button>
              <button class="btn-ghost" id="lose-levels">关卡</button>
            </div>
          </div>
        </div>`);
      $('#lose-retry').addEventListener('click', () => this.startLevel(this.level!.id));
      $('#lose-home').addEventListener('click', () => this.showHome());
      $('#lose-levels').addEventListener('click', () => this.showLevels());
    }, 380);
  }

  private showPause(): void {
    if (!this.running || this.paused) return;
    this.paused = true;
    this.showOverlay(`
      <div class="modal">
        <h3>暂停</h3>
        <div class="modal-actions">
          <button class="btn-primary" id="pause-resume">继续游戏</button>
          <div class="btn-row">
            <button class="btn-ghost" id="pause-restart">重来</button>
            <button class="btn-ghost" id="pause-home">首页</button>
          </div>
        </div>
      </div>`);
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
          1. 点击一支箭，它会朝箭头方向飞出棋盘<br/>
          2. 前方被别的箭挡住就会撞墙，扣一颗爱心<br/>
          3. 把棋盘清空即可过关，撞墙越少星星越多
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
      this.save.coins = 120;
      persist(this.save);
      this.hideOverlay();
      this.showHome();
      this.toast('进度已重置');
    });
  }

  private showShop(): void {
    this.showOverlay(`
      <div class="modal">
        <h3>金币商店</h3>
        <p>金币用来买提示。正式版这里会接入内购与激励视频。</p>
        <div class="reward">${icon('coin')}<span>${this.save.coins}</span></div>
        <div class="modal-actions">
          <button class="btn-primary" id="shop-ad">看广告 +50</button>
          <button class="btn-ghost" id="shop-buy">200 金币换 10 次提示</button>
          <button class="btn-ghost" id="shop-close">关闭</button>
        </div>
      </div>`);
    $('#shop-ad').addEventListener('click', () => {
      this.save.coins += 50;
      persist(this.save);
      this.sfx.coin();
      this.hideOverlay();
      this.updateHud(true);
      this.toast('+50 金币（演示版）');
    });
    $('#shop-buy').addEventListener('click', () => {
      if (this.save.coins < 200) {
        this.toast('金币不够啦');
        return;
      }
      this.save.coins -= 200;
      persist(this.save);
      this.hideOverlay();
      this.updateHud(true);
      this.toast('已获得 10 次提示（演示版）');
    });
    $('#shop-close').addEventListener('click', () => this.hideOverlay());
  }

  // ---------------------------------------------------------------- hud

  private updateHud(refreshCoins: boolean): void {
    if (this.level) {
      const done = this.level.arrows.length - this.alive.size;
      const pct = (done / this.level.arrows.length) * 100;
      $('#hud-progress').style.width = `${pct.toFixed(1)}%`;
    }
    if (refreshCoins) {
      $('#hud-coins').querySelector('b')!.textContent = String(this.save.coins);
      $('#home-coins').textContent = String(this.save.coins);
      $('#home-level-chip').textContent = `第 ${Math.min(this.save.unlocked, LEVEL_COUNT)} 关`;
    }
    this.updateTimer();
  }

  private updateTimer(): void {
    const t = Math.max(0, Math.ceil(this.timeLeft));
    const mm = String(Math.floor(t / 60)).padStart(2, '0');
    const ss = String(t % 60).padStart(2, '0');
    const el = $('#hud-timer');
    el.querySelector('b')!.textContent = `${mm}:${ss}`;
    el.classList.toggle('low', t <= 20);
  }

  private updateHearts(breakOne = false): void {
    const box = $('#hud-hearts');
    const lost = 3 - Math.max(0, this.hearts);
    if (box.children.length !== 3) {
      box.innerHTML = [0, 1, 2].map(() => icon('heart')).join('');
    }
    Array.from(box.children).forEach((el, i) => {
      const isLost = i >= 3 - lost;
      if (isLost) {
        el.classList.add('lost');
        if (breakOne && i === 3 - lost) {
          el.classList.add('breaking');
          setTimeout(() => el.classList.remove('breaking'), 460);
        }
      } else {
        el.classList.remove('lost');
      }
    });
  }

  private showCombo(n: number): void {
    const el = $('#combo');
    el.textContent = n >= 6 ? `连击 ×${n} 太强了！` : `连击 ×${n}`;
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
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
      if (this.comboT > 0) {
        this.comboT -= dt;
        if (this.comboT <= 0) this.combo = 0;
      }
      if (this.hintId !== null && now > this.hintUntil) {
        this.hintId = null;
        this.renderer.setHint(null);
      }
      if (this.timeLeft <= 0) {
        this.timeLeft = 0;
        this.updateTimer();
        this.lose('time');
      }
      if (Math.floor(now / 250) !== Math.floor((now - dt * 1000) / 250)) this.updateTimer();
    }

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
void UI;
void ARROW_COLORS;
void cellKey;