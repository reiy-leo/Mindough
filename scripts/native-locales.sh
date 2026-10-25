#!/usr/bin/env bash
# 原生端的本地化显示名（Rei 2026-10-24：英文 Mindough，中文「念头团」；2026-10-25 加了西、葡、俄、日、德、法、印尼，都叫 Mindough）。gen/ 不进仓库，CI 里 init 之后跑这个把文件拷进去。
#   scripts/native-locales.sh android            # tauri android init 之后：values-zh / values-zh-rCN / values-es / values-pt-rBR / values-ru / values-ja / values-de / values-fr / values-in 的 app_name
#   scripts/native-locales.sh ios <Foo.app>       # 打 ipa 之前：把 locales/apple 下每个 .lproj（en、zh-Hans、es、pt-BR、ru、ja、de、fr、id）的 InfoPlist.strings 放进 .app
# 加语言时三处一起改：locales/ 下的文件、src-tauri/Info.plist 的 CFBundleLocalizations、tauri.conf.json 的 bundle.macOS.files。
# macOS 不用这个：tauri.conf.json 的 bundle.macOS.files 直接打进 Contents/Resources。
# 只改显示名；bundle identifier（dev.rei8t.mindough）、productName、安装包文件名都不动。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/apps/client/src-tauri/locales"
case "${1:-}" in
  android)
    RES="$ROOT/apps/client/src-tauri/gen/android/app/src/main/res"
    [ -d "$RES" ] || { echo "没有 $RES，先 tauri android init"; exit 1; }
    for d in "$SRC"/android/values-*; do
      name=$(basename "$d")
      mkdir -p "$RES/$name"
      cp "$d"/*.xml "$RES/$name/"
    done
    # 默认 strings.xml 里没有 main_activity_title 时，各语言里也去掉（免得 lint 报缺默认资源）
    if ! grep -q 'name="main_activity_title"' "$RES/values/strings.xml" 2>/dev/null; then
      for d in "$SRC"/android/values-*; do
        f="$RES/$(basename "$d")/app_name.xml"
        sed -i.bak '/main_activity_title/d' "$f" && rm -f "$f.bak"
      done
    fi
    for d in "$SRC"/android/values-*; do
      printf '%s: ' "$(basename "$d")"; grep -h 'app_name' "$RES/$(basename "$d")/app_name.xml"
    done
    grep -h 'app_name' "$RES"/values/strings.xml
    ;;
  ios)
    APP="${2:?要给 .app 路径}"
    for l in "$SRC"/apple/*.lproj; do
      mkdir -p "$APP/$(basename "$l")"
      cp "$l"/InfoPlist.strings "$APP/$(basename "$l")/"
    done
    ls "$APP"/*.lproj
    ;;
  *) echo "用法：$0 android | ios <Foo.app>"; exit 2 ;;
esac
