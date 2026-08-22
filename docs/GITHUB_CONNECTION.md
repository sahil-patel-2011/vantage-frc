# GitHub connection (Team settings + AI context)

Org-scoped robot-code bridge so FRC Assistant / code assist can pull **size-capped, read-only** file
snippets from one linked GitHub account. Never pushes. Never requests the `workflow` scope.

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
| POST | `/api/github` | `authorize-url` \| `connect-pat` \| `set-default-repo` \| `disconnect` |
| GET | `/api/github/oauth/callback` | OAuth redirect |
| GET | `/api/github/repos?orgId=` | List repos for linked account |
| GET | `/api/github/contents?orgId=&path=` | Size-capped file/tree snippets |

## Bugbot

Build → Code → **AI Bugbot** (also `/bugbot`) can scan the linked default repo (or a repo picked on that screen).

- **Subscription Bugbot** meters `feature=coding` on the org BYOK / plan allowance.
- **Bugbot Ultra** is a hosted flat SKU: **$1 scan**, **$2 propose fix**, **$1 recheck**. It does not use the org BYO key. Fixes are unified diffs for human approval — Vantage never pushes.

Empty GitHub / empty trees stay empty. No DEMO findings.
