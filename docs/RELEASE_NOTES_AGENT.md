# Publishing release notes from a coding agent

Release notes have one shape, and one machine door. A coding agent (Cursor, Claude Code, CI)
posts the *facts* of a release; `composeReleaseNotes`
(`packages/core/src/release-notes-compose.ts`) decides the wording, so every note published over
months reads identically and stays short and non-technical.

## Endpoint

```
POST /api/agent/release-notes
Authorization: Bearer $RELEASE_AGENT_TOKEN
content-type: application/json

{
  "version": "2026.3",
  "headline": "Scouting is faster on the field",
  "added":    ["Tap-based match scoring"],
  "improved": ["Team comparison loads instantly"],
  "fixed":    ["Team profiles no longer crash on open"],
  "preview":  false,
  "draft":    false
}
```

- `preview: true` — render the note and return it, publish nothing. Good for a dry run.
- `draft: true` — stage it; a human publishes from the admin console.
- Re-posting the same `version` edits that release in place and does **not** re-notify.
- Audience is always everyone, email off, in-app notification on. Plan gates and feature flags
  remain human-only, through `/api/admin/releases`.

Releases are attributed to the founding platform admin, never to the token, and the whole publish
runs in one RLS-bound transaction.

## Writing rules the composer enforces

- Headline: one plain sentence, no version number, no `feat:` prefix.
- Bullets: at most 6 per section, 110 characters each; commit hashes, PR numbers, file paths,
  backticks and conventional-commit prefixes are stripped; duplicates dropped.
- Sections always print in this order: **New**, **Better**, **Fixed** (empty ones are omitted).
- Say what a student user can now do — not how it was implemented.

## Reading the feed

```
GET /api/desktop/updates?limit=20   # public, no session
```

Returns `latest` (version, slug, publishedAt) plus recent published notes — this is what the
desktop updater compares against its own build, and what the website changelog renders. Signed-in
users see the same notes at `/whats-new`.

## Token

`RELEASE_AGENT_TOKEN` is a long random string you generate (`openssl rand -hex 32`) and store as
an app secret. Anyone holding it can publish, so treat it like a deploy key.
