# @vantage/core

Identity, tenancy, membership, and notifications — the parts of the product
that decide **who you are** and **what you may see**, kept out of the web app so
they can be tested without a browser.

## Access is closed, by design

Vantage has no public sign-up. The chain is:

1. A platform admin provisions a team and its owner.
2. Owners and admins invite exact email addresses.
3. Everybody else lands on the waitlist.

`access-policy.ts`, `invite-*.ts` and `claim-workspace.ts` hold that chain.
Anything that would let an unknown email into a team without an invite is a
security change, not a convenience change.

Authentication is Better Auth with Google and a numeric email code.
`email-2fa.ts` is the second factor; `desktop-link-plugin.ts` is how the
desktop shell hands a session to a native window without the user retyping
anything.

## Roles

`owner | admin | scout | viewer`. There is no `member` — a `member` in a
migration or a fixture is a bug that will fail an enum check. Role questions go
through `capabilities.ts` and `hub-access.ts` rather than string comparisons
scattered through pages, so "can this person see Finance" has one answer in one
place.

## Tenancy

`active-context.ts` tracks which team the current request belongs to. It pairs
with `withRls` in [`@vantage/db`](../db/README.md): this package decides the
org, the database enforces it. Neither is sufficient alone — a bug here is a
wrong answer, a missing `withRls` is a data leak.

## Notifications

`in-app-notifications.ts`, `email-notifications.ts` and `push.ts` are the three
channels, with per-member preferences honoured in one place so a member who
turned something off stays off across all three. `email.ts` / `gmail-smtp.ts` /
`email-provider.ts` degrade to a clear "configure email" state when no provider
is set, rather than failing a request that had nothing to do with email.

## Admin surfaces

`platform-admins` gates `/admin`; `admin-tenure.ts` and `admin-audit.ts` record
who did what, because a platform admin can reach across teams and that has to
leave a trail.
