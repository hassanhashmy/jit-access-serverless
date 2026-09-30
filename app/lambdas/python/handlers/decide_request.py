"""POST /requests/{id}/decision: an approver approves or rejects a waiting request.

This Lambda only decides and resumes the workflow. Step Functions writes the resulting
status, so the workflow stays the single writer of request state.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import boto3
from aws_lambda_powertools import Logger, Metrics
from aws_lambda_powertools.logging import correlation_paths
from aws_lambda_powertools.metrics import MetricUnit
from botocore.exceptions import ClientError

from jit import authz, model, repo
from jit.errors import BadRequest, Conflict, Forbidden, NotFound
from jit.http import api_handler, json_body, response

logger = Logger()
metrics = Metrics()
sfn = boto3.client("stepfunctions")

# The token is single-use: once one approver resumes the workflow, or it times out, it's gone.
TOKEN_GONE_ERRORS = frozenset({"TaskTimedOut", "TaskDoesNotExist", "InvalidToken"})


def _iso(dt: datetime) -> str:
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_HTTP)
@metrics.log_metrics
@api_handler
def handler(event, context):
    caller = authz.caller_from_event(event)
    request_id = event["pathParameters"]["id"]
    body = json_body(event)

    decision = body.get("decision")
    if decision not in model.DECISIONS:
        raise BadRequest("decision must be APPROVED or REJECTED")
    comment = str(body.get("comment", ""))[:500]

    item = repo.get(request_id)
    if item is None:
        raise NotFound("request not found")

    try:
        authz.check_can_decide(caller, item)
    except Forbidden:
        metrics.add_metric(name="DecisionForbidden", unit=MetricUnit.Count, value=1)
        raise

    decided_at = datetime.now(timezone.utc)
    output = {
        "decision": decision,
        "approverSub": caller.sub,
        "approverUsername": caller.username,
        "comment": comment,
        "decidedAt": _iso(decided_at),
    }
    if decision == model.APPROVED:
        output["expiresAt"] = _iso(decided_at + timedelta(minutes=int(item["durationMinutes"])))

    try:
        sfn.send_task_success(taskToken=item["taskToken"], output=json.dumps(output))
    except ClientError as e:
        if e.response["Error"]["Code"] in TOKEN_GONE_ERRORS:
            raise Conflict("request is no longer awaiting a decision") from e
        raise

    metrics.add_metric(name=f"Decision{decision.title()}", unit=MetricUnit.Count, value=1)
    logger.info("decision recorded", extra={"requestId": request_id, "decision": decision})
    return response(202, {"requestId": request_id, "decision": decision})
