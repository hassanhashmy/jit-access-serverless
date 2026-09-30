# Permission boundary: the MOST any app role (Lambda, Step Functions, EventBridge target) can ever do.
# Effective permissions = identity policy ∩ boundary. CDK grants exact permissions; this caps them,
# so even a mistaken or malicious grant in the app code can't reach IAM, other tables, or other buckets.
data "aws_iam_policy_document" "app_boundary" {
  #checkov:skip=CKV_AWS_356:Only X-Ray, log-delivery and task-token APIs use "*"; they have no resource-level permissions.
  #checkov:skip=CKV_AWS_111:Same statements as above; every other write is scoped to the app's name prefixes.
  statement {
    sid    = "Logs"
    effect = "Allow"
    actions = [
      "logs:CreateLogGroup",
      "logs:CreateLogStream",
      "logs:PutLogEvents",
    ]
    resources = ["arn:${local.partition}:logs:${local.region}:${local.account_id}:log-group:*"]
  }

  statement {
    sid    = "LogDeliveryForStepFunctionsAndEventBridge"
    effect = "Allow"
    actions = [
      "logs:CreateLogDelivery",
      "logs:GetLogDelivery",
      "logs:UpdateLogDelivery",
      "logs:DeleteLogDelivery",
      "logs:ListLogDeliveries",
      "logs:PutResourcePolicy",
      "logs:DeleteResourcePolicy",
      "logs:DescribeResourcePolicies",
      "logs:DescribeLogGroups",
    ]
    resources = ["*"] # these log-delivery APIs don't support resource-level permissions
  }

  statement {
    sid    = "Tracing"
    effect = "Allow"
    actions = [
      "xray:PutTraceSegments",
      "xray:PutTelemetryRecords",
      "xray:GetSamplingRules",
      "xray:GetSamplingTargets",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "AppTableOnly"
    effect = "Allow"
    actions = [
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:DeleteItem",
      "dynamodb:Query",
      "dynamodb:ConditionCheckItem",
      "dynamodb:BatchGetItem",
      "dynamodb:BatchWriteItem",
      "dynamodb:DescribeTable",
      "dynamodb:DescribeStream",
      "dynamodb:GetRecords",
      "dynamodb:GetShardIterator",
      "dynamodb:ListStreams",
    ]
    resources = [
      "arn:${local.partition}:dynamodb:${local.region}:${local.account_id}:table/${local.app_resource}-*",
      "arn:${local.partition}:dynamodb:${local.region}:${local.account_id}:table/${local.app_resource}-*/*",
    ]
  }

  statement {
    sid       = "AppEventBusOnly"
    effect    = "Allow"
    actions   = ["events:PutEvents"]
    resources = ["arn:${local.partition}:events:${local.region}:${local.account_id}:event-bus/${local.app_resource}*"]
  }

  statement {
    sid       = "StartAppWorkflowOnly"
    effect    = "Allow"
    actions   = ["states:StartExecution"]
    resources = ["arn:${local.partition}:states:${local.region}:${local.account_id}:stateMachine:${local.app_resource}-*"]
  }

  statement {
    sid    = "WorkflowCallbacks"
    effect = "Allow"
    actions = [
      "states:SendTaskSuccess",
      "states:SendTaskFailure",
      "states:SendTaskHeartbeat",
    ]
    resources = ["*"] # task-token APIs don't support resource-level permissions
  }

  statement {
    sid       = "InvokeAppFunctionsOnly"
    effect    = "Allow"
    actions   = ["lambda:InvokeFunction"]
    resources = ["arn:${local.partition}:lambda:${local.region}:${local.account_id}:function:${local.app_prefix}-*"]
  }

  statement {
    sid    = "AppQueuesOnly"
    effect = "Allow"
    actions = [
      "sqs:SendMessage",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
    ]
    resources = ["arn:${local.partition}:sqs:${local.region}:${local.account_id}:${local.app_resource}-*"]
  }

  statement {
    sid    = "ReadCdkAssets"
    effect = "Allow"
    actions = [
      "s3:GetObject*",
      "s3:GetBucket*",
      "s3:List*",
    ]
    resources = [
      "arn:${local.partition}:s3:::cdk-${var.cdk_qualifier}-assets-${local.account_id}-${local.region}",
      "arn:${local.partition}:s3:::cdk-${var.cdk_qualifier}-assets-${local.account_id}-${local.region}/*",
    ]
  }

  statement {
    sid    = "WriteAppWebsiteBucket"
    effect = "Allow"
    actions = [
      "s3:GetObject*",
      "s3:GetBucket*",
      "s3:List*",
      "s3:PutObject",
      "s3:PutObjectLegalHold",
      "s3:PutObjectRetention",
      "s3:PutObjectTagging",
      "s3:PutObjectVersionTagging",
      "s3:DeleteObject*",
      "s3:Abort*",
    ]
    resources = [
      "arn:${local.partition}:s3:::${local.app_bucket_pref}-*",
      "arn:${local.partition}:s3:::${local.app_bucket_pref}-*/*",
    ]
  }

  statement {
    sid       = "InvalidateCdn"
    effect    = "Allow"
    actions   = ["cloudfront:CreateInvalidation", "cloudfront:GetInvalidation"]
    resources = ["arn:${local.partition}:cloudfront::${local.account_id}:distribution/*"]
  }

  # The session broker may step into the platform's JIT target roles, and nothing else.
  statement {
    sid       = "BrokerSessionsIntoTargetRolesOnly"
    effect    = "Allow"
    actions   = ["sts:AssumeRole", "sts:SetSourceIdentity", "sts:TagSession"]
    resources = ["arn:${local.partition}:iam::${local.account_id}:role/jit-target-*"]
  }

  statement {
    sid           = "NeverAssumeAnyOtherRole"
    effect        = "Deny"
    actions       = ["sts:AssumeRole"]
    not_resources = ["arn:${local.partition}:iam::${local.account_id}:role/jit-target-*"]
  }

  # Explicit deny for readability and defence in depth. Nothing above allows these anyway.
  statement {
    sid       = "NeverIdentityOrOrganization"
    effect    = "Deny"
    actions   = ["iam:*", "organizations:*", "account:*"]
    resources = ["*"]
  }
}

resource "aws_iam_policy" "app_boundary" {
  name        = local.boundary_name
  description = "Permission boundary for every IAM role created by the ${var.app_stack_name} CDK stack"
  policy      = data.aws_iam_policy_document.app_boundary.json
}
