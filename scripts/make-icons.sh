#!/usr/bin/env bash
# 从 apps/client/src-tauri/icons/source-character.png（透明底角色图）生成全部图标。需要 ImageMagick 7。
set -euo pipefail
cd "$(dirname "$0")/../apps/client"
I=src-tauri/icons; P=public/icons; T=$(mktemp -d)
C=$I/source-character.png
fit(){ magick "$C" -resize ${1}x${1} -background none -gravity center -extent ${2}x${2} "$3"; }
magick -size 1024x1024 gradient:'#FFFFFF'-'#E4EAFF' $T/bg.png
fit 800 1024 $T/c800.png; magick $T/bg.png $T/c800.png -gravity center -composite -alpha off -depth 8 $I/source-full.png
fit 680 1024 $T/c680.png; magick $T/bg.png $T/c680.png -gravity center -composite -alpha off -depth 8 $T/maskable.png
fit 600 1024 $T/fg.png
magick -size 824x824 xc:none -fill white -draw "roundrectangle 0,0,823,823,185,185" $T/mask.png
magick -size 824x824 gradient:'#FFFFFF'-'#E4EAFF' \( $T/mask.png -alpha extract \) -alpha off -compose CopyOpacity -composite $T/tile.png
fit 660 824 $T/c660.png; magick $T/tile.png $T/c660.png -gravity center -compose over -composite $T/tile2.png
magick $T/tile2.png \( +clone -background '#1a2a66' -shadow 35x14+0+12 \) +swap -background none -layers merge +repage $T/sh.png
magick $T/sh.png -gravity center -background none -extent 1024x1024 -depth 8 $I/source-macos.png
# 桌面（macOS 圆角方块 + 阴影；Windows / Linux 同图）
pnpm exec tauri icon $I/source-macos.png -o $T/mac >/dev/null
cp $T/mac/*.png $T/mac/icon.icns $T/mac/icon.ico $I/
# iOS（满版、不能有透明）
pnpm exec tauri icon $I/source-full.png -o $T/full >/dev/null
for f in $T/full/ios/*.png; do magick "$f" -background white -alpha remove -alpha off $I/ios/$(basename "$f"); done
# Android（旧版满版 / 圆形，自适应前景 + 背景色 #EEF2FF）
for p in mdpi:48:108 hdpi:72:162 xhdpi:96:216 xxhdpi:144:324 xxxhdpi:192:432; do IFS=: read d s g <<<"$p"; D=$I/android/mipmap-$d
  magick $I/source-full.png -resize ${s}x${s} -alpha off $D/ic_launcher.png
  magick $I/source-full.png -resize ${s}x${s} \( -size ${s}x${s} xc:none -fill white -draw "circle $((s/2)),$((s/2)) $((s/2)),0" \) -alpha off -compose CopyOpacity -composite $D/ic_launcher_round.png
  magick $T/fg.png -resize ${g}x${g} $D/ic_launcher_foreground.png; done
# 网页 / PWA
magick $I/source-macos.png -resize 192x192 $P/icon-192.png; magick $I/source-macos.png -resize 512x512 $P/icon-512.png
magick $T/maskable.png -resize 192x192 $P/maskable-192.png; magick $T/maskable.png -resize 512x512 $P/maskable-512.png
magick $I/source-full.png -resize 180x180 -alpha off $P/apple-touch-icon.png
magick $I/source-macos.png -resize 64x64 public/favicon.png; magick $I/source-macos.png -define icon:auto-resize=48,32,16 public/favicon.ico
rm -rf $T; echo "图标已生成。改了 public/icons 记得把 public/sw.js 的 SHELL 版本号 +1。"
