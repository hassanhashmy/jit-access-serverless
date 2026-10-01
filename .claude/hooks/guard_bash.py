#!/usr/bin/env python3
"""PreToolUse hook for Bash: block commands that must go through the pipeline or could cause damage.

Exit code 2 blocks the command; stderr is shown to Claude so it can take the right path instead.
"""
import json
import re
import sys

cmd = json.load(sys.stdin).get("tool_input", {}).get("command", "")

RULES = [
    (r"\bterraform\s+(apply|destroy|import|state\s+(rm|mv|push))\b",
     "Platform changes are applied by the platform.yml workflow (manual run on main), not from here. Run `terraform plan` instead."),
    (r"\bcdk\s+(deploy|destroy)\b",
     "App deploys go through pipeline.yml via GitHub OIDC after merge. Use `npx cdk synth` or `npx cdk diff` locally."),
    (r"\bgit\s+push\b.*(--force\b|\s-f\b|--force-with-lease)",
     "Force-pushing is not allowed. Push a new commit instead."),
    (r"\brm\s+-[a-z]*r[a-z]*f?\s+(/|~|\.\.?/?)(\s|$)",
     "Refusing to recursively delete a root, home or parent directory."),
    (r"\b(cat|less|head|tail|cp)\b[^|;]*\.tfstate\b",
     "Terraform state can contain sensitive values; don't read or copy it."),
]
# Pushing to main deploys to AWS, so changes go through a pull request instead.
# Only the push itself is inspected, so "gh pr create --base main" in the same command is fine.
for push in re.findall(r"\bgit\s+push\b[^;&|]*", cmd):
    import subprocess
    branch = subprocess.run(["git", "branch", "--show-current"], capture_output=True, text=True).stdout.strip()
    explicit_target = re.search(r"\bgit\s+push\s+(-\S+\s+)*\S+\s+\S+", push)
    if re.search(r"\bmain\b", push) or (branch == "main" and not explicit_target):
        print("Blocked by guard_bash: pushing to main deploys to AWS. Push a feature branch and open a PR "
              "(`gh pr create`), or ask the user to push.", file=sys.stderr)
        sys.exit(2)

for pattern, reason in RULES:
    if re.search(pattern, cmd):
        print(f"Blocked by guard_bash: {reason}", file=sys.stderr)
        sys.exit(2)

# AWS CLI: always the project profile, and read-only (incident triage and checks never change AWS).
for segment in re.split(r"&&|\|\||;|\|", cmd):
    if not re.search(r"(^|\s)aws\s+[a-z]", segment):
        continue
    if "--profile devops-showcase" not in segment and "AWS_PROFILE=devops-showcase" not in cmd:
        print("Blocked by guard_bash: AWS CLI calls must use --profile devops-showcase (never the default profile).", file=sys.stderr)
        sys.exit(2)
    m = re.search(r"\baws\s+(\S+)\s+(\S+)", segment)
    if not m:
        continue
    service, op = m.groups()
    read_only_exceptions = {"start-query", "stop-query", "simulate-principal-policy", "simulate-custom-policy", "lookup-events"}
    if service == "s3" and op in {"rm", "mv", "cp", "sync", "rb", "mb"}:
        print("Blocked by guard_bash: S3 writes are not allowed from here.", file=sys.stderr)
        sys.exit(2)
    if op not in read_only_exceptions and re.match(
        r"(delete|remove|put|create|update|terminate|attach|detach|set|tag|untag|modify|start|stop|send|invoke|redrive|purge|reset|revoke|add|import|restore|cancel|disable|enable)",
        op,
    ):
        print(f"Blocked by guard_bash: `aws {service} {op}` changes AWS. Only read-only AWS calls are allowed; "
              "propose the command to the user instead.", file=sys.stderr)
        sys.exit(2)

sys.exit(0)
