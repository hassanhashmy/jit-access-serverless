---
paths:
  - "platform/**"
  - "app/lib/**"
  - ".github/workflows/**"
---

# IAM and identity rules (non-negotiable)

1. No `Action: "*"`. No `iam:*` outside the platform apply role's `jit-*` scope.
2. Every role created by the app stack carries the permission boundary. CloudFormation can't create a role without it.
3. Nothing may remove or edit a permission boundary, or create IAM users, access keys or login profiles.
4. `iam:PassRole` is scoped to specific roles and restricted with `iam:PassedToService`.
5. OIDC trust: `aud = sts.amazonaws.com`, `sub` with `StringEquals` on the immutable subject
   (`repo:hassanhashmy@16563703/jit-access-serverless@1398502385:...`), and `job_workflow_ref` pinned to one workflow file.
   Never `StringLike` with `repo:owner/*`.
6. Pull requests never get write credentials. The only PR role is the read-only platform plan role.
7. Explicit denies list exact actions. A wildcard deny can silently block reads Terraform or CloudFormation need.
8. Sessions into target roles set `SourceIdentity` to the human's username, so CloudTrail shows who acted.
9. Only the session broker may `sts:AssumeRole` (into `jit-target-*`), and only the revoker may write IAM
   (`iam:PutRolePolicy` on `jit-target-*`).

When a change touches any of this, run the `iam-review` skill or ask the `security-reviewer` agent before committing.
