# 02 · 发布到 App Store（iOS）

> 目标：从 Cocos 工程产出一个可提交的 `.ipa`，并在 App Store Connect 完成提审。
> 前置：Apple Developer Program（个人/公司 $99/年）、macOS + Xcode、已备案的隐私政策页面。

---

## 1. Cocos 侧构建

「项目 → 构建发布」新建 **iOS** 任务：

| 选项 | 建议值 |
| --- | --- |
| 包名 Bundle Identifier | `com.yourcompany.arrowclear`（与 ASC 一致，提交后不可改） |
| 目标设备 | iPhone / iPad 均可，或仅 iPhone |
| 屏幕方向 | **Portrait**（本游戏只支持竖屏） |
| 渲染后端 | 默认 Metal |
| 调试模式 | 关闭 |
| 资源服务器地址 | 留空（内置资源） |

构建完成后得到 `build/ios/proj/`，里面是 Xcode 工程。

```bash
open build/ios/proj/*.xcodeproj
```

---

## 2. Xcode 配置

### 2.1 签名

- 选中 target → **Signing & Capabilities**
- Team 选择你的开发者账号
- 勾选 **Automatically manage signing**
- Bundle Identifier 与 Cocos 里填的一致

### 2.2 竖屏 & 状态栏

在 `Info.plist`（或 target → Info）确认：

```xml
<key>UISupportedInterfaceOrientations</key>
<array>
  <string>UIInterfaceOrientationPortrait</string>
</array>
<key>UIRequiresFullScreen</key><true/>
<key>UIStatusBarHidden</key><true/>
<key>UIViewControllerBasedStatusBarAppearance</key><false/>
```

### 2.3 应用名 & 图标

- `CFBundleDisplayName` = `一箭清空`
- 图标使用 `store` 里的 1024 图（无透明通道）：

```bash
# 生成各尺寸（示例，按 Xcode 15 的 AppIcon 单尺寸也可）
sips -z 180 180 assets/art/app-icon-1024.png --out AppIcon-60@3x.png
```

Xcode 15+ 支持 **Single Size 1024×1024**，直接把 `app-icon-1024.png` 拖进
`Assets.xcassets/AppIcon.appiconset` 即可，系统会自动生成其余尺寸。

### 2.4 隐私清单（必做）

Cocos 引擎在 iOS 上会通过 `NSUserDefaults` 保存本地数据。
在 Xcode 里 **File → New → File → App Privacy**，命名 `PrivacyInfo.xcprivacy`，内容：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>NSPrivacyTracking</key><false/>
  <key>NSPrivacyTrackingDomains</key><array/>
  <key>NSPrivacyCollectedDataTypes</key><array/>
  <key>NSPrivacyAccessedAPITypes</key>
  <array>
    <dict>
      <key>NSPrivacyAccessedAPIType</key>
      <string>NSPrivacyAccessedAPICategoryUserDefaults</string>
      <key>NSPrivacyAccessedAPITypeReasons</key>
      <array><string>CA92.1</string></array>
    </dict>
  </array>
</dict>
</plist>
```

如果接入统计/广告 SDK，把对应 SDK 的隐私清单合并进来，并在 ASC 的「App 隐私」里如实勾选。

### 2.5 出口合规

`Info.plist` 加：

```xml
<key>ITSAppUsesNonExemptEncryption</key><false/>
```

这样每次上传不用再回答加密问题。

### 2.6 真机跑一遍

- 用 Release 配置 Archive 前，先真机 Debug 跑通：首页、开始游戏、点箭飞出、撞墙扣心、胜负弹窗。
- 检查刘海/灵动岛安全区：HUD 顶部按钮没有被遮住。
- 检查静音键打开时是否有声音（有 BGM 时尤其注意）。

---

## 3. 上传

1. Xcode → 选择 **Any iOS Device (arm64)** → **Product → Archive**。
2. Organizer → **Distribute App → App Store Connect → Upload**。
3. 等待处理完成（通常 5~30 分钟），在 ASC 的 TestFlight 里可见。
4. 建议先内部 TestFlight 试玩 1~2 天。

---

## 4. App Store Connect 资料

### 4.1 应用信息

| 字段 | 填写 |
| --- | --- |
| 名称 | 一箭清空（30 字符内，重名可加副标题） |
| 副标题 | 停不下来的箭阵解谜 |
| 类别 | 游戏 / 益智 |
| 年龄分级 | 4+ |
| 价格 | 免费 + 激励广告（无内购） |

### 4.2 截图

App Store 会要求 **6.9 英寸**（1320×2868）必填，6.5 英寸（1242×2688）可选但建议一并上传。
本仓库已生成：

- `store/appstore/00-home-6.9.png`（1320×2868）
- `store/appstore/01-home.png`、`02-game.png`、`03-win.png`（1290×2796，6.7 英寸）

如果 ASC 只接受 6.9，用 1320×2868 那张，其余两张用同尺寸重新截图（把浏览器窗口设为 440×956、
DPR 3，再跑 `tools/cdp.mjs`）。

### 4.3 隐私

- 「App 隐私」：如果不接统计 SDK → **不收集数据**。
- 隐私政策 URL：必须可访问，内容至少包含：收集哪些数据、用途、联系方式、删除方式。
  即使不收集，也需要一个说明页。
- 若接入了广告/统计，必须声明 Device ID、使用数据等。

### 4.4 激励广告（无内购）

本作**不含任何内购/计费**，也没有金币等中间货币，变现只有激励视频：
补体力、失败复活、补提示三个入口（每次广告 +1 点/次），因此不触发审核指南 3.1.1。

接入方式（正式包）：

1. Cocos Service 面板接入 AdMob / 穿山甲等聚合 SDK，创建「激励视频」广告位；
2. 把广告位 ID 填进 `assets/scripts/cocos/Platform.ts` 的广告桥（微信端已接
   `wx.createRewardedVideoAd`，iOS/Android 原生位待填）；
3. 未配 ID 时游戏自动回退到内置「演示广告」，不会崩溃也不会留空白位。

接入广告 SDK 后注意：隐私政策与「App 隐私」标签要声明设备标识符/使用数据；
用到 IDFA 的聚合 SDK 需要加 ATT 弹窗（`NSUserTrackingUsageDescription`）。

---

## 5. 审核要点（游戏类）

| 条款 | 风险 | 处理 |
| --- | --- | --- |
| 4.2 Minimum Functionality | 玩法太单薄被拒 | 60 关 + 星级 + 提示 + 存档，已具备基本内容量；提审时在备注里写清玩法 |
| 2.1 App Completeness | 闪退/占位按钮 | 不要留「敬请期待」按钮；未配广告位时自动回退演示广告，不留空白 |
| 3.1.1 In-App Purchase | 无内购被误判 | 商店只有广告入口，无任何付费项；提审备注写明「无内购」 |
| 5.1.1 Privacy | 未声明数据收集 | 隐私清单 + 隐私政策 |
| 2.3.1 Hidden Features | 动态下发玩法 | 不要热更代码 |

提审备注建议：

```
一箭清空是一款单机解谜游戏。点击箭头发射，前方被挡会撞墙扣血，
清空棋盘过关。共 60 关，无账号系统，本地存档，无内购；
体力与提示次数均可通过观看激励视频免费获得。
```

---

## 6. 上线检查清单

- [ ] Bundle ID 与 ASC 一致，签名用 Distribution 证书
- [ ] 仅竖屏、状态栏隐藏、安全区正常
- [ ] 1024 图标无透明通道
- [ ] 6.9 英寸截图 3 张以上
- [ ] 隐私政策 URL 可访问
- [ ] PrivacyInfo.xcprivacy 已加入 target
- [ ] 激励视频广告位 ID 已配置（或确认以演示广告提审）
- [ ] 真机 Release 包无崩溃、音频正常
- [ ] 出口合规 `ITSAppUsesNonExemptEncryption=false`
- [ ] TestFlight 内部试玩通过