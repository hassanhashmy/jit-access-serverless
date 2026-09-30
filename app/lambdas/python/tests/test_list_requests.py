import json

from conftest import ALICE, BOB, http_event, seed
from handlers import list_requests


def call(ctx, user, view):
    resp = list_requests.handler(http_event(user, query={"view": view}), ctx)
    return resp["statusCode"], json.loads(resp["body"])


def test_mine_returns_only_callers_requests(ctx, table):
    seed(table, requestId="a1")
    seed(table, requestId="b1", requesterSub=BOB["sub"])
    status, body = call(ctx, ALICE, "mine")
    assert status == 200
    assert [i["requestId"] for i in body["items"]] == ["a1"]


def test_pending_requires_approver(ctx, table):
    status, _ = call(ctx, ALICE, "pending")
    assert status == 403


def test_pending_hides_task_tokens(ctx, table):
    seed(table)
    status, body = call(ctx, BOB, "pending")
    assert status == 200
    assert len(body["items"]) == 1
    assert "taskToken" not in body["items"][0]
