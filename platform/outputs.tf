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

output "target_role_arns" {
  description = "Roles a granted JIT request can open a console session into."
  value       = { for k, r in aws_iam_role.target : k => r.arn }
}

output "platform_plan_role_arn" {
  description = "Set as the AWS_PLATFORM_PLAN_ROLE_ARN variable in GitHub."
  value       = aws_iam_role.platform_plan.arn
}

output "platform_apply_role_arn" {
  description = "Set as the AWS_PLATFORM_APPLY_ROLE_ARN variable in GitHub."
  value       = aws_iam_role.platform_apply.arn
}
