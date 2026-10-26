#!/usr/bin/env bash
# 把 apps/client/dist 上传到 R2 桶 mindough-web（先 pnpm --filter client build）
set -euo pipefail
cd "$(dirname "$0")/.."
DIST=../client/dist
# 桶名默认从 wrangler.deploy.jsonc 的 WEB 绑定读，自己部署改了桶名也不用改这里；也可以用 WEB_BUCKET 覆盖
BUCKET="${WEB_BUCKET:-$(grep -o '"binding": "WEB", "bucket_name": "[^"]*"' wrangler.deploy.jsonc | sed 's/.*"bucket_name": "//; s/"$//')}"
BUCKET="${BUCKET:-mindough-web}"
(cd "$DIST" && find . -type f ! -name '_headers' | sed 's|^\./||') | while read -r f; do
  npx wrangler r2 object put "$BUCKET/$f" --file "$DIST/$f" --remote >/dev/null
  echo "上传 $f"
done
