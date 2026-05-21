#!/usr/bin/env bash
# Idempotent: provisions the Web Push subscriptions DDB table + persists
# VAPID keys into scripts/.aws-resources so deploy.sh injects them as
# Lambda env vars on every deploy.
#
# Re-runnable. Won't regenerate VAPID keys if they already exist (would
# invalidate every existing subscription).

set -euo pipefail
export PATH="/c/Program Files/Amazon/AWSCLIV2:${PATH}"
export MSYS_NO_PATHCONV=1

REGION="${AWS_REGION:-ap-southeast-2}"
TABLE_NAME="parkproof-push-subscriptions"
ROLE_NAME="${LAMBDA_ROLE_NAME:-parkproof-lambda-role}"
POLICY_NAME="parkproof-push-subscriptions-rw"

cd "$(dirname "$0")/.."
RESOURCES_FILE="scripts/.aws-resources"

echo "▶ Web Push setup"
echo "  region:  $REGION"
echo "  table:   $TABLE_NAME"
echo "  role:    $ROLE_NAME"
echo ""

# ─── 1. Generate VAPID keys (one-time only) ─────────────────────────────
if grep -q "^VAPID_PUBLIC_KEY=" "$RESOURCES_FILE" 2>/dev/null; then
  echo "  ✓ VAPID keys already exist in $RESOURCES_FILE — skipping regen"
  echo "    (regenerating would invalidate every existing subscription)"
else
  echo "  • generating VAPID keypair"
  # web-push must already be installed in lambda/ — see lambda/package.json
  KEYS_JSON=$(cd lambda && node -e "import('web-push').then(m => process.stdout.write(JSON.stringify(m.default.generateVAPIDKeys())))")
  PUB=$(echo "$KEYS_JSON" | python -c "import sys,json; print(json.load(sys.stdin)['publicKey'])")
  PRIV=$(echo "$KEYS_JSON" | python -c "import sys,json; print(json.load(sys.stdin)['privateKey'])")
  {
    echo "VAPID_PUBLIC_KEY=$PUB"
    echo "VAPID_PRIVATE_KEY=$PRIV"
    echo "VAPID_SUBJECT=mailto:hello@parkproof.com.au"
  } >> "$RESOURCES_FILE"
  echo "    public key:  $PUB"
  echo "    (private key written to $RESOURCES_FILE)"
fi

# ─── 2. Create DDB table (idempotent) ────────────────────────────────────
if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "  ✓ DDB table $TABLE_NAME exists"
else
  echo "  • creating DDB table $TABLE_NAME"
  aws dynamodb create-table \
    --table-name "$TABLE_NAME" \
    --attribute-definitions "AttributeName=device_id,AttributeType=S" \
    --key-schema "AttributeName=device_id,KeyType=HASH" \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION" \
    >/dev/null
  echo "    waiting for table to become active..."
  aws dynamodb wait table-exists --table-name "$TABLE_NAME" --region "$REGION"
  # Enable TTL on expires_at — auto-sweep stale subs after 90 days
  aws dynamodb update-time-to-live \
    --table-name "$TABLE_NAME" \
    --time-to-live-specification "Enabled=true,AttributeName=expires_at" \
    --region "$REGION" \
    >/dev/null
  echo "    ✓ TTL enabled on expires_at (90-day rolling)"
fi

# ─── 3. Stamp table name into .aws-resources ────────────────────────────
if grep -q "^DYNAMODB_TABLE_PUSH=" "$RESOURCES_FILE" 2>/dev/null; then
  sed -i "s|^DYNAMODB_TABLE_PUSH=.*$|DYNAMODB_TABLE_PUSH=$TABLE_NAME|" "$RESOURCES_FILE"
else
  echo "DYNAMODB_TABLE_PUSH=$TABLE_NAME" >> "$RESOURCES_FILE"
fi

# ─── 4. Attach IAM policy to Lambda role ────────────────────────────────
echo "  • attaching IAM policy $POLICY_NAME to $ROLE_NAME"
POLICY_DOC=$(cat <<EOF
{
  "Version":"2012-10-17",
  "Statement":[{
    "Effect":"Allow",
    "Action":["dynamodb:PutItem","dynamodb:GetItem","dynamodb:UpdateItem","dynamodb:DeleteItem","dynamodb:Scan","dynamodb:Query"],
    "Resource":"arn:aws:dynamodb:$REGION:*:table/$TABLE_NAME"
  }]
}
EOF
)
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "$POLICY_DOC" \
  >/dev/null
echo "    ✓ IAM policy attached"

echo ""
echo "✓ Web Push foundation provisioned"
echo ""
echo "Next steps tonight:"
echo "  1. bash scripts/deploy.sh   (picks up new env vars + new route)"
echo "  2. Open About page → 'Try notifications (preview)' → grant permission"
echo "  3. Send a test push via scripts/send-test-push.mjs"
