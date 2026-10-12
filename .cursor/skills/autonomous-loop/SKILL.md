---
name: autonomous-loop
description: Repeats research, implementation, and a live check on vantagefrc.vercel.app until a Vantage task works without finicky steps, then commits and pushes only that work. Use when the user asks to keep going, run an autonomous loop, commit and push, or make a flow just work.
---

# Autonomous loop

Run the loop yourself. Do not hand the clicking back to the user.

## Each pass

1. Read the owning code and `docs/FEATURE_MAP.md`.
2. Open the matching URL on https://vantagefrc.vercel.app and use the control a person would use.
3. Change only what the request needs.
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

- Stage only the files changed for this task.
- Commit with a message that says why.
- Push the current branch with `git push -u origin HEAD` when it has no upstream.
- Do not stage unrelated dirty files, secrets, or `.env` files.
- Do not force-push, skip hooks, or update git config.

Stop when the request is done and pushed, or when sign-in, a payment, or a destructive confirmation blocks you. Name that blocker.
