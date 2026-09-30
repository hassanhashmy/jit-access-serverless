# Tells IAM to trust JWTs issued by GitHub Actions. STS fetches GitHub's signing keys (JWKS)
# from the issuer's /.well-known/openid-configuration, so no thumbprint is required.
resource "aws_iam_openid_connect_provider" "github" {
  url            = "https://token.actions.githubusercontent.com"
  client_id_list = ["sts.amazonaws.com"]
}
