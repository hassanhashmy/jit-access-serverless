---
name: add-lambda
description: Scaffold a new Python Lambda the project way - handler, shared logic, unit tests, CDK wiring with least-privilege grants, alarm and (for API routes) JWT-protected route. Use when adding a new function or API endpoint.
argument-hint: "<name> <api-route|workflow-task|event-consumer> <what it does>"
---

# Add a Python Lambda

1. **Handler** - `app/lambdas/python/handlers/<snake_name>.py`. Follow `.claude/rules/python.md`:
   module-level clients, Powertools logger with correlation id, `@api_handler` for API routes,
   errors from `jit.errors`. Put reusable logic in `jit/` (authorization rules in `jit/authz.py`).
2. **Tests** - `app/lambdas/python/tests/test_<snake_name>.py` using the `ctx`, `table` and `http_event`
   fixtures from `conftest.py`. Cover: happy path, each 4xx branch, and the authorization rule
   (a caller who must be refused, and proof the side effect didn't happen).
3. **CDK** - add it in the construct that owns it:
   - API route → `app/lib/api.ts`: `fn(...)`, exact `table.grant(...)` actions, `route(...)` with the right
     scope, and add it to `this.functions`.
   - Workflow task → `app/lib/workflow.ts`, invoked by a `LambdaInvoke` with `addRetry` and `addCatch(markFailed)`.
   - Event consumer → `app/lib/events.ts` with a rule, retries and the events DLQ.
   Functions in a construct's `functions` automatically get an error alarm.
4. **Infra tests** - update `app/test/jit-access.test.ts` if counts or invariants change (for example the route count).
5. Run the `verify` skill. Fix cdk-nag findings or acknowledge them with a reason in `lib/nag-suppressions.ts`.
6. Summarise: new permissions granted (exact actions/resources), new route or trigger, tests added.
