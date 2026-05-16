#!/usr/bin/env bash
# ParkProof — one-time setup for cryptographic evidence signing.
#
#   1. Create an AWS KMS asymmetric key (ECDSA P-256, SIGN_VERIFY)
#   2. Tag it and create an alias
#   3. Grant the Lambda execution role permission to call kms:Sign / kms:GetPublicKey
#   4. Set KMS_KEY_ID on the Lambda env
#   5. Extract the public key to public/parkproof-public-key.pem
#
# Idempotent: re-running detects existing resources and skips.

set -euo pipefail

PROJECT=parkproof
REGION=ap-southeast-2
KEY_ALIAS=alias/$PROJECT-evidence-signing
ROLE_NAME=$PROJECT-lambda-role
LAMBDA_NAME=$PROJECT-sign-translator
POLICY_NAME=$PROJECT-kms-sign
PUBLIC_KEY_PATH=public/parkproof-public-key.pem

cd "$(dirname "$0")/.."

if ! command -v aws >/dev/null 2>&1; then
  if [[ -x "/c/Program Files/Amazon/AWSCLIV2/aws.exe" ]]; then
    export PATH="/c/Program Files/Amazon/AWSCLIV2:$PATH"
  fi
fi
command -v aws >/dev/null 2>&1 || { echo "✗ aws CLI not found"; exit 1; }

[[ -f .env ]] || { echo "✗ .env not found"; exit 1; }
set -a; . ./.env; set +a
[[ -n "${ANTHROPIC_API_KEY:-}" ]] || { echo "✗ ANTHROPIC_API_KEY missing from .env"; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "▶ Setup cryptographic signing"
echo "  Account: $ACCOUNT_ID"
echo "  Region:  $REGION"
echo ""

# ───── [1/5] KMS asymmetric key ────────────────────────────────────────────
echo "▶ [1/5] KMS key: $KEY_ALIAS"
KEY_ID=$(aws kms describe-key \
  --key-id "$KEY_ALIAS" \
  --region "$REGION" \
  --query 'KeyMetadata.KeyId' \
  --output text 2>/dev/null || echo "")

if [[ -z "$KEY_ID" || "$KEY_ID" == "None" ]]; then
  echo "  • creating ECDSA P-256 key"
  KEY_ID=$(aws kms create-key \
    --region "$REGION" \
    --description "ParkProof evidence signing (ECDSA P-256)" \
    --key-usage SIGN_VERIFY \
    --key-spec ECC_NIST_P256 \
    --tags TagKey=Project,TagValue=parkproof \
    --query 'KeyMetadata.KeyId' \
    --output text)
  aws kms create-alias \
    --region "$REGION" \
    --alias-name "$KEY_ALIAS" \
    --target-key-id "$KEY_ID"
  echo "  • created: $KEY_ID"
else
  echo "  • exists: $KEY_ID"
fi
KEY_ARN="arn:aws:kms:$REGION:$ACCOUNT_ID:key/$KEY_ID"

# ───── [2/5] Lambda role permission ────────────────────────────────────────
echo "▶ [2/5] IAM policy: $POLICY_NAME on $ROLE_NAME"
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Effect\": \"Allow\",
      \"Action\": [\"kms:Sign\", \"kms:GetPublicKey\", \"kms:DescribeKey\"],
      \"Resource\": \"$KEY_ARN\"
    }]
  }"
echo "  • policy applied"

# Wait for IAM to propagate before the Lambda env update can pick it up
sleep 5

# ───── [3/5] Lambda env: KMS_KEY_ID ────────────────────────────────────────
echo "▶ [3/5] Lambda env: KMS_KEY_ID"
EXISTING_ENV=$(aws lambda get-function-configuration \
  --function-name "$LAMBDA_NAME" \
  --region "$REGION" \
  --query 'Environment.Variables' \
  --output json)

# Merge KMS_KEY_ID into the existing env vars (preserve ANTHROPIC_API_KEY).
# Using FD 0 instead of '/dev/stdin' so Node on Windows doesn't try to resolve
# the POSIX path to 'C:\dev\stdin'.
NEW_ENV=$(echo "$EXISTING_ENV" | node -e "
  const data = require('fs').readFileSync(0, 'utf8');
  const incoming = JSON.parse(data || '{}') || {};
  incoming.KMS_KEY_ID = '$KEY_ID';
  process.stdout.write(JSON.stringify({ Variables: incoming }));
")
aws lambda update-function-configuration \
  --function-name "$LAMBDA_NAME" \
  --region "$REGION" \
  --environment "$NEW_ENV" \
  >/dev/null
aws lambda wait function-updated --function-name "$LAMBDA_NAME" --region "$REGION"
echo "  • set"

# ───── [4/5] Export public key ─────────────────────────────────────────────
echo "▶ [4/5] Public key → $PUBLIC_KEY_PATH"
PUB_JSON=public-key.tmp.json
aws kms get-public-key \
  --key-id "$KEY_ID" \
  --region "$REGION" \
  > "$PUB_JSON"

# Use Node for the PEM wrap so we don't depend on platform-specific base64 flags.
node -e "
  const fs = require('fs');
  const data = JSON.parse(fs.readFileSync('$PUB_JSON', 'utf8'));
  const b64 = data.PublicKey;
  const lines = [];
  for (let i = 0; i < b64.length; i += 64) lines.push(b64.slice(i, i + 64));
  const pem = '-----BEGIN PUBLIC KEY-----\n' + lines.join('\n') + '\n-----END PUBLIC KEY-----\n';
  fs.writeFileSync('$PUBLIC_KEY_PATH', pem);
"
rm -f "$PUB_JSON"
echo "  • saved (will be uploaded to CloudFront on next deploy)"

# ───── [5/5] Summary ──────────────────────────────────────────────────────
echo ""
echo "✓ Signing setup complete"
echo ""
echo "  Key alias: $KEY_ALIAS"
echo "  Key ID:    $KEY_ID"
echo "  Public:    $PUBLIC_KEY_PATH (run scripts/deploy.sh to publish to CloudFront)"
echo ""
echo "  Next: run scripts/deploy.sh to push the Lambda update + publish the public key."
