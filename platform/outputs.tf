output "github_deploy_role_arn" {
  description = "Set as the AWS_DEPLOY_ROLE_ARN variable in GitHub."
  value       = aws_iam_role.github_deploy.arn
}

output "permissions_boundary_arn" {
  value = aws_iam_policy.app_boundary.arn
}

output "cfn_exec_policy_arn" {
  description = "Pass to: cdk bootstrap --cloudformation-execution-policies <arn>"
  value       = aws_iam_policy.cfn_exec.arn
}
