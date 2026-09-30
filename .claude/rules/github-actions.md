---
paths:
  - ".github/workflows/**"
---

# GitHub Actions

- `pipeline.yml` owns the app (ignores `platform/**`); `platform.yml` owns Terraform. Keep them separate.
- Top-level `permissions: contents: read`. Add `id-token: write` only on the job that talks to AWS.
- The deploy role trusts `pipeline.yml` on main; the platform roles trust `platform.yml`. Renaming a workflow file
  breaks its AWS trust (update `platform/` first).
- Pass user input and event data through `env:`, never interpolate `${{ }}` directly into `run:` scripts.
- Deploy and apply jobs use `concurrency` with `cancel-in-progress: false`.
- Role ARNs come from repository variables (`vars.*`); they are not secrets. No AWS keys in secrets.
- Lint workflow changes with actionlint before pushing.
