#!/usr/bin/env bash
# ParkProof — deploy to AWS.
# Idempotent — re-run after code changes to update Lambda + frontend.
#
# Provisions:
#   - IAM role for Lambda execution
#   - Lambda function (sign translator) + ANTHROPIC_API_KEY env var
#   - API Gateway HTTP API (POST /sign-translate)
#   - S3 bucket with static website hosting + public read
#   - CloudFront distribution (HTTPS + global CDN)

set -euo pipefail

# ───── Config ───────────────────────────────────────────────────────────────
PROJECT=parkproof
REGION=ap-southeast-2
LAMBDA_NAME=$PROJECT-sign-translator
ROLE_NAME=$PROJECT-lambda-role
API_NAME=$PROJECT-api
DIST_COMMENT=$PROJECT-cdn

# ───── Preflight ────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.."

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
# DynamoDB and S3 identifiers. Optional — deploy keeps working without auth
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
echo "  • packaging"
pushd lambda >/dev/null
rm -rf node_modules
npm install --omit=dev --silent
popd >/dev/null
rm -f function.zip
if command -v zip >/dev/null 2>&1; then
  ( cd lambda && zip -rq ../function.zip . -x "*.git*" "*.DS_Store" )
elif command -v powershell.exe >/dev/null 2>&1; then
  # Windows Git Bash fallback — Compress-Archive ships with PowerShell
  powershell.exe -NoProfile -Command \
    "Compress-Archive -Path 'lambda/*' -DestinationPath 'function.zip' -Force" \
    >/dev/null
else
  echo "✗ Need either 'zip' or PowerShell on PATH to build the Lambda package"
  exit 1
fi

if aws lambda get-function --function-name "$LAMBDA_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "  • updating code"
  aws lambda update-function-code \
    --function-name "$LAMBDA_NAME" \
    --zip-file fileb://function.zip \
    --region "$REGION" \
    >/dev/null
  aws lambda wait function-updated --function-name "$LAMBDA_NAME" --region "$REGION"
else
  echo "  • creating function"
  aws lambda create-function \
    --function-name "$LAMBDA_NAME" \
    --runtime nodejs20.x \
    --handler index.handler \
    --role "$ROLE_ARN" \
    --zip-file fileb://function.zip \
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
  echo "$EXISTING_ENV" | node -e "
  const data = require('fs').readFileSync(0, 'utf8');
  const incoming = JSON.parse(data || '{}') || {};
  incoming.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  for (const key of ['COGNITO_USER_POOL_ID', 'COGNITO_APP_CLIENT_ID', 'DYNAMODB_TABLE_SESSIONS', 'DYNAMODB_TABLE_PUSH', 'S3_BUCKET_EVIDENCE', 'S3_BUCKET_USER_FEEDBACK', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']) {
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
    # Existing route — re-confirm the authorizer is attached. Cheap idempotent update.
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
ensure_route "draft-appeal"
ensure_route "sign-session"

# Auth-required routes — JWT authorizer is attached when COGNITO_AUTHORIZER_ID
# is set (which it is whenever scripts/.aws-resources exists).
ensure_route "sessions/upload" --auth
ensure_route "sessions/list"   --auth
ensure_route "sessions/delete" --auth
ensure_route "photos/presign"  --auth
ensure_route "me/export"       --auth
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
# endpoints until status != 'pending'. Polling needs no auth — job_id IS
# the bearer token, and DDB TTL purges rows after 10 min.
ensure_get_anon_route() {
  local route_key="GET $1"
  local source_arn_path="${1#/}"
  # Wildcard ANY {placeholder} segment for the Lambda source-arn pattern.
  # `${x//\{/*}` only replaces the opening brace — we need the whole
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
# Bake the Cognito identifiers + API URL + VAPID public key into the
# bundle. These are public values (anyone inspecting the JS bundle can see
# them); not secrets. The VAPID PRIVATE key stays Lambda-side only.
VITE_API_URL="$API_URL" \
VITE_COGNITO_USER_POOL_ID="${COGNITO_USER_POOL_ID:-}" \
VITE_COGNITO_APP_CLIENT_ID="${COGNITO_APP_CLIENT_ID:-}" \
VITE_COGNITO_REGION="${COGNITO_REGION:-ap-southeast-2}" \
VITE_COGNITO_HOSTED_UI_DOMAIN="${COGNITO_HOSTED_UI_DOMAIN:-}" \
VITE_VAPID_PUBLIC_KEY="${VAPID_PUBLIC_KEY:-}" \
  npm run build --silent

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
echo "  S3 fallback: $S3_WEBSITE_URL  (HTTP only — geolocation/notifications won't work)"
echo "  API URL:     $API_URL"
echo ""
if [[ "$DIST_STATUS" == "InProgress" ]]; then
  echo "  CloudFront is still propagating (first deploy takes 5–15 min)."
  echo "  Re-runs of this script will be fast — only invalidating the CDN cache."
fi
