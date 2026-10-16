# iOS：用免费 Apple ID 装到自己的 iPhone

Rei 2026-10-16 定：不交 Apple Developer Program 年费，不走 TestFlight，用 Xcode 个人团队（Personal Team）直接装真机。

## 限制
- 签名 7 天过期，过期后 app 打不开，要连 Mac 重新装一次（覆盖安装，数据还在；删掉 app 才会丢本机数据，云端同步的不丢）。
- 一台设备最多 3 个这样装的 app。
- 免费账号开不了一部分能力（推送、App Group 等）；iOS 小组件要 App Group，先不接。本地通知、mindough:// 深链接、Google 登录不受影响。

## Rei 的 Mac：2018 款 Intel MacBook Pro（2026-10-16）
- 最高只能升 macOS Sequoia 15 → 最高 Xcode 26.3（26.4 起要 Tahoe 26.2；Xcode 27 只支持 Apple 芯片）。
- iPhone 还在 iOS 26：照下面步骤用 Xcode 26.3 直接装。
- Rei 的 iPhone 13 已是 iOS 27 → 走 Actions + Sideloadly（下面「推荐做法」）；本地 Xcode 那套留作备用。

## 推荐做法：Actions 打包 + Sideloadly 安装
1. GitHub 仓库 → Actions → 「Build iOS」→ Run workflow（只手动触发，`.github/workflows/ios.yml`，runner `xcode-27`）。私有仓库 macOS 分钟按 10 倍计，一次大约 15–25 分钟。
2. 跑完下载 artifact `mindough-ios-unsigned`，解压得 `Mindough-unsigned.ipa`。
3. Mac 上装 Sideloadly（sideloadly.io），iPhone 用线连上，拖进 ipa，填免费 Apple ID，Start。
4. iPhone：设置 → 隐私与安全性 → 开发者模式打开；设置 → 通用 → VPN 与设备管理 → 信任你的 Apple ID。
5. 7 天后：Sideloadly 再装一次同一个 ipa（或新跑一次拿最新版），数据还在。Sideloadly 有自动续签，Mac 和 iPhone 同一 Wi-Fi 时可以开。

## 第一次（在 Mac 上）
1. 装 Xcode（App Store），打开一次同意协议；终端 `xcode-select --install`。
2. `brew install cocoapods`；`rustup target add aarch64-apple-ios aarch64-apple-ios-sim`。
3. Xcode → Settings → Accounts → 加上你的 Apple ID（会出现「(Personal Team)」）。
4. 拉仓库：`git clone git@github.com:reiy-leo/Mindough.git && cd Mindough && pnpm install`。
5. `pnpm tauri ios init`（生成 `apps/client/src-tauri/gen/apple`）。
6. `pnpm tauri ios build --open` 不必跑完，或直接用 Xcode 打开 `apps/client/src-tauri/gen/apple/*.xcodeproj`：
   - 选 target `mindough_iOS` → Signing & Capabilities → 勾 Automatically manage signing → Team 选「(Personal Team)」。
   - 若提示 Bundle Identifier `dev.rei8t.mindough` 不可用，改成 `dev.rei8t.mindough.rei` 之类（同时改 tauri.conf.json 的 identifier）。
   - Product → Scheme → Edit Scheme → Run → Build Configuration 选 **Release**（用打包好的前端，不连电脑上的开发服务器）。
7. iPhone 用线连 Mac，信任这台电脑；iPhone 设置 → 隐私与安全性 → 开发者模式 → 打开（会重启）。
8. Xcode 顶部选你的 iPhone，点 ▶ Run。
9. 第一次打开会提示「不受信任的开发者」：iPhone 设置 → 通用 → VPN 与设备管理 → 你的 Apple ID → 信任。

## 每 7 天
连上 Mac，`git pull && pnpm install`，Xcode 里点 ▶ Run 即可（顺便装上最新版）。

## 装好后要试的
登录同步、提醒通知（首次会问权限）、mindough:// 深链接、外链打开、拍照/选图。结果记回 PLAN「真机待验」。

## 已知问题
- 2026-10-17：iOS 包 CI 已能出 ipa（f9b1359）。Sideloadly 报 `GSA returned a non-plist response (HTTP 503)`：苹果从 2026-09 起拦冒充 Xcode 的登录请求。对策：Rei 已是 Sideloadly v0.70.1 仍 503；不行就设置里 Anisette 换 Fake Anisette、关代理；再不行用 AltServer 1.7.6+。
- 2026-10-17：换 Fake Anisette 后报 `Login failed (-80045)`。苹果自 2026-10-12 起拒绝所有第三方工具登录（AltStore/SideStore/iloader/Sideloadly 全中），频繁重试有锁号风险。已知可用：iloader 2.3.8（Windows anisette v3）→ 先装 SideStore 再装 ipa。过渡：Safari 网页版添加到主屏幕。
