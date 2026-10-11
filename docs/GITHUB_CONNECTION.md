# GitHub connection (Team settings + AI context)

*For team admins linking the robot-code repository, and operators configuring GitHub OAuth. Last updated 2026-10-11.*

Org-scoped robot-code bridge so FRC Assistant / code assist can pull **size-capped, read-only** file
snippets from one linked GitHub account. Never pushes, opens, merges or comments on a pull request.
Never requests the `workflow` scope. The one write is optional: registering the repository webhook
for automatic pull request reviews (repo settings, `/hooks` only; `lib/code/bugbot-contract.test.ts`
enforces both).

UI: **Team admin** → `#github-connection`  
Route: `/team?orgId=<uuid>#github-connection`  
Migration: `packages/db/migrations/0112_github_context.sql` (`github_connections` + RLS)

## Production behavior

| Path | Needs `GITHUB_OAUTH_*`? | Notes |
|---|---|---|
| **Encrypted PAT** | No | Always available. Fine-grained or classic PAT with Contents: Read. |
| **OAuth App** | Yes | One-click Connect GitHub. Disabled in UI when env missing — **not** a feature-level Setup-required. |

`GET /api/github?orgId=` returns:

- `setupRequired: false` — feature is usable (PAT)
- `oauthSetupRequired: true` — only when OAuth App credentials are blank
- `patAvailable: true` — always
- `callbackUrl` — **always present**, computed from `BETTER_AUTH_URL` and never gated on the client
  credentials. The admin who has not created the OAuth App yet is the only person who needs it, and
  GitHub will not issue a client id until they have pasted it in. (`redirectUri` keeps its old
  null-when-unconfigured meaning: the Connect button reads it as "OAuth is usable".)
- `missingEnv` — the blank required variables, so a card can list them as chips
- `message` — names the variables, where to set them, the console, the callback URL and the scopes
- `credentialRejected` / `rejectedLogin` — a stored token GitHub has refused (see below)

## When a token dies

A revoked PAT, an expired fine-grained PAT, or an OAuth App the account de-authorised all make every
call answer `401 Bad credentials`. That used to leave the row at `status='connected'` forever: the card
read **LINKED @octocat**, the deploy log was empty, and the raw provider string was the only clue.

- `GitHubCredentialRejectedError` (`apps/web/lib/github/api.ts`) separates a refused credential from
  every other failure. A **403 is only counted as a refusal when `x-ratelimit-remaining` is not `0`** —
  a rate limit is a wait, and telling someone to reconnect over one makes them bin a working token.
- `POST /api/github {action:"verify"}` spends one `/user` call against the stored credential and records
  the result: healthy refreshes `github_login` and `last_tested_at`; refused sets `status='error'`.
  `set-default-repo` records it too, since choosing a repo is usually where a dead token is first met.
- `status='error'` deliberately **keeps the encrypted credential**. A revoked token is not a disconnect:
  the admin may be re-authorising the same account, and the stored login is what tells them which one.
  Only an explicit Disconnect overwrites the envelope.
- `loadGitHubConnectionState()` reads rows in any status, so `/connectors` and Team admin can say
  **"Token expired — reconnect"** rather than "Not connected" — which is what sends someone off to
  create a second OAuth App instead of re-authorising the one they have. Disconnect stays reachable in
  that state.
- Marking the row is owner/admin only (the RLS UPDATE policy). A member who hits a dead token still gets
  the plain message; a read never changes team state as a side effect.

Status codes: auth `401`, role refusal `403`, a refused GitHub credential `502`, everything else `400`.

## See also

`/connectors` (Settings → Connectors) shows GitHub next to every other connector with the same callback
URL, working Connect/Disconnect, and the missing variables. Section 4b of `docs/DEPLOYMENT.md` is the
full table.

## Vercel env checklist (project `vantage-frc-web`)

Set on **Production** (and Preview if you test OAuth there). Redeploy after changes.

### Required for OAuth (optional if teams use PAT only)

| Variable | Value |
|---|---|
| `GITHUB_OAUTH_CLIENT_ID` | GitHub OAuth App Client ID |
| `GITHUB_OAUTH_CLIENT_SECRET` | GitHub OAuth App Client Secret |

### Optional

| Variable | Default / notes |
|---|---|
| `GITHUB_OAUTH_REDIRECT_URI` | `${BETTER_AUTH_URL}/api/github/oauth/callback` |
| `GITHUB_OAUTH_SCOPES` | `read:user repo` — **never** add `workflow` |
| `GITHUB_OAUTH_STATE_SECRET` | Falls back to `BETTER_AUTH_SECRET` |

Also required for token encryption at rest (same as other BYOK secrets): production KMS /
`BETTER_AUTH_SECRET` stack already used by billing envelope encryption.

### GitHub OAuth App console

1. GitHub → Settings → Developer settings → **OAuth Apps** → New.
2. Homepage URL: `https://vantage-frc-web.vercel.app`
3. Authorization callback URL (exact):
   `https://vantage-frc-web.vercel.app/api/github/oauth/callback`
4. Paste Client ID / Secret into Vercel env; redeploy.
5. Local: add `http://localhost:3001/api/github/oauth/callback` (or your `BETTER_AUTH_URL`) as a second
   callback if testing OAuth locally.

### PAT path (no GitHub OAuth App)

1. Create a fine-grained PAT (Contents: Read on the robot repo) or classic PAT with `repo` read.
2. Team admin → **Encrypt and save PAT**.
3. Choose **default robot-code repo**.
4. Chat/code can pass `githubContext.paths` / `includeTree` (see `packages/vantage-vscode/CONTRACT.md`).

## Database

```sh
npm run db:migrate   # applies 0112_github_context.sql among others
```

Table is org-unique, RLS via `is_org_member` / `has_org_role(owner|admin)`. Credentials stored as
encrypted JSON blobs — never returned on GET.

## Onboarding deep link

Users who choose **Build & code** as primary focus are sent to
`/team?orgId=…#github-connection` after approval (when a workspace org is known). The onboarding review
step also links to Team → GitHub.

## APIs (session cookie)

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/github?orgId=` | Status + public connection metadata |
| POST | `/api/github` | `authorize-url` \| `connect-pat` \| `set-default-repo` \| `verify` \| `disconnect` |
| GET | `/api/github/oauth/callback` | OAuth redirect |
| GET | `/api/github/repos?orgId=` | List repos for linked account |
| GET | `/api/github/contents?orgId=&path=` | Size-capped file/tree snippets |
| GET | `/api/github/pulls?orgId=` | Open pull requests, their latest AI review, the code map |
| POST | `/api/github/pulls` | `review` \| `refresh-map` \| `auto-reviews` (owner/admin) |
| POST | `/api/github/webhook/<token>` | GitHub deliveries (no session; signed — see below) |

## Pull request reviews and the code map

Build → Code → **Pull requests** (`app/code/code-pr-panel.tsx`). Migration
`0716_github_pr_reviews.sql` adds `github_pr_reviews`, `github_code_index` and the webhook columns on
`github_connections`; it is in the production schema preflight.

- **Review a pull request.** Owners, admins and team members can review any open PR in the default
  repo. Vantage reads the PR's changed files (up to 25 files, 60k characters of patch), asks the
  team's AI route for a JSON review, and stores it per head commit. A finding is kept only when it
  quotes a line the PR added — anything the model cannot point at is dropped, never shown. Metered as
  `feature=coding` like every other AI call; viewers can read reviews but not start one.
- **Review every new pull request** (owner/admin switch). Creates one repository webhook for
  `pull_request` and `push`, with a per-team URL token and a per-team signing secret (encrypted at rest
  like the token). Opened, reopened, ready-for-review and updated non-draft PRs are reviewed
  automatically; a push to the default branch refreshes the code map. Reviews run as the owner/admin who
  turned the switch on and are metered to the team. Turning it off deletes the webhook.
  - Creating the webhook needs a token that can manage hooks: the OAuth `repo` scope, or a
    fine-grained PAT with **Webhooks: Read and write** and **Pull requests: Read**. With a read-only
    token the card shows the URL, secret and events to paste into GitHub → Settings → Webhooks.
  - `/api/github/webhook/<token>` is a public proxy prefix (like the Stripe and TBA webhooks). The token
    picks the team through `github_pr_webhook_target()` (SECURITY DEFINER, callable with no user; every
    table policy still refuses that context), then `X-Hub-Signature-256` must verify against that team's
    secret over the raw body before anything runs. Unknown token → 404, bad signature → 401.
- **Code map.** One tree read plus at most six small files (the GradleRIO build file and constants)
  — no AI. It lists subsystems, commands, vendor libraries, the WPILib version and CAN IDs, and flags
  one CAN ID used twice. It feeds:
  - **Ask AI** — robot and code questions get the map and the five latest reviews as context
    (`robotCodeContextItems`); other chat does not pay for it.
  - **Robot Blueprint** — a subsystem with no code ref gets a one-tap "Use SwerveSubsystem.java"
    suggestion when exactly one mapped file fits its name.
  - **PR reviews** — the reviewer sees what already exists in the robot.

## Bugbot

Build → Code → **AI Bugbot** (also `/bugbot`) can scan the linked default repo (or a repo picked on that screen).

- **Subscription Bugbot** meters `feature=coding` on the org BYOK / plan allowance.
- **Bugbot Ultra** is a hosted flat SKU: **$1 scan**, **$2 propose fix**, **$1 recheck**. It does not use the org BYO key. Fixes are unified diffs for human approval — Vantage never pushes.

Empty GitHub / empty trees stay empty. No DEMO findings.
