# Vantage Editor + GitHub Context Bridge Contract

Coordinate the VS Code extension with `apps/web` on these shapes. Mock mode in the
extension works when APIs are unavailable.

## Auth token (stored in VS Code SecretStorage)

See `schemas/device-auth.schema.json`.

```json
{
  "deviceToken": "base64url",
  "deviceId": "uuid",
  "orgId": "uuid",
  "orgName": "string",
  "userId": "uuid",
  "scopes": ["editor.context.submit"],
  "vantageUrl": "https://example.com",
  "mock": false
}
```

API auth header: `Authorization: Bearer <deviceToken>`

## Editor endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/editor/pair/start` | public | Begin device code; body `{ machineName, extensionVersion, platform?, editor? }` |
| POST | `/api/editor/pair/poll` | public | Poll with `{ pollToken }` → `pending` \| `approved` \| `expired` |
| POST | `/api/editor/pair/approve` | session cookie | Approve `{ code, orgId }` in browser |
| GET | `/api/editor/session` | bearer | Current device + org |
| DELETE | `/api/editor/session` | bearer | Revoke device |
| POST | `/api/editor/context` | bearer | Opt-in context submit (`optIn: true` required) |

### Pair start response

```json
{
  "userCode": "ABCD-EFGH",
  "pollToken": "…",
  "verificationUri": "https://…/editor/pair?code=ABCD-EFGH",
  "expiresIn": 600,
  "interval": 3
}
```

### Pair poll approved

```json
{
  "status": "approved",
  "deviceToken": "…",
  "deviceId": "uuid",
  "orgId": "uuid",
  "orgName": "Team Name",
  "userId": "uuid",
  "scopes": ["editor.context.submit"]
}
```

### Context body (never whole-repo)

Schema: `schemas/editor-context.schema.json`.

```json
{
  "intent": "ask_selection" | "review_file" | "share_context",
  "optIn": true,
  "workspaceRoot": "optional string",
  "relativePath": "src/Robot.java",
  "languageId": "java",
  "selection": { "startLine": 1, "endLine": 20, "text": "…" },
  "fileContent": "optional, capped",
  "diagnostics": [{ "severity": "Error", "message": "…", "line": 12 }],
  "prompt": "optional"
}
```

Limits: ~48k content chars, ≤40 diagnostics. Server rejects when `optIn !== true`.

### Context response

```json
{
  "success": true,
  "contextId": "uuid",
  "summary": { "intent": "…", "relativePath": "…", "contentChars": 123, "diagnosticsCount": 0 },
  "deepLinks": {
    "chat": "https://…/chat?orgId=…&source=vscode&contextId=…",
    "code": "https://…/code?orgId=…&source=vscode"
  }
}
```

## How VS Code plugs into chat / GitHub

1. Extension pairs → stores device token.
2. User shares selection → `POST /api/editor/context` with `optIn: true`.
3. Open deep-link `/chat?orgId=…&source=vscode&contextId=…`.
4. Chat client sends the first message with `editorContextId` to `POST /api/agent`.
5. Server loads the stored editor payload (size-capped) and injects it as provenance
   `vscode_selection` — never invents DEMO code when empty.
6. Optionally, the same agent turn may also include org GitHub file context:

```json
{
  "action": "message",
  "orgId": "uuid",
  "threadId": "uuid",
  "scope": "private",
  "message": "Why does this stall?",
  "editorContextId": "uuid-from-step-2",
  "githubContext": {
    "paths": ["src/main/java/frc/robot/Robot.java"],
    "includeTree": false,
    "repoFullName": "optional/override",
    "ref": "optional-branch"
  }
}
```

Org GitHub connection (OAuth or PAT) is managed in Team settings (`/team#github-connection`),
not by the extension. Extension context is user/device opt-in; GitHub context is org-admin linked.

## GitHub server endpoints (session cookie, org member)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/github?orgId=` | Connection status + OAuth setup flags |
| POST | `/api/github` | `authorize-url` \| `connect-pat` \| `set-default-repo` \| `disconnect` |
| GET | `/api/github/oauth/callback` | OAuth redirect |
| GET | `/api/github/repos?orgId=` | List linked repos |
| GET | `/api/github/contents?orgId=&path=&tree=1` | Size-capped file/tree snippets |

Env (Onshape-style): `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET`, optional
`GITHUB_OAUTH_REDIRECT_URI`, `GITHUB_OAUTH_SCOPES` (default `read:user repo`, never `workflow`).

## Privacy rules

1. User approves org in browser during pair.
2. Each share shows a preview and requires explicit confirm in the editor.
3. No silent workspace walk / zip / git upload.
4. GitHub APIs are read-only from Vantage; no pushes; no workflow scope.
5. Empty / disconnected states stay empty — no fabricated DEMO code as live context.
