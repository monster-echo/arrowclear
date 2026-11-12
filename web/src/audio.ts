/** Tiny procedural sound engine — every SFX is synthesised, zero audio assets. */

type Ctx = AudioContext;

export class Sfx {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  enabled = true;

  constructor(private musicEnabled = true) {}

  /** Must be called from a user gesture on iOS/Safari. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(this.ctx.destination);
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
  }

  private get t(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  private tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain = 0.18,
    slideTo?: number,
    delay = 0,
  ): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t0 = this.t + delay;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  private noise(dur: number, gain: number, from: number, to: number, delay = 0): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const t0 = this.t + delay;
    const len = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(from, t0);
    filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t0);
  }

  click(): void {
    this.tone(520, 0.07, 'triangle', 0.1, 680);
  }

  clear(combo = 0): void {
    const semis = Math.min(combo, 9) * 2;
    const base = 392 * Math.pow(2, semis / 12);
    this.tone(base, 0.16, 'sine', 0.2, base * 1.9);
    this.tone(base * 2, 0.09, 'triangle', 0.07, base * 2.6);
    this.noise(0.13, 0.05, 2200, 5200);
  }

  blocked(): void {
    this.tone(150, 0.16, 'sawtooth', 0.12, 82);
    this.tone(96, 0.2, 'sine', 0.12, 60, 0.02);
  }

  hint(): void {
    this.tone(740, 0.1, 'sine', 0.1, 980);
    this.tone(1180, 0.12, 'sine', 0.07, 1320, 0.08);
  }

  coin(): void {
    this.tone(980, 0.07, 'square', 0.05, 980);
    this.tone(1480, 0.09, 'square', 0.045, 1480, 0.055);
  }

  win(): void {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.32, 'triangle', 0.15, f, i * 0.1));
    this.tone(1568, 0.5, 'sine', 0.08, 1568, 0.42);
  }

  lose(): void {
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.3, 'sawtooth', 0.09, f * 0.98, i * 0.13));
  }

  whoosh(): void {
    this.noise(0.24, 0.045, 500, 2600);
  }
}