"""GET /requests?view=mine|pending: the caller's own requests, or the approval queue for approvers."""

from __future__ import annotations

from aws_lambda_powertools import Logger
from aws_lambda_powertools.logging import correlation_paths

from jit import authz, model, repo
from jit.errors import BadRequest
from jit.http import api_handler, response

logger = Logger()


@logger.inject_lambda_context(correlation_id_path=correlation_paths.API_GATEWAY_HTTP)
@api_handler
def handler(event, context):
    caller = authz.caller_from_event(event)
    view = (event.get("queryStringParameters") or {}).get("view", "mine")

    if view == "mine":
        items = repo.list_by_requester(caller.sub)
    elif view == "pending":
        authz.require_approver(caller)
        items = repo.list_by_status(model.AWAITING_APPROVAL)
    else:
        raise BadRequest("view must be 'mine' or 'pending'")

    return response(200, {"items": [model.public_view(i) for i in items]})
