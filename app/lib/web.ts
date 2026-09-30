import * as fs from 'fs';
import * as path from 'path';
import { Duration, RemovalPolicy, Stack } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';

const WEB_DIST = path.join(__dirname, '..', '..', 'web', 'dist');

/** Private S3 bucket behind CloudFront (origin access control). The browser never talks to S3 directly. */
export class Web extends Construct {
  readonly bucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  /** https://jit.hassanhashmi.com (custom domain from the platform layer) */
  readonly url: string;
  /** https://xxxx.cloudfront.net, still accepted so old links keep working */
  readonly cloudFrontUrl: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    const { account, region } = Stack.of(this);

    // Contract with the platform layer: Terraform owns the domain and its us-east-1 certificate.
    const domainName = ssm.StringParameter.valueForStringParameter(this, '/jit/platform/web-domain');
    const certificate = acm.Certificate.fromCertificateArn(
      this,
      'Certificate',
      ssm.StringParameter.valueForStringParameter(this, '/jit/platform/web-certificate-arn'),
    );

    this.bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    const cognitoOrigin = `https://jit-access-${account}.auth.${region}.amazoncognito.com`;
    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: [
            "default-src 'self'",
            // API calls, OIDC discovery + JWKS (cognito-idp), and the token endpoint (Cognito domain).
            `connect-src 'self' https://*.execute-api.${region}.amazonaws.com https://cognito-idp.${region}.amazonaws.com ${cognitoOrigin}`,
            "img-src 'self' data:",
            "style-src 'self' https://fonts.googleapis.com",
            "font-src https://fonts.gstatic.com",
            "frame-ancestors 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join('; '),
        },
        strictTransportSecurity: { override: true, accessControlMaxAge: Duration.days(365), includeSubdomains: true },
        contentTypeOptions: { override: true },
        frameOptions: { override: true, frameOption: cloudfront.HeadersFrameOption.DENY },
        referrerPolicy: { override: true, referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER },
      },
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'JIT Access web app',
      domainNames: [domainName],
      certificate,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
      },
      errorResponses: [{ httpStatus: 403, responseHttpStatus: 200, responsePagePath: '/index.html' }],
    });

    this.url = `https://${domainName}`;
    this.cloudFrontUrl = `https://${this.distribution.distributionDomainName}`;
  }

  /** Upload the built app plus a runtime config.json, then invalidate the CDN cache. */
  deploy(config: Record<string, string>): void {
    const sources = [s3deploy.Source.jsonData('config.json', config)];
    if (fs.existsSync(WEB_DIST)) sources.unshift(s3deploy.Source.asset(WEB_DIST));

    new s3deploy.BucketDeployment(this, 'Deploy', {
      sources,
      destinationBucket: this.bucket,
      distribution: this.distribution,
      distributionPaths: ['/*'],
      memoryLimit: 256,
    });
  }
}
