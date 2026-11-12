import { AudioSource, Node } from 'cc';
import { Assets } from './Assets';

export class Sfx {
  private source: AudioSource | null = null;
  enabled = true;

  attach(node: Node): void {
    this.source = node.getComponent(AudioSource) || node.addComponent(AudioSource);
  }

  play(name: string, volume = 1): void {
    if (!this.enabled || !this.source) return;
    const clip = Assets.clip(name);
    if (!clip) return;
    this.source.playOneShot(clip, volume);
  }
}