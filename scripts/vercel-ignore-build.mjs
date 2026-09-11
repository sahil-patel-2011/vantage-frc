#!/usr/bin/env node
// Vercel ignored-build-step: exit 0 = skip, exit 1 = build.
// A quote-free script so ignoreCommand cannot crash on nested JSON/shell quoting.
// A crashed ignore step is reported as Deployment Error, not Ignored.

const ref = process.env.VERCEL_GIT_COMMIT_REF ?? "";
process.exit(ref === "main" ? 1 : 0);
