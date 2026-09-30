"""Workflow task: cut off every console session that was issued for this grant, immediately.

STS credentials can't be cancelled one by one, so this uses AWS's "revoke active sessions" pattern:
attach a Deny to the target role for sessions of this user issued before now. New sessions from a
later grant are issued after this timestamp and aren't affected.
"""

from __future__ import annotations

import json
import os
import re

import boto3
from aws_lambda_powertools import Logger

from jit.http import now_iso
from jit.policy import ACCESS_ROLES

logger = Logger()
iam = boto3.client("iam")

TARGET_ROLE_NAME_PREFIX = os.environ.get("TARGET_ROLE_NAME_PREFIX", "jit-target-")


def revoke_policy(username: str, issued_before: str) -> dict:
    return {
        "Version": "2012-10-17",
        "Statement": [
            {
                "Sid": "RevokeSessionsIssuedBefore",
                "Effect": "Deny",
                "Action": "*",
                "Resource": "*",
                "Condition": {
                    "StringEquals": {"aws:SourceIdentity": username},
                    "DateLessThan": {"aws:TokenIssueTime": issued_before},
                },
            }
        ],
    }


def policy_name(username: str) -> str:
    return re.sub(r"[^\w+=,.@-]", "-", f"jit-revoke-{username}")[:128]


@logger.inject_lambda_context
def handler(event, context):
    logger.set_correlation_id(event.get("correlationId"))
    role = event["role"]
    if role not in ACCESS_ROLES:  # never touch a role outside the catalogue, whatever the input says
        raise ValueError(f"unknown access role {role!r}")
    username = event["requesterUsername"]
    issued_before = now_iso()

    iam.put_role_policy(
        RoleName=f"{TARGET_ROLE_NAME_PREFIX}{role}",
        PolicyName=policy_name(username),
        PolicyDocument=json.dumps(revoke_policy(username, issued_before)),
    )
    logger.info(
        "sessions revoked",
        extra={"requestId": event["requestId"], "role": role, "user": username, "issuedBefore": issued_before},
    )
    return {"revokedSessionsIssuedBefore": issued_before}
