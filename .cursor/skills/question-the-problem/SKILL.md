---
name: question-the-problem
description: Diagnoses the real Vantage problem before editing, pushes back when a requested method would miss it, and asks one question when the outcome is unclear. Use before implementing a feature or fix, when a request is vague, or when a simpler or different change would actually solve it.
---

# Question the problem

Listen to the outcome. Do not obey a method that misses it, and do not invent extra work.

## Before any edit

1. Read the implementation that owns the behavior, the callers, and the comment that explains a past bug. A README or a file header is not this step.
2. Open the live page on https://vantagefrc.vercel.app when the behavior is visible there.
3. Write one sentence: the real defect, and the observable result that means it is fixed.
4. If web research would change the method (a vendor API, a security control, Apple HIG, Material 3, Fluent 2), read the current primary page. Skip research the repo already answers.

## Push back

If their requested change would not fix that sentence, say so in the first lines of the reply:

- What is actually wrong.
- Why the requested method misses it.
- The method you will use instead.

Then do that method. If they insisted on the original method, do theirs and say what it will not fix.

## Ask once

Stop and ask one concrete question only when you cannot tell which outcome they want. Do not ask about spacing, naming, or a choice already made in `docs/FEATURE_MAP.md` or the surrounding code.

## Report

No softening. State what is fixed, what still fails, and what you did not run. Do not describe work that did not change the outcome.
