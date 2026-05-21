#!/usr/bin/env bash
# Idempotent: provisions the S3 bucket for user-feedback durable storage,
# attaches an IAM policy to the Lambda role that allows PutObject to it, and
# writes the bucket name into scripts/.aws-resources so deploy.sh picks it up.
#
# Safe to re-run — every step checks for existing state first.

set -euo pipefail

# AWS CLI is at the Windows path on this machine. Idempotent.
export PATH="/c/Program Files/Amazon/AWSCLIV2:${PATH}"
export MSYS_NO_PATHCONV=1

REGION="${AWS_REGION:-ap-southeast-2}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
BUCKET="parkproof-user-feedback-${ACCOUNT_ID}"
ROLE_NAME="${LAMBDA_ROLE_NAME:-parkproof-lambda-role}"
POLICY_NAME="parkproof-user-feedback-write"

echo "▶ User-feedback bucket: $BUCKET (region: $REGION)"
echo "  account:           $ACCOUNT_ID"
echo "  lambda role:       $ROLE_NAME"
echo ""

# ─── 1. Create bucket (idempotent) ─────────────────────────────────────────
if aws s3api head-bucket --bucket "$BUCKET" --region "$REGION" 2>/dev/null; then
  echo "  ✓ bucket exists"
else
  echo "  • creating bucket"
  # ap-southeast-2 needs the LocationConstraint; us-east-1 does NOT (and
  # passing one would error). Branch on region to stay robust.
  if [[ "$REGION" == "us-east-1" ]]; then
    aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" >/dev/null
  else
    aws s3api create-bucket \
      --bucket "$BUCKET" \
      --region "$REGION" \
      --create-bucket-configuration "LocationConstraint=$REGION" >/dev/null
  fi
fi

# ─── 2. Block public access (no question, never) ──────────────────────────
echo "  • blocking public access"
aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --public-access-block-configuration \
    "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true" \
  >/dev/null

# ─── 3. Server-side encryption (AES256) ───────────────────────────────────
echo "  • enforcing server-side encryption"
aws s3api put-bucket-encryption \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --server-side-encryption-configuration '{
    "Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]
  }' \
  >/dev/null

# ─── 4. Lifecycle policy — keep 2 years, then expire ──────────────────────
# Feedback ages out after a couple of years. Anything older has stopped
# being useful for product decisions and starts being a data-retention
# liability.
echo "  • lifecycle: expire objects after 730 days"
aws s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --lifecycle-configuration '{
    "Rules":[{
      "ID":"expire-after-2-years",
      "Status":"Enabled",
      "Filter":{"Prefix":""},
      "Expiration":{"Days":730}
    }]
  }' \
  >/dev/null

# ─── 5. Attach IAM policy to the Lambda role ──────────────────────────────
echo "  • attaching IAM policy to $ROLE_NAME"
POLICY_DOC=$(cat <<EOF
{
  "Version":"2012-10-17",
  "Statement":[{
    "Effect":"Allow",
    "Action":["s3:PutObject"],
    "Resource":"arn:aws:s3:::$BUCKET/*"
  }]
}
EOF
)
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "$POLICY_DOC" \
  >/dev/null
echo "  ✓ IAM policy ${POLICY_NAME} attached"

# ─── 6. Stamp the bucket name into scripts/.aws-resources ─────────────────
# deploy.sh reads from this file to inject the env var into the Lambda
# config on every deploy.
RESOURCES_FILE="$(dirname "$0")/.aws-resources"
if [[ -f "$RESOURCES_FILE" ]]; then
  if grep -q "^S3_BUCKET_USER_FEEDBACK=" "$RESOURCES_FILE"; then
    # Already present — update in place
    sed -i "s|^S3_BUCKET_USER_FEEDBACK=.*$|S3_BUCKET_USER_FEEDBACK=$BUCKET|" "$RESOURCES_FILE"
  else
    echo "S3_BUCKET_USER_FEEDBACK=$BUCKET" >> "$RESOURCES_FILE"
  fi
  echo "  ✓ stamped into scripts/.aws-resources"
else
  echo "S3_BUCKET_USER_FEEDBACK=$BUCKET" > "$RESOURCES_FILE"
  echo "  ✓ created scripts/.aws-resources"
fi

echo ""
echo "✓ User-feedback bucket ready: s3://$BUCKET/"
echo ""
echo "  List recent feedback:"
echo "    aws s3 ls s3://$BUCKET/ --recursive --region $REGION"
echo ""
echo "  Read one entry:"
echo "    aws s3 cp s3://$BUCKET/2026-05-21/<uuid>.json - --region $REGION | jq ."
