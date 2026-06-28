#!/usr/bin/env bash
# ParkProof — early-warning alarm for Anthropic (Claude) call volume.
#
# WHY: the AWS Budgets alarm (parkproof-monthly) only sees AWS spend. The
# Anthropic bill is separate and has no alarm, so an anonymous abuse run on the
# Claude vision routes could accrue real cost invisibly (robustness-review H3).
# The per-IP rate limiter is the primary defence; this is the safety net that
# tells you if cost is climbing anyway (e.g. distributed abuse across IPs).
#
# WHAT: a CloudWatch metric filter counts every Claude call (the Lambda logs
# `anthropic_call=` for translate and `appeal_call=` for appeal), and an alarm
# emails you if the hourly count crosses a threshold. The TRUE fix — a hard
# spend cap — lives in the Anthropic Console (Billing -> Usage limits); set one
# there too. This is the AWS-side proxy.
#
# Idempotent and re-runnable. Pass the alert email + threshold, or use the
# defaults below.
set -euo pipefail

export PATH="/c/Program Files/Amazon/AWSCLIV2:$PATH"

REGION="${AWS_REGION:-ap-southeast-2}"
LOG_GROUP="/aws/lambda/parkproof-sign-translator"
EMAIL="${1:-hello@parkproof.com.au}"
# Hourly Claude-call count that trips the alarm. The account's 10-concurrency
# cap bounds the ceiling to ~900 calls/hr; legitimate portfolio traffic is a
# handful per hour, so 300/hr is a clear "something's wrong" signal that still
# tolerates a real launch-day spike.
THRESHOLD="${2:-300}"
TOPIC_NAME="parkproof-cost-alerts"
METRIC_NS="ParkProof"
METRIC_NAME="AnthropicCalls"
FILTER_NAME="parkproof-anthropic-calls"
ALARM_NAME="parkproof-anthropic-usage"

echo "▶ [1/4] SNS topic: $TOPIC_NAME"
TOPIC_ARN=$(aws sns create-topic --name "$TOPIC_NAME" --region "$REGION" --query 'TopicArn' --output text)
echo "  • $TOPIC_ARN"

echo "▶ [2/4] Email subscription: $EMAIL"
# Skip if an identical confirmed/pending subscription already exists.
if aws sns list-subscriptions-by-topic --topic-arn "$TOPIC_ARN" --region "$REGION" \
     --query 'Subscriptions[?Endpoint==`'"$EMAIL"'`].SubscriptionArn' --output text | grep -q .; then
  echo "  • already subscribed (or pending confirmation)"
else
  aws sns subscribe --topic-arn "$TOPIC_ARN" --protocol email --notification-endpoint "$EMAIL" --region "$REGION" >/dev/null
  echo "  • subscribed — CHECK $EMAIL AND CLICK THE CONFIRMATION LINK (alarms won't email until you do)"
fi

echo "▶ [3/4] Metric filter on $LOG_GROUP"
# Match either Claude-call log line; emit 1 per call into ParkProof/AnthropicCalls.
MSYS_NO_PATHCONV=1 aws logs put-metric-filter \
  --log-group-name "$LOG_GROUP" \
  --filter-name "$FILTER_NAME" \
  --filter-pattern '?"anthropic_call=" ?"appeal_call="' \
  --metric-transformations \
    "metricName=$METRIC_NAME,metricNamespace=$METRIC_NS,metricValue=1,defaultValue=0" \
  --region "$REGION"
echo "  • filter $FILTER_NAME -> $METRIC_NS/$METRIC_NAME"

echo "▶ [4/4] CloudWatch alarm: $ALARM_NAME (> $THRESHOLD Claude calls/hour)"
aws cloudwatch put-metric-alarm \
  --alarm-name "$ALARM_NAME" \
  --alarm-description "ParkProof Claude-call volume exceeded ${THRESHOLD}/hour — possible cost abuse on the anonymous AI routes. The Anthropic bill is not covered by the AWS budget alarm." \
  --namespace "$METRIC_NS" \
  --metric-name "$METRIC_NAME" \
  --statistic Sum \
  --period 3600 \
  --evaluation-periods 1 \
  --threshold "$THRESHOLD" \
  --comparison-operator GreaterThanThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions "$TOPIC_ARN" \
  --region "$REGION"
echo "  • alarm armed"

echo ""
echo "✓ Done. Two manual follow-ups:"
echo "  1. Confirm the SNS subscription email sent to $EMAIL."
echo "  2. Set a hard spend cap in the Anthropic Console (Billing -> Usage limits) —"
echo "     that's the real ceiling; this alarm is the early warning."
