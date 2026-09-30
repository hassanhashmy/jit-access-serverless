"""DynamoDB access for the requests table."""

from __future__ import annotations

import os

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

from jit import model

# Created once per execution environment and reused across warm invocations.
_table = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])

BY_REQUESTER_INDEX = "byRequester"
BY_STATUS_INDEX = "byStatus"


class AlreadyExists(Exception):
    pass


def put_new(item: dict) -> None:
    """Insert only if this requestId has never been written (idempotent create)."""
    try:
        _table.put_item(Item=item, ConditionExpression="attribute_not_exists(requestId)")
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise AlreadyExists(item["requestId"]) from e
        raise


def get(request_id: str) -> dict | None:
    return _table.get_item(Key={"requestId": request_id}, ConsistentRead=True).get("Item")


def list_by_requester(requester_sub: str, limit: int = 50) -> list[dict]:
    resp = _table.query(
        IndexName=BY_REQUESTER_INDEX,
        KeyConditionExpression=Key("requesterSub").eq(requester_sub),
        ScanIndexForward=False,
        Limit=limit,
    )
    return resp["Items"]


def list_by_status(status: str, limit: int = 50) -> list[dict]:
    resp = _table.query(
        IndexName=BY_STATUS_INDEX,
        KeyConditionExpression=Key("status").eq(status),
        ScanIndexForward=False,
        Limit=limit,
    )
    return resp["Items"]


def mark_awaiting_approval(request_id: str, task_token: str, execution_arn: str, now: str) -> None:
    """PENDING -> AWAITING_APPROVAL. Fails if another execution already claimed the request."""
    try:
        _table.update_item(
            Key={"requestId": request_id},
            UpdateExpression="SET #s = :awaiting, taskToken = :t, executionArn = :e, updatedAt = :now",
            ConditionExpression="#s = :pending",
            ExpressionAttributeNames={"#s": "status"},
            ExpressionAttributeValues={
                ":awaiting": model.AWAITING_APPROVAL,
                ":pending": model.PENDING,
                ":t": task_token,
                ":e": execution_arn,
                ":now": now,
            },
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise AlreadyExists(request_id) from e
        raise
