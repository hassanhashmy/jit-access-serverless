#!/usr/bin/env python3
"""PostToolUse hook for Write/Edit/MultiEdit: format the edited file and report lint problems.

Exit code 2 sends the lint output back to Claude so it fixes the problem in the same turn.
"""
import json
import os
import pathlib
import shutil
import subprocess
import sys

root = pathlib.Path(os.environ.get("CLAUDE_PROJECT_DIR", "."))
path = pathlib.Path(json.load(sys.stdin).get("tool_input", {}).get("file_path", ""))
if not path.is_file():
    sys.exit(0)


def run(args, cwd):
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True)


problems = ""
py_root = root / "app/lambdas/python"
if path.suffix == ".py" and py_root in path.parents:
    ruff = py_root / ".venv/bin/ruff"
    ruff = str(ruff) if ruff.exists() else shutil.which("ruff")
    if ruff:
        run([ruff, "format", str(path)], py_root)
        r = run([ruff, "check", "--fix", str(path)], py_root)
        if r.returncode:
            problems = r.stdout
elif path.suffix == ".tf" and shutil.which("terraform"):
    r = run(["terraform", "fmt", str(path)], path.parent)
    if r.returncode:
        problems = r.stderr
elif path.suffix == ".ts" and (root / "app") in path.parents and (root / "app/node_modules").exists():
    r = run(["npx", "eslint", "--fix", str(path)], root / "app")
    if r.returncode:
        problems = r.stdout

if problems.strip():
    print(f"Lint problems in {path.name} (fix them before moving on):\n{problems}", file=sys.stderr)
    sys.exit(2)
sys.exit(0)
