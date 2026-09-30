---
name: add-access-role
description: Add a new JIT access type (e.g. prod-s3-readonly) end to end - policy catalogue, Terraform target role, console link, UI option and tests. Use when the user wants a new kind of temporary access.
argument-hint: "<role-name> <max-minutes> <what it may read>"
---

# Add a JIT access role

An access role exists in five places. Change all of them in one change, in this order.

1. **Policy catalogue** - `app/lambdas/python/jit/policy.py`, `ACCESS_ROLES`:
   `AccessRole("<name>", "<description>", <max_minutes>, requires_incident=<bool>)`.
   Names are `prod-<thing>-<read|readonly>`. Ask the user for the max duration if not given.
2. **Target role** - `platform/targets.tf`:
   - add an `aws_iam_policy_document "<name_snake>"` with the exact read actions and resources
     (scope to this project's resources where the API allows it; comment any `"*"`),
   - add the entry to `local.targets` with `description` and `policy`.
   The role gets the `ReadOnlyAccess` boundary automatically. **If the user wants write access, stop and
   explain that JIT target roles are capped at read-only by design; changing that needs a design decision.**
3. **Console link** - `app/lambdas/python/handlers/start_session.py`, `CONSOLE_DESTINATIONS`: the console
   page the session should land on, in `REGION`.
4. **UI option** - `web/src/main.ts`, `ACCESS_ROLES`: `{ name, label, max }` matching step 1.
5. **Tests** - `app/lambdas/python/tests/test_policy.py`: a case for the new max duration (and the incident
   rule if `requires_incident`). `test_catalogue.py` already fails if a role has no console destination.

Then:
- Run the `verify` skill.
- Run the `iam-review` skill on the `platform/` diff.
- Show `cd platform && terraform plan` output for the new role (plan only).
- Tell the user the rollout order: merge and apply `platform.yml` first (the role must exist), then the app
  pipeline deploys the catalogue, broker and UI. Don't apply or deploy yourself.
