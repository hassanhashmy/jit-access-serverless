"""HTTP API (payload v2) helpers: responses, body parsing and error mapping."""

from __future__ import annotations

import functools
import json
from datetime import datetime, timezone
from decimal import Decimal

from aws_lambda_powertools import Logger

from jit.errors import ApiError, BadRequest

logger = Logger()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _default(value):
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    raise TypeError(f"not JSON serialisable: {type(value).__name__}")


def response(status: int, body: dict | list) -> dict:
    return {
        "statusCode": status,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(body, default=_default),
    }


def json_body(event: dict) -> dict:
    raw = event.get("body") or "{}"
    try:
        body = json.loads(raw)
    except json.JSONDecodeError as e:
        raise BadRequest("body must be valid JSON") from e
    if not isinstance(body, dict):
        raise BadRequest("body must be a JSON object")
    return body


def api_handler(fn):
    """Turn ApiError subclasses into 4xx responses; anything else is a logged 500 without internals."""

    @functools.wraps(fn)
    def wrapper(event, context):
        try:
            return fn(event, context)
        except ApiError as e:
            logger.warning("request rejected", extra={"status": e.status, "error": e.message})
            return response(e.status, {"message": e.message})
        except Exception:
            logger.exception("unhandled error")
            return response(500, {"message": "internal error"})

    return wrapper
