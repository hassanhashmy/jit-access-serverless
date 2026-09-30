# Policy for the CloudFormation execution role that `cdk bootstrap` creates.
# By default CDK gives that role AdministratorAccess. This replaces it with:
#   1. management of only the services the app uses, and
#   2. IAM role changes ONLY when the role carries the app permission boundary.
# That second rule closes the classic escalation path: "the pipeline creates an admin role, then uses it".
data "aws_iam_policy_document" "cfn_exec" {
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
    sid       = "ReadPlatformParameters"
    effect    = "Allow"
    actions   = ["ssm:GetParameter", "ssm:GetParameters"]
    resources = ["arn:${local.partition}:ssm:${local.region}:${local.account_id}:parameter/jit/*"]
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
      "iam:UpdateAssumeRolePolicy",
      "iam:TagRole",
      "iam:UntagRole",
    ]
    resources = ["arn:${local.partition}:iam::${local.account_id}:role/${local.app_prefix}-*"]

    condition {
      test     = "StringEquals"
      variable = "iam:PermissionsBoundary"
      values   = [local.boundary_arn]
    }
  }

  statement {
    sid    = "ReadAndDeleteAppRoles"
    effect = "Allow"
    actions = [
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListRolePolicies",
      "iam:ListAttachedRolePolicies",
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
