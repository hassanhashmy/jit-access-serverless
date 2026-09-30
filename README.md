# JIT Access (serverless)

Just-in-time access requests on AWS serverless. An engineer asks for time-boxed elevated access, a different person approves it, and the grant expires automatically. Every step emits an audit event.

## Layout

| Path | What | Tool |
|---|---|---|
| `platform/` | GitHub OIDC provider, deploy role, permission boundary | Terraform |
| `app/` | Cognito, API Gateway, Lambdas, DynamoDB, EventBridge, Step Functions, S3/CloudFront | AWS CDK (TypeScript) |
| `app/lambdas/python/` | API and workflow Lambdas | Python 3.12 |
| `app/lambdas/ts/` | DynamoDB Stream → EventBridge publisher | TypeScript |
| `web/` | Browser app: OIDC login, requests, approvals, token inspector | TypeScript |
| `docs/` | Architecture, decision records, runbooks | Markdown |

## Ownership

Terraform owns the **platform layer**, which changes rarely and is security-reviewed. CDK owns the **application layer**, which is deployed by the pipeline. Every IAM role the app creates must carry the platform's permission boundary.
