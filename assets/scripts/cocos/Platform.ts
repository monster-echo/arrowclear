import { sys } from 'cc';

declare const wx: {
  vibrateShort?: (opts?: { type?: string }) => void;
  shareAppMessage?: (opts: { title: string; imageUrl?: string }) => void;
  getSystemInfoSync?: () => { platform?: string };
  showToast?: (opts: { title: string; icon?: string }) => void;
} | undefined;

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
};