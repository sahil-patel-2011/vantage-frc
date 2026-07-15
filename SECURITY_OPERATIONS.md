# Security operations

Organization identity is global, but organization access is policy-gated. Owners/admins may allow password, Google, and/or email OTP; at least one remains enabled. Membership stays invite-only. Required MFA causes a new step-up when entering a stricter organization.

TOTP secrets use authenticated encryption. Recovery codes are one-time and stored only as keyed hashes. Remembered-device tokens are random, HttpOnly, hashed in Postgres, expiring, and revocable. No SMS factor exists.

Password reset uses Better Auth's hashed, short-lived, attempt-limited email OTP. Requests are generic for unknown addresses. Completion verifies the code, checks the password against Have I Been Pwned's k-anonymous range service, uses Better Auth password hashing, verifies the email, revokes all existing sessions, writes an audit event, and sends a security notice.

Platform-admin bootstrap: a not-yet-enrolled platform admin may perform the first privileged setup, which is auditable. Once that admin enrolls MFA, privileged mutations require a recent step-up. Recovery uses a stored one-time recovery code. If all factors are lost, another already-enrolled platform admin must revoke/reseed access through the documented database-admin process; never bypass MFA in application code.

## Platform admins vs org Team Admin

**Platform admin** access (Global Team Manager, `/admin/*`, cross-org credits, push/provider API keys, model catalog, Stripe/platform commercial config, platform TBA connector, creating orgs globally) is granted **only** by a row in `platform_admins`. There is no self-serve path. Org owner/admin cannot escalate.

- Seeded owner email (`PLATFORM_OWNER_EMAIL`, default `sahiljpatel2011@gmail.com`) becomes a platform admin only after bootstrap (`scripts/bootstrap-platform-owner.ts` or token-gated `POST /api/admin/bootstrap-owner`), which inserts `platform_admins`.
- To add another platform admin later: insert a row into `platform_admins` for an existing verified user via the database admin role / Neon SQL (or extend the bootstrap script). Do not expose UI to grant this.
- App role `vantage_app` has SELECT-only on `platform_admins` (self-read). Inserts require the privileged DB URL.
- Pages under `/admin` return **404** for non–platform-admins. Platform APIs under `/api/admin/*` (except bootstrap-owner) likewise return 404 when the caller is not in `platform_admins`.
- UI (hamburger Platform section, command palette) shows Global Team Manager only when `/api/me` reports `platformAdmin: true`.

**Org Team Admin** (`/team`, invites, org BYO TBA keys, org API budgets) remains available to that organization's owner/admin and is separate from platform privilege.
