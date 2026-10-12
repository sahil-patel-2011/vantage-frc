---
name: vantage-hosted-control
description: Drives the hosted Vantage app at vantagefrc.vercel.app to inspect behavior, cover edge cases, and confirm a change did not break neighboring flows. Use when reviewing the live app, verifying a UI or routing change, or when the user asks the agent to control or test the app itself.
---

# Hosted app control

The functional app is https://vantagefrc.vercel.app. Drive it yourself in the browser. Do not hand the clicking back to the user.

## Before acting

Read the route in `docs/FEATURE_MAP.md` so you know the intended primary action, empty copy, and which hub owns the screen.

## What to exercise

- The path the user named, end to end.
- Signed-out marketing and `/signin` when the change touches entry, auth, or the public site.
- No-team and empty states when the change touches product chrome. Expect **Choose your team** or one empty-state primary, not a crash or a made-up number.
- The sibling route that shares the shell, hub tabs, or data.
- Phone and desktop widths when layout, the bottom island, or navigation changed.

## Do not

- Submit the waitlist, send a sign-in code, or change team data with an account you were not given.
- Start a local database, dev server, test runner, or build on this laptop unless the user explicitly authorizes it.
- Treat a single screenshot as a completed test.

## Report

Say which URLs you opened, what you did on each, and what still worked. If sign-in blocked a signed-in path, say that path is unverified.
