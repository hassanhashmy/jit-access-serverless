"""POST /requests/{id}/session: open a REAL, time-limited AWS console session for a granted request.

This is the only place where JIT access turns into AWS permissions:
  1. check the caller owns an active grant (GRANTED and not expired)
  2. sts:AssumeRole into the platform's target role, for no longer than the grant has left
  3. exchange the temporary credentials for a one-time console sign-in URL
STS credentials can't be revoked individually, so the session length is what bounds the access.
"""

from __future__ import annotations

import os
import re
from datetime import datetime, timezone

import boto3
from aws_lambda_powertools import Logger, Metrics
from aws_lambda_powertools.logging import correlation_paths
from aws_lambda_powertools.metrics import MetricUnit

from jit import authz, console, repo
from jit.errors import NotFound
from jit.http import api_handler, now_iso, response

logger = Logger()
metrics = Metrics()
sts = boto3.client("sts")

REGION = os.environ.get("AWS_REGION", "eu-west-2")
TARGET_ROLE_PREFIX = os.environ.get("TARGET_ROLE_PREFIX", "")  # arn:aws:iam::<acct>:role/jit-target-
ISSUER = os.environ.get("CONSOLE_ISSUER", "jit-access")

# STS limits: at least 15 minutes, and at most 1 hour for role-chained sessions.
MIN_SESSION_SECONDS = 900
MAX_SESSION_SECONDS = 3600

CONSOLE_DESTINATIONS = {
    "prod-logs-read": f"https://{REGION}.console.aws.amazon.com/cloudwatch/home?region={REGION}#logsV2:log-groups",
    "prod-db-readonly": (
        f"https://{REGION}.console.aws.amazon.com/dynamodbv2/home?region={REGION}#item-explorer?table=jit-access-requests"
    ),
    "prod-breakglass-admin": f"https://{REGION}.console.aws.amazon.com/console/home?region={REGION}",
}


def session_seconds(expires_at: str, now: datetime) -> int:
    remaining = int((datetime.fromisoformat(expires_at.replace("Z", "+00:00")) - now).total_seconds())
    return max(MIN_SESSION_SECONDS, min(MAX_SESSION_SECONDS, remaining))


def session_name(username: str, request_id: str) -> str:
    return re.sub(r"[^\w+=,.@-]", "-", f"{username}-{request_id[:8]}")[:64]


@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_HTTP)
@metrics.log_metrics
@api_handler
def handler(event, context):
    caller = authz.caller_from_event(event)
    request_id = event["pathParameters"]["id"]

    item = repo.get(request_id)
    if item is None:
        raise NotFound("request not found")
    authz.check_can_start_session(caller, item, now_iso())

    role = item["role"]
    duration = session_seconds(item["expiresAt"], datetime.now(timezone.utc))
    assumed = sts.assume_role(
        RoleArn=f"{TARGET_ROLE_PREFIX}{role}",
        RoleSessionName=session_name(caller.username, request_id),
        SourceIdentity=caller.username,  # recorded in CloudTrail on every action in the session
        DurationSeconds=duration,
        Tags=[{"Key": "jit-request-id", "Value": request_id}],
    )
    credentials = assumed["Credentials"]
    url = console.signin_url(credentials, CONSOLE_DESTINATIONS[role], ISSUER)

    metrics.add_metric(name="ConsoleSessionIssued", unit=MetricUnit.Count, value=1)
    logger.info(
        "console session issued",
        extra={"requestId": request_id, "role": role, "sessionSeconds": duration},  # never log the URL
    )
    return response(
        200,
        {
            "consoleUrl": url,
            "role": role,
            "sessionExpiresAt": credentials["Expiration"].isoformat(),
            "grantExpiresAt": item["expiresAt"],
        },
    )
