# 03 · 发布到 Google Play（Android）

> 目标：产出签名后的 `.aab`，通过 Play Console 内部测试 → 正式发布。
> 前置：Google Play 开发者账号（$25 一次性）、JDK 17、Android Studio、签名 keystore。

---

## 1. Cocos 侧构建

「项目 → 构建发布」新建 **Android** 任务：

| 选项 | 建议值 |
| --- | --- |
| 包名 Package Name | `com.yourcompany.arrowclear`（发布后不可改） |
| Target API Level | **35**（Google Play 2025 起要求） |
| Minimum API Level | 24（覆盖 98%+ 设备） |
| APP ABI | `arm64-v8a` + `armeabi-v7a`（如只发 64 位可仅 arm64） |
| 屏幕方向 | Portrait |
| 构建类型 | **App Bundle（.aab）** |
| 调试模式 | 关闭 |

产物：`build/android/proj/`（Gradle 工程）与 `build/android/publish/` 下的 apk/aab。

> Cocos 3.8 默认生成的 Gradle 工程可以直接用 Android Studio 打开。
> 如果构建面板没有 AAB 选项，在 `build/android/proj/gradle.properties` 里设置
> `APP_BUNDLE=true`，或直接执行下面的 `bundleRelease`。

---

## 2. 生成签名 keystore

只做一次，**务必备份**（丢失将无法更新应用）：

```bash
keytool -genkeypair -v \
  -keystore arrowclear-release.jks \
  -alias arrowclear \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass '你的密码' -keypass '你的密码' \
  -dname "CN=Arrow Clear, OU=Games, O=YourCompany, L=Shanghai, C=CN"
```

### 配置 Gradle 签名

`build/android/proj/build.gradle`（或 `app/build.gradle`）：

```gradle
android {
    signingConfigs {
        release {
            storeFile file(System.getenv("ARROW_KEYSTORE") ?: "../../../keys/arrowclear-release.jks")
            storePassword System.getenv("ARROW_STORE_PASS")
            keyAlias System.getenv("ARROW_KEY_ALIAS") ?: "arrowclear"
            keyPassword System.getenv("ARROW_KEY_PASS")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
            minifyEnabled false
        }
    }
}
```

> 不要把密码写进仓库。用环境变量或 `~/.gradle/gradle.properties`。

### 打包

```bash
cd build/android/proj
./gradlew bundleRelease     # → app/build/outputs/bundle/release/app-release.aab
# 或直接出 apk 自测
./gradlew assembleRelease
```

用 `bundletool` 本地验证 aab 能装：

```bash
bundletool build-apks --bundle=app-release.aab --output=app.apks \
  --ks=arrowclear-release.jks --ks-key-alias=arrowclear
bundletool install-apks --apks=app.apks
```

---

## 3. Play Console 配置

### 3.1 创建应用

- 应用名：一箭清空
- 默认语言：中文（简体）
- 应用类型：游戏
- 免费

### 3.2 商店资料

| 素材 | 规格 | 本仓库 |
| --- | --- | --- |
| 应用图标 | 512×512 PNG（无透明） | `store/appstore/01-home.png` 裁切或重新导出 |
| 特色图片 | 1024×500 | `store/feature-graphic-1024x500.png` |
| 手机截图 | 2~8 张，1080×1920 或更高，16:9/9:16 | `store/googleplay/01-home.png`、`02-game.png` |
| 简短说明 | ≤80 字 | 「一箭清空：点箭发射，清空整块棋盘」 |
| 完整说明 | ≤4000 字 | 见下 |

完整说明模板：

```
《一箭清空》是一款轻松上头的箭阵解谜游戏。

棋盘上铺满了彩色的长箭，每条箭都有自己的出口。
点击箭头发射：前方没有阻挡，它就会飞出棋盘；被别的箭挡住，就会撞墙扣心。

【玩法】
· 观察每条箭的朝向与阻挡关系
· 先放走挡路的箭，层层拆解
· 清空整块棋盘即可过关
· 撞墙越少，星级越高

【特色】
· 60 个手工调校的关卡，越往后越烧脑
· 一局 2~3 分钟，随时来一把
· 提示功能帮你找到当前能飞的那支箭
· 无需联网，无账号，进度本地保存
```

### 3.3 内容分级与数据安全

- **内容分级**：完成 IARC 问卷 → 一般 3+ / Everyone。
- **数据安全**：不收集数据、不共享数据（若接入 AdMob 需如实声明设备 ID、广告数据）。
- **广告**：当前无广告 → 选「不含广告」。
- **目标受众**：13 岁以上或全年龄（若选儿童，广告 SDK 限制会更多）。

### 3.4 新账号的封闭测试要求

2023 年 11 月起，**个人开发者新账号**需要：

- 至少 **12 名测试者**连续参与 **14 天**的封闭测试；
- 之后才能申请正式发布。

公司账号目前不受此限制，但仍建议先走「内部测试 → 封闭测试 → 正式版」。
提前准备好测试者名单，别等到要发布才发现卡在这里。

### 3.5 上传与发布

1. 测试 → 内部测试 → 创建版本 → 上传 `.aab`
2. 填写版本说明（`versionCode` 每次必须递增）
3. 审核通过后，正式版 → 创建版本 → 发布

---

## 4. 可选：接入 AdMob

`assets/scripts/cocos/Platform.ts` 已经预留了桥接位置。推荐用 Cocos 的 AdMob 插件或
`native.reflection` 调用原生 SDK：

- 激励视频：三个广告位——体力弹窗（+1 体力）、失败复活（回 3 心加时）、提示用完（+1 次），
  入口都在 `GameRoot.ts`，广告桥在 `Platform.showRewardedAd()`
- 插屏：每 3 关一次，注意不要在结算弹窗上叠加
- 隐私：欧盟需 UMP / GDPR 同意；美国需 COPPA 声明

广告接入后必须更新 **数据安全表单** 与 **广告声明**，否则会被下架。

---

## 5. 常见问题

**targetSdk 不够新**：Play 会直接拒绝上传。Cocos 构建面板里改成 35，
或修改 `build/android/proj/gradle.properties` 的 `PROP_TARGET_SDK_VERSION=35`。

**64 位要求**：必须包含 `arm64-v8a`，否则无法发布。

**aab 安装失败**：用 `bundletool` 而不是直接拖 aab 到手机；或用 `assembleRelease` 出 apk 自测。

**签名不一致**：一旦用 Play App Signing 上传，后续更新必须用同一把上传密钥。
换电脑前先导出 keystore 和密码。

**华为/小米等国内渠道**：需要单独出 APK 并提交各商店，包名一致、签名一致；
国内渠道还要求软著、ICP 备案等，见微信小游戏文档的资质部分。

---

## 6. 上线检查清单

- [ ] 包名最终确认，签名 keystore 已备份
- [ ] targetSdk 35、含 arm64-v8a、Release 构建
- [ ] versionCode / versionName 正确
- [ ] 512 图标、1024×500 特色图、≥2 张 1080×1920 截图
- [ ] 数据安全表单与 SDK 实际行为一致
- [ ] 内容分级问卷完成
- [ ] 隐私政策 URL
- [ ] 封闭测试 12 人 / 14 天（个人新账号）
- [ ] 真机安装验证：启动、横竖屏锁定、返回键、后台恢复