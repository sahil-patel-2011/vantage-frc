# @vantage/db

Schema, migrations, and the two ways to reach Postgres.

## The one rule

**Every request-path query goes through `withRls`.** It opens a transaction and
sets `app.user_id` / `app.org_id` for the life of that transaction, and the
row-level security policies on every org-scoped table read those settings. That
is how one team cannot see another team's data — not a `WHERE org_id = ?` that
somebody has to remember to write.

```ts
import { withRls } from "@vantage/db";

await withRls({ userId, orgId }, async (client) => {
  const rows = await client.query(
    `SELECT id, title FROM scouting_reports WHERE org_id = $1::uuid`,
    [orgId],
  );
  return rows.rows;
});
```

`@vantage/db/admin` is the worker role. It bypasses RLS, which is correct for a
queue job that operates across teams and catastrophic anywhere a request can
reach. **Product and request code must never import it** — this is enforced by
lint, not by convention.

## Writing queries

Raw parameterised SQL against the `PoolClient` that `withRls` hands you. Not an
ORM query builder, and never string concatenation:

- `$1`, `$2`, … for every value, with an explicit cast: `$1::uuid`,
  `= ANY($3::text[])`.
- `apps/web/lib/strategy/compute-strategy.ts` and
  `apps/web/lib/impact/compute-impact.ts` are the reference shape.

## Migrations

394 files in `migrations/`, applied in numeric order, **append-only**.

- Name the next one `NNNN_slug.sql` with the next free number. Check the
  directory first; numbering is sparse, so the highest number is well above the
  file count.
- Never edit or renumber a migration that has shipped. A migration that has run
  somewhere is history.
- A new org-scoped table needs all of it: `org_id uuid NOT NULL REFERENCES
  organizations(id) ON DELETE CASCADE`, `ENABLE ROW LEVEL SECURITY`, policies
  built from `is_org_member(org_id)` / `has_org_role(org_id, ARRAY[…]::org_role[])`
  / `current_app_user_id()`, then `GRANT … TO vantage_app, vantage_worker`.
  `0024_competition_operations.sql` and `0038_community_impact.sql` are the
  patterns to copy.

`npm run db:migrate` applies them; `npm run test:db:integration` applies them
twice against a scratch database and proves the policies hold.

## Proving a policy actually works

Testing as `postgres` proves nothing — superusers bypass RLS. Connect as
`vantage_app`, set `app.user_id` / `app.org_id` with `set_config`, and put every
expected refusal inside its own `SAVEPOINT`: one correct rejection aborts the
transaction, and without a savepoint every later check then fails for the wrong
reason. `scripts/rls-proof.mjs` does this, and CI runs it.

## Hosts

Neon in production, any Postgres 16/17 for self-hosting
(`DATABASE_DRIVER=pg`, automatic for non-`neon.tech` hosts). Identity is Better
Auth over these same tables — never Supabase Auth, and never the Data API
`anon` / `service_role` keys for product data. See [`docs/NEON.md`](../../docs/NEON.md).
