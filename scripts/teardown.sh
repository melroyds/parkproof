#!/usr/bin/env bash
# ParkProof — destroy every AWS resource the deploy script created.
#
# Defaults to a DRY RUN. Pass --confirm to actually delete things:
#
#   bash scripts/teardown.sh           # prints what would be deleted, no changes
#   bash scripts/teardown.sh --confirm # actually destroys everything
#
# Takes ~10 minutes because CloudFront must redeploy as "disabled" before it
# can be deleted. The script handles that wait for you.

set -euo pipefail

PROJECT=parkproof
REGION=ap-southeast-2
LAMBDA_NAME=$PROJECT-sign-translator
ROLE_NAME=$PROJECT-lambda-role
API_NAME=$PROJECT-api
DIST_COMMENT=$PROJECT-cdn
OAC_NAME=$PROJECT-oac

cd "$(dirname "$0")/.."

if ! command -v aws >/dev/null 2>&1; then
  if [[ -x "/c/Program Files/Amazon/AWSCLIV2/aws.exe" ]]; then
    export PATH="/c/Program Files/Amazon/AWSCLIV2:$PATH"
  fi
fi
command -v aws >/dev/null 2>&1 || { echo "✗ aws CLI not found"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "✗ node not found"; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET=$PROJECT-app-$ACCOUNT_ID

CONFIRM="${1:-}"

echo "ParkProof teardown — account $ACCOUNT_ID"
echo ""
echo "Resources that will be deleted (if any exist):"
echo "  • Lambda function:   $LAMBDA_NAME"
echo "  • IAM role:          $ROLE_NAME"
echo "  • API Gateway:       $API_NAME"
echo "  • S3 bucket:         $BUCKET (with all contents)"
echo "  • CloudFront dist:   $DIST_COMMENT"
echo "  • OAC:               $OAC_NAME"
echo ""

if [[ "$CONFIRM" != "--confirm" ]]; then
  echo "Dry run — nothing was deleted."
  echo "To actually delete, run:  bash scripts/teardown.sh --confirm"
  exit 0
fi

echo "▶ DELETING IN 5 SECONDS — Ctrl+C to abort"
sleep 5
echo ""

# ───── 1. CloudFront: disable, wait, then delete ───────────────────────────
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$DIST_COMMENT'].Id | [0]" \
  --output text 2>/dev/null || echo "")
if [[ -n "$DIST_ID" && "$DIST_ID" != "None" ]]; then
  echo "▶ CloudFront: disabling $DIST_ID"
  ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query 'ETag' --output text)
  aws cloudfront get-distribution-config --id "$DIST_ID" --query 'DistributionConfig' > dist-current.tmp.json

  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('dist-current.tmp.json', 'utf8'));
    cfg.Enabled = false;
    fs.writeFileSync('dist-disabled.tmp.json', JSON.stringify(cfg));
  "
  aws cloudfront update-distribution \
    --id "$DIST_ID" \
    --distribution-config file://dist-disabled.tmp.json \
    --if-match "$ETAG" \
    >/dev/null
  rm -f dist-current.tmp.json dist-disabled.tmp.json

  echo "  • waiting for redeploy (5–15 min)…"
  aws cloudfront wait distribution-deployed --id "$DIST_ID"

  ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query 'ETag' --output text)
  aws cloudfront delete-distribution --id "$DIST_ID" --if-match "$ETAG"
  echo "  • deleted"
else
  echo "▶ CloudFront: nothing to delete"
fi

# ───── 2. OAC ──────────────────────────────────────────────────────────────
OAC_ID=$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='$OAC_NAME'].Id | [0]" \
  --output text 2>/dev/null || echo "")
if [[ -n "$OAC_ID" && "$OAC_ID" != "None" ]]; then
  echo "▶ OAC: deleting $OAC_ID"
  OAC_ETAG=$(aws cloudfront get-origin-access-control --id "$OAC_ID" --query 'ETag' --output text)
  aws cloudfront delete-origin-access-control --id "$OAC_ID" --if-match "$OAC_ETAG"
  echo "  • deleted"
else
  echo "▶ OAC: nothing to delete"
fi

# ───── 3. S3 bucket: empty then delete ─────────────────────────────────────
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "▶ S3 bucket: emptying and deleting $BUCKET"
  aws s3 rm "s3://$BUCKET" --recursive --region "$REGION" >/dev/null
  aws s3api delete-bucket --bucket "$BUCKET" --region "$REGION"
  echo "  • deleted"
else
  echo "▶ S3 bucket: nothing to delete"
fi

# ───── 4. API Gateway ──────────────────────────────────────────────────────
API_ID=$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)
if [[ -n "$API_ID" && "$API_ID" != "None" ]]; then
  echo "▶ API Gateway: deleting $API_ID"
  aws apigatewayv2 delete-api --api-id "$API_ID" --region "$REGION"
  echo "  • deleted"
else
  echo "▶ API Gateway: nothing to delete"
fi

# ───── 5. Lambda function ──────────────────────────────────────────────────
if aws lambda get-function --function-name "$LAMBDA_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "▶ Lambda: deleting $LAMBDA_NAME"
  aws lambda delete-function --function-name "$LAMBDA_NAME" --region "$REGION"
  echo "  • deleted"
else
  echo "▶ Lambda: nothing to delete"
fi

# ───── 6. IAM role ─────────────────────────────────────────────────────────
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
  echo "▶ IAM role: deleting $ROLE_NAME"
  for POLICY_ARN in $(aws iam list-attached-role-policies --role-name "$ROLE_NAME" --query 'AttachedPolicies[].PolicyArn' --output text); do
    aws iam detach-role-policy --role-name "$ROLE_NAME" --policy-arn "$POLICY_ARN"
  done
  aws iam delete-role --role-name "$ROLE_NAME"
  echo "  • deleted"
else
  echo "▶ IAM role: nothing to delete"
fi

echo ""
echo "✓ Teardown complete — all ParkProof AWS resources removed."
