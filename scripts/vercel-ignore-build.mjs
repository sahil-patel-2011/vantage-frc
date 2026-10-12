#!/usr/bin/env node
// Vercel ignored-build-step: exit 0 = skip, exit 1 = build.
// A quote-free script so ignoreCommand cannot crash on nested JSON/shell quoting.
// A crashed ignore step is reported as Deployment Error, not Ignored.

// Every Git push, including main, stores code only. A release builds only when the operator has
// marked that exact commit: the Vercel variable VANTAGE_RELEASE_SHA holds the full SHA being
// built. Any other commit, or no mark at all, skips, so one mark is one build.
const release = (process.env.VANTAGE_RELEASE_SHA ?? "").trim().toLowerCase();
const commit = (process.env.VERCEL_GIT_COMMIT_SHA ?? "").trim().toLowerCase();
const marked = /^[0-9a-f]{40}$/.test(release) && release === commit;
process.exit(marked ? 1 : 0);
