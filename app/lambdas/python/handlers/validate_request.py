"""Workflow task: apply business policy to a new request (allowed role, max duration, incident ref)."""

from __future__ import annotations

import os

from aws_lambda_powertools import Logger

from jit import policy

logger = Logger()


@logger.inject_lambda_context
def handler(event, context):
    logger.set_correlation_id(event.get("correlationId"))

    # Failure scenario for the demo: proves Retry and Catch in the state machine.
    if os.environ.get("DEMO_FAILURES") == "true" and "#fail-validate" in event.get("reason", ""):
        raise RuntimeError("demo: injected validation failure")

    allowed, explanation = policy.evaluate(event["role"], int(event["durationMinutes"]), event["reason"])
    logger.info(
        "policy evaluated",
        extra={"requestId": event["requestId"], "allowed": allowed, "explanation": explanation},
    )
    return {"allowed": allowed, "explanation": explanation}
