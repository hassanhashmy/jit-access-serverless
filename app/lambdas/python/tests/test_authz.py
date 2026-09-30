import pytest

from jit import authz
from jit.errors import Conflict, Forbidden


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("[approvers]", {"approvers"}),
        ("[approvers requesters]", {"approvers", "requesters"}),
        ('["approvers","requesters"]', {"approvers", "requesters"}),
        (["approvers"], {"approvers"}),
        (None, set()),
        ("[]", set()),
    ],
)
def test_parse_groups_handles_http_api_formats(raw, expected):
    assert authz.parse_groups(raw) == frozenset(expected)


def caller(sub="sub-bob", groups=("approvers",)):
    return authz.Caller(sub=sub, username="u", groups=frozenset(groups))


ITEM = {"requesterSub": "sub-alice", "status": "AWAITING_APPROVAL"}


def test_approver_can_decide_someone_elses_request():
    authz.check_can_decide(caller(), ITEM)


def test_non_approver_is_forbidden():
    with pytest.raises(Forbidden):
        authz.check_can_decide(caller(groups=("requesters",)), ITEM)


def test_approver_cannot_decide_own_request():
    with pytest.raises(Forbidden, match="own request"):
        authz.check_can_decide(caller(sub="sub-alice"), ITEM)


def test_cannot_decide_when_not_waiting():
    with pytest.raises(Conflict):
        authz.check_can_decide(caller(), {**ITEM, "status": "GRANTED"})


def test_only_requesters_can_request():
    authz.require_requester(caller(groups=("requesters",)))
    authz.require_requester(caller(groups=("approvers", "requesters")))
    with pytest.raises(Forbidden, match="requesters"):
        authz.require_requester(caller(groups=("approvers",)))
    with pytest.raises(Forbidden):
        authz.require_requester(caller(groups=()))
