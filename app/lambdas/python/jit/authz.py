"""Authorization: what an authenticated caller may do.

Authentication already happened at API Gateway (JWT signature, issuer, audience, expiry, scope).
These checks need the request data itself, so they can only run here.
"""

from __future__ import annotations

from dataclasses import dataclass

from jit import model
from jit.errors import Conflict, Forbidden


@dataclass(frozen=True)
class Caller:
    sub: str
    username: str
    groups: frozenset[str]

    @property
    def is_approver(self) -> bool:
        return model.APPROVERS_GROUP in self.groups


def parse_groups(raw) -> frozenset[str]:
    """HTTP API flattens JWT array claims into a string like "[approvers requesters]"."""
    if raw is None:
        return frozenset()
    if isinstance(raw, list):
        return frozenset(str(g) for g in raw)
    text = str(raw).strip().strip("[]")
    return frozenset(g.strip().strip('"') for g in text.replace(",", " ").split() if g.strip())


def caller_from_event(event: dict) -> Caller:
    claims = event["requestContext"]["authorizer"]["jwt"]["claims"]
    return Caller(
        sub=claims["sub"],
        username=claims.get("username") or claims.get("cognito:username") or claims["sub"],
        groups=parse_groups(claims.get("cognito:groups")),
    )


def require_approver(caller: Caller) -> None:
    if not caller.is_approver:
        raise Forbidden("only members of the approvers group can do this")


def check_can_decide(caller: Caller, item: dict) -> None:
    """Separation of duties: an approver, deciding someone else's request, while it is still waiting."""
    require_approver(caller)
    if caller.sub == item["requesterSub"]:
        raise Forbidden("you cannot approve or reject your own request")
    if item["status"] != model.AWAITING_APPROVAL:
        raise Conflict(f"request is {item['status']}, not awaiting approval")


def check_can_start_session(caller: Caller, item: dict, now_iso: str) -> None:
    """Only the requester, only while the grant is active. ISO-8601 UTC strings compare correctly."""
    if caller.sub != item["requesterSub"]:
        raise Forbidden("only the person who requested this access can use it")
    if item["status"] != model.GRANTED:
        raise Forbidden(f"no active access: request is {item['status']}")
    if item.get("expiresAt", "") <= now_iso:
        raise Forbidden("access has expired")
