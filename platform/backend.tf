# State lives in S3 with native lock files (Terraform >= 1.10), so no DynamoDB lock table is needed.
# The bucket is created once by bootstrap-state.sh, because Terraform can't store state in a bucket it hasn't created yet.
terraform {
  backend "s3" {
    bucket       = "jit-access-tfstate-232936223811"
    key          = "platform/terraform.tfstate"
    region       = "eu-west-2"
    encrypt      = true
    use_lockfile = true
  }
}
