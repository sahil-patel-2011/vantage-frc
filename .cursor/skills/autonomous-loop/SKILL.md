---
name: autonomous-loop
description: Repeats research, implementation, and a live check on vantagefrc.vercel.app until a Vantage task works without finicky steps, then commits and pushes only that work. Use when the user asks to keep going, run an autonomous loop, commit and push, or make a flow just work.
---

# Autonomous loop

Run the loop yourself. Do not hand the clicking back to the user.

## Each pass

1. Name the real defect in one sentence. If the requested edit would not fix it, say why and use the better method. If the outcome is unclear, ask one question and stop.
2. Read the implementation, its callers, and the comment that records a past bug. A file header is not enough. Open the matching URL on https://vantagefrc.vercel.app and use the control.
3. Change only what fixes that defect. Skip work that does not change the outcome.
4. Use it again. Confirm the obvious action works, the empty or signed-out state still has one next step, and the neighboring route still works.
5. If the result is broken or finicky, fix it and repeat this pass.

## Finicky means

- More than one step for a job the app already has the data to finish.
- A control that looks tappable and does nothing.
- A disabled action with no reason.
- A page that looks empty even though the content exists.
- Copy that names an internal system instead of the next action.

## Commit and push

After the last green pass:

- Stage explicit paths for this task only. Never `git add -A` or `git add .`.
- Leave other agents' uncommitted files unstaged, and do not restore or stash them.
- Commit with a message that says why.
- Push the current branch with `git push -u origin HEAD` when it has no upstream.
- Do not stage unrelated dirty files, secrets, or `.env` files.
- Do not force-push, skip hooks, or update git config.

Stop when the request is done and pushed, or when sign-in, a payment, or a destructive confirmation blocks you. Name that blocker.
