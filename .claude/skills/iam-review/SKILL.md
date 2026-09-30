---
name: iam-review
description: Review IAM, trust-policy and permission-boundary changes for privilege escalation and least-privilege problems. Use before committing any change under platform/, app/lib/ IAM grants, or .github/workflows/.
allowed-tools: Read, Grep, Glob, Bash(git diff *), Bash(git log *), Bash(npx cdk synth *), Bash(terraform validate *), Bash(terraform plan *)
---

# IAM review

1. Collect the change: `git diff main...HEAD -- platform app/lib .github/workflows` (or the working tree diff).
2. For CDK changes, synthesise and list the new statements:
   ```bash
   cd app && npx cdk synth --quiet && python3 -c "
   import json; t=json.load(open('cdk.out/JitAccess.template.json'))['Resources']
   for k,v in t.items():
       if v['Type']=='AWS::IAM::Policy':
           for s in v['Properties']['PolicyDocument']['Statement']: print(k, s.get('Effect'), s.get('Action'), s.get('Resource'))"
   ```
3. Check every item in `.claude/rules/iam-security.md`, plus:
   - wildcards in actions or resources that the API could scope,
   - new `iam:*`, `sts:AssumeRole`, `iam:PassRole` or `iam:Put*Policy` anywhere,
   - trust-policy changes: principal, `aud`, `sub`, `job_workflow_ref`, `StringLike` vs `StringEquals`,
   - a role without the permission boundary, or anything that could detach or edit a boundary,
   - new explicit denies that are broader than intended,
   - workflow changes that add `id-token: write` to a job reachable from pull requests.
4. Report findings as a table: **severity** (block / fix / note), **where** (file:line), **what could go wrong**
   (a concrete escalation or failure scenario), **fix**. If nothing is wrong, say which checks were run.
   Don't modify files during the review.
