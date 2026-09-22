# Vantage and Scouting: two products, one ecosystem

*Last reviewed September 2026.*

Vantage is two products that share one system.

| | **Vantage** | **Scouting** |
|---|---|---|
| Address | `vantagefrc.vercel.app` | `vantagefrc-scouting.vercel.app` |
| What it is for | Running the team: calendar, tasks, chat, build, CAD, code, money, outreach, AI | Competition: fast match and pit entry, team lookup, match prediction, the pick list |
| Navigation | Home, the four workspaces (Team, Build, Competition, Business), search | Five tabs: Home, Scout, Teams, Predict, Pick list — and "Back to Vantage" |
| Who lives in it | Everyone, all season | Scouters, the strategy lead and the drive coach, mostly at events |

The relationship is the one between a file drive and a document editor from the same company. Each
has its own front door and its own navigation, so each can stay focused. Both know who you are,
which team you are on and what you are allowed to see. And you can go from one to the other without
signing in again.

## What is shared, and what is not

**Shared: all of it except the front door.**

- **One deployment.** Both products are served by the same Next.js app (`apps/web`). The Scouting
  pages live under `/scout` and reuse the same feature components that Vantage uses: `/scout/teams`
  is the Research team lookup, `/scout/predict` is the Match Simulator, `/scout/picklist` is the
  collaborative pick list and `/scout/entry` is offline scouting. Every feature has one
  implementation. A fix in one product is a fix in both.
- **One database.** The same Postgres rows under the same row-level security. A scout entry saved in
  Scouting is in Vantage's command center, briefing and pick list on the next read. There is no
  sync between products, because there is nothing to sync.
- **One identity.** The same Better Auth users, sessions, team memberships and roles. Permissions are
  enforced by the same server routes and database policies whichever host a request arrives on.
- **One design system.** The same tokens, components and product stylesheets, so the two products
  read as one family.

**Not shared: the hostname, the frame and the navigation.**

- The Scouting host serves only `/scout/*`, plus sign-in, invites, onboarding, legal pages and every
  `/api/*` route. A request there for a Vantage page (say `/budget`) is redirected to the same page on
  the Vantage host. Links to a feature that Scouting also has (`/intel`, `/match-sim`,
  `/picklist-collab`, `/scouting`) land on Scouting's copy instead. See
  `apps/web/lib/products/products.ts`.
- `/scout/*` renders inside `ScoutingShell` (`apps/web/app/scout/`), not Vantage's app shell.
- The Vantage host serves everything, `/scout` included. A link that never learned about the split
  still works.

## Signing in once across two hosts

Browsers will not share a cookie between two `*.vercel.app` addresses. `vercel.app` is on the
[Public Suffix List](https://publicsuffix.org/list/), which makes every project address a separate
site, by design. So "Open Scouting" hands the signed-in person across instead.

1. **Vantage host.** `GET /api/handoff/start?to=scouting&path=/scout/teams` (signed in) generates 32
   random bytes and stores only their SHA-256, through `create_product_handoff()` (migration 0670).
   The token is bound to this user, the destination host and the destination path, and it is valid
   for **60 seconds**. The browser is sent to the Scouting host with the token in the URL, with
   `Referrer-Policy: no-referrer`.
2. **Scouting host.** `GET /api/handoff/accept?token=…` calls `consume_product_handoff(hash, host)`.
   That is a single atomic `UPDATE … WHERE used_at IS NULL AND expires_at > now() AND target_host = host`,
   so a replayed, forwarded, expired or wrong-host link redeems nothing and gets the normal sign-in
   page.
3. **New session.** The Scouting host then creates its own Better Auth session for that user,
   through a server-only plugin endpoint (`packages/core/src/product-handoff-plugin.ts`, the same
   pattern as the desktop link). The endpoint has no HTTP route, so it cannot be called from outside.
4. **Same standing.** The new session inherits the original session's sign-in method and
   second-factor time. A team that allows only Google sign-in, or requires the emailed code, sees
   exactly the same standing on both hosts: no weaker, no stronger.

The handoff table has row-level security forced on, no policies and no table grants. It can only be
reached through those two functions, and the auth role may only call `consume_…`.

**On a custom domain this hop disappears.** Put Vantage at `vantagefrc.com` and Scouting at
`scouting.vantagefrc.com`, set the two origins below, and the session cookie can be scoped to the
parent domain. The handoff code stays and becomes unnecessary; nothing else changes. A domain costs
about $10–15 a year and is the recommended next step. See [CUSTOM_DOMAIN.md](CUSTOM_DOMAIN.md).

## Why not `scouting.vantagefrc.vercel.app`

It was the first address proposed, and it cannot exist. Vercel issues one level of subdomain under
`vercel.app` per project; nested subdomains and wildcards are only available on a custom domain
([Vercel: wildcard domains](https://vercel.com/blog/wildcard-domains),
[working with domains](https://vercel.com/docs/domains/working-with-domains)). The Scouting product
therefore uses the sibling address `vantagefrc-scouting.vercel.app` until a custom domain is
attached.

## Configuration

| Variable | Production value | Notes |
|---|---|---|
| `NEXT_PUBLIC_VANTAGE_ORIGIN` | `https://vantagefrc.vercel.app` | The Vantage product's origin |
| `NEXT_PUBLIC_SCOUTING_ORIGIN` | `https://vantagefrc-scouting.vercel.app` | The Scouting product's origin. Unset means Scouting lives at `/scout` on one host with no handoff |

Both are also added to Better Auth's trusted origins, so sign-out and other `/api/auth` requests
work from either host. The Scouting address must be attached to the same Vercel project as a domain.

Local development uses two names for the same server: `localhost:3401` is Vantage and
`127.0.0.1:3401` is Scouting. Browsers treat these as different sites, so the handoff is exercised
for real. `allowedDevOrigins` lets the dev server serve its scripts to `127.0.0.1`.

## Offline and device storage

Scouting keeps unsynced entries, photos and cached event data in IndexedDB (`lib/scout-offline.ts`).
Browsers treat that as best-effort storage and may clear it under pressure. Scouting's home shows
what this device holds and how much room is left (`navigator.storage.estimate()`), and offers **Keep
scouting data on this device**, which calls `navigator.storage.persist()`. Once granted, the browser
keeps the data until the person clears it. Chromium browsers usually allow several gigabytes per
site.

## Files

| Path | What it is |
|---|---|
| `apps/web/lib/products/products.ts` | Which host is which product, host routing, and cross-product links |
| `apps/web/lib/products/handoff.ts` | Handoff token minting, hashing and redemption |
| `apps/web/app/api/handoff/{start,accept}/route.ts` | The two halves of the handoff |
| `packages/core/src/product-handoff-plugin.ts` | Server-only session minting |
| `packages/db/migrations/0670_product_handoffs.sql` | Handoff storage and its two functions |
| `apps/web/app/scout/` | The Scouting product: frame, home, and the reused feature routes |
| `apps/web/proxy.ts` | Applies the host routing before authentication |
