# Custom domain for the web app. CloudFront only uses ACM certificates from us-east-1.
# DNS is hosted in Cloudflare, so the validation record is added there by hand (see outputs).

provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      Project   = "jit-access"
      Layer     = "platform"
      ManagedBy = "terraform"
    }
  }
}

resource "aws_acm_certificate" "web" {
  provider          = aws.us_east_1
  domain_name       = var.web_domain
  validation_method = "DNS"

  lifecycle {
    create_before_destroy = true
  }
}

# Contract with the app layer: CDK reads these at deploy time.
resource "aws_ssm_parameter" "web_domain" {
  #checkov:skip=CKV2_AWS_34:Public domain name, not a secret.
  name  = "/jit/platform/web-domain"
  type  = "String"
  value = var.web_domain
}

resource "aws_ssm_parameter" "web_certificate_arn" {
  #checkov:skip=CKV2_AWS_34:Certificate ARN, not a secret.
  name  = "/jit/platform/web-certificate-arn"
  type  = "String"
  value = aws_acm_certificate.web.arn
}
