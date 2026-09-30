variable "region" {
  description = "Region the app is deployed to."
  type        = string
  default     = "eu-west-2"
}

variable "github_repository" {
  description = "owner/repo allowed to assume the deploy role."
  type        = string
  default     = "hassanhashmy/jit-access-serverless"
}

variable "deploy_branch" {
  description = "Only workflows running on this branch can deploy."
  type        = string
  default     = "main"
}

variable "app_stack_name" {
  description = "CloudFormation stack name of the CDK app. IAM resources are scoped to this prefix."
  type        = string
  default     = "JitAccess"
}

variable "cdk_qualifier" {
  description = "CDK bootstrap qualifier (the default value used by cdk bootstrap)."
  type        = string
  default     = "hnb659fds"
}
