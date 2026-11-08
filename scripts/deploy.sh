#!/usr/bin/env bash
# ParkProof: deploy to AWS.
# Idempotent: re-run after code changes to update Lambda + frontend.
#
# Provisions:
#   - IAM role for Lambda execution
#   - Lambda function (sign translator) + ANTHROPIC_API_KEY env var
#   - API Gateway HTTP API (POST /sign-translate)
#   - S3 bucket with static website hosting + public read
#   - CloudFront distribution (HTTPS + global CDN)
#
# Usage:
#   bash scripts/deploy.sh                  the full deploy (.env and AWS credentials)
#   bash scripts/deploy.sh --package-only   build the Lambda package in a temp
#                                           folder, list what's in it and stop:
#                                           no AWS call, no .env needed
#   DEPLOY_ALLOW_WORKDAY=1 bash scripts/deploy.sh
#                                           build the frontend with workday mode
#                                           on. Only after a lawyer has read its
#                                           copy (docs/legal-review-queue.md).

set -euo pipefail

# ───── Options ──────────────────────────────────────────────────────────────
PACKAGE_ONLY=0
for arg in "$@"; do
  case "$arg" in
    --package-only) PACKAGE_ONLY=1 ;;
    -h|--help)
      sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "✗ Unknown option: $arg (try --help)" >&2
      exit 2
      ;;
  esac
done

# Workday mode ships off until a lawyer has read its copy
# (docs/legal-review-queue.md). The build always gets an explicit VITE_FEATURE_WORKDAY,
# which beats every .env file (vite.config.ts keeps VITE_* values already set).
# The switch is read here, from the shell that ran this script, before .env and
# scripts/.aws-resources are loaded below (set -a exports every line in
# them), so a line in either file can't turn workday mode on.
if [[ "${DEPLOY_ALLOW_WORKDAY:-}" == "1" ]]; then
  WORKDAY_FLAG=true
  WORKDAY_NOTE="ON (VITE_FEATURE_WORKDAY=true, because DEPLOY_ALLOW_WORKDAY=1)"
else
  WORKDAY_FLAG=false
  WORKDAY_NOTE="off (VITE_FEATURE_WORKDAY=false; DEPLOY_ALLOW_WORKDAY=1 turns it on)"
fi
# Read-only, so a WORKDAY_FLAG line in a sourced file stops the deploy
# rather than changing the build.
readonly WORKDAY_FLAG WORKDAY_NOTE

# ───── Config ───────────────────────────────────────────────────────────────
PROJECT=parkproof
REGION=ap-southeast-2
LAMBDA_NAME=$PROJECT-sign-translator
# The AWS SDK for JavaScript v3 needs Node 22 or newer from early January
# 2027. CI tests on Node 22 too (.github/workflows/test.yml).
LAMBDA_RUNTIME=nodejs22.x
ROLE_NAME=$PROJECT-lambda-role
API_NAME=$PROJECT-api
DIST_COMMENT=$PROJECT-cdn

# ───── Preflight ────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.."
REPO_ROOT=$(pwd -P)

# ───── Lambda package helpers ───────────────────────────────────────────────
# The Lambda package is staged in a temp folder outside the repo: the lambda/
# sources are copied there (not node_modules, not the tests), production
# dependencies are installed there with npm ci, and the zip is made there.
# lambda/node_modules in the working tree is never deleted or reinstalled, so
# a Dropbox or OneDrive lock on it can't stop a deploy, and the Lambda tests
# keep their dev dependencies afterwards.

# A path the Windows aws.exe or PowerShell can read. They don't understand
# Git Bash paths such as /tmp/... or /c/Users/... (CLAUDE.md gotcha). Where
# there's no cygpath (Linux, macOS) the path is already native.
win_path() {
  if command -v cygpath >/dev/null 2>&1; then cygpath -w "$1"; else printf '%s\n' "$1"; fi
}

# A string inside single quotes in a PowerShell command.
ps_quote() {
  local q="'"
  printf "'%s'" "${1//$q/$q$q}"
}

PKG_TMP=""
KEEP_ZIP=0
cleanup_package() {
  [[ -n "$PKG_TMP" && -d "$PKG_TMP" ]] || return 0
  if [[ "$KEEP_ZIP" == "1" ]]; then
    rm -rf "$PKG_TMP/lambda"
  else
    rm -rf "$PKG_TMP"
  fi
}
trap cleanup_package EXIT

# Sets FUNCTION_ZIP to the built package.
build_lambda_package() {
  local tmp_root="${TMPDIR:-/tmp}"
  if command -v cygpath >/dev/null 2>&1; then tmp_root=$(cygpath -u "$tmp_root"); fi
  PKG_TMP=$(mktemp -d "$tmp_root/parkproof-lambda.XXXXXX")
  local pkg_real
  pkg_real=$(cd "$PKG_TMP" && pwd -P)
  case "$pkg_real/" in
    "$REPO_ROOT"/*)
      echo "✗ The temp folder $pkg_real is inside the repo; set TMPDIR to a folder outside it" >&2
      exit 1
      ;;
  esac
  local stage="$PKG_TMP/lambda"
  FUNCTION_ZIP="$PKG_TMP/function.zip"
  mkdir -p "$stage"
  echo "  • packaging in $(win_path "$PKG_TMP")"

  local entry name
  for entry in lambda/* lambda/.[!.]*; do
    [[ -e "$entry" ]] || continue
    name=$(basename "$entry")
    case "$name" in
      node_modules|*.test.js|.DS_Store|.git*) continue ;;
    esac
    cp -R "$entry" "$stage/"
  done
  [[ -f "$stage/package-lock.json" ]] || { echo "✗ lambda/package-lock.json is missing; npm ci needs it" >&2; exit 1; }

  echo "  • installing production dependencies (npm ci --omit=dev)"
  ( cd "$stage" && npm ci --omit=dev --no-audit --no-fund --loglevel=error >/dev/null )

  if command -v zip >/dev/null 2>&1; then
    ( cd "$stage" && zip -rq "$FUNCTION_ZIP" . -x "*.git*" "*.DS_Store" )
  else
    # Windows Git Bash has no zip. Compress-Archive ships with PowerShell.
    # PowerShell 7 (pwsh) writes standard entry names (node_modules/x/y.js);
    # Windows PowerShell 5.1 writes them with backslashes, which Lambda has
    # accepted for every deploy so far, so it stays the fallback.
    local ps=""
    if command -v pwsh >/dev/null 2>&1; then
      ps=pwsh
    elif command -v powershell.exe >/dev/null 2>&1; then
      ps=powershell.exe
    else
      echo "✗ Need either 'zip' or PowerShell on PATH to build the Lambda package" >&2
      exit 1
    fi
    "$ps" -NoProfile -NonInteractive -Command \
      "Compress-Archive -Path $(ps_quote "$(win_path "$stage")\\*") -DestinationPath $(ps_quote "$(win_path "$FUNCTION_ZIP")") -Force" \
      >/dev/null
  fi
  [[ -s "$FUNCTION_ZIP" ]] || { echo "✗ The Lambda package wasn't written" >&2; exit 1; }
}

# Every entry name in a zip, one per line.
zip_entries() {
  if command -v unzip >/dev/null 2>&1; then
    unzip -Z1 "$1"
  elif command -v pwsh >/dev/null 2>&1 || command -v powershell.exe >/dev/null 2>&1; then
    local ps=powershell.exe
    command -v pwsh >/dev/null 2>&1 && ps=pwsh
    "$ps" -NoProfile -NonInteractive -Command \
      "Add-Type -AssemblyName System.IO.Compression.FileSystem; \$z = [IO.Compression.ZipFile]::OpenRead($(ps_quote "$(win_path "$1")")); try { \$z.Entries | ForEach-Object { \$_.FullName } } finally { \$z.Dispose() }" \
      | tr -d '\r'
  else
    python3 -c 'import sys, zipfile; print("\n".join(zipfile.ZipFile(sys.argv[1]).namelist()))' "$1"
  fi
}

# Lambda's limit for a package uploaded with --zip-file.
LAMBDA_DIRECT_UPLOAD_MAX=52428800

# Prints the package's size and top-level entries, and stops the deploy when
# the package can't work: no index.js (the handler is index.handler), no
# package.json (it marks the code as ES modules), no node_modules, or too big
# to upload.
describe_lambda_package() {
  local bytes entries count top
  bytes=$(wc -c < "$FUNCTION_ZIP" | tr -d ' ')
  entries=$(zip_entries "$FUNCTION_ZIP")
  # Here-strings, not pipes, into grep: with pipefail, grep -q stopping early
  # on a long list can fail the pipe and hide a match.
  count=$(grep -c . <<< "$entries" || true)
  top=$(sed -E 's#[/\\].*##' <<< "$entries" | LC_ALL=C sort -u | grep . || true)
  echo "  • package: $bytes bytes ($(awk -v b="$bytes" 'BEGIN { printf "%.1f", b / 1048576 }') MB), $count entries"
  echo "  • top-level entries:"
  sed 's/^/      /' <<< "$top"
  if grep -q '\\' <<< "$entries"; then
    echo "  ! entry names use backslashes (Windows PowerShell 5.1). Lambda has accepted these so far; install PowerShell 7 or zip for standard names."
  fi
  local required
  for required in index.js package.json node_modules; do
    if ! grep -qx "$required" <<< "$top"; then
      echo "✗ $required isn't at the top of the Lambda package; not deploying" >&2
      exit 1
    fi
  done
  if (( bytes > LAMBDA_DIRECT_UPLOAD_MAX )); then
    echo "✗ The package is over Lambda's 50 MB limit for a direct upload; not deploying" >&2
    exit 1
  fi
}

if [[ "$PACKAGE_ONLY" == "1" ]]; then
  echo "▶ Lambda package only. No AWS call is made."
  build_lambda_package
  describe_lambda_package
  KEEP_ZIP=1
  echo "  • kept for inspection: $(win_path "$FUNCTION_ZIP") (delete it when you're done)"
  echo "  • a full deploy would build the frontend with workday mode $WORKDAY_NOTE"
  echo ""
  echo "✓ Package built. Nothing was deployed."
  exit 0
fi

# AWS CLI v2 on Windows installs to "C:\Program Files\Amazon\AWSCLIV2" which
# isn't on Git Bash's default PATH. Add it before doing anything.
if ! command -v aws >/dev/null 2>&1; then
  if [[ -x "/c/Program Files/Amazon/AWSCLIV2/aws.exe" ]]; then
    export PATH="/c/Program Files/Amazon/AWSCLIV2:$PATH"
  fi
fi
command -v aws >/dev/null 2>&1 || { echo "✗ aws CLI not found on PATH"; exit 1; }

[[ -f .env ]] || { echo "✗ .env not found at project root"; exit 1; }
set -a; . ./.env; set +a
[[ -n "${ANTHROPIC_API_KEY:-}" ]] || { echo "✗ ANTHROPIC_API_KEY missing from .env"; exit 1; }

# scripts/.aws-resources is written by setup-auth.sh and carries the Cognito,
# DynamoDB and S3 identifiers. Optional: deploy keeps working without auth
# (the existing /sign-translate etc. routes don't need it). When present,
# auth-enabled features get wired in too.
if [[ -f scripts/.aws-resources ]]; then
  set -a; . ./scripts/.aws-resources; set +a
  echo "▶ Loaded auth resources from scripts/.aws-resources"
  echo "    Cognito User Pool: ${COGNITO_USER_POOL_ID:-(unset)}"
  echo "    DDB sessions:      ${DYNAMODB_TABLE_SESSIONS:-(unset)}"
  echo "    S3 evidence:       ${S3_BUCKET_EVIDENCE:-(unset)}"
  echo "    S3 user-feedback:  ${S3_BUCKET_USER_FEEDBACK:-(unset)}"
fi

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET=$PROJECT-app-$ACCOUNT_ID

echo "▶ Deploying ParkProof"
echo "  Account: $ACCOUNT_ID"
echo "  Region:  $REGION"
echo "  Bucket:  $BUCKET"
echo "  Workday: $WORKDAY_NOTE"
echo ""

# ───── [1/6] IAM role for Lambda ────────────────────────────────────────────
echo "▶ [1/6] IAM role: $ROLE_NAME"
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "  • exists"
else
  echo "  • creating"
  aws iam create-role \
    --role-name "$ROLE_NAME" \
    --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"lambda.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
    >/dev/null
  aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole
  echo "  • waiting for role to propagate"
  sleep 12
fi
ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query Role.Arn --output text)

# ───── [2/6] Package and deploy Lambda ──────────────────────────────────────
echo "▶ [2/6] Lambda: $LAMBDA_NAME"
# Staged and zipped in a temp folder outside the repo (build_lambda_package
# above). The Windows aws.exe gets the zip's Windows path.
build_lambda_package
describe_lambda_package
FUNCTION_ZIP_ARG="fileb://$(win_path "$FUNCTION_ZIP")"

if aws lambda get-function --function-name "$LAMBDA_NAME" --region "$REGION" >/dev/null 2>&1; then
  # Move an existing function onto $LAMBDA_RUNTIME before the new code lands,
  # and let that update settle first: Lambda refuses a code update while a
  # configuration update is still in progress. A no-op once it is there.
  # tr strips the CR that the Windows aws.exe can leave on text output.
  CURRENT_RUNTIME=$(aws lambda get-function-configuration \
    --function-name "$LAMBDA_NAME" \
    --region "$REGION" \
    --query Runtime \
    --output text | tr -d '\r')
  if [[ "$CURRENT_RUNTIME" != "$LAMBDA_RUNTIME" ]]; then
    echo "  • moving runtime from $CURRENT_RUNTIME to $LAMBDA_RUNTIME"
    aws lambda update-function-configuration \
      --function-name "$LAMBDA_NAME" \
      --runtime "$LAMBDA_RUNTIME" \
      --region "$REGION" \
      >/dev/null
    aws lambda wait function-updated --function-name "$LAMBDA_NAME" --region "$REGION"
  else
    echo "  • runtime: $LAMBDA_RUNTIME"
  fi
  echo "  • updating code"
  aws lambda update-function-code \
    --function-name "$LAMBDA_NAME" \
    --zip-file "$FUNCTION_ZIP_ARG" \
    --region "$REGION" \
    >/dev/null
  aws lambda wait function-updated --function-name "$LAMBDA_NAME" --region "$REGION"
else
  echo "  • creating function"
  aws lambda create-function \
    --function-name "$LAMBDA_NAME" \
    --runtime "$LAMBDA_RUNTIME" \
    --handler index.handler \
    --role "$ROLE_ARN" \
    --zip-file "$FUNCTION_ZIP_ARG" \
    --timeout 60 \
    --memory-size 512 \
    --region "$REGION" \
    >/dev/null
  aws lambda wait function-active --function-name "$LAMBDA_NAME" --region "$REGION"
fi

echo "  • setting env vars (preserving anything not in this script)"
# Merge new env values into the existing config so we don't wipe out anything
# set by setup-signing.sh, setup-auth.sh, or future one-time setup scripts.
EXISTING_ENV=$(aws lambda get-function-configuration \
  --function-name "$LAMBDA_NAME" \
  --region "$REGION" \
  --query 'Environment.Variables' \
  --output json)
MERGED_ENV=$(
  ANTHROPIC_API_KEY="$ANTHROPIC_API_KEY" \
  COGNITO_USER_POOL_ID="${COGNITO_USER_POOL_ID:-}" \
  COGNITO_APP_CLIENT_ID="${COGNITO_APP_CLIENT_ID:-}" \
  DYNAMODB_TABLE_SESSIONS="${DYNAMODB_TABLE_SESSIONS:-}" \
  DYNAMODB_TABLE_PUSH="${DYNAMODB_TABLE_PUSH:-}" \
  S3_BUCKET_EVIDENCE="${S3_BUCKET_EVIDENCE:-}" \
  S3_BUCKET_USER_FEEDBACK="${S3_BUCKET_USER_FEEDBACK:-}" \
  VAPID_PUBLIC_KEY="${VAPID_PUBLIC_KEY:-}" \
  VAPID_PRIVATE_KEY="${VAPID_PRIVATE_KEY:-}" \
  VAPID_SUBJECT="${VAPID_SUBJECT:-}" \
  PUSH_SCHEDULER_ROLE_ARN="${PUSH_SCHEDULER_ROLE_ARN:-}" \
  PUSH_DISPATCH_LAMBDA_ARN="${PUSH_DISPATCH_LAMBDA_ARN:-}" \
  echo "$EXISTING_ENV" | node -e "
  const data = require('fs').readFileSync(0, 'utf8');
  const incoming = JSON.parse(data || '{}') || {};
  incoming.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  for (const key of ['COGNITO_USER_POOL_ID', 'COGNITO_APP_CLIENT_ID', 'DYNAMODB_TABLE_SESSIONS', 'DYNAMODB_TABLE_PUSH', 'S3_BUCKET_EVIDENCE', 'S3_BUCKET_USER_FEEDBACK', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT', 'PUSH_SCHEDULER_ROLE_ARN', 'PUSH_DISPATCH_LAMBDA_ARN']) {
    if (process.env[key]) incoming[key] = process.env[key];
  }
  process.stdout.write(JSON.stringify({ Variables: incoming }));
")
aws lambda update-function-configuration \
  --function-name "$LAMBDA_NAME" \
  --environment "$MERGED_ENV" \
  --region "$REGION" \
  >/dev/null
aws lambda wait function-updated --function-name "$LAMBDA_NAME" --region "$REGION"

LAMBDA_ARN=$(aws lambda get-function --function-name "$LAMBDA_NAME" --region "$REGION" --query Configuration.FunctionArn --output text)

# ───── [3/6] API Gateway ────────────────────────────────────────────────────
echo "▶ [3/6] API Gateway: $API_NAME"
API_ID=$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)

if [[ -z "$API_ID" || "$API_ID" == "None" ]]; then
  echo "  • creating HTTP API"
  API_ID=$(aws apigatewayv2 create-api \
    --name "$API_NAME" \
    --protocol-type HTTP \
    --cors-configuration '{"AllowOrigins":["*"],"AllowMethods":["GET","POST","OPTIONS"],"AllowHeaders":["Content-Type","Authorization"],"MaxAge":300}' \
    --region "$REGION" \
    --query ApiId --output text)

  INTEGRATION_ID=$(aws apigatewayv2 create-integration \
    --api-id "$API_ID" \
    --integration-type AWS_PROXY \
    --integration-uri "$LAMBDA_ARN" \
    --payload-format-version 2.0 \
    --region "$REGION" \
    --query IntegrationId --output text)

  aws apigatewayv2 create-route \
    --api-id "$API_ID" \
    --route-key "POST /sign-translate" \
    --target "integrations/$INTEGRATION_ID" \
    --region "$REGION" \
    >/dev/null

  aws apigatewayv2 create-stage \
    --api-id "$API_ID" \
    --stage-name '$default' \
    --auto-deploy \
    --region "$REGION" \
    >/dev/null

  aws lambda add-permission \
    --function-name "$LAMBDA_NAME" \
    --statement-id "apigateway-invoke-$(date +%s)" \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*/sign-translate" \
    --region "$REGION" \
    >/dev/null

  echo "  • API created: $API_ID"
else
  echo "  • API exists: $API_ID"
fi

# ─── Idempotent route management ───
# Usage: ensure_route <route_path> [--auth]
#   <route_path>     URL path under the API (e.g. "feedback" or "sessions/upload")
#   --auth           Attach the Cognito JWT authorizer (requires COGNITO_AUTHORIZER_ID
#                    in scripts/.aws-resources). Anonymous routes leave it off.
# Route keys with slashes (e.g. "POST /sessions/upload") work fine in API Gateway.
ensure_route() {
  local route_path="$1"
  local with_auth="${2:-}"
  local route_key="POST /$route_path"
  local route_id
  route_id=$(aws apigatewayv2 get-routes \
    --api-id "$API_ID" \
    --region "$REGION" \
    --query "Items[?RouteKey=='$route_key'].RouteId | [0]" \
    --output text 2>/dev/null || echo "")
  local int_id
  int_id=$(aws apigatewayv2 get-integrations \
    --api-id "$API_ID" \
    --region "$REGION" \
    --query 'Items[0].IntegrationId' --output text)

  if [[ -z "$route_id" || "$route_id" == "None" ]]; then
    echo "  • adding /$route_path route"
    if [[ "$with_auth" == "--auth" && -n "${COGNITO_AUTHORIZER_ID:-}" ]]; then
      route_id=$(aws apigatewayv2 create-route \
        --api-id "$API_ID" \
        --route-key "$route_key" \
        --target "integrations/$int_id" \
        --authorization-type JWT \
        --authorizer-id "$COGNITO_AUTHORIZER_ID" \
        --region "$REGION" \
        --query RouteId --output text)
    else
      route_id=$(aws apigatewayv2 create-route \
        --api-id "$API_ID" \
        --route-key "$route_key" \
        --target "integrations/$int_id" \
        --region "$REGION" \
        --query RouteId --output text)
    fi
    aws lambda add-permission \
      --function-name "$LAMBDA_NAME" \
      --statement-id "apigateway-invoke-${route_path//\//-}-$(date +%s)" \
      --action lambda:InvokeFunction \
      --principal apigateway.amazonaws.com \
      --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*/$route_path" \
      --region "$REGION" \
      >/dev/null
  elif [[ "$with_auth" == "--auth" && -n "${COGNITO_AUTHORIZER_ID:-}" ]]; then
    # Existing route: re-confirm the authorizer is attached. Cheap idempotent update.
    aws apigatewayv2 update-route \
      --api-id "$API_ID" \
      --route-id "$route_id" \
      --authorization-type JWT \
      --authorizer-id "$COGNITO_AUTHORIZER_ID" \
      --region "$REGION" \
      >/dev/null
    echo "  • /$route_path exists (auth attached)"
  else
    echo "  • /$route_path route exists"
  fi
}

ensure_route "feedback"
ensure_route "user-feedback"
ensure_route "push/subscribe"
ensure_route "push/schedule"
ensure_route "push/cancel"
# Weekly reminders by push (T5b): book and cancel one rule's cron schedules.
ensure_route "push/recurring"
ensure_route "push/recurring/cancel"
ensure_route "draft-appeal"
ensure_route "read-notice"
ensure_route "sign-session"

# Auth-required routes. The JWT authorizer is attached when COGNITO_AUTHORIZER_ID
# is set (which it is whenever scripts/.aws-resources exists).
ensure_route "sessions/upload" --auth
ensure_route "sessions/list"   --auth
ensure_route "sessions/delete" --auth
ensure_route "photos/presign"     --auth
ensure_route "photos/materialize" --auth
ensure_route "me/export"          --auth
ensure_route "me/delete"       --auth

# GET method variant for the two listing/export routes, so the frontend can
# use natural GETs instead of POSTs. ensure_route created the POST already;
# add a GET pointing at the same integration + authorizer.
ensure_get_route() {
  local route_path="$1"
  local route_key="GET /$route_path"
  local existing
  existing=$(aws apigatewayv2 get-routes \
    --api-id "$API_ID" \
    --region "$REGION" \
    --query "Items[?RouteKey=='$route_key'].RouteId | [0]" \
    --output text 2>/dev/null || echo "")
  if [[ -n "$existing" && "$existing" != "None" ]]; then return; fi
  local int_id
  int_id=$(aws apigatewayv2 get-integrations \
    --api-id "$API_ID" --region "$REGION" \
    --query 'Items[0].IntegrationId' --output text)
  echo "  • adding GET /$route_path"
  aws apigatewayv2 create-route \
    --api-id "$API_ID" \
    --route-key "$route_key" \
    --target "integrations/$int_id" \
    --authorization-type JWT \
    --authorizer-id "$COGNITO_AUTHORIZER_ID" \
    --region "$REGION" \
    >/dev/null
  aws lambda add-permission \
    --function-name "$LAMBDA_NAME" \
    --statement-id "apigateway-invoke-GET-${route_path//\//-}-$(date +%s)" \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*/$route_path" \
    --region "$REGION" \
    >/dev/null
}

if [[ -n "${COGNITO_AUTHORIZER_ID:-}" ]]; then
  ensure_get_route "sessions/list"
  ensure_get_route "me/export"
fi

# Anonymous GET routes for the async-polling endpoints. The frontend POSTs
# to /sign-translate, gets back a job_id, then polls these /status/{id}
# endpoints until status != 'pending'. Polling needs no auth: job_id IS
# the bearer token, and DDB TTL purges rows after 10 min.
ensure_get_anon_route() {
  local route_key="GET $1"
  local source_arn_path="${1#/}"
  # Wildcard ANY {placeholder} segment for the Lambda source-arn pattern.
  # `${x//\{/*}` only replaces the opening brace; we need the whole
  # `{job_id}` chunk replaced with `*` or API Gateway's actual invocation
  # ARN won't match the permission and Lambda returns AccessDenied → 500.
  local source_arn_wild
  source_arn_wild=$(echo "$source_arn_path" | sed -E 's/\{[^}]+\}/*/g')
  local existing
  existing=$(aws apigatewayv2 get-routes \
    --api-id "$API_ID" \
    --region "$REGION" \
    --query "Items[?RouteKey=='$route_key'].RouteId | [0]" \
    --output text 2>/dev/null || echo "")
  if [[ -n "$existing" && "$existing" != "None" ]]; then
    echo "  • $route_key route exists"
    return
  fi
  local int_id
  int_id=$(aws apigatewayv2 get-integrations \
    --api-id "$API_ID" --region "$REGION" \
    --query 'Items[0].IntegrationId' --output text)
  echo "  • adding $route_key"
  aws apigatewayv2 create-route \
    --api-id "$API_ID" \
    --route-key "$route_key" \
    --target "integrations/$int_id" \
    --region "$REGION" \
    >/dev/null
  aws lambda add-permission \
    --function-name "$LAMBDA_NAME" \
    --statement-id "apigateway-invoke-GET-${1//[\/\{\}]/-}-$(date +%s)" \
    --action lambda:InvokeFunction \
    --principal apigateway.amazonaws.com \
    --source-arn "arn:aws:execute-api:$REGION:$ACCOUNT_ID:$API_ID/*/*/$source_arn_wild" \
    --region "$REGION" \
    >/dev/null 2>&1 || true
}

ensure_get_anon_route "/sign-translate/status/{job_id}"
ensure_get_anon_route "/draft-appeal/status/{job_id}"
# /read-notice/status serves notice jobs only and deletes each row once it
# hands back a finished result (lambda/index.js handleJobStatus).
ensure_get_anon_route "/read-notice/status/{job_id}"

API_URL="https://$API_ID.execute-api.$REGION.amazonaws.com/sign-translate"
echo "  • endpoint: $API_URL"

# Note on Lambda Function URLs: I tried adding one here as a second front-door
# for the slow anonymous routes (sign-translate, draft-appeal can exceed API
# Gateway's 30s timeout on complex multi-variant signs). The Function URL was
# created cleanly and signed (AWS_IAM) invocations worked, but unauthenticated
# invocations (AuthType:NONE with a Principal:"*" resource policy) consistently
# returned 403 despite no SCPs, RCPs, or public-access block at the org /
# account level. Reverted. src/lib/api.ts handles the 30s timeout gracefully
# on the client with a retry-with-friendly-error layer instead.

# ───── [4/6] Build frontend ─────────────────────────────────────────────────
echo "▶ [4/6] Building frontend"

# Re-subset the PDF fonts BEFORE vite picks them up. The subset script
# reads src/locales/*.json, extracts every unique codepoint that
# appears in the rendered strings, and rewrites the TTFs in
# public/fonts/ to contain only those glyphs. This is what keeps the
# CJK fonts under 1MB (vs 17MB raw) and ensures any new locale strings
# added since the last deploy actually have glyph coverage when they
# render in evidence PDFs.
#
# Skipped automatically if pyftsubset isn't installed (`python -m
# fontTools.subset --help` is the canary). Falls through with a
# warning rather than failing the deploy. Fonts on disk are still
# the previously-subsetted version, which is fine for a deploy where
# no locale strings changed. To force a re-subset, install fonttools
# (`pip install fonttools brotli`) and re-run this script.
if python -m fontTools.subset --help > /dev/null 2>&1; then
  echo "  • re-subsetting PDF fonts to match current locale strings"
  PYTHONIOENCODING=utf-8 python scripts/_subset_pdf_fonts.py > /dev/null 2>&1 \
    || echo "    ! WARNING: subset failed; fonts on disk are previous version"
else
  echo "  • fontTools not installed, skipping font re-subset (run \`pip install fonttools brotli\` to enable)"
fi

# Clean dist/ before each build. Especially important after the two-app
# cutover (2026-05-26): the previous outDir was `dist`, the new outDir
# is `dist/app`. Without this cleanup, stale files from any pre-cutover
# build (sw.js, manifest.webmanifest, index.html at root) would linger
# at dist/ root and ship to production alongside the new landing,
# overwriting it on S3 sync or creating a confused PWA registration.
# Vite's emptyOutDir: true only empties dist/app/, not dist/ itself.
rm -rf dist
# Bake the Cognito identifiers + API URL + VAPID public key into the
# bundle. These are public values (anyone inspecting the JS bundle can see
# them); not secrets. The VAPID PRIVATE key stays Lambda-side only.
# VITE_FEATURE_WORKDAY is always set here, from DEPLOY_ALLOW_WORKDAY (see
# the top of this script), so no .env file can decide it.
echo "  • workday mode: $WORKDAY_NOTE"
VITE_FEATURE_WORKDAY="$WORKDAY_FLAG" \
VITE_API_URL="$API_URL" \
VITE_COGNITO_USER_POOL_ID="${COGNITO_USER_POOL_ID:-}" \
VITE_COGNITO_APP_CLIENT_ID="${COGNITO_APP_CLIENT_ID:-}" \
VITE_COGNITO_REGION="${COGNITO_REGION:-ap-southeast-2}" \
VITE_COGNITO_HOSTED_UI_DOMAIN="${COGNITO_HOSTED_UI_DOMAIN:-}" \
VITE_VAPID_PUBLIC_KEY="${VAPID_PUBLIC_KEY:-}" \
  npm run build --silent

# ───── [4.5/6] Compose the two-surface layout ───────────────────────────────
# After vite build (with base: '/app/' + outDir: 'dist/app'), dist/ looks
# like this:
#   dist/
#     app/
#       index.html, sw.js, manifest.webmanifest, assets/, locales/, ...
#
# We now add the marketing landing on top so the final layout is:
#   dist/
#     index.html              ← marketing landing (Claude Design)
#     sw.js                   ← eviction shim (clears any old root-scope SW)
#     landing-styles.css, landing-demo.js, assets/ ...
#     app/
#       index.html, sw.js, manifest.webmanifest, assets/, locales/, ...
#
# The subsequent `aws s3 sync dist/ ... --delete` sweeps the whole tree
# in one shot. See migrations/two-app-architecture/README.md for the
# full architecture rationale.

echo "▶ [4.5/6] Layering marketing landing + SW shim into dist/"

LANDING_SRC="migrations/two-app-architecture/landing-from-claude-design"
if [[ ! -f "$LANDING_SRC/index.html" ]]; then
  echo "✗ Landing not found at $LANDING_SRC/index.html"
  echo "  Unzip the Claude Design output into that directory before deploying."
  exit 1
fi

# Copy every file from the landing folder into dist/ root.
cp -R "$LANDING_SRC"/. dist/

# Strip the meta files that ride along inside the landing folder but
# shouldn't ship to the live site:
#   - DEPLOY.md is Claude Design's own deployment notes (not for visitors)
#   - .gitkeep is our placeholder so the directory survives in git when
#     the landing isn't unpacked yet
# `cp + rm` over `rsync --exclude` because rsync isn't guaranteed on
# Git Bash for Windows. `-f` silences "no such file" if either is gone.
rm -f dist/DEPLOY.md dist/.gitkeep

# Drop the SW eviction shim at dist/sw.js. vite-plugin-pwa now writes
# its SW under dist/app/sw.js (because of base: '/app/'), so dist/sw.js
# is otherwise empty after the build. The shim self-unregisters any
# old root-scope service worker that browsers may have cached from
# the pre-cutover build. Idempotent, safe to run on every deploy.
cp "migrations/two-app-architecture/public-sw-shim.js" dist/sw.js

echo "  • landing files: $(find "$LANDING_SRC" -type f -not -name .gitkeep -not -name DEPLOY.md | wc -l | tr -d ' ')"
echo "  • sw shim:        dist/sw.js (evicts old root-scope SW)"

# Public key line endings (field-test fix list, Tier 2). With
# core.autocrlf=true, a checkout made before .gitattributes pinned *.pem to
# LF still has CRLF PEMs on disk (merging the rule doesn't rewrite them),
# and the live key then differs byte for byte from the repo's (182 bytes
# against 178). Ship LF whatever the checkout holds: strip CR from every
# PEM in dist/, and stop the deploy if any CR is left.
PEM_COUNT=0
while IFS= read -r -d '' pem; do
  tr -d '\r' < "$pem" > "$pem.lf" && mv "$pem.lf" "$pem"
  if LC_ALL=C grep -q $'\r' "$pem"; then
    echo "✗ $pem still has CR line endings after normalising; not deploying" >&2
    exit 1
  fi
  echo "  • pem (LF):       $pem ($(wc -c < "$pem" | tr -d ' ') bytes)"
  PEM_COUNT=$((PEM_COUNT + 1))
done < <(find dist -type f -name '*.pem' -print0)
if [ "$PEM_COUNT" -eq 0 ]; then
  echo "  ! no .pem in dist/: the public key is missing from this build" >&2
fi

# ───── [5/6] S3 bucket + upload ─────────────────────────────────────────────
echo "▶ [5/6] S3 bucket: $BUCKET"
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "  • exists"
else
  echo "  • creating"
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" \
    >/dev/null

  aws s3api put-public-access-block \
    --bucket "$BUCKET" \
    --public-access-block-configuration "BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false"

  aws s3api put-bucket-policy --bucket "$BUCKET" --policy "{
    \"Version\":\"2012-10-17\",
    \"Statement\":[{
      \"Effect\":\"Allow\",
      \"Principal\":\"*\",
      \"Action\":\"s3:GetObject\",
      \"Resource\":\"arn:aws:s3:::$BUCKET/*\"
    }]
  }"

  aws s3 website "s3://$BUCKET" --index-document index.html --error-document index.html
fi

echo "  • syncing dist/"
aws s3 sync dist/ "s3://$BUCKET" --delete --region "$REGION" >/dev/null

S3_WEBSITE_URL="http://$BUCKET.s3-website-$REGION.amazonaws.com"

# ───── [6/6] CloudFront ─────────────────────────────────────────────────────
echo "▶ [6/6] CloudFront: $DIST_COMMENT"
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$DIST_COMMENT'].Id | [0]" \
  --output text 2>/dev/null || echo "")

if [[ -z "$DIST_ID" || "$DIST_ID" == "None" ]]; then
  echo "  • creating distribution (5–15 min to propagate globally)"
  # Project-relative path so the Windows aws.exe can resolve it
  # (POSIX /tmp/... from `mktemp` doesn't work cross-shell on Windows).
  CONFIG_FILE="cloudfront-config.tmp.json"
  cat > "$CONFIG_FILE" <<EOF
{
  "CallerReference": "parkproof-$(date +%s)",
  "Comment": "$DIST_COMMENT",
  "Enabled": true,
  "DefaultRootObject": "index.html",
  "Origins": {
    "Quantity": 1,
    "Items": [{
      "Id": "s3-website",
      "DomainName": "$BUCKET.s3-website-$REGION.amazonaws.com",
      "CustomOriginConfig": {
        "HTTPPort": 80,
        "HTTPSPort": 443,
        "OriginProtocolPolicy": "http-only",
        "OriginSslProtocols": {"Quantity": 1, "Items": ["TLSv1.2"]},
        "OriginReadTimeout": 30,
        "OriginKeepaliveTimeout": 5
      },
      "CustomHeaders": {"Quantity": 0}
    }]
  },
  "DefaultCacheBehavior": {
    "TargetOriginId": "s3-website",
    "ViewerProtocolPolicy": "redirect-to-https",
    "AllowedMethods": {
      "Quantity": 2,
      "Items": ["GET", "HEAD"],
      "CachedMethods": {"Quantity": 2, "Items": ["GET", "HEAD"]}
    },
    "CachePolicyId": "658327ea-f89d-4fab-a63d-7e88639e58f6",
    "Compress": true
  },
  "CustomErrorResponses": {
    "Quantity": 2,
    "Items": [
      {"ErrorCode": 403, "ResponseCode": "200", "ResponsePagePath": "/index.html", "ErrorCachingMinTTL": 0},
      {"ErrorCode": 404, "ResponseCode": "200", "ResponsePagePath": "/index.html", "ErrorCachingMinTTL": 0}
    ]
  },
  "PriceClass": "PriceClass_All",
  "HttpVersion": "http2"
}
EOF
  DIST_ID=$(aws cloudfront create-distribution \
    --distribution-config "file://$CONFIG_FILE" \
    --query 'Distribution.Id' \
    --output text)
  rm -f "$CONFIG_FILE"
fi


DIST_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query 'Distribution.DomainName' --output text)
DIST_STATUS=$(aws cloudfront get-distribution --id "$DIST_ID" --query 'Distribution.Status' --output text)

echo "  • distribution: $DIST_ID"
echo "  • status:       $DIST_STATUS"
echo "  • invalidating CDN cache"
aws cloudfront create-invalidation --distribution-id "$DIST_ID" --paths '/*' --query 'Invalidation.Id' --output text >/dev/null

# ───── Done ─────────────────────────────────────────────────────────────────
echo ""
echo "✓ Deploy complete"
echo ""
echo "  App URL:     https://$DIST_DOMAIN"
echo "  S3 fallback: $S3_WEBSITE_URL  (HTTP only: geolocation/notifications won't work)"
echo "  API URL:     $API_URL"
echo ""
if [[ "$DIST_STATUS" == "InProgress" ]]; then
  echo "  CloudFront is still propagating (first deploy takes 5–15 min)."
  echo "  Re-runs of this script will be fast, only invalidating the CDN cache."
fi
