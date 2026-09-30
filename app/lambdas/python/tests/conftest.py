import json
import os
from dataclasses import dataclass

import boto3
import pytest

os.environ.update(
    AWS_DEFAULT_REGION="eu-west-2",
    AWS_ACCESS_KEY_ID="testing",
    AWS_SECRET_ACCESS_KEY="testing",
    TABLE_NAME="jit-access-requests-test",
    POWERTOOLS_SERVICE_NAME="jit-access",
    POWERTOOLS_METRICS_NAMESPACE="JitAccessTest",
    POWERTOOLS_DEV="false",
)

from moto import mock_aws  # noqa: E402

# Start the mock before any handler module creates its boto3 clients at import time.
_mock = mock_aws()
_mock.start()


@dataclass
class FakeContext:
    function_name: str = "test-fn"
    memory_limit_in_mb: int = 256
    invoked_function_arn: str = "arn:aws:lambda:eu-west-2:123456789012:function:test-fn"
    aws_request_id: str = "req-123"


@pytest.fixture
def ctx():
    return FakeContext()


@pytest.fixture(autouse=True)
def table():
    ddb = boto3.resource("dynamodb")
    t = ddb.create_table(
        TableName=os.environ["TABLE_NAME"],
        BillingMode="PAY_PER_REQUEST",
        KeySchema=[{"AttributeName": "requestId", "KeyType": "HASH"}],
        AttributeDefinitions=[
            {"AttributeName": "requestId", "AttributeType": "S"},
            {"AttributeName": "requesterSub", "AttributeType": "S"},
            {"AttributeName": "status", "AttributeType": "S"},
            {"AttributeName": "createdAt", "AttributeType": "S"},
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "byRequester",
                "KeySchema": [
                    {"AttributeName": "requesterSub", "KeyType": "HASH"},
                    {"AttributeName": "createdAt", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
            {
                "IndexName": "byStatus",
                "KeySchema": [
                    {"AttributeName": "status", "KeyType": "HASH"},
                    {"AttributeName": "createdAt", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            },
        ],
    )
    yield t
    t.delete()


ALICE = {"sub": "sub-alice", "username": "alice", "groups": "[requesters]"}
BOB = {"sub": "sub-bob", "username": "bob", "groups": "[approvers]"}
CAROL = {"sub": "sub-carol", "username": "carol", "groups": "[approvers requesters]"}


def http_event(user, body=None, headers=None, path=None, query=None):
    return {
        "version": "2.0",
        "headers": headers or {},
        "pathParameters": path,
        "queryStringParameters": query,
        "body": json.dumps(body) if body is not None else None,
        "requestContext": {
            "requestId": "corr-abc",
            "authorizer": {
                "jwt": {
                    "claims": {"sub": user["sub"], "username": user["username"], "cognito:groups": user["groups"]},
                    "scopes": ["jit-api/requests.write"],
                }
            },
        },
    }


def seed(table, **overrides):
    item = {
        "requestId": "req-1",
        "requesterSub": ALICE["sub"],
        "requesterUsername": "alice",
        "role": "prod-logs-read",
        "durationMinutes": 60,
        "reason": "INC-42 investigating 5xx",
        "status": "AWAITING_APPROVAL",
        "createdAt": "2026-10-01T09:00:00Z",
        "updatedAt": "2026-10-01T09:00:00Z",
        "taskToken": "secret-task-token",
    }
    item.update(overrides)
    table.put_item(Item=item)
    return item
