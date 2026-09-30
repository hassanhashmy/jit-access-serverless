import json

import pytest

from handlers import revoke_sessions


class FakeIam:
    def __init__(self):
        self.calls = []

    def put_role_policy(self, **kwargs):
        self.calls.append(kwargs)


@pytest.fixture
def iam(monkeypatch):
    fake = FakeIam()
    monkeypatch.setattr(revoke_sessions, "iam", fake)
    return fake


EVENT = {"requestId": "r-1", "role": "prod-logs-read", "requesterUsername": "scott", "correlationId": "c"}


def test_denies_this_users_sessions_issued_before_now(ctx, iam):
    result = revoke_sessions.handler(EVENT, ctx)
    [call] = iam.calls
    assert call["RoleName"] == "jit-target-prod-logs-read"
    assert call["PolicyName"] == "jit-revoke-scott"
    statement = json.loads(call["PolicyDocument"])["Statement"][0]
    assert statement["Effect"] == "Deny" and statement["Action"] == "*"
    assert statement["Condition"]["StringEquals"] == {"aws:SourceIdentity": "scott"}
    assert statement["Condition"]["DateLessThan"]["aws:TokenIssueTime"] == result["revokedSessionsIssuedBefore"]


def test_refuses_roles_outside_the_catalogue(ctx, iam):
    with pytest.raises(ValueError):
        revoke_sessions.handler({**EVENT, "role": "../admin"}, ctx)
    assert iam.calls == []


def test_policy_name_is_iam_safe():
    assert revoke_sessions.policy_name("scott smith") == "jit-revoke-scott-smith"
