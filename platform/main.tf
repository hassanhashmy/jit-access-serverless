data "aws_caller_identity" "current" {}
data "aws_partition" "current" {}

locals {
  account_id = data.aws_caller_identity.current.account_id
  partition  = data.aws_partition.current.partition
  region     = var.region

  # Name prefixes the app stack is allowed to use. CDK derives role and function names from the stack name.
  app_prefix      = var.app_stack_name        # JitAccess-... (roles, functions)
  app_bucket_pref = lower(var.app_stack_name) # jitaccess-... (buckets)
  app_resource    = "jit-access"              # tables, bus, queues, state machine

  boundary_name = "jit-app-boundary"
  boundary_arn  = "arn:${local.partition}:iam::${local.account_id}:policy/${local.boundary_name}"
}
