# 一箭清空 · Arrow Clear

> 长蛇形箭阵解谜。点一支箭，它沿着箭头方向飞出棋盘；被别的箭挡住就会「撞墙」。
> 把整块棋盘清空即可过关，撞墙越少星星越多。

[<img src="store/appstore/01-home.png" width="260" alt="首页" />](store/appstore/01-home.png)
[<img src="store/appstore/02-game.png" width="260" alt="关卡" />](store/appstore/02-game.png)
[<img src="store/appstore/03-win.png" width="260" alt="结算" />](store/appstore/03-win.png)

---

## 这个仓库里有什么

| 模块 | 路径 | 说明 |
| --- | --- | --- |
| Cocos Creator 3.8.6 工程 | `assets/` `project.json` | iOS / Android / 微信小游戏三端共用 |
| 纯 TS 玩法内核 | `assets/scripts/core/` | 关卡生成、可解性校验、规则、存档，零引擎依赖 |
| Cocos 表现层 | `assets/scripts/cocos/` | 场景、棋盘绘制、UI、动效、音效 |
| 可玩 Web 预览 | `web/` → `dist/web/` | 与 Cocos 共用同一套内核，用于快速验证手感与画面 |
| 美术 / 音频资源 | `assets/resources/` | 全部由脚本生成，可复现 |
| 上架文档 | `docs/` | iOS、Google Play、微信小游戏完整流程 |
| 商店素材 | `store/` | 6.9" / 6.7" 截图、Google Play 特色图、1024 图标 |

---

## 快速开始

### 1. Web 预览（不用装 Cocos，30 秒看效果）

```bash
cd ArrowClear
npm install
npm run web          # 打开 http://localhost:4173
```

打包成静态站点：

```bash
npm run build:web    # 输出 dist/web
```

`dist/web` 可以直接丢到任意静态服务器 / CDN，也可作为商店演示链接。

### 2. Cocos Creator

1. 安装 **Cocos Creator 3.8.6**（Dashboard 里选 3.8.6，不要用 2.x）。
2. Dashboard → 项目 → 添加 → 选择本目录 `ArrowClear`。
3. 打开后双击 `assets/scenes/main.scene`，点右上角 ▶ 预览。
4. 构建：菜单「项目 → 构建发布」，平台选 `iOS` / `Android` / `微信小游戏`。

> 设计分辨率 720×1280，竖屏，`FIXED_WIDTH`。代码里也会强制设置一次，所以换机型不会错位。
> 如果场景打不开，见 [docs/01-快速开始.md](docs/01-快速开始.md) 的兜底方案（30 秒重建场景）。

### 3. 校验

```bash
npm test               # 类型检查 + 3 套测试（1163 项断言，约 90 秒）
```

单独运行：

```bash
npm run check            # Web + 核心 TypeScript
npm run check:cocos      # Cocos 脚本按官方引擎类型检查
npm run test:core        # 核心规则单测（1092 项）
npm run test:e2e         # 真实 Chrome 端到端（25 项）
npm run test:project     # Cocos 工程静态校验（46 项）
npm run test:levels      # 60 关生成 + 可解性校验
```

---

## 玩法

- 棋盘由一条条**长蛇形箭头**铺满，每条箭占若干格，箭头指向出口方向。
- 点击任意一支箭：
  - 箭头正前方到棋盘边缘**没有其它箭** → 整条箭飞出棋盘，格子释放；
  - 前方被挡 → 撞墙，扣 1 颗爱心，箭头抖动。
- 3 颗爱心用完或倒计时归零 → 失败；清空棋盘 → 过关。
- 星级看撞墙次数：0~5% 三星，≤18% 二星，其余一星。
- 金币用于「提示」（30 金币高亮一支当前可飞的箭）。

**为什么不会出现死局**：移除一支箭只会让格子变空，永远不会让别的箭变得更堵。
因此「任何合法操作都不会把局面弄坏」，关卡只要初始可解，玩家随便点都能通关。
关卡生成器利用这一点，用「反向放置」保证 100% 可解，见
[docs/05-玩法与关卡设计.md](docs/05-玩法与关卡设计.md)。

---

## 架构

```
assets/scripts/core/          纯逻辑，可单测、可跑 Node
  types.ts                    箭头 / 关卡 / 方向
  rng.ts                      可复现随机（mulberry32）
  levelgen.ts                 反向生成 + 贪心可解性校验 + 配色
  levels.ts                   60 关难度曲线（确定性种子）
assets/scripts/cocos/         Cocos 表现层
  GameRoot.ts                 页面流转、HUD、弹窗、存档、计时
  BoardView.ts                棋盘绘制（Graphics）、命中、飞出/抖动/提示动效
  UIKit.ts / Theme.ts         设计系统与控件
  Assets.ts / Sfx.ts          资源与音效
  SaveStore.ts / Platform.ts  存档、微信/原生桥
web/                          Canvas2D 预览（Vue/React 都不需要）
```

核心规则只写一次：Web 预览通过 esbuild 引用 `assets/scripts/core`，
Cocos 工程直接 import 同一个目录。改一处，两端同时生效。

---

## 三端发布

| 平台 | 文档 | 关键前置 |
| --- | --- | --- |
| iOS / App Store | [docs/02-发布-iOS.md](docs/02-发布-iOS.md) | Apple Developer $99/年、Xcode、隐私政策 |
| Google Play | [docs/03-发布-Android.md](docs/03-发布-Android.md) | Play 开发者账号、签名 keystore、AAB |
| 微信小游戏 | [docs/04-发布-微信小游戏.md](docs/04-发布-微信小游戏.md) | 企业主体、游戏版号 / 备案、微信开发者工具 |
| 测试报告 | [docs/07-测试报告.md](docs/07-测试报告.md) | 1163 项断言、性能数据、未覆盖项与风险 |

---

## 测试与验证范围

`npm test` 全绿：**1163 项断言，0 失败**。明细见 [docs/07-测试报告.md](docs/07-测试报告.md)。

- **核心规则**（1092 项）：60 关完整性/可解性、单调性随机顺序 60 局、250 关随机规格压力测试、配色、性能。
- **浏览器 E2E**（25 项）：真实 Chrome 跑完首页→对局→提示→暂停→胜负→存档→关卡选择→5 档屏幕→5 关连打；
  实测 60fps、点击响应 2ms、FCP 44ms、0 控制台错误。
- **Cocos 工程静态校验**（46 项）：场景图引用、脚本 UUID 联动、资源路径与文件头、核心零引擎依赖、构建产物无外链。

**仍未覆盖**：Cocos 编辑器实际导入/构建、iOS/Android/微信真机、广告与内购（接口占位）。
本机没有安装 Cocos Creator，第一次打开请按 `docs/01` 的 3 分钟检查清单过一遍（场景、竖屏、设计分辨率）。

---

## 资源与许可

- 字体：**ZCOOL KuaiLe**（SIL Open Font License 1.1），已按实际用字子集化到 ~43KB。
- 其余美术（Logo、吉祥物、图标、背景）与音效均为本项目脚本生成，无第三方版权素材。
- 生成脚本：`tools/gen_assets.py`、`tools/render-assets.mjs`、`tools/subset_font.py`。
- 详见 [docs/06-美术与音效资源.md](docs/06-美术与音效资源.md)。