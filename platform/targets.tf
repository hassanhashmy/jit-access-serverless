# The elevated access that JIT requests actually grant. The platform team decides which target
# roles EXIST and what they allow; the app can only broker short sessions into them.
#
# Only the app's session-broker Lambda can assume these roles, and it must set a SourceIdentity
# (the human's username), so CloudTrail shows who used the elevated access.

locals {
  target_prefix = "jit-target-"
  broker_role   = "arn:${local.partition}:iam::${local.account_id}:role/${local.app_prefix}-ApiStartSession*"
  log_groups = [
    "arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:${local.app_prefix}-*",
    "arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:/aws/events/${local.app_resource}-*",
    "arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:/aws/vendedlogs/states/${local.app_resource}-*",
  ]
  requests_table = "arn:${local.partition}:dynamodb:${local.region}:${local.account_id}:table/${local.app_resource}-requests"
}

data "aws_iam_policy_document" "target_trust" {
  statement {
    sid     = "OnlyTheSessionBroker"
    effect  = "Allow"
    actions = ["sts:AssumeRole", "sts:SetSourceIdentity", "sts:TagSession"]

    principals {
      type        = "AWS"
      identifiers = ["arn:${local.partition}:iam::${local.account_id}:root"]
    }

    condition {
      test     = "ArnLike"
      variable = "aws:PrincipalArn"
      values   = [local.broker_role]
    }

    # Every session must name the human it was issued to.
    condition {
      test     = "Null"
      variable = "sts:SourceIdentity"
      values   = ["false"]
    }
  }
}

# ---- prod-logs-read: read the app's CloudWatch Logs ---------------------------------------
data "aws_iam_policy_document" "logs_read" {
  statement {
    sid       = "ListLogGroups"
    actions   = ["logs:DescribeLogGroups", "logs:DescribeQueries", "logs:DescribeQueryDefinitions"]
    resources = ["*"]
  }
  statement {
    sid = "ReadAppLogs"
    actions = [
      "logs:DescribeLogStreams",
      "logs:GetLogEvents",
      "logs:FilterLogEvents",
      "logs:StartQuery",
      "logs:StopQuery",
      "logs:GetQueryResults",
      "logs:GetLogRecord",
      "logs:ListTagsForResource",
    ]
    resources = concat(local.log_groups, [for g in local.log_groups : "${g}:*"])
  }
}

# ---- prod-db-readonly: read the requests table --------------------------------------------
data "aws_iam_policy_document" "db_readonly" {
  statement {
    sid       = "ListTables"
    actions   = ["dynamodb:ListTables", "dynamodb:DescribeLimits"]
    resources = ["*"]
  }
  statement {
    sid = "ReadRequestsTable"
    actions = [
      "dynamodb:DescribeTable",
      "dynamodb:DescribeTimeToLive",
      "dynamodb:DescribeContinuousBackups",
      "dynamodb:ListTagsOfResource",
      "dynamodb:GetItem",
      "dynamodb:BatchGetItem",
      "dynamodb:Query",
      "dynamodb:Scan",
    ]
    resources = [local.requests_table, "${local.requests_table}/index/*"]
  }
}

locals {
  targets = {
    "prod-logs-read"   = { description = "JIT: read the app's CloudWatch Logs", policy = data.aws_iam_policy_document.logs_read.json }
    "prod-db-readonly" = { description = "JIT: read-only access to the requests table", policy = data.aws_iam_policy_document.db_readonly.json }
    # Break-glass is deliberately ReadOnlyAccess in this demo account, not real admin.
    "prod-breakglass-admin" = { description = "JIT: emergency access (read-only in this demo)", policy = null }
  }
}

resource "aws_iam_role" "target" {
  for_each             = local.targets
  name                 = "${local.target_prefix}${each.key}"
  description          = each.value.description
  assume_role_policy   = data.aws_iam_policy_document.target_trust.json
  max_session_duration = 3600
}

resource "aws_iam_role_policy" "target" {
  for_each = { for k, v in local.targets : k => v if v.policy != null }
  name     = "access"
  role     = aws_iam_role.target[each.key].id
  policy   = each.value.policy
}

resource "aws_iam_role_policy_attachment" "breakglass_readonly" {
  role       = aws_iam_role.target["prod-breakglass-admin"].name
  policy_arn = "arn:${local.partition}:iam::aws:policy/ReadOnlyAccess"
}
