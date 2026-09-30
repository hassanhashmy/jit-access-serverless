# JIT Access

Just-in-time AWS access: a user requests time-boxed access, a different approver approves it, the
workflow grants a real, read-only AWS console session and revokes it at expiry. Serverless and
event-driven on AWS, deployed from GitHub with OIDC.

Live: https://jit.hassanhashmi.com · AWS account 232936223811 · region eu-west-2

## Layout

| Path | What | Tool |
|---|---|---|
| `platform/` | OIDC deploy roles, permission boundaries, JIT target roles, ACM cert, SSM contract | Terraform |
| `app/lib/` | Cognito, API Gateway, Lambdas, DynamoDB, EventBridge, Step Functions, S3/CloudFront, alarms | CDK (TypeScript) |
| `app/lambdas/python/` | `handlers/` (one file per Lambda), `jit/` (shared: authz, policy, repo, http) | Python 3.12 |
| `app/lambdas/ts/stream-publisher/` | DynamoDB Stream → EventBridge | TypeScript |
| `web/` | Browser app (OIDC code + PKCE) | TypeScript + Vite |
| `.github/workflows/` | `pipeline.yml` (app), `platform.yml` (Terraform) | GitHub Actions |

## Commands

```bash
# Python Lambdas
cd app/lambdas/python && .venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/pytest -q
# CDK app (no AWS credentials needed)
cd app && npm run lint && npm run build && npm test && npx cdk synth --quiet
# Web
cd web && npm run build
# Terraform (validate only; no backend, no AWS)
cd platform && terraform fmt -check -recursive && terraform init -backend=false -input=false && terraform validate
```

The `verify` skill runs all of these in the same order as CI.

## How changes reach AWS

- **Never deploy or apply from a laptop.** App changes deploy through `pipeline.yml` after merge to main.
  Platform changes are planned on a PR and applied by a manual run of `platform.yml`.
- Order for changes that touch both layers: platform first (roles/boundary must exist), then the app.
- Read-only AWS CLI calls always use `--profile devops-showcase --region eu-west-2`, and `terraform plan` runs with
  `AWS_PROFILE=devops-showcase` (the state lives in S3). Never use the default profile.

## Non-negotiables

- Every IAM role the app creates carries the platform permission boundary (a CDK test enforces it).
- No `Action: "*"`, no IAM users or access keys, no long-lived credentials anywhere.
- OIDC trust policies match `sub` with `StringEquals` on the immutable repo subject, plus `job_workflow_ref`.
- Authentication is API Gateway's JWT authorizer; authorization lives in `jit/authz.py`. Never rely on the UI.
- Every cdk-nag or checkov suppression states a reason.

Detailed standards per area are in `.claude/rules/`. Repeatable tasks are skills in `.claude/skills/`.

## Conventions

- One-line commit messages in the imperative ("Add prod-s3-readonly access role").
- Keep the security invariants covered by tests when you change them (`app/test/`, `app/lambdas/python/tests/`).
