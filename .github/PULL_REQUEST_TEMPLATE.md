## What

<!-- One paragraph. Link the issue if there is one. -->

## How to verify

```sh
npm test
npm run typecheck
```

<!-- Name the commands you actually ran. UI changes need a real click-through, not a screenshot. -->

## Checks

- [ ] No secrets in the diff (`.env*` stays gitignored except `.env.example`)
- [ ] No invented metrics / demo scores
- [ ] Request DB still goes through `withRls`; no new `@vantage/db/admin` import on a request path
- [ ] New org-scoped SQL is parameterized (`$1`, `$2`, …)
- [ ] New migrations (if any) are append-only with the next free `NNNN_` prefix
