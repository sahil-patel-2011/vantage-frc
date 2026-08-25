# Finance Data Security

Reviewed statement of how team money data is protected in Vantage. Every claim below was verified by
reading the cited migration or source file on 2026-08-23 (branch `cursor/simplify-team-hub`). This
document favors accuracy over reassurance: gaps and findings are listed alongside the protections.

## Scope

Money-bearing tables and the code that reads/writes them:

| Table | Migration | Money columns |
| --- | --- | --- |
| `finance_categories`, `finance_budget_plans` | `0035_team_finance_sponsors.sql` | `monthly_limit_usd`, `total_limit_usd` |
| `sponsors`, `sponsor_contacts`, `sponsor_contributions`, `sponsor_interactions`, `sponsor_prospects` | `0035` | `amount_usd`, `estimated_value_usd` |
| `purchase_requests` | `0035` | `unit_cost_usd`, `total_cost_usd` |
| `finance_transactions` | `0035` | `amount_usd` (`CHECK >= 0`) |
| `finance_audit_log` | `0035` | `before`/`after` jsonb snapshots |
| `grant_opportunities`, `grant_applications`, … | `0036_grants_awards_outreach.sql` | `amount_requested_usd`, `amount_awarded_usd` |
| `season_budgets`, `season_costs` | `0070_season_budget.sql` | `amount_usd` |
| `fundraiser_events` | `0070_fundraiser_events.sql` | `goal_usd`, `proceeds_usd` |
| `vendors` | `0126_vendors.sql` | none, but see Finding F2 |
| `finance_funding_sources`, `finance_purchase_log` | `0434_season_finance_desk.sql` | `planned_usd`, `received_usd`, `amount_usd` |

## 1. Tenant isolation (RLS) — verified table by table

Row Level Security is the security model, not a convenience. Product code reaches the database only
through `withRls({ userId, orgId? }, …)` (`packages/db`), which runs as the `vantage_app` role with
`SET LOCAL app.user_id` / `app.org_id`; policies then decide row visibility.

Verified: **every table in `0035_team_finance_sponsors.sql` has `ENABLE ROW LEVEL SECURITY` plus
policies** (lines 164–227): all ten tables (`finance_categories`, `finance_budget_plans`, `sponsors`,
`sponsor_contacts`, `sponsor_contributions`, `sponsor_interactions`, `sponsor_prospects`,
`purchase_requests`, `finance_transactions`, `finance_audit_log`) get a `*_member_read` SELECT policy
gated on `is_org_member(org_id)` and write policies gated on
`has_org_role(org_id, ARRAY['owner','admin']::org_role[])` (purchase requests additionally allow
member self-insert/self-edit of pending rows via `current_app_user_id()`).

Also verified RLS-enabled with org-scoped policies:

- `finance_funding_sources`, `finance_purchase_log` — `0434` lines 67–101.
- `fundraiser_events` — `0070_fundraiser_events.sql` lines 24–31.
- `season_budgets`, `season_costs` — `0070_season_budget.sql` (both `ENABLE ROW LEVEL SECURITY`,
  member policies at lines 46–52).
- `grant_*`, `award_*`, `outreach_messages` — `0036` (6 `ENABLE ROW LEVEL SECURITY` statements,
  e.g. `grant_applications_member_read` / `grant_applications_admin_write` at lines 122–123).
- `vendors` — `0126` (RLS enabled, member read/write policies).

**No finance table was found lacking RLS.** All finance tables use
`org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`, so cross-org reads return
zero rows even if a caller guesses another org's UUIDs, and rows die with the org.

`finance_audit_log` is effectively **append-only for the app role**: it has only a SELECT policy and
an INSERT policy (`0035` lines 225–227). RLS default-denies UPDATE/DELETE despite the broad `GRANT`,
so audit rows cannot be edited or removed through the product role.

Role notes (`0001_roles_and_rls.sql`): `vantage_app` is `NOLOGIN` with per-table policies;
`vantage_worker` is `NOLOGIN BYPASSRLS` and is reserved for queue/worker jobs. Request code cannot
import the worker client — `@vantage/db/admin` is blocked by `no-restricted-imports` in
`eslint.config.mjs` (line 52).

## 2. Route-level gating — verified

- Every non-public route is session-protected by `apps/web/proxy.ts` (Better Auth); finance API
  routes additionally call `auth.api.getSession` / `requireTenantSession` and return 401 without a
  session.
- Read convention for money data: **any org member** may read, matching the `*_member_read` RLS
  policies. Routes make wrong-org access an explicit 403 instead of an empty 200 via
  `requireOrgMember` (`apps/web/lib/tenant-org-access.ts`), e.g. `apps/web/app/api/finance/summary/route.ts`.
  The new `GET /api/finance/balance` (`apps/web/app/api/finance/balance/route.ts`) follows the same
  convention: session → `withRls({userId, orgId})` → `requireOrgMember` → parameterized reads, and
  degrades to `{status:"setup_required"}` (HTTP 200) when the database is unreachable.
- Write convention: owner/admin enforced twice — in route code
  (`apps/web/app/api/business/finance/route.ts` line 69 checks the membership role before any write)
  and independently by the DB policies above, so a route bug alone cannot cross the role boundary.
- Sponsor surfaces additionally honor the org funding profile via `requireSponsorsMember` /
  `assertSponsorsAllowed` (`apps/web/lib/tenant-org-access.ts`; `organizations.sponsors_allowed`).
- All finance SQL in reviewed routes is parameterized (`$1::uuid`, `= ANY(...)`); no string-built
  SQL was found in the finance paths.

## 3. Derived balances — no denormalized money

There is no stored "balance" column anywhere. The real-money balance
(`apps/web/lib/finance/balance.ts`) and the season rollup
(`apps/web/lib/business/compute-season-finance.ts`) recompute totals on every read from recorded
rows only, under the caller's RLS context, with explicit double-count guards (ledger rows linked to
a sponsor contribution or purchase request are not counted twice). Empty datasets produce honest
empty states — never fabricated numbers.

## 4. Audit log coverage — partial (see Gap G2)

`finance_audit_log` inserts were found in exactly two write paths:

- `apps/web/app/api/finance/budget/route.ts` (line 77) — budget plan changes.
- `apps/web/app/api/finance/purchase-requests/route.ts` (line 149) — purchase-request transitions.

Both record `actor_user_id`, `action`, and `before`/`after` jsonb. Platform-admin actions are
audited separately via `@vantage/core` admin-audit helpers.

## 5. No card or bank numbers stored — verified, one finding

- Grep across `packages/db/migrations` and `apps/web` found **no card number, CVV, IBAN, routing or
  bank-account columns on any finance table**. `0434` states the invariant in its header comment
  ("Never stores card/bank numbers") and only stores a `receipt_url` constrained to `http(s)`.
- Defense in depth: every `/api/business/finance` write body passes through
  `sanitizeFinanceWriteBody` (`apps/web/lib/finance/sanitize-write.ts`), which deletes payment
  credential fields (`cardNumber`, `cvv`, `routing_number`, `iban`, `pan`, `ssn`, …) including
  normalized-key variants, and redacts PAN/routing-like digit patterns from free-text fields before
  they reach SQL.
- Stripe billing (platform subscriptions) keeps card data with Stripe; Vantage stores only Stripe
  identifiers (`packages/billing`).

**Finding F2 — `vendors.account_number` (`0126_vendors.sql` line 18):** the vendor directory stores
an optional plain-text `account_number` (a team's account reference with a supplier, written via
`apps/web/lib/vendors/compute-vendors.ts`). It is org-RLS-protected and member-readable, but it is a
free-text field a team could paste a real bank/card number into, and it is not encrypted or pattern
redacted. Recommend routing vendor writes through the same redaction as finance writes, or
documenting it as "supplier reference only".

## 6. Encryption

- **Provider/BYO AI keys** are envelope-encrypted: AES-256-GCM with a per-secret data key that is
  itself wrapped by KMS (`encryptSecret`/`decryptSecret`, `packages/billing/src/index.ts` lines
  838–871; ciphertext + `encrypted_dek` + `kms_key_id` columns in `0006`/`0007`/`0013`). The
  dev-only `LocalKmsService` throws `"LocalKmsService is forbidden in production"` (line 806).
- **Money amounts are NOT field-level encrypted.** `amount_usd` and friends are plain `numeric`
  columns. Protection is RLS + TLS in transit + the Postgres host's at-rest encryption
  (Neon today; Supabase Postgres-host cutover per `docs/SUPABASE_CUTOVER.md` keeps Better Auth +
  `withRls` and never uses the Data API `anon`/`service_role` keys).

## Findings and gaps (not fixed here — reported for follow-up)

- **F1 — `0035` grants omit `vantage_worker`:** the `GRANT` block (`0035` lines 229–231) grants only
  to `vantage_app`, deviating from the repo convention (`GRANT … TO vantage_app, vantage_worker`).
  Later `0040_team_business_portal.sql` (lines 101–106) backfills worker grants for most of these
  tables, but **not `finance_audit_log`** — worker jobs cannot write audit rows. Possibly
  intentional; worth an explicit decision.
- **F2 — `vendors.account_number`** stored in plain text (details in section 5).
- **G1 — no field-level encryption of amounts** (section 6). Acceptable under the current threat
  model (RLS + host encryption), but a platform-DB compromise exposes amounts in the clear.
- **G2 — audit coverage is partial:** season-finance-desk writes (`finance_funding_sources`,
  `finance_purchase_log` via `/api/business/finance`), sponsor contributions, fundraiser proceeds,
  and season costs do **not** write `finance_audit_log` rows; only budget plans and purchase
  requests do. Deletes on the desk are hard deletes with no audit trail.
- **G3 — `vantage_worker` is `BYPASSRLS`:** any code running as the worker role sees all orgs'
  finance rows. Mitigated by the lint ban on `@vantage/db/admin` in request code and worker-only
  usage, but the role remains the platform's widest data path.
- **O1 — duplicate migration numbers exist** (e.g. two `0070_*.sql` files, and ~24 duplicated
  prefixes). Migrations run in numeric order; duplicated numbers make ordering
  filename-dependent — an operational (not confidentiality) risk noted while auditing.
