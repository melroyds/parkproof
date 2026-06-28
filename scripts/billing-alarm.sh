#!/usr/bin/env bash
# ParkProof — create or update an AWS Budgets monthly cost alarm.
#
# Usage:
#   bash scripts/billing-alarm.sh you@example.com            # email required (or set ALARM_EMAIL)
#   bash scripts/billing-alarm.sh you@example.com 25         # override threshold (USD)
#
# Threshold defaults to $10/month. The alarm email has no default — pass it.
# AWS Budgets is free for the first 2 budgets per account.

set -euo pipefail

DEFAULT_THRESHOLD=10

# No personal default — pass the alarm email as the first arg or via $ALARM_EMAIL.
EMAIL="${1:-${ALARM_EMAIL:-}}"
THRESHOLD="${2:-$DEFAULT_THRESHOLD}"
BUDGET_NAME="parkproof-monthly"

if [[ -z "$EMAIL" ]]; then
  echo "✗ No alarm email. Pass one as the first arg or set ALARM_EMAIL." >&2
  echo "  e.g. bash scripts/billing-alarm.sh alerts@parkproof.com.au 25" >&2
  exit 1
fi

cd "$(dirname "$0")/.."

if ! command -v aws >/dev/null 2>&1; then
  if [[ -x "/c/Program Files/Amazon/AWSCLIV2/aws.exe" ]]; then
    export PATH="/c/Program Files/Amazon/AWSCLIV2:$PATH"
  fi
fi
command -v aws >/dev/null 2>&1 || { echo "✗ aws CLI not found"; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

echo "▶ AWS Budgets alarm"
echo "  Account:    $ACCOUNT_ID"
echo "  Budget:     $BUDGET_NAME"
echo "  Threshold:  \$${THRESHOLD}/month"
echo "  Email:      $EMAIL"
echo ""

# Delete + recreate so this script is fully idempotent — including notification
# changes if you re-run with different args.
if aws budgets describe-budget \
  --account-id "$ACCOUNT_ID" \
  --budget-name "$BUDGET_NAME" \
  >/dev/null 2>&1; then
  echo "  • existing budget found — replacing"
  aws budgets delete-budget --account-id "$ACCOUNT_ID" --budget-name "$BUDGET_NAME" >/dev/null
fi

aws budgets create-budget \
  --account-id "$ACCOUNT_ID" \
  --budget "{
    \"BudgetName\": \"$BUDGET_NAME\",
    \"BudgetType\": \"COST\",
    \"TimeUnit\": \"MONTHLY\",
    \"BudgetLimit\": {\"Amount\": \"$THRESHOLD\", \"Unit\": \"USD\"}
  }" \
  --notifications-with-subscribers "[
    {
      \"Notification\": {
        \"NotificationType\": \"ACTUAL\",
        \"ComparisonOperator\": \"GREATER_THAN\",
        \"Threshold\": 80,
        \"ThresholdType\": \"PERCENTAGE\"
      },
      \"Subscribers\": [{\"SubscriptionType\": \"EMAIL\", \"Address\": \"$EMAIL\"}]
    },
    {
      \"Notification\": {
        \"NotificationType\": \"FORECASTED\",
        \"ComparisonOperator\": \"GREATER_THAN\",
        \"Threshold\": 100,
        \"ThresholdType\": \"PERCENTAGE\"
      },
      \"Subscribers\": [{\"SubscriptionType\": \"EMAIL\", \"Address\": \"$EMAIL\"}]
    }
  ]"

echo ""
echo "✓ Budget created"
echo ""
echo "  You will get an email at $EMAIL when:"
echo "    • Actual spend exceeds 80% of \$${THRESHOLD} (\$$(awk "BEGIN {printf \"%.2f\", $THRESHOLD * 0.8}"))"
echo "    • Forecasted spend exceeds 100% of \$${THRESHOLD}"
echo ""
echo "  AWS may send a one-time confirmation email — accept it to start receiving alerts."
