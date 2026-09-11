# Security

*For operators running a deployment, contributors touching auth or data access, and anyone who has
found a problem. Last reviewed September 2026.*

## Reporting a vulnerability

Email **sahiljpatel2011@gmail.com** with the details. Please do not open a public issue for anything
that could expose a team's data. You will get a reply, and a fix or an explanation, as fast as one
person can manage. Many Vantage users are minors; treat any data exposure as serious.

## The security model in one paragraph

Every team's data is isolated **by the database**, not by the application. Each request runs inside a
Postgres transaction that carries the signed-in user's id and their active team's id, and row-level
security policies on every team-scoped table use those two values to decide what the query can see.
Application bugs therefore cannot leak one team's rows to another. The application role has no way
to bypass this; only background workers run as a role that does, and product code is lint-blocked
from using it. The proof is `scripts/rls-proof.mjs`, which connects as a non-superuser and asserts
cross-team reads return nothing; CI runs it against a fresh database on every change.

## Accounts and sign-in

- Identity is global; **membership in a team is by invitation only**. A platform administrator
  creates each team and its owner; owners and admins invite exact email addresses. Everyone else who
  signs up joins the waitlist, and waitlist rows never become product users.
- Sign-in methods are password, Google, and a numeric email code. Team owners and admins choose which
  are allowed for their team; at least one stays enabled. Requiring MFA on a team triggers a fresh
  step-up when a member enters it.
- Email codes are hashed, expire in five minutes, are single-use, and are attempt- and rate-limited.
  Password reset uses the same mechanism, checks the new password against Have I Been Pwned's
  k-anonymous range service, revokes every existing session, writes an audit event, and sends a
  notice.
- TOTP secrets are stored with authenticated encryption. Recovery codes are one-time and stored only
  as keyed hashes. "Remember this device" tokens are random, HttpOnly, hashed, expiring and revocable.
  There is no SMS factor.
- Session cookies are HttpOnly, SameSite=Lax, and Secure in production. Better Auth's CSRF and origin
  checks stay on (`trustedOrigins`).
- Public abuse surfaces — waitlist, email codes, invitations, message posting, admin bootstrap — are
  rate-limited (`apps/web/lib/rate-limit.ts`; Redis-backed when configured).

## Platform administrators versus team administrators

**Platform admin** (the `/admin` area: creating teams, connectors, the model catalog, plans, support,
cross-team audit) is granted **only** by a row in the `platform_admins` table.

- There is no self-serve path. A team owner or admin cannot escalate to it.
- The first platform admin is created by a one-time bootstrap (`scripts/bootstrap-platform-owner.ts`
  or the token-gated `POST /api/admin/bootstrap-owner`) for the address in `PLATFORM_OWNER_EMAIL`.
  Later admins are added by inserting a row with the privileged database role — never through UI.
- The application role can only read its own `platform_admins` row.
- `/admin` pages and `/api/admin/*` routes return **404** to anyone who is not a platform admin.
- Once a platform admin has enrolled MFA, privileged actions require a recent step-up. Recovery uses a
  stored one-time recovery code; if every factor is lost, another enrolled platform admin re-seeds
  access through the database. MFA is never bypassed in application code.

**Team admin** (owner or admin of one team: invitations, roles, the team's own keys and budgets) is
separate and limited to that team.

## Secrets

- Copy `.env.example` to a git-ignored `.env.local` (or `.env.development.local` for local runs).
  `.env*` is ignored except `.env.example`. Never commit credentials, database URLs with passwords,
  provider keys or bootstrap tokens.
- Documentation, issues and screenshots show **empty** values or obviously fake placeholders. Never
  paste production values anywhere.
- Teams' own AI keys are envelope-encrypted per team (AWS KMS in production). The local key service is
  development-only and refuses to start in production. The same applies to `E2E_AUTH_FIXTURE`, which
  the code rejects when `NODE_ENV=production`.
- Invite tokens, device tokens and pairing codes are stored only as SHA-256 hashes.

## Public, token-scoped surfaces

A few routes are reachable without a session, each by an unguessable token:

- **Calendar feeds** (`/api/calendar/feed/<token>`): personal ICS subscriptions. The token belongs to
  one member; a `SECURITY DEFINER` function returns nothing for unknown tokens or members who have
  left the team. Treat the URL like a password; rotate it from Team → Calendar → Sync.
- **File share links** and **public forms** follow the same pattern: a 32-hex token, a definer
  function with a pinned `search_path`, and nothing else exposed.

The proxy allows these paths by token pattern only; every other route requires a session.

## Data protections in the code

- Every request transaction sets `app.user_id` and, when a team is active, `app.org_id`; pooled
  connections cannot carry one user's identity into another's request.
- Membership rows are created only by platform provisioning or the atomic `accept_org_invite()`
  path, which requires an unexpired single-use token, an exact verified-email match and a row lock.
  Invitation resend, revoke and expiry, and all provisioning, are audited.
- AI usage locks the team's billing row, sums the ledger for the period, enforces caps, calls the
  provider and appends usage before releasing the lock. There is no cached credit counter to drift.
- Shared reference tables (event data) are read-only to the application role; only the worker role
  can write them, and sync cursors are not visible to the application role.
- Administrative changes are recorded in an append-only `admin_actions` table.
- Analytics accepts three fixed event names and no free-form properties or contact details.

## Legal

The legal document version is pinned in `packages/core/src/legal.ts`. The privacy policy states
plainly that analytics are account-linked and that AI usage may be used to improve models. Keep
those disclosures accurate and visible — do not soften them.
