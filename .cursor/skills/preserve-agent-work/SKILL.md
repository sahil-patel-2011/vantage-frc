---
name: preserve-agent-work
description: Protects in-progress work from other agents, especially Claude, and rechecks a Vantage change before treating it as done. Use before editing this repo, when git status shows unrelated modifications, or when changing shared files such as the proxy, hubs, app shell, withRls, billing, or offline snapshots.
---

# Preserve other agents' work

Other agents have long-running uncommitted edits in this repo. A coding task includes leaving that work intact.

## Before editing

1. Run `git status --short` and `git diff --stat`.
2. Run `git log -5 --oneline` so the change sits on the current decisions, not an older guess.
3. For each file you expect to touch, if it is already modified, read `git diff -- <path>` first.
4. Choose the smallest place to edit. A new module is safer than a drive-by edit in a dirty shared file.

## While editing

- Change only the lines the task needs. Do not reformat a file, rename nearby symbols, or "fix" unrelated lint.
- If a dirty file must change, keep the other agent's hunks. Do not replace the whole file.
- Follow the comment above the code. Those comments record a bug that already happened.

## Recheck, more than once

After the edit, and again after every later fix:

1. Read the diff from first hunk to last. Stop if a deleted line is someone else's guard, copy, or test.
2. Search for callers of every changed export. Update only the callers the task requires, and read those diffs too.
3. Use the flow on https://vantagefrc.vercel.app and open one neighboring route.

Do not report done after the first pass if a later fix touched the same files. Read that diff again.

## Git

- Stage explicit paths only. Never `git add -A` or `git add .`.
- Never restore, reset, or stash a file to make the tree look clean.
- Commit and push only when the user asked for that, or when the standing loop rule applies to a finished task. The commit contains this task's paths and nothing else.

On this laptop, do not start a local database, dev server, test runner, or build unless the user explicitly authorizes that workload.
