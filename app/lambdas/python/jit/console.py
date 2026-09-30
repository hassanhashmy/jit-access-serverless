"""Turn temporary STS credentials into a one-time AWS console sign-in URL (custom identity broker).

https://docs.aws.amazon.com/IAM/latest/UserGuide/id_roles_providers_enable-console-custom-url.html
The sign-in token is valid for 15 minutes and works once. Treat the URL like a password: return it
only to the requester and never log it.
"""

from __future__ import annotations

import json
import urllib.parse
import urllib.request

FEDERATION_ENDPOINT = "https://signin.aws.amazon.com/federation"


def _get_signin_token(credentials: dict) -> str:
    session = json.dumps(
        {
            "sessionId": credentials["AccessKeyId"],
            "sessionKey": credentials["SecretAccessKey"],
            "sessionToken": credentials["SessionToken"],
        }
    )
    # No SessionDuration: these are role-chained credentials, so the console session simply
    # lasts as long as the credentials do.
    query = urllib.parse.urlencode({"Action": "getSigninToken", "Session": session})
    with urllib.request.urlopen(f"{FEDERATION_ENDPOINT}?{query}", timeout=5) as resp:  # noqa: S310 - fixed AWS https endpoint
        return json.loads(resp.read())["SigninToken"]


def signin_url(credentials: dict, destination: str, issuer: str) -> str:
    query = urllib.parse.urlencode(
        {
            "Action": "login",
            "Issuer": issuer,
            "Destination": destination,
            "SigninToken": _get_signin_token(credentials),
        }
    )
    return f"{FEDERATION_ENDPOINT}?{query}"
