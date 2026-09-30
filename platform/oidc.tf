# GitHub's OIDC issuer. IAM allows one provider per issuer URL per account, and this account's
# provider is already shared with another repo's pipeline, so this layer references it instead of
# owning it. Destroying this project must never break someone else's deployments.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}
