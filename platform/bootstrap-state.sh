#!/usr/bin/env bash
# One-time: create the encrypted, versioned, private S3 bucket that holds Terraform state.
set -euo pipefail

PROFILE="${AWS_PROFILE:-devops-showcase}"
REGION="eu-west-2"
ACCOUNT="$(aws sts get-caller-identity --profile "$PROFILE" --query Account --output text)"
BUCKET="jit-access-tfstate-${ACCOUNT}"

aws s3api create-bucket --bucket "$BUCKET" --region "$REGION" --profile "$PROFILE" \
  --create-bucket-configuration LocationConstraint="$REGION"
aws s3api put-bucket-versioning --bucket "$BUCKET" --profile "$PROFILE" \
  --versioning-configuration Status=Enabled
aws s3api put-bucket-encryption --bucket "$BUCKET" --profile "$PROFILE" \
  --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
aws s3api put-public-access-block --bucket "$BUCKET" --profile "$PROFILE" \
  --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
aws s3api put-bucket-policy --bucket "$BUCKET" --profile "$PROFILE" --policy "{
  \"Version\": \"2012-10-17\",
  \"Statement\": [{
    \"Sid\": \"DenyInsecureTransport\",
    \"Effect\": \"Deny\",
    \"Principal\": \"*\",
    \"Action\": \"s3:*\",
    \"Resource\": [\"arn:aws:s3:::${BUCKET}\", \"arn:aws:s3:::${BUCKET}/*\"],
    \"Condition\": {\"Bool\": {\"aws:SecureTransport\": \"false\"}}
  }]
}"
echo "State bucket ready: s3://${BUCKET}"
