---
name: finish-and-verify
description: Completes a Vantage task through research, implementation, functional checks, and regression checks before reporting it done. Use when the user asks for a feature, fix, UI change, or any task that should be finished and tested, including requests to keep going until the work is done.
---

# Finish and verify

Do not report the task done while any requested part is unfinished or unchecked.

## Sequence

1. Name the real defect and the observable result that means it is fixed. If the request would miss that, say so and use the better method. If the outcome is unclear, ask one question and stop.
2. Read the implementation, its callers, and the comment that records why it exists. Then read `docs/FEATURE_MAP.md` and the live page on https://vantagefrc.vercel.app. A header is not this step.
3. Do the work. Leave unrelated code alone.
4. Prove the changed flow in the browser: open it, use it, and confirm the result.
5. Open every neighboring route that shares the changed component, state, or data.
6. If a check fails, fix it and repeat that check.
7. Report what works, what you opened, and any path you could not reach.

## Proof

A rendered screenshot is not proof. Confirm the action: a control responds, a form submits or correctly refuses, navigation lands on the right screen, and empty or error copy is the real product copy.

On this laptop, use the hosted app. Do not start a local database, dev server, test runner, or build unless the user explicitly authorizes that workload.

## When to stop

Stop when the outcomes are true, or when you are blocked. A blocker is an unclear outcome, sign-in you do not have, a payment, a destructive confirmation, or a missing credential. Ask one question or name the single next step. Do not ask about a choice the code or the request already settles.
