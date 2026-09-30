---
paths:
  - "platform/**"
---

# Terraform platform layer

- This layer owns trust and guardrails: OIDC deploy roles, `jit-app-boundary`, `jit-cfn-exec`, JIT target roles,
  the ACM certificate and the SSM contract under `/jit/platform/`.
- Build policies with `aws_iam_policy_document`. Scope resources by name prefix (`JitAccess-*`, `jit-access-*`, `jit-target-*`).
- Any `resources = ["*"]` needs a comment explaining why (API has no resource-level permissions) and, if checkov
  flags it, a `#checkov:skip=<ID>:<reason>` inside the resource.
- Target roles (`jit-target-*`) keep the `ReadOnlyAccess` permissions boundary. Granting write access through JIT
  is a design change: stop and ask the user.
- The GitHub OIDC provider is shared with another repo. It's a `data` source here; never create, import or change it.
- Validate with `terraform fmt -check`, `terraform validate` and checkov. Use `terraform plan` to show changes.
  Never apply locally: the user applies through a manual run of `platform.yml`.
