#!/usr/bin/env bash
# ParkProof: the Lambda role's permissions on the async jobs table.
#
# The jobs table (parkproof-jobs) holds the pending, done and error rows of
# every async job (sign readings, appeal drafts, notice reads) and the
# per-IP rate limiter's rows. Its GetItem, PutItem and UpdateItem grants on
# parkproof-lambda-role were made by hand when the table was created, and no
# script has them (they were confirmed allowed on 9 Nov 2026). This script
# adds the one that was missing.
#
# What it does, and nothing else:
#   - adds an inline policy, parkproof-jobs-delete, on parkproof-lambda-role
#     that allows dynamodb:DeleteItem on the jobs table. /read-notice/status
#     deletes each notice row once it has handed back a finished result, and
#     deletes expired rows (lambda/index.js handleJobStatus). A read-only
#     check on 9 Nov 2026 found DeleteItem was not granted (implicitDeny).
#
# It doesn't create the table, change its TTL (the table's TTL attribute is
# `ttl`, which is what the code writes), or touch scripts/.aws-resources,
# Cognito or any other policy. Safe to re-run: put-role-policy replaces the
# policy with the same document.
#
# Usage:
#   bash scripts/setup-jobs-table.sh
# Environment (all optional):
#   JOBS_TABLE        the table's name, if the Lambda's JOBS_TABLE says so
#                     (default parkproof-jobs)
#   LAMBDA_ROLE_NAME  default parkproof-lambda-role
#   AWS_REGION        default ap-southeast-2

set -euo pipefail
if ! command -v aws >/dev/null 2>&1 && [[ -x "/c/Program Files/Amazon/AWSCLIV2/aws.exe" ]]; then
  export PATH="/c/Program Files/Amazon/AWSCLIV2:${PATH}"
fi
command -v aws >/dev/null 2>&1 || { echo "✗ aws CLI not found on PATH" >&2; exit 1; }

REGION="${AWS_REGION:-ap-southeast-2}"
TABLE_NAME="${JOBS_TABLE:-parkproof-jobs}"
ROLE_NAME="${LAMBDA_ROLE_NAME:-parkproof-lambda-role}"
POLICY_NAME="parkproof-jobs-delete"

# tr strips the CR that the Windows aws.exe can leave on text output.
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text | tr -d '\r')
[[ "$ACCOUNT_ID" =~ ^[0-9]{12}$ ]] || { echo "✗ Couldn't read the AWS account id (got '$ACCOUNT_ID')" >&2; exit 1; }
TABLE_ARN="arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/$TABLE_NAME"

echo "▶ Jobs table permissions"
echo "  role:   $ROLE_NAME"
echo "  table:  $TABLE_ARN"
echo "  policy: $POLICY_NAME (dynamodb:DeleteItem)"

POLICY_DOC=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "NoticeJobDeleteAfterRead",
    "Effect": "Allow",
    "Action": "dynamodb:DeleteItem",
    "Resource": "$TABLE_ARN"
  }]
}
EOF
)

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "$POLICY_DOC" \
  >/dev/null
echo "  ✓ $ROLE_NAME can delete rows in $TABLE_NAME"
echo ""
echo "IAM takes up to a minute to apply this. Then check it (read-only):"
echo "  aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME \\"
echo "    --resource-arns $TABLE_ARN --action-names dynamodb:DeleteItem \\"
echo "    --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text"
echo "  It should print: dynamodb:DeleteItem  allowed"
