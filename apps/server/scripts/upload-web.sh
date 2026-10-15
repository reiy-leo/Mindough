#!/usr/bin/env bash
# 把 apps/client/dist 上传到 R2 桶 mindough-web（先 pnpm --filter client build）
set -euo pipefail
cd "$(dirname "$0")/.."
DIST=../client/dist
(cd "$DIST" && find . -type f ! -name '_headers' | sed 's|^\./||') | while read -r f; do
  npx wrangler r2 object put "mindough-web/$f" --file "$DIST/$f" --remote >/dev/null
  echo "上传 $f"
done
