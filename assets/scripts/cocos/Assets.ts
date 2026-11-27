import { AudioClip, Font, ImageAsset, resources, SpriteFrame, Texture2D } from 'cc';

function loadFrame(path: string): Promise<SpriteFrame | null> {
  return new Promise((resolve) => {
    resources.load(`${path}/spriteFrame`, SpriteFrame, (err, asset) => {
      if (!err && asset) {
        resolve(asset);
        return;
      }
      // Fallback: if imported as texture or image asset, construct a SpriteFrame directly
      resources.load(`${path}/texture`, Texture2D, (err2, tex) => {
        if (!err2 && tex) {
          const sf = new SpriteFrame();
          sf.texture = tex;
          resolve(sf);
          return;
        }
        resources.load(path, ImageAsset, (err3, img) => {
          if (!err3 && img) {
            resolve(SpriteFrame.createWithImage(img));
            return;
          }
          console.warn('[assets] missing sprite', path, err, err2, err3);
          resolve(null);
        });
      });
    });
  });
}

function loadFont(path: string): Promise<Font | null> {
  return new Promise((resolve) => {
    resources.load(path, Font, (err, asset) => {
      if (err || !asset) {
        console.warn('[assets] missing font', path, err);
        resolve(null);
        return;
      }
      resolve(asset);
    });
  });
}

function loadClip(path: string): Promise<AudioClip | null> {
  return new Promise((resolve) => {
    resources.load(path, AudioClip, (err, asset) => {
      if (err || !asset) {
        resolve(null);
        return;
      }
      resolve(asset);
    });
  });
}

export class Assets {
  static readonly frames = new Map<string, SpriteFrame>();
  static readonly clips = new Map<string, AudioClip>();
  static font: Font | null = null;

  static frame(name: string): SpriteFrame | null {
    return Assets.frames.get(name) ?? null;
  }

  static clip(name: string): AudioClip | null {
    return Assets.clips.get(name) ?? null;
  }

  static async preload(): Promise<void> {
    const icons = [
      'gear',
      'coin',
      'heart',
      'clock',
      'bulb',
      'restart',
      'pause',
      'play',
      'sound',
      'sound-off',
      'back',
      'lock',
      'star',
      'star-empty',
      'levels',
      'shop',
      'help',
      'close',
      'bolt',
    ];
    const art = ['logo', 'logo-zh', 'mascot', 'bg'];
    const audio = ['pop', 'thud', 'win', 'lose', 'coin', 'click'];

    const tasks: Promise<void>[] = [];
    for (const name of icons) {
      tasks.push(
        loadFrame(`art/icons/${name}`).then((f) => {
          if (f) Assets.frames.set(name, f);
        }),
      );
    }
    for (const name of art) {
      tasks.push(
        loadFrame(`art/${name}`).then((f) => {
          if (f) Assets.frames.set(name, f);
        }),
      );
    }
    for (const name of audio) {
      tasks.push(
        loadClip(`audio/${name}`).then((c) => {
          if (c) Assets.clips.set(name, c);
        }),
      );
    }
    tasks.push(
      loadFont('fonts/ZCOOLKuaiLe-Regular').then((f) => {
        if (f) Assets.font = f;
      }),
    );

    await Promise.all(tasks);
  }
}