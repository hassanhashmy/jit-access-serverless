import pytest

from conftest import seed
from handlers import register_approval, validate_request


def test_validate_returns_policy_result(ctx):
    event = {"requestId": "r", "role": "prod-db-readonly", "durationMinutes": 500, "reason": "x"}
    result = validate_request.handler(event, ctx)
    assert result["allowed"] is False


def test_validate_demo_failure_only_when_enabled(ctx, monkeypatch):
    event = {"requestId": "r", "role": "prod-logs-read", "durationMinutes": 10, "reason": "x #fail-validate"}
    assert validate_request.handler(event, ctx)["allowed"] is True
    monkeypatch.setenv("DEMO_FAILURES", "true")
    with pytest.raises(RuntimeError, match="injected"):
        validate_request.handler(event, ctx)


def test_register_saves_token_and_moves_to_awaiting(ctx, table):
    seed(table, status="PENDING", taskToken=None)
    register_approval.handler({"requestId": "req-1", "taskToken": "tok", "executionArn": "arn:exec"}, ctx)
    item = table.get_item(Key={"requestId": "req-1"})["Item"]
    assert item["status"] == "AWAITING_APPROVAL"
    assert item["taskToken"] == "tok"
    assert item["executionArn"] == "arn:exec"


def test_duplicate_execution_is_rejected(ctx, table):
    seed(table, status="PENDING")
    event = {"requestId": "req-1", "taskToken": "tok", "executionArn": "arn:exec"}
    register_approval.handler(event, ctx)
    with pytest.raises(register_approval.DuplicateExecutionError):
        register_approval.handler({**event, "taskToken": "tok-2", "executionArn": "arn:exec-2"}, ctx)
