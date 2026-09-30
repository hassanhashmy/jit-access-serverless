# Policy for the CloudFormation execution role that `cdk bootstrap` creates.
# By default CDK gives that role AdministratorAccess. This replaces it with:
#   1. management of only the services the app uses, and
#   2. IAM role changes ONLY when the role carries the app permission boundary.
# That second rule closes the classic escalation path: "the pipeline creates an admin role, then uses it".
data "aws_iam_policy_document" "cfn_exec" {
  # This IS a deployment role: it must create and delete the app's resources. The risky part, IAM,
  # is constrained by the boundary condition and the explicit denies below; an SCP is the outer fence.
  #checkov:skip=CKV_AWS_107:Deployment role for Lambda/Cognito; no IAM credential APIs are allowed (explicit deny).
  #checkov:skip=CKV_AWS_109:Role changes only with the permission-boundary condition; boundary edits are denied.
  #checkov:skip=CKV_AWS_110:Escalation path closed by iam:PermissionsBoundary condition and PassRole service condition.
  #checkov:skip=CKV_AWS_111:CloudFormation resource names aren't known in advance; tables and buckets are prefix-scoped.
  #checkov:skip=CKV_AWS_356:Service-wide actions for the app's services; IAM is resource- and condition-scoped.
  statement {
    sid    = "ManageAppServices"
    effect = "Allow"
    actions = [
      "apigateway:*",
      "cloudfront:*",
      "cloudwatch:*",
      "cognito-idp:*",
      "events:*",
      "lambda:*",
      "logs:*",
      "sns:*",
      "sqs:*",
      "states:*",
      "xray:*",
    ]
    resources = ["*"]
  }

  statement {
    sid     = "ManageAppTableOnly"
    effect  = "Allow"
    actions = ["dynamodb:*"]
    resources = [
      "arn:${local.partition}:dynamodb:${local.region}:${local.account_id}:table/${local.app_resource}-*",
      "arn:${local.partition}:dynamodb:${local.region}:${local.account_id}:table/${local.app_resource}-*/*",
    ]
  }

  statement {
    sid     = "ManageAppBucketsOnly"
    effect  = "Allow"
    actions = ["s3:*"]
    resources = [
      "arn:${local.partition}:s3:::${local.app_bucket_pref}-*",
      "arn:${local.partition}:s3:::${local.app_bucket_pref}-*/*",
    ]
  }

  statement {
    sid     = "ReadPlatformAndBootstrapParameters"
    effect  = "Allow"
    actions = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = [
      "arn:${local.partition}:ssm:${local.region}:${local.account_id}:parameter/jit/*",
      "arn:${local.partition}:ssm:${local.region}:${local.account_id}:parameter/cdk-bootstrap/${var.cdk_qualifier}/version",
    ]
  }

  # Lambda fetches function and layer code from S3 with the CALLER's permissions.
  statement {
    sid     = "ReadCdkAssets"
    effect  = "Allow"
    actions = ["s3:GetObject", "s3:GetObjectVersion", "s3:GetBucketLocation", "s3:ListBucket"]
    resources = [
      "arn:${local.partition}:s3:::cdk-${var.cdk_qualifier}-assets-${local.account_id}-${local.region}",
      "arn:${local.partition}:s3:::cdk-${var.cdk_qualifier}-assets-${local.account_id}-${local.region}/*",
    ]
  }

  statement {
    sid    = "CreateRolesOnlyWithBoundary"
    effect = "Allow"
    actions = [
      "iam:CreateRole",
      "iam:PutRolePolicy",
      "iam:DeleteRolePolicy",
      "iam:AttachRolePolicy",
      "iam:DetachRolePolicy",
      "iam:PutRolePermissionsBoundary",
    ]
    resources = ["arn:${local.partition}:iam::${local.account_id}:role/${local.app_prefix}-*"]

    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [local.boundary_arn]
    }
  }

  statement {
    # These actions don't support the iam:PermissionsBoundary condition key. They can't grant
    # permissions, and they only touch roles that could only have been created with the boundary.
    sid    = "ManageAppRolesMetadata"
    effect = "Allow"
    actions = [
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
      "iam:ListRoleTags",
      "iam:TagRole",
      "iam:UntagRole",
      "iam:UpdateRole",
      "iam:UpdateRoleDescription",
      "iam:UpdateAssumeRolePolicy",
      "iam:DeleteRole",
    ]
    resources = ["arn:${local.partition}:iam::${local.account_id}:role/${local.app_prefix}-*"]
  }

  statement {
    sid       = "PassAppRolesToAppServicesOnly"
    effect    = "Allow"
    actions   = ["iam:PassRole"]
    resources = ["arn:${local.partition}:iam::${local.account_id}:role/${local.app_prefix}-*"]

    condition {
      test     = "StringEquals"
      variable = "iam:PassedToService"
      values   = ["lambda.amazonaws.com", "states.amazonaws.com", "events.amazonaws.com"]
    }
  }

  statement {
    sid    = "NeverWeakenTheGuardrails"
    effect = "Deny"
    actions = [
      "iam:DeleteRolePermissionsBoundary",
      "iam:CreatePolicyVersion",
      "iam:DeletePolicy",
      "iam:DeletePolicyVersion",
      "iam:SetDefaultPolicyVersion",
    ]
    resources = ["*"]
  }

  statement {
    sid       = "NeverCreateLongLivedCredentials"
    effect    = "Deny"
    actions   = ["iam:CreateUser", "iam:CreateAccessKey", "iam:CreateLoginProfile"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "cfn_exec" {
  name        = "jit-cfn-exec"
  description = "Replaces AdministratorAccess on the CDK CloudFormation execution role"
  policy      = data.aws_iam_policy_document.cfn_exec.json
}
