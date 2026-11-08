#!/usr/bin/env bash
# ParkProof: destroy every AWS resource the setup and deploy scripts create.
#
# Defaults to a DRY RUN. Pass --confirm to actually delete things:
#
#   bash scripts/teardown.sh           # prints what would be deleted, no changes
#   bash scripts/teardown.sh --confirm # actually destroys everything
#
# The dry run reads only the account id. Anything else, including a mistyped
# --confirm, is a dry run too.
#
# A --confirm run deletes every driver's synced records, evidence photos,
# push registrations and account, and all the feedback. None of it can be
# recovered. Export anything you want to keep first.
#
# What it removes, in this order. Each step skips what isn't there, so a run
# that stops part way can be run again.
#   1. Every EventBridge schedule named parkproof-push-* (a record's one-shot
#      reminders and the weekly ones, which the Lambda books under
#      setup-push-scheduler.sh's grant), and the hand-made parkproof-warmer
#      schedule if there is one. First, so nothing fires at a deleted Lambda.
#   2. CloudFront (deploy.sh). It must redeploy as "disabled" before it can
#      be deleted, which takes 5 to 15 minutes; the script waits. Then the
#      parkproof-uri-rewrite function (made by hand) and the OAC (harden.sh).
#   3. The app bucket (deploy.sh), emptied first.
#   4. The API (deploy.sh), with its routes, its stage and the parkproof-jwt
#      authorizer (setup-auth.sh).
#   5. The Lambda (deploy.sh), then every /aws/lambda/parkproof-* log group
#      (setup-log-retention.sh sets the retention on the Lambda's), which
#      takes the usage alarm's metric filter with it. Then the usage alarm
#      and its SNS topic (anthropic-usage-alarm.sh) and the launch dashboard
#      (_create_launch_dashboard.py).
#   6. The Cognito user pool, with its app client and sign-in providers,
#      after its Hosted UI domain (setup-auth.sh).
#   7. The DynamoDB tables: sessions (setup-auth.sh), push subscriptions
#      (setup-push.sh) and jobs (made by hand; setup-jobs-table.sh grants on it).
#   8. The evidence bucket (setup-auth.sh, versioned) and the feedback bucket
#      (setup-feedback-bucket.sh), emptied first, old versions included.
#   9. The KMS signing key (setup-signing.sh). KMS can't delete a key at once:
#      it is scheduled for deletion after 7 days, the shortest wait KMS
#      allows, and disabled until then. Then its alias is removed. Until the
#      7 days are up, `aws kms cancel-key-deletion --key-id <id>` brings it
#      back. PDFs already signed can still be checked with
#      public/parkproof-public-key.pem, which needs nothing in AWS.
#  10. The scheduler role (setup-push-scheduler.sh) and the Lambda role
#      (deploy.sh). IAM refuses to delete a role that still has policies, so
#      each role's inline policies (every one, including the setup scripts'
#      and any made by hand) are deleted and its managed policies detached
#      first.
#
# Left alone on purpose:
#   - The AWS Budgets alarm parkproof-monthly (billing-alarm.sh). It watches
#     the whole account, so it still emails if anything is left running.
#   - The ACM certificates, Cloudflare DNS and the Apple and Google sign-in
#     registrations. No script makes them, and the certificates cost nothing.
#   - scripts/.aws-resources, the local file with the VAPID keys and the ids
#     of what this deletes. Move it aside before setting up again.
#
# Never run this without reading the dry run first.

set -euo pipefail

PROJECT=parkproof
REGION=ap-southeast-2

# deploy.sh
LAMBDA_NAME=$PROJECT-sign-translator
ROLE_NAME=$PROJECT-lambda-role
API_NAME=$PROJECT-api
DIST_COMMENT=$PROJECT-cdn
# harden.sh, and the hand-made viewer-request function (scripts/_cloudfront-uri-rewrite.js)
OAC_NAME=$PROJECT-oac
CF_FUNCTION_NAME=$PROJECT-uri-rewrite
# setup-auth.sh
USER_POOL_NAME=$PROJECT-users
APP_CLIENT_NAME=$PROJECT-spa
AUTHORIZER_NAME=$PROJECT-jwt
SESSIONS_TABLE=$PROJECT-sessions
# setup-push.sh, and the jobs table (made by hand; setup-jobs-table.sh)
PUSH_TABLE=$PROJECT-push-subscriptions
JOBS_TABLE="${JOBS_TABLE:-$PROJECT-jobs}"
# setup-push-scheduler.sh, and the hand-made warmer
SCHEDULER_ROLE_NAME=$PROJECT-push-scheduler-role
PUSH_SCHEDULE_PREFIX=$PROJECT-push-
WARMER_SCHEDULE=$PROJECT-warmer
# setup-signing.sh
KEY_ALIAS=alias/$PROJECT-evidence-signing
# KMS's shortest wait before it deletes a key.
KMS_WAIT_DAYS=7
# setup-log-retention.sh (the Lambda's group) and anthropic-usage-alarm.sh
LOG_GROUP_PREFIX=/aws/lambda/$PROJECT-
METRIC_FILTER_NAME=$PROJECT-anthropic-calls
ALARM_NAME=$PROJECT-anthropic-usage
TOPIC_NAME=$PROJECT-cost-alerts
# _create_launch_dashboard.py
DASHBOARD_NAME=$PROJECT-launch
# billing-alarm.sh: kept, see above.
BUDGET_NAME=$PROJECT-monthly

# The inline policies the setup scripts put on the two roles. Step 10 deletes
# whatever a role has, so a policy made by hand goes too.
LAMBDA_INLINE_POLICIES="$PROJECT-data-access $PROJECT-user-feedback-write $PROJECT-push-subscriptions-rw $PROJECT-lambda-schedule-rw $PROJECT-kms-sign $PROJECT-jobs-delete"
SCHEDULER_INLINE_POLICIES="$PROJECT-push-scheduler-invoke"

cd "$(dirname "$0")/.."

if ! command -v aws >/dev/null 2>&1; then
  if [[ -x "/c/Program Files/Amazon/AWSCLIV2/aws.exe" ]]; then
    export PATH="/c/Program Files/Amazon/AWSCLIV2:$PATH"
  fi
fi
command -v aws >/dev/null 2>&1 || { echo "✗ aws CLI not found"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "✗ node not found"; exit 1; }
# Git Bash would turn a log group's leading slash into a Windows path.
export MSYS_NO_PATHCONV=1

# tr strips the CR that the Windows aws.exe can leave on text output.
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text | tr -d '\r')
[[ "$ACCOUNT_ID" =~ ^[0-9]{12}$ ]] || { echo "✗ Couldn't read the AWS account id (got '$ACCOUNT_ID')" >&2; exit 1; }
BUCKET=$PROJECT-app-$ACCOUNT_ID
EVIDENCE_BUCKET=$PROJECT-evidence-$ACCOUNT_ID
FEEDBACK_BUCKET=$PROJECT-user-feedback-$ACCOUNT_ID
HOSTED_UI_DOMAIN=$PROJECT-$ACCOUNT_ID
TOPIC_ARN=arn:aws:sns:$REGION:$ACCOUNT_ID:$TOPIC_NAME

CONFIRM="${1:-}"

echo "ParkProof teardown, account $ACCOUNT_ID, region $REGION"
echo ""
echo "Resources that will be deleted (if any exist):"
echo "  • Push schedules:    every EventBridge schedule named ${PUSH_SCHEDULE_PREFIX}*, and $WARMER_SCHEDULE (made by hand)"
echo "  • CloudFront dist:   $DIST_COMMENT, then its function $CF_FUNCTION_NAME (made by hand)"
echo "  • OAC:               $OAC_NAME"
echo "  • S3 bucket:         $BUCKET (with all contents)"
echo "  • API Gateway:       $API_NAME, with its routes and the $AUTHORIZER_NAME authorizer"
echo "  • Lambda function:   $LAMBDA_NAME"
echo "  • Log groups:        every ${LOG_GROUP_PREFIX}* group, with the $METRIC_FILTER_NAME metric filter"
echo "  • CloudWatch alarm:  $ALARM_NAME, and its SNS topic $TOPIC_NAME"
echo "  • Dashboard:         $DASHBOARD_NAME"
echo "  • Cognito:           user pool $USER_POOL_NAME, with its app client $APP_CLIENT_NAME,"
echo "                       its sign-in providers and the Hosted UI domain $HOSTED_UI_DOMAIN"
echo "  • DynamoDB tables:   $SESSIONS_TABLE, $PUSH_TABLE, $JOBS_TABLE"
echo "  • S3 buckets:        $EVIDENCE_BUCKET, $FEEDBACK_BUCKET"
echo "                       (with all contents, old versions included)"
echo "  • KMS key:           $KEY_ALIAS and its alias. Scheduled for deletion after"
echo "                       $KMS_WAIT_DAYS days, the shortest wait KMS allows, and disabled until then"
echo "  • IAM roles:         $SCHEDULER_ROLE_NAME and $ROLE_NAME, after every policy on them:"
echo "                       inline on $ROLE_NAME: $LAMBDA_INLINE_POLICIES"
echo "                       inline on $SCHEDULER_ROLE_NAME: $SCHEDULER_INLINE_POLICIES"
echo "                       plus any other inline policy, and AWSLambdaBasicExecutionRole detached"
echo ""
echo "This deletes every driver's synced records, evidence photos, push registrations"
echo "and account, and all the feedback. None of it can be recovered."
echo ""
echo "Kept: the AWS Budgets alarm $BUDGET_NAME (it watches the whole account), the ACM"
echo "certificates, and scripts/.aws-resources (move it aside before setting up again)."
echo ""

if [[ "$CONFIRM" != "--confirm" ]]; then
  echo "Dry run, nothing was deleted."
  echo "To actually delete, run:  bash scripts/teardown.sh --confirm"
  exit 0
fi

echo "▶ DELETING IN 5 SECONDS. Ctrl+C to abort"
sleep 5
echo ""

# Text output of a lookup, without CR, and empty when it fails.
read_text() {
  "$@" 2>/dev/null | tr -d '\r' || true
}

# Empties a bucket, every object version and delete marker included (the
# evidence bucket is versioned, so `aws s3 rm` alone would leave it full),
# 1000 at a time, then deletes the bucket.
delete_bucket() {
  local bucket="$1" label="$2"
  if ! aws s3api head-bucket --bucket "$bucket" --region "$REGION" >/dev/null 2>&1; then
    echo "▶ S3 $label bucket: nothing to delete"
    return 0
  fi
  echo "▶ S3 $label bucket: emptying and deleting $bucket"
  # Project-relative, so the Windows aws.exe can read it (not a /tmp path).
  local batch=teardown-batch.tmp.json count errors
  while :; do
    aws s3api list-object-versions --bucket "$bucket" --region "$REGION" --max-items 1000 --output json > "$batch"
    count=$(node -e "
      const fs = require('fs');
      const page = JSON.parse(fs.readFileSync('$batch', 'utf8').trim() || '{}') || {};
      const objects = [...(page.Versions || []), ...(page.DeleteMarkers || [])]
        .slice(0, 1000)
        .map(({ Key, VersionId }) => ({ Key, VersionId }));
      fs.writeFileSync('$batch', JSON.stringify({ Objects: objects, Quiet: true }));
      process.stdout.write(String(objects.length));
    ")
    [[ "$count" == "0" ]] && break
    errors=$(aws s3api delete-objects --bucket "$bucket" --region "$REGION" \
      --delete "file://$batch" --query 'length(Errors || `[]`)' --output text | tr -d '\r')
    if [[ "$errors" != "0" ]]; then
      rm -f "$batch"
      echo "✗ $errors objects in $bucket couldn't be deleted; stopping" >&2
      exit 1
    fi
    echo "  • removed $count objects and versions"
  done
  rm -f "$batch"
  aws s3api delete-bucket --bucket "$bucket" --region "$REGION"
  echo "  • deleted"
}

# Deletes a role's inline policies, detaches its managed ones, then deletes it.
delete_role() {
  local role="$1" name arn
  if ! aws iam get-role --role-name "$role" >/dev/null 2>&1; then
    echo "▶ IAM role: $role, nothing to delete"
    return 0
  fi
  echo "▶ IAM role: deleting $role"
  for name in $(aws iam list-role-policies --role-name "$role" --query 'PolicyNames[]' --output text | tr -d '\r'); do
    [[ "$name" == "None" ]] && continue
    aws iam delete-role-policy --role-name "$role" --policy-name "$name"
    echo "  • inline policy $name deleted"
  done
  for arn in $(aws iam list-attached-role-policies --role-name "$role" --query 'AttachedPolicies[].PolicyArn' --output text | tr -d '\r'); do
    [[ "$arn" == "None" ]] && continue
    aws iam detach-role-policy --role-name "$role" --policy-arn "$arn"
    echo "  • managed policy ${arn##*/} detached"
  done
  aws iam delete-role --role-name "$role"
  echo "  • deleted"
}

# ───── 1. Push schedules, and the warmer ───────────────────────────────────
SCHEDULES=$(read_text aws scheduler list-schedules --name-prefix "$PUSH_SCHEDULE_PREFIX" --region "$REGION" \
  --query 'Schedules[].[Name,GroupName]' --output text)
if [[ -n "$SCHEDULES" && "$SCHEDULES" != "None" ]]; then
  echo "▶ Push schedules: deleting every ${PUSH_SCHEDULE_PREFIX}* schedule"
  while IFS=$'\t' read -r name group; do
    [[ -n "$name" && "$name" != "None" ]] || continue
    aws scheduler delete-schedule --name "$name" --group-name "${group:-default}" --region "$REGION"
    echo "  • $name deleted"
  done <<< "$SCHEDULES"
else
  echo "▶ Push schedules: nothing to delete"
fi
WARMER_ROLE=$(read_text aws scheduler get-schedule --name "$WARMER_SCHEDULE" --region "$REGION" \
  --query 'Target.RoleArn' --output text)
if [[ -n "$WARMER_ROLE" && "$WARMER_ROLE" != "None" ]]; then
  echo "▶ Warmer schedule: deleting $WARMER_SCHEDULE"
  aws scheduler delete-schedule --name "$WARMER_SCHEDULE" --region "$REGION"
  echo "  • deleted. It was made by hand, with the role $WARMER_ROLE;"
  echo "    delete that role by hand unless it's $SCHEDULER_ROLE_NAME (step 10 does that one)"
else
  echo "▶ Warmer schedule: nothing to delete"
fi

# ───── 2. CloudFront: disable, wait, then delete; its function; the OAC ────
DIST_ID=$(read_text aws cloudfront list-distributions \
  --query "DistributionList.Items[?Comment=='$DIST_COMMENT'].Id | [0]" \
  --output text)
if [[ -n "$DIST_ID" && "$DIST_ID" != "None" ]]; then
  echo "▶ CloudFront: disabling $DIST_ID"
  ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query 'ETag' --output text | tr -d '\r')
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

  echo "  • waiting for redeploy (5 to 15 min)…"
  aws cloudfront wait distribution-deployed --id "$DIST_ID"

  ETAG=$(aws cloudfront get-distribution-config --id "$DIST_ID" --query 'ETag' --output text | tr -d '\r')
  aws cloudfront delete-distribution --id "$DIST_ID" --if-match "$ETAG"
  echo "  • deleted"
else
  echo "▶ CloudFront: nothing to delete"
fi

# A function still associated with a distribution can't be deleted, so this
# comes after the distribution.
CF_FUNCTION_ETAG=$(read_text aws cloudfront describe-function --name "$CF_FUNCTION_NAME" --query 'ETag' --output text)
if [[ -n "$CF_FUNCTION_ETAG" && "$CF_FUNCTION_ETAG" != "None" ]]; then
  echo "▶ CloudFront function: deleting $CF_FUNCTION_NAME"
  aws cloudfront delete-function --name "$CF_FUNCTION_NAME" --if-match "$CF_FUNCTION_ETAG"
  echo "  • deleted"
else
  echo "▶ CloudFront function: nothing to delete"
fi

OAC_ID=$(read_text aws cloudfront list-origin-access-controls \
  --query "OriginAccessControlList.Items[?Name=='$OAC_NAME'].Id | [0]" \
  --output text)
if [[ -n "$OAC_ID" && "$OAC_ID" != "None" ]]; then
  echo "▶ OAC: deleting $OAC_ID"
  OAC_ETAG=$(aws cloudfront get-origin-access-control --id "$OAC_ID" --query 'ETag' --output text | tr -d '\r')
  aws cloudfront delete-origin-access-control --id "$OAC_ID" --if-match "$OAC_ETAG"
  echo "  • deleted"
else
  echo "▶ OAC: nothing to delete"
fi

# ───── 3. App bucket: empty then delete ────────────────────────────────────
delete_bucket "$BUCKET" app

# ───── 4. API Gateway (routes, stage and JWT authorizer go with it) ────────
API_ID=$(read_text aws apigatewayv2 get-apis --region "$REGION" --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text)
if [[ -n "$API_ID" && "$API_ID" != "None" ]]; then
  echo "▶ API Gateway: deleting $API_ID"
  aws apigatewayv2 delete-api --api-id "$API_ID" --region "$REGION"
  echo "  • deleted"
else
  echo "▶ API Gateway: nothing to delete"
fi

# ───── 5. Lambda function, its logs, the usage alarm, the dashboard ────────
if aws lambda get-function --function-name "$LAMBDA_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "▶ Lambda: deleting $LAMBDA_NAME"
  aws lambda delete-function --function-name "$LAMBDA_NAME" --region "$REGION"
  echo "  • deleted"
else
  echo "▶ Lambda: nothing to delete"
fi

# After the Lambda, so nothing writes a new log group. Deleting a group
# deletes its metric filters ($METRIC_FILTER_NAME) too.
LOG_GROUPS=$(read_text aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP_PREFIX" --region "$REGION" \
  --query 'logGroups[].logGroupName' --output text)
if [[ -n "$LOG_GROUPS" && "$LOG_GROUPS" != "None" ]]; then
  echo "▶ Log groups: deleting every ${LOG_GROUP_PREFIX}* group"
  for group in $LOG_GROUPS; do
    aws logs delete-log-group --log-group-name "$group" --region "$REGION"
    echo "  • $group deleted"
  done
else
  echo "▶ Log groups: nothing to delete"
fi

ALARM=$(read_text aws cloudwatch describe-alarms --alarm-names "$ALARM_NAME" --region "$REGION" \
  --query 'MetricAlarms[0].AlarmName' --output text)
if [[ "$ALARM" == "$ALARM_NAME" ]]; then
  echo "▶ CloudWatch alarm: deleting $ALARM_NAME"
  aws cloudwatch delete-alarms --alarm-names "$ALARM_NAME" --region "$REGION"
  echo "  • deleted"
else
  echo "▶ CloudWatch alarm: nothing to delete"
fi

if aws sns get-topic-attributes --topic-arn "$TOPIC_ARN" --region "$REGION" >/dev/null 2>&1; then
  echo "▶ SNS topic: deleting $TOPIC_NAME (and its email subscription)"
  aws sns delete-topic --topic-arn "$TOPIC_ARN" --region "$REGION"
  echo "  • deleted"
else
  echo "▶ SNS topic: nothing to delete"
fi

if aws cloudwatch get-dashboard --dashboard-name "$DASHBOARD_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "▶ Dashboard: deleting $DASHBOARD_NAME"
  aws cloudwatch delete-dashboards --dashboard-names "$DASHBOARD_NAME" --region "$REGION"
  echo "  • deleted"
else
  echo "▶ Dashboard: nothing to delete"
fi

# ───── 6. Cognito: the Hosted UI domain, then the pool ─────────────────────
USER_POOL_ID=$(read_text aws cognito-idp list-user-pools --max-results 60 --region "$REGION" \
  --query "UserPools[?Name=='$USER_POOL_NAME'].Id | [0]" --output text)
if [[ -n "$USER_POOL_ID" && "$USER_POOL_ID" != "None" ]]; then
  echo "▶ Cognito: deleting user pool $USER_POOL_ID ($USER_POOL_NAME)"
  DOMAIN=$(read_text aws cognito-idp describe-user-pool --user-pool-id "$USER_POOL_ID" --region "$REGION" \
    --query 'UserPool.Domain' --output text)
  if [[ -n "$DOMAIN" && "$DOMAIN" != "None" ]]; then
    aws cognito-idp delete-user-pool-domain --domain "$DOMAIN" --user-pool-id "$USER_POOL_ID" --region "$REGION"
    echo "  • Hosted UI domain $DOMAIN deleted"
  fi
  # The app client and the Apple and Google providers go with the pool.
  aws cognito-idp delete-user-pool --user-pool-id "$USER_POOL_ID" --region "$REGION"
  echo "  • deleted, with every account in it"
else
  echo "▶ Cognito: nothing to delete"
fi

# ───── 7. DynamoDB tables ──────────────────────────────────────────────────
for table in "$SESSIONS_TABLE" "$PUSH_TABLE" "$JOBS_TABLE"; do
  if aws dynamodb describe-table --table-name "$table" --region "$REGION" >/dev/null 2>&1; then
    echo "▶ DynamoDB: deleting $table"
    aws dynamodb delete-table --table-name "$table" --region "$REGION" >/dev/null
    echo "  • deleted"
  else
    echo "▶ DynamoDB: $table, nothing to delete"
  fi
done

# ───── 8. Evidence and feedback buckets: empty then delete ─────────────────
delete_bucket "$EVIDENCE_BUCKET" evidence
delete_bucket "$FEEDBACK_BUCKET" feedback

# ───── 9. KMS signing key: schedule deletion, then remove the alias ────────
# Scheduled before the alias goes, so a run that stops in between still finds
# the key by its alias next time.
KEY_ID=$(read_text aws kms describe-key --key-id "$KEY_ALIAS" --region "$REGION" --query 'KeyMetadata.KeyId' --output text)
if [[ -n "$KEY_ID" && "$KEY_ID" != "None" ]]; then
  echo "▶ KMS: $KEY_ALIAS ($KEY_ID)"
  KEY_STATE=$(aws kms describe-key --key-id "$KEY_ID" --region "$REGION" --query 'KeyMetadata.KeyState' --output text | tr -d '\r')
  if [[ "$KEY_STATE" == "PendingDeletion" ]]; then
    echo "  • already scheduled for deletion"
  else
    DELETION_DATE=$(aws kms schedule-key-deletion --key-id "$KEY_ID" --pending-window-in-days "$KMS_WAIT_DAYS" \
      --region "$REGION" --query 'DeletionDate' --output text | tr -d '\r')
    echo "  • scheduled for deletion on $DELETION_DATE, after $KMS_WAIT_DAYS days: the shortest wait KMS allows."
    echo "    It's disabled until then, and nothing new can be signed. To undo:"
    echo "    aws kms cancel-key-deletion --key-id $KEY_ID --region $REGION"
  fi
  aws kms delete-alias --alias-name "$KEY_ALIAS" --region "$REGION"
  echo "  • alias $KEY_ALIAS deleted"
else
  echo "▶ KMS: nothing to delete"
fi

# ───── 10. IAM roles ───────────────────────────────────────────────────────
delete_role "$SCHEDULER_ROLE_NAME"
delete_role "$ROLE_NAME"

echo ""
echo "✓ Teardown complete. The KMS key is deleted after $KMS_WAIT_DAYS days."
echo "  Kept: the $BUDGET_NAME budget alarm and scripts/.aws-resources."
