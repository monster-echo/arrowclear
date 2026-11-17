import { sys } from 'cc';

interface WxRewardedVideoAd {
  show(): Promise<void>;
  load(): Promise<void>;
  onClose(cb: (res?: { isEnded?: boolean }) => void): void;
  offClose(cb: (res?: { isEnded?: boolean }) => void): void;
}

declare const wx: {
  vibrateShort?: (opts?: { type?: string }) => void;
  shareAppMessage?: (opts: { title: string; imageUrl?: string }) => void;
  getSystemInfoSync?: () => { platform?: string };
  showToast?: (opts: { title: string; icon?: string }) => void;
  /** 微信小游戏激励视频广告；在其它环境不存在。 */
  createRewardedVideoAd?: (opts: { adUnitId: string }) => WxRewardedVideoAd;
} | undefined;

/**
 * 微信小游戏激励视频的广告位 ID。提审前在公众平台「流量主」里创建，
 * 把 id 填进来即可启用真实广告；留空时游戏会回退到内置的演示广告。
 */
const REWARDED_AD_UNIT_ID = '';

export const Platform = {
  isWeChat(): boolean {
    return typeof wx !== 'undefined' && !!wx && !!wx.getSystemInfoSync;
  },

  vibrate(): void {
    try {
      if (Platform.isWeChat() && wx?.vibrateShort) {
        wx.vibrateShort({ type: 'light' });
      } else if (sys.isNative) {
        // Native haptics are wired by the platform layer in the shipping build.
      }
    } catch {
      /* no-op */
    }
  },

  share(title: string): void {
    try {
      if (Platform.isWeChat() && wx?.shareAppMessage) {
        wx.shareAppMessage({ title });
      }
    } catch {
      /* no-op */
    }
  },

  toast(message: string): void {
    if (Platform.isWeChat() && wx?.showToast) wx.showToast({ title: message, icon: 'none' });
  },

  /**
   * 播放激励视频广告，结束时回调 rewarded = 是否完整看完。
   * 返回 false 表示当前环境没有真实广告可用（非微信 / 未配广告位），
   * 调用方应回退到演示广告。
   */
  showRewardedAd(onEnd: (rewarded: boolean) => void): boolean {
    if (!REWARDED_AD_UNIT_ID) return false;
    try {
      if (!Platform.isWeChat() || !wx?.createRewardedVideoAd) return false;
      const ad = wx.createRewardedVideoAd({ adUnitId: REWARDED_AD_UNIT_ID });
      const handler = (res?: { isEnded?: boolean }): void => {
        ad.offClose(handler);
        // 旧基础库 res 为 undefined 时视为已看完。
        onEnd(res?.isEnded !== false);
      };
      ad.onClose(handler);
      ad.show().catch(() => {
        // 拉取失败：重载一次，仍失败则按未看完处理。
        ad.load()
          .then(() => ad.show())
          .catch(() => {
            ad.offClose(handler);
            onEnd(false);
          });
      });
      return true;
    } catch {
      return false;
    }
  },
};
