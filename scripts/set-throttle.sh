#!/usr/bin/env bash
# ParkProof — set API Gateway HTTP API throttle limits.
#
# Usage:
#   bash scripts/set-throttle.sh                # uses defaults (100 burst / 25 rate)
#   bash scripts/set-throttle.sh 50 20          # override: 50 burst / 20 rate
#
# Throttle limits cap how many requests/sec your API will accept before returning
# 429 Too Many Requests. Sized for "good Reddit day" traffic — absorbs an initial
# click-spike of ~100 simultaneous requests then handles ~30 concurrent scanners
# at the 25 req/s rate (each scan generates ~25 requests over 30s as the client
# polls the async-job status endpoint). The Lambda account-level concurrency
# ceiling (default 10 on a new AWS account) is the actual cost ceiling — at
# 30s per scan that bounds throughput to ~$24/hr worst case.
#
# To go lower for cost protection: bash scripts/set-throttle.sh 40 10
# To go higher for a planned launch: bash scripts/set-throttle.sh 200 50  (and
# also file a Lambda concurrency quota increase 24h ahead via the AWS console).

set -euo pipefail

PROJECT=parkproof
REGION=ap-southeast-2
API_NAME=$PROJECT-api

BURST="${1:-100}"
RATE="${2:-25}"

cd "$(dirname "$0")/.."

if ! command -v aws >/dev/null 2>&1; then
  if [[ -x "/c/Program Files/Amazon/AWSCLIV2/aws.exe" ]]; then
    export PATH="/c/Program Files/Amazon/AWSCLIV2:$PATH"
  fi
fi
command -v aws >/dev/null 2>&1 || { echo "✗ aws CLI not found"; exit 1; }

API_ID=$(aws apigatewayv2 get-apis \
  --region "$REGION" \
  --query "Items[?Name=='$API_NAME'].ApiId | [0]" \
  --output text)
[[ -n "$API_ID" && "$API_ID" != "None" ]] || { echo "✗ API '$API_NAME' not found"; exit 1; }

echo "▶ Throttle: $API_NAME ($API_ID)"
echo "  Burst:  $BURST req/s  (short-duration spike cap)"
echo "  Rate:   $RATE req/s   (sustained cap)"
echo ""

aws apigatewayv2 update-stage \
  --api-id "$API_ID" \
  --stage-name '$default' \
  --default-route-settings "ThrottlingBurstLimit=$BURST,ThrottlingRateLimit=$RATE" \
  --region "$REGION" \
  --query 'DefaultRouteSettings' \
  --output table

echo ""
echo "✓ Throttle applied — anything above $RATE req/s sustained returns 429."
