import json
from datetime import datetime, timedelta, timezone

import pytest

from conftest import ALICE, BOB, http_event, seed
from handlers import start_session
from jit import console


def iso(dt):
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


class FakeSts:
    def __init__(self):
        self.calls = []

    def assume_role(self, **kwargs):
        self.calls.append(kwargs)
        return {
            "Credentials": {
                "AccessKeyId": "ASIA",
                "SecretAccessKey": "secret",
                "SessionToken": "token",
                "Expiration": datetime.now(timezone.utc) + timedelta(seconds=kwargs["DurationSeconds"]),
            }
        }


@pytest.fixture
def sts(monkeypatch):
    fake = FakeSts()
    monkeypatch.setattr(start_session, "sts", fake)
    monkeypatch.setattr(start_session, "TARGET_ROLE_PREFIX", "arn:aws:iam::123456789012:role/jit-target-")
    monkeypatch.setattr(console, "_get_signin_token", lambda creds: "signin-token")
    return fake


def call(ctx, user, request_id="req-1"):
    resp = start_session.handler(http_event(user, path={"id": request_id}), ctx)
    return resp["statusCode"], json.loads(resp["body"])


def granted(table, minutes_left=30, **overrides):
    expires = iso(datetime.now(timezone.utc) + timedelta(minutes=minutes_left))
    return seed(table, status="GRANTED", expiresAt=expires, **overrides)


def test_requester_with_active_grant_gets_console_url(ctx, table, sts):
    granted(table)
    status, body = call(ctx, ALICE)
    assert status == 200
    assert body["consoleUrl"].startswith("https://signin.aws.amazon.com/federation?Action=login")
    assert "SigninToken=signin-token" in body["consoleUrl"]
    [assumed] = sts.calls
    assert assumed["RoleArn"] == "arn:aws:iam::123456789012:role/jit-target-prod-logs-read"
    assert assumed["SourceIdentity"] == "alice"
    assert assumed["RoleSessionName"] == "alice-req-1"
    assert "Tags" not in assumed  # session tags need sts:TagSession, which the target trust doesn't grant


def test_session_never_outlives_one_hour_and_follows_grant(ctx, table, sts):
    granted(table, minutes_left=30)
    call(ctx, ALICE)
    assert 1700 <= sts.calls[0]["DurationSeconds"] <= 1800


def test_session_is_at_least_sts_minimum(ctx, table, sts):
    granted(table, minutes_left=2)
    call(ctx, ALICE)
    assert sts.calls[0]["DurationSeconds"] == 900


@pytest.mark.parametrize("status", ["PENDING", "AWAITING_APPROVAL", "REJECTED", "REVOKED", "EXPIRED"])
def test_no_session_without_active_grant(ctx, table, sts, status):
    seed(table, status=status)
    code, body = call(ctx, ALICE)
    assert code == 403
    assert sts.calls == []


def test_expired_grant_is_refused_even_if_not_yet_revoked(ctx, table, sts):
    granted(table, minutes_left=-1)
    code, body = call(ctx, ALICE)
    assert code == 403 and "expired" in body["message"]
    assert sts.calls == []


def test_someone_elses_grant_is_refused(ctx, table, sts):
    granted(table)
    code, _ = call(ctx, BOB)
    assert code == 403
    assert sts.calls == []


def test_session_name_is_sts_safe():
    assert start_session.session_name("scott smith", "ffb138af-29cb") == "scott-smith-ffb138af"
