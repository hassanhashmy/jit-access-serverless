# Roles for the platform workflow (.github/workflows/platform.yml):
#   pull request touching platform/**  -> terraform plan  as jit-github-platform-plan  (read-only)
#   manual run on main                 -> terraform apply as jit-github-platform-apply (IAM write)
# Each role trusts exactly one workflow file (job_workflow_ref), so the app pipeline can't assume
# the platform roles and the platform workflow can't assume the app deploy role.

locals {
  workflow_ref_prefix = "${var.github_repository}/.github/workflows"
  state_bucket        = "arn:${local.partition}:s3:::jit-access-tfstate-${local.account_id}"
}

data "aws_iam_policy_document" "platform_plan_trust" {
  statement {
    sid     = "PlatformWorkflowOnPullRequests"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.github_subject_prefix}:pull_request"]
    }
    condition {
      test     = "StringLike"
      variable = "token.actions.githubusercontent.com:job_workflow_ref"
      values   = ["${local.workflow_ref_prefix}/platform.yml@refs/pull/*"]
    }
  }
}

data "aws_iam_policy_document" "platform_apply_trust" {
  statement {
    sid     = "PlatformWorkflowOnMainOnly"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.github_subject_prefix}:ref:refs/heads/${var.deploy_branch}"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:job_workflow_ref"
      values   = ["${local.workflow_ref_prefix}/platform.yml@refs/heads/${var.deploy_branch}"]
    }
  }
}

# ---- plan: read-only ----------------------------------------------------------------------
data "aws_iam_policy_document" "platform_plan" {
  #checkov:skip=CKV_AWS_356:terraform refresh reads IAM metadata (roles, policies, OIDC provider) account-wide; no data or secrets.
  statement {
    sid       = "ReadIamMetadata"
    actions   = ["iam:Get*", "iam:List*", "ssm:DescribeParameters"]
    resources = ["*"]
  }
  statement {
    sid       = "ReadPlatformParametersOnly"
    actions   = ["ssm:GetParameter", "ssm:GetParameters", "ssm:ListTagsForResource"]
    resources = ["arn:${local.partition}:ssm:${local.region}:${local.account_id}:parameter/jit/*"]
  }
  statement {
    sid       = "ReadState"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = [local.state_bucket, "${local.state_bucket}/platform/*"]
  }
}

# ---- apply: manage only this project's platform resources ---------------------------------
data "aws_iam_policy_document" "platform_apply" {
  #checkov:skip=CKV_AWS_107:Platform deploy role; manages jit-* IAM only, user and key creation is explicitly denied.
  #checkov:skip=CKV_AWS_108:Needs read access to IAM and SSM for terraform refresh.
  #checkov:skip=CKV_AWS_109:By design it manages the platform's jit-* roles and policies (and nothing else).
  #checkov:skip=CKV_AWS_110:Privileged by nature; only platform.yml on main via manual run can assume it.
  #checkov:skip=CKV_AWS_111:Writes are name-scoped to jit-* roles/policies, /jit/* parameters and the state bucket.
  #checkov:skip=CKV_AWS_356:Read-only IAM/SSM calls on "*" for refresh; all writes are resource-scoped.
  statement {
    sid       = "ReadForRefresh"
    actions   = ["iam:Get*", "iam:List*", "ssm:DescribeParameters", "ssm:ListTagsForResource"]
    resources = ["*"]
  }
  statement {
    sid     = "ManagePlatformRolesAndPolicies"
    actions = ["iam:*"]
    resources = [
      "arn:${local.partition}:iam::${local.account_id}:role/jit-*",
      "arn:${local.partition}:iam::${local.account_id}:policy/jit-*",
    ]
  }
  statement {
    sid       = "ManagePlatformParameters"
    actions   = ["ssm:*"]
    resources = ["arn:${local.partition}:ssm:${local.region}:${local.account_id}:parameter/jit/*"]
  }
  statement {
    sid       = "ReadWriteStateAndLock"
    actions   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
    resources = [local.state_bucket, "${local.state_bucket}/platform/*"]
  }
  # Reading the shared OIDC provider is fine (Terraform looks it up); changing it never is.
  statement {
    sid    = "NeverLongLivedCredentialsOrTheSharedOidcProvider"
    effect = "Deny"
    actions = [
      "iam:CreateUser",
      "iam:CreateAccessKey",
      "iam:CreateLoginProfile",
      "iam:CreateOpenIDConnectProvider",
      "iam:DeleteOpenIDConnectProvider",
      "iam:UpdateOpenIDConnectProviderThumbprint",
      "iam:AddClientIDToOpenIDConnectProvider",
      "iam:RemoveClientIDFromOpenIDConnectProvider",
      "iam:TagOpenIDConnectProvider",
      "iam:UntagOpenIDConnectProvider",
    ]
    resources = ["*"]
  }
}

resource "aws_iam_role" "platform_plan" {
  name                 = "jit-github-platform-plan"
  description          = "terraform plan for platform/ on pull requests (read-only)"
  assume_role_policy   = data.aws_iam_policy_document.platform_plan_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "platform_plan" {
  name   = "plan-read-only"
  role   = aws_iam_role.platform_plan.id
  policy = data.aws_iam_policy_document.platform_plan.json
}

resource "aws_iam_role" "platform_apply" {
  name                 = "jit-github-platform-apply"
  description          = "terraform apply for platform/ from a manual run of platform.yml on main"
  assume_role_policy   = data.aws_iam_policy_document.platform_apply_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "platform_apply" {
  name   = "apply-platform"
  role   = aws_iam_role.platform_apply.id
  policy = data.aws_iam_policy_document.platform_apply.json
}
