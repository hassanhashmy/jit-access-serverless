# Role assumed by GitHub Actions through OIDC. It holds no deploy permissions of its own:
# it can only hand off to the CDK bootstrap roles, which do the actual deployment.
data "aws_iam_policy_document" "github_trust" {
  statement {
    sid     = "GitHubActionsMainBranchOnly"
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]

    principals {
      type        = "Federated"
      identifiers = [data.aws_iam_openid_connect_provider.github.arn]
    }

    # Token must be minted for AWS STS, not some other audience.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }

    # Exact match on repo (by immutable ID) AND branch. StringLike with "repo:owner/*" would let any
    # repo or branch in.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values   = ["${var.github_subject_prefix}:ref:refs/heads/${var.deploy_branch}"]
    }

    # And only the app pipeline file, so other workflows on main can't borrow this role.
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:job_workflow_ref"
      values   = ["${var.github_repository}/.github/workflows/pipeline.yml@refs/heads/${var.deploy_branch}"]
    }
  }
}

resource "aws_iam_role" "github_deploy" {
  name                 = "jit-github-deploy"
  description          = "Assumed by GitHub Actions (OIDC) on ${var.github_repository}@${var.deploy_branch}"
  assume_role_policy   = data.aws_iam_policy_document.github_trust.json
  max_session_duration = 3600
}

data "aws_iam_policy_document" "github_deploy" {
  statement {
    sid     = "AssumeCdkBootstrapRolesOnly"
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:TagSession"]
    resources = [
      for r in ["deploy", "file-publishing", "image-publishing", "lookup"] :
      "arn:${local.partition}:iam::${local.account_id}:role/cdk-${var.cdk_qualifier}-${r}-role-${local.account_id}-${local.region}"
    ]
  }
}

resource "aws_iam_role_policy" "github_deploy" {
  name   = "assume-cdk-roles"
  role   = aws_iam_role.github_deploy.id
  policy = data.aws_iam_policy_document.github_deploy.json
}
