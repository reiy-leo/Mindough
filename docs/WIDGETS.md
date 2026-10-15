# 小组件（M3-3）

「我的一天 + 今天要打卡」在 app 外面也能看到。三块，完成度不同：

| 平台 | 形式 | 状态 |
|---|---|---|
| macOS / Windows / Linux | 置顶的「小窗」（Tauri 第二个窗口） | ✅ 做好；真机待验 |
| Android | 主屏 AppWidget，读 app 写的 JSON 快照 | 快照 ✅（app 写）；Kotlin 小组件写好了，**还没接进构建** |
| iOS | WidgetKit 扩展 | 只有脚手架（Swift 文件 + 步骤），要 Rei 在 Xcode 里加 target、开 App Group |

## 桌面小窗

- 入口：我的一天页标题右边的「打开小窗」按钮（只在桌面 app 里出现；网页、手机没有）。
- `lib/windows.ts` 的 `openMiniWindow()` 开一个 label 为 `mini` 的 `WebviewWindow`：`index.html?window=mini#/mini`，340 × 540，`alwaysOnTop`，可调大小；已经开着就叫到前面。
- `main.tsx` 看到 `?window=mini` 就只渲染 `components/MiniWindow.tsx`（+ 详情弹层 + 提示）：标题「我的一天」+ 日期和完成数、置顶开关（图钉）、「打开主窗口」；我的一天的任务（`TaskRow`，可以直接勾 / 计时 / +1）、「今天要打卡」（不重复列出已在我的一天里的）；底部「加到今天…」输入条。点一行在小窗里开详情。
- 数据：两个窗口共用同一个 rusqlite 连接；各自的内存快照靠 Tauri 事件 `mindough:changes` 互相告知（写的一方 `store.onLocalWrite` 发出，另一方 `store.applyRemote` 合进来，不进 outbox）。小窗不跑同步、不排提醒、不接登录回调，都交给主窗口。
- 权限（`capabilities/default.json`）：windows 加 `mini`；`core:webview:allow-create-webview-window`、`core:window:allow-set-always-on-top`、`allow-set-focus`、`allow-show`、`allow-unminimize`。
- 截图：`?window=mini` 在浏览器里也能打开（`work/screens/m3-mini-*`），但浏览器里的「置顶」「打开主窗口」不起作用。

## Android AppWidget

已经有的：
- 手机 app 里，数据一变（防抖 2 秒）`lib/widget-snapshot.ts` 就把快照交给 Rust 命令 `widget_snapshot`（`src-tauri/src/widget.rs`），写到 app 数据目录的 `widget-snapshot.json`（先写 .tmp 再改名）：

```json
{ "version": 1, "at": "2026-10-16T01:00:00.000Z", "date": "2026-10-16",
  "myDay": [{ "id": "…", "title": "买菜", "done": false }],
  "checkIns": [{ "id": "…", "title": "喝 8 杯水", "done": false }] }
```

- `src-tauri/mobile/android-widget/`：`MindoughWidget.kt`（AppWidgetProvider，读快照、拼成几行、点了打开 app）、`res/layout/mindough_widget.xml`、`res/xml/mindough_widget_info.xml`（3 × 2 格，30 分钟系统刷新）。

还要做的（`gen/android` 是 `tauri android init` 生成的、不进仓库，所以没接）：
1. 在 `build.yml` 的 Android job 里 `tauri android init` 之后加一步，把 `MindoughWidget.kt` 拷到 `gen/android/app/src/main/java/dev/rei8t/mindough/`，`res/` 合到 `gen/android/app/src/main/res/`。
2. 在 `gen/android/app/src/main/AndroidManifest.xml` 的 `<application>` 里加：

```xml
<receiver android:name=".MindoughWidget" android:exported="false">
  <intent-filter><action android:name="android.appwidget.action.APPWIDGET_UPDATE" /></intent-filter>
  <meta-data android:name="android.appwidget.provider" android:resource="@xml/mindough_widget_info" />
</receiver>
```

3. 真机确认 Tauri 的 `app_data_dir` 在 Android 上是 `context.dataDir`（Kotlin 里两处都找）。
4. 以后：写完快照立刻刷新小组件（Rust → JNI 调 `MindoughWidget.refresh`），列表改成 `RemoteViewsService` 可以滚动、可以点勾。

没在这里做：本机没有 Android SDK，编不了，也就没法验证——所以先不往 CI 里加，免得打包坏掉。

## iOS WidgetKit

`src-tauri/mobile/ios-widget/MindoughWidget.swift` 是完整的小组件代码（小 / 中两种尺寸，读快照显示前 5 件）。接入要在 Mac 上：
1. `pnpm tauri ios init` 后用 Xcode 打开 `gen/apple`，File → New → Target → Widget Extension，名字 MindoughWidget，用这个 Swift 文件替换模板。
2. app target 与 widget target 都开 App Groups：`group.dev.rei8t.mindough`。
3. `widget.rs` 在 iOS 上要写到共享容器（`FileManager.containerURL(forSecurityApplicationGroupIdentifier:)`），现在写的是 app 自己的数据目录——小组件读不到。需要一个小的 Swift 插件或 objc 调用拿到容器路径。
4. 写完快照调 `WidgetCenter.shared.reloadAllTimelines()`。

iOS 要开发者账号签名（App Group 也要），分发方式待 Rei 定，所以只到脚手架。
