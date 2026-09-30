"""Workflow task (callback pattern): save the task token so an approver can resume the workflow.

Step Functions invokes this with .waitForTaskToken and then pauses until someone calls
SendTaskSuccess with the same token, or the task times out.
"""

from __future__ import annotations

from aws_lambda_powertools import Logger

from jit import repo
from jit.http import now_iso

logger = Logger()


class DuplicateExecutionError(Exception):
    """The request was already claimed by another execution (e.g. a duplicate event)."""


@logger.inject_lambda_context
def handler(event, context):
    logger.set_correlation_id(event.get("correlationId"))
    request_id = event["requestId"]
    try:
        repo.mark_awaiting_approval(request_id, event["taskToken"], event["executionArn"], now_iso())
    except repo.AlreadyExists as e:
        logger.warning("duplicate execution ignored", extra={"requestId": request_id})
        raise DuplicateExecutionError(f"request {request_id} is already being processed") from e

    logger.info("awaiting approval", extra={"requestId": request_id})
    return {"registered": True}
