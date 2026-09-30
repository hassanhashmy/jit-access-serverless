---
name: verify
description: Run every check CI runs (ruff, pytest, eslint, tsc, jest, web build, cdk synth with cdk-nag, terraform fmt/validate, checkov) and report pass/fail. Use before committing or opening a PR, and after any code or IaC change.
allowed-tools: Bash(cd *), Bash(.venv/bin/ruff *), Bash(.venv/bin/pytest *), Bash(npm run *), Bash(npm test *), Bash(npx cdk synth *), Bash(terraform fmt *), Bash(terraform init -backend=false *), Bash(terraform validate *), Bash(checkov *)
---

# Verify

Run these from the repo root, in order, and keep going after a failure so the report is complete:

| # | Area | Command |
|---|---|---|
| 1 | Python lint | `cd app/lambdas/python && .venv/bin/ruff check . && .venv/bin/ruff format --check .` |
| 2 | Python tests | `cd app/lambdas/python && .venv/bin/pytest -q` |
| 3 | TypeScript lint + types | `cd app && npm run lint && npm run build` |
| 4 | Infra tests | `cd app && npm test` |
| 5 | Web build | `cd web && npm run build` |
| 6 | Synth + cdk-nag | `cd app && npx cdk synth --quiet` (fails on unacknowledged findings) |
| 7 | Terraform | `cd platform && terraform fmt -check -recursive && terraform init -backend=false -input=false && terraform validate` |
| 8 | Terraform scan | `checkov -d platform --framework terraform --compact --quiet` (skip with a note if checkov isn't installed; CI runs it) |

If `.venv` is missing: `cd app/lambdas/python && python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt`.

Report a table of the 8 checks with pass/fail and, for failures, the first relevant error lines and the likely fix.
Don't commit or push as part of this skill.
