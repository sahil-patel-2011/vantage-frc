#!/usr/bin/env node
// Vercel ignored-build-step: exit 0 = skip, exit 1 = build.
// A quote-free script so ignoreCommand cannot crash on nested JSON/shell quoting.
// A crashed ignore step is reported as Deployment Error, not Ignored.

// Every Git push, including main, stores code only. An intentional release uses
// a manual deployment after the operator checks the remaining free allowance.
process.exit(0);
