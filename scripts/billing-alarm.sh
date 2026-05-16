#!/usr/bin/env bash
# ParkProof — create or update an AWS Budgets monthly cost alarm.
#
# Usage:
#   bash scripts/billing-alarm.sh                            # uses defaults
#   bash scripts/billing-alarm.sh email@example.com          # override email
#   bash scripts/billing-alarm.sh email@example.com 25       # override threshold (USD)
#
# Defaults: $10/month threshold, alerts the email below.
# AWS Budgets is free for the first 2 budgets per account.

set -euo pipefail

DEFAULT_EMAIL="moltensnake@gmail.com"
DEFAULT_THRESHOLD=10

EMAIL="${1:-$DEFAULT_EMAIL}"
THRESHOLD="${2:-$DEFAULT_THRESHOLD}"
BUDGET_NAME="parkproof-monthly"

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
