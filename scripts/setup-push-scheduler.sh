#!/usr/bin/env bash
# Idempotent: provisions everything needed for EventBridge Scheduler to fire
# one-shot push notifications at parking-reminder times.
#
#   1. An IAM role EventBridge Scheduler assumes when firing the target
#      Lambda. This role can ONLY invoke our dispatch handler — nothing else.
#   2. Permissions on the Lambda execution role to CREATE / DELETE schedules
#      and to PASS the scheduler role to EventBridge.
#   3. Stamps the role ARN into scripts/.aws-resources so deploy.sh + the
#      Lambda code can read it from env.
#
# Re-runnable. Won't recreate the role if it exists.

set -euo pipefail
export PATH="/c/Program Files/Amazon/AWSCLIV2:${PATH}"
export MSYS_NO_PATHCONV=1

REGION="${AWS_REGION:-ap-southeast-2}"
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)

SCHEDULER_ROLE_NAME="parkproof-push-scheduler-role"
SCHEDULER_POLICY_NAME="parkproof-push-scheduler-invoke"
LAMBDA_ROLE_NAME="${LAMBDA_ROLE_NAME:-parkproof-lambda-role}"
LAMBDA_NAME="${LAMBDA_NAME:-parkproof-sign-translator}"
LAMBDA_SCHEDULER_POLICY="parkproof-lambda-schedule-rw"

cd "$(dirname "$0")/.."
RESOURCES_FILE="scripts/.aws-resources"

echo "▶ Web Push scheduler setup"
echo "  region:           $REGION"
echo "  scheduler role:   $SCHEDULER_ROLE_NAME"
echo "  lambda role:      $LAMBDA_ROLE_NAME"
echo "  lambda function:  $LAMBDA_NAME"
echo ""

LAMBDA_ARN="arn:aws:lambda:$REGION:$ACCOUNT_ID:function:$LAMBDA_NAME"

# ─── 1. Scheduler execution role ────────────────────────────────────────
# Trust policy: only EventBridge Scheduler can assume this role.
TRUST_POLICY='{
  "Version":"2012-10-17",
  "Statement":[{
    "Effect":"Allow",
    "Principal":{"Service":"scheduler.amazonaws.com"},
    "Action":"sts:AssumeRole"
  }]
}'

if aws iam get-role --role-name "$SCHEDULER_ROLE_NAME" >/dev/null 2>&1; then
  echo "  ✓ Scheduler role $SCHEDULER_ROLE_NAME exists"
else
  echo "  • creating scheduler role"
  aws iam create-role \
    --role-name "$SCHEDULER_ROLE_NAME" \
    --assume-role-policy-document "$TRUST_POLICY" \
    --description "Lets EventBridge Scheduler invoke parkproof-sign-translator for push dispatch" \
    >/dev/null
  # IAM role takes a few seconds to be assumable after creation.
  sleep 5
fi

# Inline policy on the scheduler role: only allow InvokeFunction on our
# specific Lambda. Tightest scope.
SCHEDULER_INVOKE_POLICY=$(cat <<EOF
{
  "Version":"2012-10-17",
  "Statement":[{
    "Effect":"Allow",
    "Action":"lambda:InvokeFunction",
    "Resource":"$LAMBDA_ARN"
  }]
}
EOF
)
aws iam put-role-policy \
  --role-name "$SCHEDULER_ROLE_NAME" \
  --policy-name "$SCHEDULER_POLICY_NAME" \
  --policy-document "$SCHEDULER_INVOKE_POLICY" \
  >/dev/null
echo "  ✓ scheduler role can invoke $LAMBDA_NAME"

SCHEDULER_ROLE_ARN="arn:aws:iam::$ACCOUNT_ID:role/$SCHEDULER_ROLE_NAME"

# ─── 2. Lambda permissions: create/delete schedules + pass scheduler role ─
LAMBDA_SCHEDULE_POLICY=$(cat <<EOF
{
  "Version":"2012-10-17",
  "Statement":[
    {
      "Effect":"Allow",
      "Action":[
        "scheduler:CreateSchedule",
        "scheduler:DeleteSchedule",
        "scheduler:GetSchedule",
        "scheduler:UpdateSchedule"
      ],
      "Resource":"arn:aws:scheduler:$REGION:$ACCOUNT_ID:schedule/default/parkproof-push-*"
    },
    {
      "Effect":"Allow",
      "Action":"iam:PassRole",
      "Resource":"$SCHEDULER_ROLE_ARN",
      "Condition":{"StringEquals":{"iam:PassedToService":"scheduler.amazonaws.com"}}
    }
  ]
}
EOF
)
aws iam put-role-policy \
  --role-name "$LAMBDA_ROLE_NAME" \
  --policy-name "$LAMBDA_SCHEDULER_POLICY" \
  --policy-document "$LAMBDA_SCHEDULE_POLICY" \
  >/dev/null
echo "  ✓ Lambda role can create/delete schedules + pass scheduler role"

# ─── 3. Stamp into .aws-resources ────────────────────────────────────────
if grep -q "^PUSH_SCHEDULER_ROLE_ARN=" "$RESOURCES_FILE" 2>/dev/null; then
  sed -i "s|^PUSH_SCHEDULER_ROLE_ARN=.*$|PUSH_SCHEDULER_ROLE_ARN=$SCHEDULER_ROLE_ARN|" "$RESOURCES_FILE"
else
  echo "PUSH_SCHEDULER_ROLE_ARN=$SCHEDULER_ROLE_ARN" >> "$RESOURCES_FILE"
fi

if ! grep -q "^PUSH_DISPATCH_LAMBDA_ARN=" "$RESOURCES_FILE" 2>/dev/null; then
  echo "PUSH_DISPATCH_LAMBDA_ARN=$LAMBDA_ARN" >> "$RESOURCES_FILE"
fi

echo ""
echo "✓ Push scheduler infrastructure provisioned"
echo "  scheduler role: $SCHEDULER_ROLE_ARN"
echo "  dispatch target: $LAMBDA_ARN"
echo ""
echo "Next: bash scripts/deploy.sh   (picks up new env vars + new routes)"
