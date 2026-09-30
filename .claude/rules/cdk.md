---
paths:
  - "app/lib/**"
  - "app/bin/**"
  - "app/test/**"
---

# CDK app

- One construct per concern (`identity.ts`, `api.ts`, `workflow.ts`, `events.ts`, `web.ts`, `observability.ts`);
  `jit-access-stack.ts` only wires them together.
- Python Lambdas use the `PythonFunction` helper (arm64, Powertools layer, X-Ray, 30-day log group).
- Grant permissions with `table.grant(fn, '<exact actions>')`, `bus.grantPutEventsTo`, `stateMachine.grantTaskResponse`.
  Hand-written `PolicyStatement`s must name exact actions and resources.
- Every new function goes into the construct's `functions` so Observability creates its error alarm.
- Every API route uses the Cognito JWT authorizer and an `authorizationScopes` entry.
- Values owned by the platform (boundary ARN, domain, certificate) are read from SSM `/jit/platform/*`, never hard-coded.
- cdk-nag findings are fixed, or acknowledged in `lib/nag-suppressions.ts` with a specific reason.
- Security invariants are tested in `test/jit-access.test.ts` (boundary on every role, no `Action: "*"`, JWT on
  every route, only the broker assumes roles, only the revoker writes IAM). Update the tests when the design changes.
