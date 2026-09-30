import pytest

from jit import policy
from jit.errors import BadRequest


def test_parse_valid_body():
    assert policy.parse_request_body({"role": "prod-logs-read", "durationMinutes": 30, "reason": " INC-1 "}) == (
        "prod-logs-read",
        30,
        "INC-1",
    )


@pytest.mark.parametrize(
    "body",
    [
        {},
        {"role": "prod-logs-read", "durationMinutes": "30", "reason": "x"},
        {"role": "prod-logs-read", "durationMinutes": 0, "reason": "x"},
        {"role": "prod-logs-read", "durationMinutes": True, "reason": "x"},
        {"role": "prod-logs-read", "durationMinutes": 30, "reason": "   "},
        {"role": "prod-logs-read", "durationMinutes": 30, "reason": "x" * 501},
    ],
)
def test_parse_rejects_bad_shapes(body):
    with pytest.raises(BadRequest):
        policy.parse_request_body(body)


def test_evaluate_allows_within_limits():
    assert policy.evaluate("prod-logs-read", 240, "debugging")[0] is True


def test_evaluate_rejects_unknown_role():
    allowed, why = policy.evaluate("root", 10, "please")
    assert not allowed and "unknown" in why


def test_evaluate_rejects_too_long():
    allowed, why = policy.evaluate("prod-db-readonly", 121, "report")
    assert not allowed and "120" in why


def test_breakglass_needs_incident_reference():
    assert policy.evaluate("prod-breakglass-admin", 30, "just because")[0] is False
    assert policy.evaluate("prod-breakglass-admin", 30, "INC-981 db down")[0] is True
