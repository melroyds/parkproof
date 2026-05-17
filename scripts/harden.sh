#!/usr/bin/env bash
# ParkProof — one-time security hardening pass on the AWS deploy.
# Safe to re-run; idempotent.
#
#   1. Tighten API Gateway CORS to only allow the CloudFront origin
#   2. Create CloudFront Origin Access Control (OAC) for S3
#   3. Migrate CloudFront origin: S3 website endpoint → S3 REST endpoint + OAC
#   4. Replace public bucket policy with CloudFront-only policy
#   5. Re-enable BlockPublicAccess on the bucket
#
# Day-to-day deploys (scripts/deploy.sh) continue to work after this — they use
# your IAM credentials to sync dist/ which doesn't depend on the bucket being public.

set -euo pipefail

PROJECT=parkproof
REGION=ap-southeast-2
API_NAME=$PROJECT-api
DIST_COMMENT=$PROJECT-cdn
OAC_NAME=$PROJECT-oac

cd "$(dirname "$0")/.."

# AWS CLI v2 on Windows installs to "C:\Program Files\Amazon\AWSCLIV2"
if ! command -v aws >/dev/null 2>&1; then
  if [[ -x "/c/Program Files/Amazon/AWSCLIV2/aws.exe" ]]; then
    export PATH="/c/Program Files/Amazon/AWSCLIV2:$PATH"
  fi
fi
command -v aws >/dev/null 2>&1 || { echo "✗ aws CLI not found"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "✗ node not found (needed for JSON manipulation)"; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET=$PROJECT-app-$ACCOUNT_ID

echo "▶ Hardening ParkProof"
echo "  Account: $ACCOUNT_ID"
echo "  Bucket:  $BUCKET"
echo ""

# ───── Resolve resource IDs ────────────────────────────────────────────────
DIST_ID=$(aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$DIST_COMMENT'].Id | [0]" \
  --output text)
[[ "$DIST_ID" != "None" && -n "$DIST_ID" ]] || { echo "✗ No CloudFront distribution found"; exit 1; }
DIST_DOMAIN=$(aws cloudfront get-distribution --id "$DIST_ID" --query 'Distribution.DomainName' --output text)
DIST_ARN="arn:aws:cloudfront::$ACCOUNT_ID:distribution/$DIST_ID"

API_ID=$(aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)
[[ "$API_ID" != "None" && -n "$API_ID" ]] || { echo "✗ No API Gateway found"; exit 1; }

CORS_ORIGIN="https://$DIST_DOMAIN"

echo "  Distribution: $DIST_ID ($DIST_DOMAIN)"
echo "  API:          $API_ID"
echo "  CORS origin:  $CORS_ORIGIN"
echo ""

# ───── [1/5] Lock API Gateway CORS to CloudFront ───────────────────────────
echo "▶ [1/5] API Gateway CORS → $CORS_ORIGIN"
aws apigatewayv2 update-api \
  --api-id "$API_ID" \
  --cors-configuration "{
    \"AllowOrigins\": [\"$CORS_ORIGIN\"],
    \"AllowMethods\": [\"GET\", \"POST\", \"OPTIONS\"],
    \"AllowHeaders\": [\"Content-Type\", \"Authorization\"],
    \"MaxAge\": 300
  }" \
  --region "$REGION" \
  >/dev/null
echo "  • CORS tightened (GET + Authorization included for /sessions/list + /me/export)"

# ───── [2/5] CloudFront Origin Access Control (OAC) ────────────────────────
echo "▶ [2/5] OAC: $OAC_NAME"
OAC_ID=$(aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='$OAC_NAME'].Id | [0]" \
  --output text 2>/dev/null || echo "")

if [[ -z "$OAC_ID" || "$OAC_ID" == "None" ]]; then
  echo "  • creating"
  OAC_ID=$(aws cloudfront create-origin-access-control \
    --origin-access-control-config "{
      \"Name\": \"$OAC_NAME\",
      \"Description\": \"OAC for ParkProof S3 bucket\",
      \"OriginAccessControlOriginType\": \"s3\",
      \"SigningBehavior\": \"always\",
      \"SigningProtocol\": \"sigv4\"
    }" \
    --query 'OriginAccessControl.Id' --output text)
else
  echo "  • exists"
fi
echo "  • OAC ID: $OAC_ID"

# ───── [3/5] Migrate CloudFront origin to S3 REST + OAC ────────────────────
echo "▶ [3/5] CloudFront origin migration"
ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query 'ETag' --output text)
aws cloudfront get-distribution-config --id "$DIST_ID" --query 'DistributionConfig' > dist-current.tmp.json

NEEDS_MIGRATION=$(node -e "
const cfg = JSON.parse(require('fs').readFileSync('dist-current.tmp.json', 'utf8'));
const origin = cfg.Origins.Items[0];
console.log(origin.CustomOriginConfig ? 'yes' : 'no');
")

if [[ "$NEEDS_MIGRATION" == "yes" ]]; then
  echo "  • migrating from website-endpoint to REST+OAC"
  node -e "
    const fs = require('fs');
    const cfg = JSON.parse(fs.readFileSync('dist-current.tmp.json', 'utf8'));
    cfg.Origins.Items = [{
      Id: 's3-rest',
      DomainName: '$BUCKET.s3.$REGION.amazonaws.com',
      OriginPath: '',
      OriginAccessControlId: '$OAC_ID',
      S3OriginConfig: { OriginAccessIdentity: '' },
      ConnectionAttempts: 3,
      ConnectionTimeout: 10,
      OriginShield: { Enabled: false },
      CustomHeaders: { Quantity: 0 }
    }];
    cfg.DefaultCacheBehavior.TargetOriginId = 's3-rest';
    fs.writeFileSync('dist-updated.tmp.json', JSON.stringify(cfg));
  "
  aws cloudfront update-distribution \
    --id "$DIST_ID" \
    --distribution-config file://dist-updated.tmp.json \
    --if-match "$ETAG" \
    >/dev/null
  rm -f dist-updated.tmp.json
  echo "  • migrated (CloudFront will redeploy in 3–10 min)"
else
  echo "  • already on REST+OAC"
fi
rm -f dist-current.tmp.json

# ───── [4/5] Bucket policy → CloudFront only ───────────────────────────────
echo "▶ [4/5] Bucket policy: CloudFront-only access"
cat > bucket-policy.tmp.json <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "AllowCloudFrontReadOnly",
    "Effect": "Allow",
    "Principal": { "Service": "cloudfront.amazonaws.com" },
    "Action": "s3:GetObject",
    "Resource": "arn:aws:s3:::$BUCKET/*",
    "Condition": {
      "StringEquals": { "AWS:SourceArn": "$DIST_ARN" }
    }
  }]
}
EOF
aws s3api put-bucket-policy --bucket "$BUCKET" --policy file://bucket-policy.tmp.json
rm -f bucket-policy.tmp.json
echo "  • policy applied"

# ───── [5/5] Re-enable BlockPublicAccess ───────────────────────────────────
echo "▶ [5/5] BlockPublicAccess: on"
aws s3api put-public-access-block --bucket "$BUCKET" --public-access-block-configuration \
  "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
echo "  • blocked"

echo ""
echo "✓ Hardening complete"
echo ""
echo "  CloudFront is redeploying its config (3–10 min). The site keeps serving"
echo "  the old origin until propagation finishes — no downtime, but the bucket"
echo "  policy + public-access changes take effect immediately."
echo ""
echo "  Verify in ~5 min:"
echo "    curl -s -o /dev/null -w '%{http_code}\\n' https://$DIST_DOMAIN"
echo "    # expect 200"
