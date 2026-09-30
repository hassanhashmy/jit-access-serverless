import json

import pytest
from botocore.exceptions import ClientError

from conftest import ALICE, BOB, CAROL, http_event, seed
from handlers import decide_request


class FakeSfn:
    def __init__(self, error_code=None):
        self.calls = []
        self.error_code = error_code

    def send_task_success(self, taskToken, output):
        if self.error_code:
            raise ClientError({"Error": {"Code": self.error_code, "Message": "x"}}, "SendTaskSuccess")
        self.calls.append({"taskToken": taskToken, "output": json.loads(output)})


@pytest.fixture
def sfn(monkeypatch):
    fake = FakeSfn()
    monkeypatch.setattr(decide_request, "sfn", fake)
    return fake


def call(ctx, user, decision="APPROVED", request_id="req-1"):
    event = http_event(user, body={"decision": decision}, path={"id": request_id})
    resp = decide_request.handler(event, ctx)
    return resp["statusCode"], json.loads(resp["body"])


def test_approver_approves_and_resumes_workflow(ctx, table, sfn):
    seed(table)
    status, _ = call(ctx, BOB)
    assert status == 202
    [sent] = sfn.calls
    assert sent["taskToken"] == "secret-task-token"
    assert sent["output"]["decision"] == "APPROVED"
    assert sent["output"]["approverSub"] == BOB["sub"]
    assert "expiresAt" in sent["output"]


def test_reject_has_no_expiry(ctx, table, sfn):
    seed(table)
    call(ctx, BOB, decision="REJECTED")
    assert "expiresAt" not in sfn.calls[0]["output"]


def test_requester_cannot_approve_own_request(ctx, table, sfn):
    seed(table, requesterSub=CAROL["sub"])
    status, body = call(ctx, CAROL)
    assert status == 403
    assert "own request" in body["message"]
    assert sfn.calls == []


def test_non_approver_is_forbidden(ctx, table, sfn):
    seed(table, requesterSub=BOB["sub"])
    status, _ = call(ctx, ALICE)
    assert status == 403
    assert sfn.calls == []


def test_unknown_request_is_404(ctx, table, sfn):
    status, _ = call(ctx, BOB, request_id="nope")
    assert status == 404


def test_already_decided_is_409(ctx, table, sfn):
    seed(table, status="GRANTED")
    status, _ = call(ctx, BOB)
    assert status == 409


def test_token_already_used_or_timed_out_is_409(ctx, table, monkeypatch):
    seed(table)
    monkeypatch.setattr(decide_request, "sfn", FakeSfn(error_code="TaskTimedOut"))
    status, body = call(ctx, BOB)
    assert status == 409
    assert "no longer" in body["message"]


def test_invalid_decision_is_400(ctx, table, sfn):
    seed(table)
    status, _ = call(ctx, BOB, decision="MAYBE")
    assert status == 400
