---
paths:
  - "app/lambdas/python/**"
---

# Python Lambdas

- One file per Lambda in `handlers/`. Shared logic goes in `jit/` so it can be unit-tested without AWS.
- Create boto3 clients and resources at module level (reused across warm invocations).
- API handlers are wrapped in `@api_handler` and raise `jit.errors` types (`BadRequest` 400, `Forbidden` 403,
  `NotFound` 404, `Conflict` 409). Never return internal error details to the caller.
- Authorization checks live in `jit/authz.py`, are pure functions, and have unit tests. The caller comes
  from `authz.caller_from_event(event)` (claims already verified by API Gateway).
- Writes to DynamoDB are conditional (`attribute_not_exists`, `#s = :expected`) so retries and duplicate
  events are safe. Never read-then-write without a condition.
- After creation, request status is changed only by the workflow (register-approval and the state machine).
- Logging: Powertools `Logger`, `@logger.inject_lambda_context`, set the correlation id. Never log tokens,
  task tokens, sign-in URLs or credentials.
- Tests use moto (see `tests/conftest.py` for the table fixture and `http_event`). Replace AWS clients with
  small fakes via `monkeypatch` (see `FakeSfn`, `FakeSts`, `FakeIam`).
- Keep `aws-lambda-powertools` in `requirements-dev.txt` in step with the layer version in `app/lib/python-function.ts`.
