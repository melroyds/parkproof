#!/usr/bin/env bash
# ParkProof: deleting a photo deletes its bytes, not just its name.
#
# The evidence bucket (parkproof-evidence-<ACCOUNT_ID>) is versioned
# (setup-auth.sh). Deleting a key there without its version only adds a
# delete marker, and the photo's bytes stay as an old version that nothing
# removes. The Lambda's photo sweeps (Delete forever, deleting a record, and
# the re-sweep when a deleted account's upload is refused: deleteObjectsUnder
# in lambda/cloud-sync.js) now delete every version and delete marker by its
# version id. This script gives the Lambda what that needs, and adds a
# backstop for the old versions earlier deletes left behind.
#
# What it does, and nothing else:
#   - adds an inline policy, parkproof-evidence-versions, on
#     parkproof-lambda-role that allows s3:ListBucketVersions on the evidence
#     bucket and s3:DeleteObjectVersion on its objects. Without it S3 refuses
#     the version sweep (AccessDenied), and the Lambda deletes only the current
#     photos, by key as before, and logs "[parkproof.s3] AccessDenied".
#   - sets the evidence bucket's lifecycle rule, delete-old-photo-versions: a
#     version that is no longer current is deleted one day after it stopped
#     being current, and a delete marker with nothing left behind it is
#     removed. That clears what deletes by key leave behind: every delete
#     before this change, and the Lambda's fallback while it lacks the grant
#     above. It never touches a current version, so it can't clear a photo
#     that lands after the last sweep (a PUT through a URL presigned before
#     the delete): only a later sweep can.
#
# The rule deletes, within a day or two, every old version in the bucket:
# photos deleted before the Lambda could delete versions, and the earlier
# copies of a photo that was uploaded again. That can't be undone.
#
# put-bucket-lifecycle-configuration replaces a bucket's whole lifecycle
# configuration, so the script stops, having changed nothing, when the bucket
# already has a rule with another ID. It doesn't change versioning, the bucket
# policy, CORS, any other IAM policy or scripts/.aws-resources. Safe to
# re-run: both are written again with the same documents.
#
# Usage:
#   bash scripts/setup-evidence-versions.sh
# Environment (all optional):
#   EVIDENCE_BUCKET   the bucket, if the Lambda's S3_BUCKET_EVIDENCE says
#                     another (default parkproof-evidence-<ACCOUNT_ID>)
#   LAMBDA_ROLE_NAME  default parkproof-lambda-role
#   AWS_REGION        default ap-southeast-2

set -euo pipefail
if ! command -v aws >/dev/null 2>&1 && [[ -x "/c/Program Files/Amazon/AWSCLIV2/aws.exe" ]]; then
  export PATH="/c/Program Files/Amazon/AWSCLIV2:${PATH}"
fi
command -v aws >/dev/null 2>&1 || { echo "✗ aws CLI not found on PATH" >&2; exit 1; }

REGION="${AWS_REGION:-ap-southeast-2}"
ROLE_NAME="${LAMBDA_ROLE_NAME:-parkproof-lambda-role}"
POLICY_NAME="parkproof-evidence-versions"
RULE_ID="delete-old-photo-versions"
# How long an old version is kept after it stops being current. The privacy
# policy promises every photo of a deleted account is deleted: keep this short.
NONCURRENT_DAYS=1

# tr strips the CR that the Windows aws.exe can leave on text output.
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text | tr -d '\r')
[[ "$ACCOUNT_ID" =~ ^[0-9]{12}$ ]] || { echo "✗ Couldn't read the AWS account id (got '$ACCOUNT_ID')" >&2; exit 1; }
BUCKET="${EVIDENCE_BUCKET:-parkproof-evidence-$ACCOUNT_ID}"

echo "▶ Evidence bucket: deleting old photo versions"
echo "  role:   $ROLE_NAME"
echo "  bucket: $BUCKET"
echo "  policy: $POLICY_NAME (s3:ListBucketVersions, s3:DeleteObjectVersion)"
echo "  rule:   $RULE_ID (old versions deleted after $NONCURRENT_DAYS day)"

# Any lifecycle rule but this one stops the run before anything changes.
if EXISTING=$(aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --region "$REGION" \
  --query 'Rules[].ID' --output text 2>&1); then
  for id in $(echo "$EXISTING" | tr -d '\r'); do
    if [[ "$id" != "$RULE_ID" ]]; then
      echo "✗ $BUCKET already has a lifecycle rule '$id'. Writing this one would delete it, so nothing was changed." >&2
      exit 1
    fi
  done
elif [[ "$EXISTING" != *NoSuchLifecycleConfiguration* ]]; then
  echo "✗ Couldn't read the lifecycle rules of $BUCKET, so nothing was changed: $EXISTING" >&2
  exit 1
fi

POLICY_DOC=$(cat <<EOF
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ListEvidenceVersions",
      "Effect": "Allow",
      "Action": "s3:ListBucketVersions",
      "Resource": "arn:aws:s3:::$BUCKET"
    },
    {
      "Sid": "DeleteEvidenceVersions",
      "Effect": "Allow",
      "Action": "s3:DeleteObjectVersion",
      "Resource": "arn:aws:s3:::$BUCKET/*"
    }
  ]
}
EOF
)

aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$POLICY_NAME" \
  --policy-document "$POLICY_DOC" \
  >/dev/null
echo "  ✓ $ROLE_NAME can list and delete the versions in $BUCKET"

LIFECYCLE_DOC=$(cat <<EOF
{
  "Rules": [
    {
      "ID": "$RULE_ID",
      "Status": "Enabled",
      "Filter": { "Prefix": "" },
      "NoncurrentVersionExpiration": { "NoncurrentDays": $NONCURRENT_DAYS },
      "Expiration": { "ExpiredObjectDeleteMarker": true }
    }
  ]
}
EOF
)

aws s3api put-bucket-lifecycle-configuration \
  --bucket "$BUCKET" \
  --region "$REGION" \
  --lifecycle-configuration "$LIFECYCLE_DOC"

GOT=$(aws s3api get-bucket-lifecycle-configuration --bucket "$BUCKET" --region "$REGION" \
  --query "Rules[?ID=='$RULE_ID'].NoncurrentVersionExpiration.NoncurrentDays | [0]" \
  --output text | tr -d '\r')
if [[ "$GOT" != "$NONCURRENT_DAYS" ]]; then
  echo "✗ $BUCKET reports '$GOT' days for $RULE_ID, not $NONCURRENT_DAYS" >&2
  exit 1
fi
echo "  ✓ $BUCKET deletes old versions $NONCURRENT_DAYS day after they stop being current"
echo ""
echo "IAM takes up to a minute to apply the policy. Then check it (read-only):"
echo "  aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME \\"
echo "    --resource-arns arn:aws:s3:::$BUCKET --action-names s3:ListBucketVersions \\"
echo "    --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text"
echo "  aws iam simulate-principal-policy --policy-source-arn arn:aws:iam::$ACCOUNT_ID:role/$ROLE_NAME \\"
echo "    --resource-arns arn:aws:s3:::$BUCKET/x --action-names s3:DeleteObjectVersion \\"
echo "    --query 'EvaluationResults[].[EvalActionName,EvalDecision]' --output text"
echo "  Each should print its action and: allowed"
