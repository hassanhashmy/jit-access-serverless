"""Request states. Only the workflow changes status after creation (single writer)."""

PENDING = "PENDING"
AWAITING_APPROVAL = "AWAITING_APPROVAL"
GRANTED = "GRANTED"
REVOKED = "REVOKED"
REJECTED = "REJECTED"
EXPIRED = "EXPIRED"
FAILED = "FAILED"

APPROVED = "APPROVED"  # a decision, not a stored status
DECISIONS = frozenset({APPROVED, REJECTED})

APPROVERS_GROUP = "approvers"

# Never returned to clients: the task token lets its holder resume the workflow.
PRIVATE_FIELDS = frozenset({"taskToken"})


def public_view(item: dict) -> dict:
    return {k: v for k, v in item.items() if k not in PRIVATE_FIELDS}
