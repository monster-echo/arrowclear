# CI · GitHub Actions 双端发布流水线

参照 `tongtongtong`（Cozy Valley Match）已验证的发布管线移植；引擎差异在
Cocos Creator 3.8.6 CLI（macOS runner 有 GUI 会话，满足编辑器的硬性要求）。

## Workflow 一览

| workflow | 触发 | 作用 |
| --- | --- | --- |
| `ci` | push main / PR | TS 类型检查、核心规则回归、关卡校验、Cocos 工程校验、web E2E（runner 自带 Chrome，经 `CHROME_PATH` 注入） |
| `release` | `v*` tag / 手动 dispatch | 签名 AAB → Play internal(completed)+production(**draft**)；签名 IPA → TestFlight；tag push 且双端成功时自动建 GitHub Release |
| `submit-review` | 手动 dispatch | 两店 API 送审（见下方的首次限制） |
| `apple-signing-check` | 手动 dispatch | Apple 签名凭据诊断，TestFlight 上传失败时先跑这个 |

`release` 的 `dry_run=true`：跳过全部签名/上传，只验证 Cocos CLI 出双端工程、
iOS 免签模拟器编译（`STAGE=sim`）、Android debug 包（`STAGE=debug`）。
改了构建配置后先跑一次 dry run。

## 版本与发版流程

1. 改版本（单源 `release/version.json`，build 必须比上一次上传严格递增）：
   ```bash
   python3 tools/set_versions.py set --version 1.0.1 --build 2
   ```
2. 写 release notes（**en-US 必填**，否则上传脚本失败）：
   - `release/play-store/release-notes/<version>/en-US.txt`（zh-CN 可选）
   - `release/app-store/release-notes/<version>/en-US.txt`（zh-Hans 可选）
3. 提交、打 tag、推送：`git tag v1.0.1 && git push origin main --tags`
   （tag 必须 = `v` + version.json 里的 version，否则 version job 直接报错）

版本注入方式：iOS 用 `xcodebuild` 的 `MARKETING_VERSION/CURRENT_PROJECT_VERSION`
覆写；Android 用 AGP 的 `android.injected.version.*` 属性。构建产物：
`export/android/arrowclear-release.aab`、`export/ios/export/arrowclear.ipa`。
CI 采用了流水线之后，**不要再从本机上传商店**，避免 build 号冲突。

## Secrets（Settings → Secrets and variables → Actions）

沿用 tongtongtong 的命名，账号级资源直接复用：

| Secret | 值 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | `base64 < ~/workspace/keys/arrowclear-release.keystore` |
| `ANDROID_KEYSTORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_ALIAS` | `arrowclear` |
| `GOOGLE_PLAY_SERVICE_ACCOUNT_JSON` | `~/workspace/keys/play-publisher-key.json` 原文（账号级，共用） |
| `APPLE_API_KEY_ID` | `3A864HP66K`（账号级，共用） |
| `APPLE_API_ISSUER_ID` | `3c721bed-bf99-4f67-891f-5ae3b78bc7ac` |
| `APPLE_API_PRIVATE_KEY` | `~/workspace/keys/AuthKey_3A864HP66K.p8` 原文 |
| `APPLE_DISTRIBUTION_CERT_P12` | Apple Distribution 证书 `.p12`（base64），Team `2VA9TC6SG4` |
| `APPLE_DISTRIBUTION_CERT_PASSWORD` | 导出该 p12 时设的密码 |

不设 provisioning profile secret：IPA 走**自动签名 + ASC API key**
（`-allowProvisioningUpdates` 会自动注册 Bundle ID、生成 store profile，
tungtungtung 已验证此机制）。本地构建用 git-ignored 的 `release.env`：

```
KEYSTORE=/Users/echo/workspace/keys/arrowclear-release.keystore
KEYSTORE_PASS=...
KEYSTORE_USER=arrowclear
ASC_KEY_PATH=/Users/echo/workspace/keys/AuthKey_3A864HP66K.p8
ASC_KEY_ID=3A864HP66K
ASC_ISSUER=3c721bed-bf99-4f67-891f-5ae3b78bc7ac
```

## 引擎侧要点（Cocos 特有）

- 编辑器 zip 来自官方固定 URL（`download.cocos.com/CocosCreator/v3.8.6/…`），
  cache key `cocos-creator-3.8.6-mac`。
- CLI 成功退出码是 **36**（32=参数错误，34=构建错误），`build_ios.sh` /
  `build_android.sh` 已按此判断；`--build` 参数必须单行，换行会静默不构建。
- 构建配置在 `tools/build-config-{ios,android}.json`（scene uuid 见文件）；
  平台细节（targetSdk/ABI/竖屏/包名/版本）由脚本注入，不在 JSON 里写不确定的键。
- `PrivacyInfo.xcprivacy` 无法被 Cocos 写进 Xcode 工程，构建脚本在导出 IPA 后
  注入 `.app` 并用 Distribution 证书重签（`tools/ios/PrivacyInfo.xcprivacy` 为源）。
- iOS 免签模拟器编译：某些 3.8.x 版本模拟器 slice 有问题，脚本会自动回退到
  免签真机构建。

## 仍需人工（不能全自动）

- **Play 首次送审**：draft 应用必须在网页控制台点一次（发布概览 → 将应用送审）；
  `submit-review` workflow 从第二次发布起可用。
- **ASC 首次**：建 App 记录（Bundle ID `tech.zhongbei.arrowclear`）、
  首次年龄分级问卷要网页操作；之后 `submit-review`（apple）可直接 API 送审。
- Play 数据安全表 / 内容分级 / 目标受众表单；ASC App 隐私标签。
- production draft → 审核的最终决定权永远在人（自动流水线只到 draft 为止）。

## 成本提示

`macos-latest` 按 10× 分钟计费：一次完整 release 约 30–60 min → 计 300–600 分钟。
dry run 同价，不要频繁跑。
