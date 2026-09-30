#!/usr/bin/env python3
"""PreToolUse hook for Write/Edit/MultiEdit: never write credentials or secret files into the repo."""
import json
import re
import sys

data = json.load(sys.stdin).get("tool_input", {})
path = data.get("file_path", "")
texts = [data.get("content", ""), data.get("new_string", "")]
texts += [e.get("new_string", "") for e in data.get("edits", []) or []]
text = "\n".join(t for t in texts if t)

if re.search(r"(^|/)\.env(\.|$)|\.pem$|\.tfstate(\.|$)|(^|/)credentials$", path):
    print(f"Blocked by guard_secrets: {path} is a secrets or state file and must not be written.", file=sys.stderr)
    sys.exit(2)

PATTERNS = {
    "AWS access key ID": r"\b(AKIA|ASIA)[0-9A-Z]{16}\b",
    "AWS secret access key": r"(?i)aws_secret_access_key\s*[=:]\s*\S{20,}",
    "private key": r"-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    "GitHub token": r"\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b",
}
for name, pattern in PATTERNS.items():
    if re.search(pattern, text):
        print(f"Blocked by guard_secrets: the change contains what looks like a {name}. "
              "Credentials never go in the repo; this project uses OIDC and temporary credentials.", file=sys.stderr)
        sys.exit(2)
sys.exit(0)
