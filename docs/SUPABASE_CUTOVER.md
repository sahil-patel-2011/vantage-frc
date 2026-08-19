# Supabase cutover (Postgres host only)

Vantage can run on **Supabase Postgres** the same way it runs on Neon: one database, **org-scoped RLS**, Better Auth sessions. This is a host switch, not a product rewrite.

## What does not change

- **Better Auth** stays the identity system. Do not turn on Supabase Auth for product users.
- **`withRls`** still sets `app.user_id` / `app.org_id` inside a transaction. Team A cannot read Team B.
- Product code still uses parameterized SQL through `vantage_app`. Workers still use `vantage_worker`.
- **Do not** put `NEXT_PUBLIC_SUPABASE_ANON_KEY` or `service_role` in the web app. The Data API must stay off for `public`.

## Team isolation

Every org-scoped table has `org_id` + RLS (`is_org_member` / `has_org_role`). AI chats, team memory, and artifacts are per workspace. Private AI threads export only for the requesting user (`/exports` → My private AI data).

## AI takeout (still private)

Owners/admins: **Exports** → Team-shared → **Select this team's AI takeout** → ZIP.

Members: **My private AI data** → **Select my AI takeout**.

Excluded: API keys, BYO envelopes, sessions, invite tokens, other orgs.

## Cutover steps (empty Supabase project)

1. In the SQL editor, run `packages/db/supabase/00_roles.sql`. Set LOGIN passwords for `vantage_app` and `vantage_worker`.
2. **Project Settings → Data API**: disable or leave unused. Migration `0432` revokes `anon` / `authenticated` on `public` if those roles exist.
3. `DATABASE_ADMIN_URL` = direct session URI as `vantage_worker` (port **5432**). Run `npm run db:migrate`.
4. `DATABASE_URL` / `DATABASE_AUTH_URL` = pooler URI as `vantage_app` (port **6543** is OK because `withRls` holds one client for `BEGIN`…`COMMIT`).
5. `node scripts/map-supabase-env.mjs` writes `.env.migrate.local`. Do **not** pass `--vercel` until you are ready to cut over production (`SUPABASE_CUTOVER_CONFIRM=I_UNDERSTAND`). Map the same aliases in the Vercel dashboard yourself if you prefer.
6. If the Vercel Supabase integration injects `POSTGRES_URL` / `POSTGRES_URL_NON_POOLING`, the app already falls back to those. Still set `DATABASE_*` aliases so workers, auth, and billing keep least-privilege roles.
7. Optional: `DATABASE_DRIVER=pg` (auto-detected for `*.supabase.co` hosts).

## Vercel integration keys to ignore

The Supabase Vercel integration often adds `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. **Leave them unused.** Product code must not import `@supabase/supabase-js` for tenancy. Better Auth + `withRls` stay the identity and isolation model.

## Do not

- Connect the app as the `postgres` superuser (bypasses RLS). Run `00_roles.sql` and switch to `vantage_app` / `vantage_worker` before going live.
- Use Supabase Storage/Auth as a second tenant model.
- Share one “AI project” across FRC teams — memory and threads are org-scoped on purpose.
- Cut over production from Neon in a drive-by change. This doc is the host-switch runbook; stay on the current Neon URLs until you deliberately migrate.
