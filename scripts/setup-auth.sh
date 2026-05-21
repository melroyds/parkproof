#!/usr/bin/env bash
# ParkProof — provision authentication + cloud-sync infrastructure.
# Idempotent. Re-run safely; only creates what's missing, updates the rest.
#
# Provisions:
#   - Cognito User Pool (email-based sign-in, self-service signup)
#   - Cognito App Client (public SPA client, no secret)
#   - Cognito Hosted UI domain (for federated Apple/Google fallback)
#   - DynamoDB table: parkproof-sessions (pay-per-request)
#   - S3 bucket: parkproof-evidence-<account-id> (private, presigned access only)
#   - IAM policy attached to the Lambda execution role for DDB + S3 + Cognito admin
#   - API Gateway Cognito JWT authorizer
#
# Writes the resource identifiers to scripts/.aws-resources so deploy.sh
# can bake them into the Lambda env + the frontend build.
#
# Cost: $0 below 50k MAU. DynamoDB pay-per-request and S3 storage essentially
# free at POC scale.

set -euo pipefail

# ───── Config ───────────────────────────────────────────────────────────────
PROJECT=parkproof
REGION=ap-southeast-2
USER_POOL_NAME=$PROJECT-users
APP_CLIENT_NAME=$PROJECT-spa
TABLE_NAME=$PROJECT-sessions
ROLE_NAME=$PROJECT-lambda-role
PRINCIPAL_POLICY_NAME=$PROJECT-data-access

# ───── Preflight ────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.."

if ! command -v aws >/dev/null 2>&1; then
  if [[ -x "/c/Program Files/Amazon/AWSCLIV2/aws.exe" ]]; then
    export PATH="/c/Program Files/Amazon/AWSCLIV2:$PATH"
  fi
fi
command -v aws >/dev/null 2>&1 || { echo "✗ aws CLI not found on PATH"; exit 1; }

ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
EVIDENCE_BUCKET=$PROJECT-evidence-$ACCOUNT_ID

# Hosted-UI domain must be globally unique within the region. Account-id
# suffix gives us a deterministic, collision-free name.
HOSTED_UI_DOMAIN=$PROJECT-$ACCOUNT_ID

echo "▶ ParkProof — setting up auth + cloud sync"
echo "  Account:       $ACCOUNT_ID"
echo "  Region:        $REGION"
echo "  User pool:     $USER_POOL_NAME"
echo "  Sessions DDB:  $TABLE_NAME"
echo "  Evidence S3:   $EVIDENCE_BUCKET"
echo "  Hosted UI:     $HOSTED_UI_DOMAIN.auth.$REGION.amazoncognito.com"
echo ""

# ───── [1/6] Cognito User Pool ──────────────────────────────────────────────
echo "▶ [1/6] Cognito User Pool: $USER_POOL_NAME"
USER_POOL_ID=$(aws cognito-idp list-user-pools --max-results 60 --region "$REGION" \
  --query "UserPools[?Name=='$USER_POOL_NAME'].Id | [0]" --output text 2>/dev/null || echo "")

if [[ -z "$USER_POOL_ID" || "$USER_POOL_ID" == "None" ]]; then
  echo "  • creating pool"
  USER_POOL_ID=$(aws cognito-idp create-user-pool \
    --region "$REGION" \
    --pool-name "$USER_POOL_NAME" \
    --policies '{
      "PasswordPolicy": {
        "MinimumLength": 8,
        "RequireUppercase": true,
        "RequireLowercase": true,
        "RequireNumbers": true,
        "RequireSymbols": false,
        "TemporaryPasswordValidityDays": 7
      }
    }' \
    --auto-verified-attributes email \
    --username-attributes email \
    --schema '[
      {"Name":"email","AttributeDataType":"String","Required":true,"Mutable":true}
    ]' \
    --account-recovery-setting '{
      "RecoveryMechanisms": [{"Priority": 1, "Name": "verified_email"}]
    }' \
    --email-configuration '{"EmailSendingAccount":"COGNITO_DEFAULT"}' \
    --query 'UserPool.Id' --output text)
  echo "  • created: $USER_POOL_ID"
else
  echo "  • exists:  $USER_POOL_ID"
fi

# ───── [2/6] Cognito App Client ─────────────────────────────────────────────
echo "▶ [2/6] App Client: $APP_CLIENT_NAME"
APP_CLIENT_ID=$(aws cognito-idp list-user-pool-clients \
  --user-pool-id "$USER_POOL_ID" \
  --region "$REGION" \
  --query "UserPoolClients[?ClientName=='$APP_CLIENT_NAME'].ClientId | [0]" \
  --output text 2>/dev/null || echo "")

# Callback URLs: the live CloudFront origin + local dev. Update when adding
# more environments (staging, custom domain) by re-running this script after
# editing the array below.
CALLBACK_URLS='["https://www.parkproof.com.au/auth/callback","https://parkproof.dsouza.tech/auth/callback","https://d1jmpu2roekssu.cloudfront.net/auth/callback","http://localhost:5173/auth/callback"]'
LOGOUT_URLS='["https://www.parkproof.com.au/","https://parkproof.dsouza.tech/","https://d1jmpu2roekssu.cloudfront.net/","http://localhost:5173/"]'

if [[ -z "$APP_CLIENT_ID" || "$APP_CLIENT_ID" == "None" ]]; then
  echo "  • creating client"
  APP_CLIENT_ID=$(aws cognito-idp create-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-name "$APP_CLIENT_NAME" \
    --no-generate-secret \
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --supported-identity-providers COGNITO \
    --callback-urls "$CALLBACK_URLS" \
    --logout-urls "$LOGOUT_URLS" \
    --allowed-o-auth-flows code \
    --allowed-o-auth-scopes openid email profile \
    --allowed-o-auth-flows-user-pool-client \
    --prevent-user-existence-errors ENABLED \
    --region "$REGION" \
    --query 'UserPoolClient.ClientId' --output text)
  echo "  • created: $APP_CLIENT_ID"
else
  echo "  • exists:  $APP_CLIENT_ID"
  # Keep the client config in sync in case someone edited the URLs above.
  aws cognito-idp update-user-pool-client \
    --user-pool-id "$USER_POOL_ID" \
    --client-id "$APP_CLIENT_ID" \
    --client-name "$APP_CLIENT_NAME" \
    --explicit-auth-flows ALLOW_USER_PASSWORD_AUTH ALLOW_USER_SRP_AUTH ALLOW_REFRESH_TOKEN_AUTH \
    --supported-identity-providers COGNITO \
    --callback-urls "$CALLBACK_URLS" \
    --logout-urls "$LOGOUT_URLS" \
    --allowed-o-auth-flows code \
    --allowed-o-auth-scopes openid email profile \
    --allowed-o-auth-flows-user-pool-client \
    --prevent-user-existence-errors ENABLED \
    --region "$REGION" \
    >/dev/null
fi

# ───── [3/6] Hosted UI domain ───────────────────────────────────────────────
# Needed for federated Apple/Google sign-in (Phase 4). Free to create even
# if we don't use it on day one. Domain must be globally unique within region.
echo "▶ [3/6] Hosted UI domain: $HOSTED_UI_DOMAIN"
EXISTING_DOMAIN=$(aws cognito-idp describe-user-pool \
  --user-pool-id "$USER_POOL_ID" \
  --region "$REGION" \
  --query 'UserPool.Domain' --output text 2>/dev/null || echo "")
if [[ -z "$EXISTING_DOMAIN" || "$EXISTING_DOMAIN" == "None" ]]; then
  echo "  • creating"
  aws cognito-idp create-user-pool-domain \
    --domain "$HOSTED_UI_DOMAIN" \
    --user-pool-id "$USER_POOL_ID" \
    --region "$REGION" \
    >/dev/null
  echo "  • created: $HOSTED_UI_DOMAIN.auth.$REGION.amazoncognito.com"
else
  echo "  • exists:  $EXISTING_DOMAIN.auth.$REGION.amazoncognito.com"
fi

# ───── [4/6] DynamoDB sessions table ────────────────────────────────────────
echo "▶ [4/6] DynamoDB: $TABLE_NAME"
if aws dynamodb describe-table --table-name "$TABLE_NAME" --region "$REGION" >/dev/null 2>&1; then
  echo "  • exists"
else
  echo "  • creating"
  # pk = USER#<cognito-sub>, sk = SESSION#<arrived_at_iso> — listing sessions
  # for a user is a Query on pk with a sort by sk descending (newest first).
  aws dynamodb create-table \
    --table-name "$TABLE_NAME" \
    --attribute-definitions \
      AttributeName=pk,AttributeType=S \
      AttributeName=sk,AttributeType=S \
    --key-schema \
      AttributeName=pk,KeyType=HASH \
      AttributeName=sk,KeyType=RANGE \
    --billing-mode PAY_PER_REQUEST \
    --region "$REGION" \
    --tags Key=Project,Value=parkproof \
    >/dev/null
  aws dynamodb wait table-exists --table-name "$TABLE_NAME" --region "$REGION"
  echo "  • created"
fi

# ───── [5/6] Evidence S3 bucket ─────────────────────────────────────────────
echo "▶ [5/6] S3 (evidence): $EVIDENCE_BUCKET"
if aws s3api head-bucket --bucket "$EVIDENCE_BUCKET" 2>/dev/null; then
  echo "  • exists"
else
  echo "  • creating"
  aws s3api create-bucket \
    --bucket "$EVIDENCE_BUCKET" \
    --region "$REGION" \
    --create-bucket-configuration "LocationConstraint=$REGION" \
    >/dev/null

  aws s3api put-public-access-block \
    --bucket "$EVIDENCE_BUCKET" \
    --public-access-block-configuration \
      "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"

  aws s3api put-bucket-versioning \
    --bucket "$EVIDENCE_BUCKET" \
    --versioning-configuration Status=Enabled

  # CORS — allow the CloudFront origin + localhost to PUT direct via presigned
  # URLs and GET back over the same path.
  aws s3api put-bucket-cors --bucket "$EVIDENCE_BUCKET" --cors-configuration '{
    "CORSRules": [{
      "AllowedHeaders": ["*"],
      "AllowedMethods": ["GET","PUT","HEAD"],
      "AllowedOrigins": [
        "https://www.parkproof.com.au",
        "https://parkproof.dsouza.tech",
        "https://d1jmpu2roekssu.cloudfront.net",
        "http://localhost:5173"
      ],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 300
    }]
  }'
  echo "  • bucket configured"
fi

# ───── [6/6] IAM policy for Lambda → DDB + S3 + Cognito admin ───────────────
echo "▶ [6/6] IAM policy: $PRINCIPAL_POLICY_NAME"
# Inline policy on the existing Lambda execution role — keeps blast radius
# scoped to this one project's resources only.
POLICY_DOC=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "SessionsTable",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:UpdateItem",
        "dynamodb:DeleteItem",
        "dynamodb:Query",
        "dynamodb:BatchWriteItem"
      ],
      "Resource": "arn:aws:dynamodb:$REGION:$ACCOUNT_ID:table/$TABLE_NAME"
    },
    {
      "Sid": "EvidenceBucket",
      "Effect": "Allow",
      "Action": [
        "s3:PutObject",
        "s3:GetObject",
        "s3:DeleteObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::$EVIDENCE_BUCKET",
        "arn:aws:s3:::$EVIDENCE_BUCKET/*"
      ]
    },
    {
      "Sid": "CognitoUserAdmin",
      "Effect": "Allow",
      "Action": [
        "cognito-idp:AdminGetUser",
        "cognito-idp:AdminDeleteUser"
      ],
      "Resource": "arn:aws:cognito-idp:$REGION:$ACCOUNT_ID:userpool/$USER_POOL_ID"
    }
  ]
}
JSON
)
aws iam put-role-policy \
  --role-name "$ROLE_NAME" \
  --policy-name "$PRINCIPAL_POLICY_NAME" \
  --policy-document "$POLICY_DOC" \
  >/dev/null
echo "  • policy attached to $ROLE_NAME"

# ───── [7] API Gateway JWT authorizer ───────────────────────────────────────
# Attached selectively in deploy.sh to the new /sessions/* and /me/* routes
# only — the existing public routes (/sign-translate, /sign-session, /feedback,
# /draft-appeal) stay anonymous so first-time users keep the zero-friction
# scanning experience.
echo "▶ [7] JWT authorizer on API Gateway"
API_NAME=$PROJECT-api
API_ID=$(aws apigatewayv2 get-apis --region "$REGION" \
  --query "Items[?Name=='$API_NAME'].ApiId | [0]" --output text 2>/dev/null || echo "")

if [[ -z "$API_ID" || "$API_ID" == "None" ]]; then
  echo "  ⚠ API Gateway not found — run scripts/deploy.sh first, then re-run this script."
  AUTHORIZER_ID=""
else
  AUTHORIZER_NAME=$PROJECT-jwt
  AUTHORIZER_ID=$(aws apigatewayv2 get-authorizers \
    --api-id "$API_ID" --region "$REGION" \
    --query "Items[?Name=='$AUTHORIZER_NAME'].AuthorizerId | [0]" \
    --output text 2>/dev/null || echo "")
  if [[ -z "$AUTHORIZER_ID" || "$AUTHORIZER_ID" == "None" ]]; then
    echo "  • creating"
    ISSUER="https://cognito-idp.$REGION.amazonaws.com/$USER_POOL_ID"
    AUTHORIZER_ID=$(aws apigatewayv2 create-authorizer \
      --api-id "$API_ID" \
      --name "$AUTHORIZER_NAME" \
      --authorizer-type JWT \
      --identity-source '$request.header.Authorization' \
      --jwt-configuration "Audience=$APP_CLIENT_ID,Issuer=$ISSUER" \
      --region "$REGION" \
      --query AuthorizerId --output text)
    echo "  • created: $AUTHORIZER_ID"
  else
    echo "  • exists:  $AUTHORIZER_ID"
  fi
fi

# ───── Persist resource IDs for deploy.sh + frontend build ──────────────────
RESOURCE_FILE=scripts/.aws-resources
cat > "$RESOURCE_FILE" <<EOF
# ParkProof auth + cloud-sync resources.
# Auto-generated by scripts/setup-auth.sh. Re-run that to refresh.
# These IDs are NOT secrets (User Pool ID + App Client ID are public values
# bundled into the SPA) but they are project-specific so the file is gitignored.
COGNITO_USER_POOL_ID=$USER_POOL_ID
COGNITO_APP_CLIENT_ID=$APP_CLIENT_ID
COGNITO_REGION=$REGION
COGNITO_HOSTED_UI_DOMAIN=$HOSTED_UI_DOMAIN.auth.$REGION.amazoncognito.com
COGNITO_AUTHORIZER_ID=$AUTHORIZER_ID
DYNAMODB_TABLE_SESSIONS=$TABLE_NAME
S3_BUCKET_EVIDENCE=$EVIDENCE_BUCKET
EOF
echo ""
echo "▶ Wrote $RESOURCE_FILE — deploy.sh will source it on next run."
echo ""
echo "✓ Auth + cloud-sync infrastructure provisioned."
echo ""
echo "  Next steps:"
echo "    1. Run scripts/deploy.sh to wire the Lambda + frontend to these resources."
echo "    2. (Optional) Phase 4: register OAuth clients with Apple + Google,"
echo "       then re-run this script with APPLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_ID"
echo "       in your environment to attach federated identity providers."
