# Security

## Report a vulnerability

Email **sahiljpatel2011@gmail.com**. Do **not** open a public GitHub issue for:

- leaked connection strings, API keys, or session tokens
- tenancy / RLS bypasses (Team A reading Team B)
- auth, invite, or MFA bugs

We will not publish a bounty table we cannot honor.

## What this project actually enforces

- Identity is **Better Auth**, not Supabase Auth and not Neon Auth.
- Product data lives in **Postgres**. Request code uses `withRls` (`SET LOCAL
  app.user_id` / `app.org_id`). Workers use `vantage_worker` via `@vantage/db/admin`.
- Org-scoped tables have `org_id` plus RLS policies (`is_org_member` /
  `has_org_role`). That is the security model, not an application-layer filter.
- `.env*` is gitignored except `.env.example`. Never commit real Neon URLs.

Operational detail: [`SECURITY_OPERATIONS.md`](SECURITY_OPERATIONS.md).
Hosted Postgres path: [`docs/NEON.md`](docs/NEON.md).
