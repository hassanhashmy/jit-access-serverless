"""POST /requests: record a new access request as PENDING.

Idempotent: the client sends an Idempotency-Key header per form submission, so a retried
request (double click, network retry) maps to the same requestId and never creates a duplicate.
"""

from __future__ import annotations

import uuid

from aws_lambda_powertools import Logger, Metrics
from aws_lambda_powertools.logging import correlation_paths
from aws_lambda_powertools.metrics import MetricUnit

from jit import authz, model, policy, repo
from jit.errors import Conflict
from jit.http import api_handler, json_body, now_iso, response

logger = Logger()
metrics = Metrics()

IDEMPOTENCY_NAMESPACE = uuid.UUID("6f1c2b7e-3d4a-4f5e-9a8b-1c2d3e4f5a6b")


def request_id_for(caller_sub: str, idempotency_key: str | None) -> str:
    if idempotency_key:
        return str(uuid.uuid5(IDEMPOTENCY_NAMESPACE, f"{caller_sub}:{idempotency_key}"))
    return str(uuid.uuid4())


@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_HTTP)
@metrics.log_metrics
@api_handler
def handler(event, context):
    caller = authz.caller_from_event(event)
    authz.require_requester(caller)
    role, duration, reason = policy.parse_request_body(json_body(event))
    idempotency_key = (event.get("headers") or {}).get("idempotency-key")
    now = now_iso()

    item = {
        "requestId": request_id_for(caller.sub, idempotency_key),
        "requesterSub": caller.sub,
        "requesterUsername": caller.username,
        "role": role,
        "durationMinutes": duration,
        "reason": reason,
        "status": model.PENDING,
        "createdAt": now,
        "updatedAt": now,
        "correlationId": logger.get_correlation_id(),
    }

    try:
        repo.put_new(item)
    except repo.AlreadyExists:
        existing = repo.get(item["requestId"])
        same_request = existing and all(
            existing.get(k) == item[k] for k in ("requesterSub", "role", "durationMinutes", "reason")
        )
        if not same_request:
            raise Conflict("Idempotency-Key was already used for a different request") from None
        logger.info("idempotent replay", extra={"requestId": item["requestId"]})
        return response(200, model.public_view(existing))

    metrics.add_metric(name="RequestCreated", unit=MetricUnit.Count, value=1)
    logger.info("request created", extra={"requestId": item["requestId"], "role": role, "durationMinutes": duration})
    return response(201, model.public_view(item))
