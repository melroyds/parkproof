#!/usr/bin/env bash
# TEMP staging deploy for the Greenfield redesign preview.
# Builds the PWA with an obscure base path and syncs ONLY that prefix into the
# existing bucket/distribution. Prod (/, /app/) is never touched. noindexed.
set -euo pipefail
export PATH="/c/Program Files/Amazon/AWSCLIV2:$PATH"

SLUG="q7m2x9k4z8a3"
BUCKET="parkproof-app-251800369612"
DIST="E33V8DMM3LQACG"
REGION="ap-southeast-2"
API_URL="https://tlsmpbft4f.execute-api.ap-southeast-2.amazonaws.com/sign-translate"
OUT="dist-staging"

cd "$(dirname "$0")/.."

# Must be exported (not an inline prefix): Git Bash converts a command's
# leading-slash args using the CURRENT shell env, before any same-line
# assignment applies. Without this, --base=/q7m2x9k4z8a3/ becomes a Windows path.
export MSYS_NO_PATHCONV=1

# Backend identifiers (same as prod, so scan->verdict and auth work on staging).
# shellcheck disable=SC1091
source scripts/.aws-resources

echo "▶ typecheck"
npx tsc -b

echo "▶ build (base=/$SLUG/)"
rm -rf "$OUT"
VITE_API_URL="$API_URL" \
VITE_COGNITO_USER_POOL_ID="${COGNITO_USER_POOL_ID:-}" \
VITE_COGNITO_APP_CLIENT_ID="${COGNITO_APP_CLIENT_ID:-}" \
VITE_COGNITO_REGION="${COGNITO_REGION:-ap-southeast-2}" \
VITE_COGNITO_HOSTED_UI_DOMAIN="${COGNITO_HOSTED_UI_DOMAIN:-}" \
VITE_VAPID_PUBLIC_KEY="${VAPID_PUBLIC_KEY:-}" \
  npx vite build --base="/$SLUG/" --outDir="$OUT" --emptyOutDir

echo "▶ post-process (noindex)"
node -e '
const fs=require("fs"); const p=process.argv[1];
let h=fs.readFileSync(p,"utf8");
if(!h.includes("noindex")) h=h.replace(/<head>/i,"<head>\n    <meta name=\"robots\" content=\"noindex,nofollow\" />");
fs.writeFileSync(p,h);
console.log("  noindex injected");
' "$OUT/index.html"

echo "▶ sync -> s3://$BUCKET/$SLUG/ (scoped, prod prefixes untouched)"
aws s3 sync "$OUT/" "s3://$BUCKET/$SLUG/" --delete --region "$REGION" >/dev/null

echo "▶ invalidate /$SLUG/*"
MSYS_NO_PATHCONV=1 aws cloudfront create-invalidation --distribution-id "$DIST" \
  --paths "/$SLUG/*" --query 'Invalidation.Id' --output text

echo ""
echo "✓ staging: https://www.parkproof.com.au/$SLUG/"
