#!/usr/bin/env bash
# ParkProof: how long the Lambda's CloudWatch logs are kept.
#
# The Lambda logs a device's random push ID (with the random ID of a record
# or weekly reminder, and the push service's host name) when it registers
# for push, books a reminder or is sent one, it logs feedback messages and
# any email a driver adds to them, and it logs each "Did we read this
# right?" answer with details of the reading and the driver's answers to the
# permit questions. No script ever set a retention on its log group, and
# CloudWatch's default is to keep log events forever. The privacy policy
# (privacy.rightsAnonymous and privacy.anonymousCloudwatch) says the logs
# are deleted after 90 days, so this sets that.
#
# What it does, and nothing else:
#   - sets a 90-day retention on /aws/lambda/<LAMBDA_NAME>
#     (aws logs put-retention-policy), then reads it back and checks it.
#
# Setting it deletes, within a few days, every log event in the group older
# than 90 days, including launch-day logs. That can't be undone. Export what
# you want to keep first (the deploy checklist, stage 6, says how).
#
# It doesn't touch any other log group, IAM, the Lambda or
# scripts/.aws-resources. Safe to re-run: the same retention is set again.
#
# Usage:
#   bash scripts/setup-log-retention.sh
# Environment (all optional):
#   LAMBDA_NAME  default parkproof-sign-translator
#   AWS_REGION   default ap-southeast-2

set -euo pipefail
if ! command -v aws >/dev/null 2>&1 && [[ -x "/c/Program Files/Amazon/AWSCLIV2/aws.exe" ]]; then
  export PATH="/c/Program Files/Amazon/AWSCLIV2:${PATH}"
fi
command -v aws >/dev/null 2>&1 || { echo "✗ aws CLI not found on PATH" >&2; exit 1; }
# Git Bash would turn the log group's leading slash into a Windows path.
export MSYS_NO_PATHCONV=1

REGION="${AWS_REGION:-ap-southeast-2}"
LAMBDA_NAME="${LAMBDA_NAME:-parkproof-sign-translator}"
LOG_GROUP="/aws/lambda/$LAMBDA_NAME"
# The privacy policy's number. Change both together, never this alone.
RETENTION_DAYS=90

echo "▶ Log retention"
echo "  log group: $LOG_GROUP"
echo "  keep:      $RETENTION_DAYS days"

aws logs put-retention-policy \
  --log-group-name "$LOG_GROUP" \
  --retention-in-days "$RETENTION_DAYS" \
  --region "$REGION"

# tr strips the CR that the Windows aws.exe can leave on text output.
GOT=$(aws logs describe-log-groups \
  --log-group-name-prefix "$LOG_GROUP" \
  --query "logGroups[?logGroupName=='$LOG_GROUP'].retentionInDays | [0]" \
  --output text \
  --region "$REGION" | tr -d '\r')
if [[ "$GOT" != "$RETENTION_DAYS" ]]; then
  echo "✗ $LOG_GROUP reports a retention of '$GOT' days, not $RETENTION_DAYS" >&2
  exit 1
fi
echo "  ✓ $LOG_GROUP keeps log events for $RETENTION_DAYS days"
