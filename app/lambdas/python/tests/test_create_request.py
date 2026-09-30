import json

from conftest import ALICE, BOB, CAROL, http_event
from handlers import create_request

BODY = {"role": "prod-logs-read", "durationMinutes": 60, "reason": "INC-42 investigating 5xx"}


def call(ctx, body=BODY, key="k-1", user=ALICE):
    resp = create_request.handler(http_event(user, body=body, headers={"idempotency-key": key}), ctx)
    return resp["statusCode"], json.loads(resp["body"])


def test_creates_pending_request(ctx, table):
    status, body = call(ctx)
    assert status == 201
    assert body["status"] == "PENDING"
    assert body["requesterSub"] == ALICE["sub"]
    assert body["correlationId"] == "corr-abc"
    assert table.get_item(Key={"requestId": body["requestId"]})["Item"]["role"] == "prod-logs-read"


def test_retry_with_same_key_returns_same_request(ctx, table):
    _, first = call(ctx)
    status, second = call(ctx)
    assert status == 200
    assert second["requestId"] == first["requestId"]
    assert table.scan()["Count"] == 1


def test_same_key_different_body_is_conflict(ctx):
    call(ctx)
    status, body = call(ctx, body={**BODY, "durationMinutes": 120})
    assert status == 409
    assert "Idempotency-Key" in body["message"]


def test_invalid_body_is_400(ctx):
    status, body = call(ctx, body={"role": "prod-logs-read"})
    assert status == 400


def test_task_token_is_never_returned(ctx):
    _, body = call(ctx)
    assert "taskToken" not in body


def test_approver_who_is_not_a_requester_is_forbidden(ctx, table):
    status, body = call(ctx, user=BOB)
    assert status == 403
    assert "requesters" in body["message"]
    assert table.scan()["Count"] == 0


def test_member_of_both_groups_can_request(ctx, table):
    status, body = call(ctx, user=CAROL)
    assert status == 201
    assert body["requesterUsername"] == "carol"
