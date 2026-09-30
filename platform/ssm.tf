# The contract between the platform layer (Terraform) and the app layer (CDK).
# CDK resolves these at deploy time, so neither side hard-codes the other's ARNs.
resource "aws_ssm_parameter" "boundary_arn" {
  #checkov:skip=CKV2_AWS_34:Holds a public policy ARN, not a secret; CloudFormation resolves it as a String parameter.
  name        = "/jit/platform/permissions-boundary-arn"
  description = "Permission boundary every app role must carry"
  type        = "String"
  value       = aws_iam_policy.app_boundary.arn
}
