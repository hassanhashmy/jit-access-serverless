"""Which access roles exist and the business rules for requesting them."""

from __future__ import annotations

import re
from dataclasses import dataclass

from jit.errors import BadRequest


@dataclass(frozen=True)
class AccessRole:
    name: str
    description: str
    max_minutes: int
    requires_incident: bool = False


ACCESS_ROLES: dict[str, AccessRole] = {
    r.name: r
    for r in (
        AccessRole("prod-logs-read", "Read CloudWatch Logs in production", 240),
        AccessRole("prod-db-readonly", "Read-only access to the production database", 120),
        AccessRole("prod-breakglass-admin", "Emergency administrator access", 60, requires_incident=True),
    )
}

INCIDENT_REF = re.compile(r"\bINC-\d+\b")
MAX_REASON_LENGTH = 500


def parse_request_body(body: dict) -> tuple[str, int, str]:
    """Shape validation at the API edge. Returns (role, duration_minutes, reason) or raises BadRequest."""
    role = body.get("role")
    duration = body.get("durationMinutes")
    reason = body.get("reason")

    if not isinstance(role, str) or not role:
        raise BadRequest("role is required")
    if isinstance(duration, bool) or not isinstance(duration, int) or duration <= 0:
        raise BadRequest("durationMinutes must be a positive integer")
    if not isinstance(reason, str) or not reason.strip():
        raise BadRequest("reason is required")
    if len(reason) > MAX_REASON_LENGTH:
        raise BadRequest(f"reason must be at most {MAX_REASON_LENGTH} characters")
    return role, duration, reason.strip()


def evaluate(role: str, duration_minutes: int, reason: str) -> tuple[bool, str]:
    """Business policy, run inside the workflow. Returns (allowed, explanation)."""
    access_role = ACCESS_ROLES.get(role)
    if access_role is None:
        return False, f"unknown access role '{role}'"
    if duration_minutes > access_role.max_minutes:
        return False, f"{role} allows at most {access_role.max_minutes} minutes"
    if access_role.requires_incident and not INCIDENT_REF.search(reason):
        return False, f"{role} requires an incident reference like INC-123 in the reason"
    return True, "policy checks passed"
