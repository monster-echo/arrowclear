/**
 * 激励视频广告（Web 演示端）。
 *
 * 没有真实广告 SDK 的环境里用「模拟广告」占位：全屏遮罩 + 倒计时，
 * 看完才能领奖励，提前关闭不给奖励 —— 行为对齐真实激励视频。
 *
 * 正式接 SDK 时，把 showRewardedAd 换成对应平台的激励视频调用，
 * onDone(rewarded) 的语义保持不变即可。
 */

const SIM_MS = 5000;

export function showRewardedAd(): Promise<boolean> {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.id = 'ad-overlay';
    root.innerHTML = `
      <div class="ad-card">
        <div class="ad-tag">广告 · 演示</div>
        <div class="ad-body">
          <div class="ad-ring"><b id="ad-count">5</b></div>
          <p>观看完整段广告即可领取奖励<br/>提前关闭将无法获得奖励</p>
        </div>
        <div class="ad-actions">
          <button class="ad-reward" id="ad-reward" disabled>领取奖励</button>
          <button class="ad-close" id="ad-close">×</button>
        </div>
      </div>`;
    document.body.appendChild(root);

    let done = false;
    const finish = (rewarded: boolean): void => {
      if (done) return;
      done = true;
      clearInterval(timer);
      root.remove();
      resolve(rewarded);
    };

    const rewardBtn = root.querySelector<HTMLButtonElement>('#ad-reward')!;
    const count = root.querySelector<HTMLElement>('#ad-count')!;
    const t0 = performance.now();
    const timer = window.setInterval(() => {
      const left = Math.max(0, SIM_MS - (performance.now() - t0));
      count.textContent = String(Math.ceil(left / 1000));
      if (left <= 0) {
        clearInterval(timer);
        count.textContent = '✓';
        rewardBtn.disabled = false;
        rewardBtn.classList.add('ready');
      }
    }, 100);

    rewardBtn.addEventListener('click', () => {
      if (!rewardBtn.disabled) finish(true);
    });
    // 提前关闭：不给奖励（对齐真实激励视频的「完整观看」约束）。
    root.querySelector('#ad-close')!.addEventListener('click', () => finish(false));
  });
}
