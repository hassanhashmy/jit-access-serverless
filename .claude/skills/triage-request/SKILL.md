---
name: triage-request
description: Investigate a stuck, failed or suspicious JIT request in the live AWS account using read-only commands - DynamoDB item, Step Functions history, DLQs, logs by correlation id, alarms and CloudTrail. Use when a request is stuck, an alarm fires, or access looks wrong.
argument-hint: "<requestId or symptom>"
---

# Incident triage (read-only)

All commands use `--profile devops-showcase --region eu-west-2`. **Never change anything in AWS.** The
`guard_bash` hook blocks writes; propose recovery commands for the user to run instead.

1. **The request** - `aws dynamodb get-item --table-name jit-access-requests --key '{"requestId":{"S":"<id>"}}'`
   Note `status`, `correlationId`, `executionArn`, timestamps and any `failureError`. Never print `taskToken`.
2. **The workflow** - `aws stepfunctions describe-execution --execution-arn <arn>` then
   `aws stepfunctions get-execution-history --execution-arn <arn> --reverse-order --max-items 20`.
   Find the last state entered and any `TaskFailed` / `ExecutionFailed` / `States.Timeout`.
   No execution at all → the event never started it: go to step 3.
3. **Delivery** - DLQ depth: `aws sqs get-queue-attributes --queue-url <url> --attribute-names ApproximateNumberOfMessages`
   for `jit-access-stream-dlq` and `jit-access-events-dlq` (`aws sqs get-queue-url --queue-name ...`).
   EventBridge target failures: CloudWatch metric `AWS/Events FailedInvocations` for the StartWorkflow rule.
4. **Logs for this request** - Logs Insights across the `JitAccess-*` log groups:
   `aws logs start-query --log-group-names <groups> --start-time <epoch> --end-time <epoch> --query-string
   'fields @timestamp, @log, level, message, error | filter correlationId = "<id>" | sort @timestamp asc'`
   then `aws logs get-query-results --query-id <id>`.
5. **Alarms** - `aws cloudwatch describe-alarms --alarm-name-prefix jit-access- --state-value ALARM`.
6. **Permissions** - if you see AccessDenied: `aws cloudtrail lookup-events --lookup-attributes
   AttributeKey=EventName,AttributeValue=<Api>` and read `errorMessage` and `userIdentity`.
   For console sessions, `sourceIdentity` names the human.

Report:
- **Timeline** (UTC) of what happened to the request.
- **Root cause**, with the evidence (log line, history event, CloudTrail record).
- **Recovery** as commands for the user to run (for example, a DLQ redrive or a fresh request), with the risk of each.
- **Prevention**: the test, alarm or code change that would have caught it.
