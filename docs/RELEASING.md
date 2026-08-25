# Releasing Vantage — the contract for agents

When the owner says **"release this as the new version"**, follow this document exactly.
It is executable-by-instruction: every step names the file, function, or endpoint to use.
No step invents content — release notes describe only what actually shipped.

## What already exists (do not rebuild it)

| Piece | Where |
| --- | --- |
| Release rows | `product_releases` table (`packages/db/migrations/0220_product_releases.sql`) — slug, title, `version_label`, `notes_markdown`, audience targeting (`all` / `paid` / `max` / `plan_codes` + `min_plan`), `feature_flags`, status (`draft` / `scheduled` / `published` / `cancelled`), `notify_email`, `notify_in_app` |
| Domain logic | `packages/core/src/product-releases.ts` — `createProductRelease`, `updateProductRelease`, `publishProductRelease`, `notifyProductRelease`, `publishDueProductReleases`, `listWhatsNewForUser`, `ackProductRelease` |
| Admin API | `POST` / `PATCH` `/api/admin/releases` (`apps/web/app/api/admin/releases/route.ts`) — platform-admin session + privileged-action MFA, writes an admin-audit row |
| Admin UI | `/admin/releases` |
| Member surface | `/whats-new` — published rows only, filtered to the member's plan; per-user "Mark as read" acks (`product_release_acks`) |
| Delivery | `notifyProductRelease` sends **email** (Resend via `createEmailProvider().sendFreeform`, one plain-text message per recipient with an unsubscribe footer from `buildUnsubscribeUrl(token, "product_updates")`) and **in-app** notifications (`emitPreferredNotification`, type `product_update`), recording per-user results in `product_release_deliveries`. Recipients come from `list_product_release_notify_recipients(release_id)`, which already respects the `product_updates` email preference — never bypass it |
| Scheduling | `status: "scheduled"` + `scheduledAt`; `publishDueProductReleases` publishes due rows by piggybacking the season sync cron (no new cron jobs) |
| Notes composer | `apps/web/lib/releases/compose-release-notes.ts` — pure structure + quality lint (this document's step 2) |

Email delivery needs `RESEND_API_KEY` and `AUTH_EMAIL_FROM` in production. When they are
missing the publish still succeeds but notification reports `setup_required` (the API returns
503 with the release attached) — surface that honestly; do not claim the email went out.

## Step 1 — determine the version and gather what changed

1. Find the last release: `GET /api/admin/releases` (platform admin) or, in server code,
   `listProductReleases(client)` — take the newest row's `versionLabel` and `publishedAt`.
2. Pick the next version. Default: bump the minor of the last `version_label`
   (`1.4.0` → `1.5.0`); the owner's message wins if it names one. First release ever: `1.0.0`.
3. Gather the raw material — real lines only:

   ```sh
   git log --oneline --no-merges --since="<publishedAt of the last release>"
   # first release ever: git log --oneline --no-merges -50
   ```

   Optionally collect feature summaries (workstream notes, PR descriptions) for anything the
   commit subjects undersell.

## Step 2 — draft the notes through the composer

Use `apps/web/lib/releases/compose-release-notes.ts`. The flow:

1. `classifyCommitLines(gitLogLines)` buckets the raw subjects into feature / improvement /
   fix candidates. These are inputs, not prose.
2. **You write the prose.** Register: Apple/Tesla — short, confident, user-benefit first.
   Say what the reader can now do, not what the code does. No internal jargon, no commit
   hashes, no file paths, no first person, at most **5 highlights**.
3. `composeReleaseNotes(material, draft)` validates the draft. It returns
   `{ ok: false, problems: [...] }` naming each offending line — rewrite and re-run until
   `ok: true`. The lint rejects "fixed bug", "misc", "various", raw file paths, first-person
   voice, and hash-shaped strings. It also refuses an empty git log: no changes, no release.
4. `releaseNotesToMarkdown(notes)` produces the `notesMarkdown` string to store.
   `notes.emailSubject` is the one-line subject (the pipeline emails
   `"<title> (<versionLabel>)"`, so make the release **title** the email-worthy line).

Run the composer with a scratch script or `npx vitest run apps/web/lib/releases` to confirm
the module itself is healthy.

## Step 3 — insert the release via the existing path

Preferred (carries MFA + audit): `POST /api/admin/releases` as a platform admin.

```json
{
  "slug": "v1-5-0",
  "title": "Scouting keeps every entry, and the pit gets a triage board",
  "versionLabel": "1.5.0",
  "notesMarkdown": "<output of releaseNotesToMarkdown>",
  "audienceType": "all",
  "status": "draft",
  "notifyEmail": true,
  "notifyInApp": true
}
```

In server code the same insert is `createProductRelease(client, input, actorUserId)` —
always inside `withRls`, never the admin pool from request code.

Create as `draft` first so the owner can eyeball it at `/admin/releases`.

## Step 4 — publish to /whats-new

`PATCH /api/admin/releases` with `{ "id": "<release id>", "publish": true }`
(server code: `publishProductRelease(client, releaseId, actorUserId)`).

Publishing sets `published_at`, and the release immediately appears on `/whats-new` for every
member whose plan the audience targets. To publish later instead, set
`status: "scheduled"` + `scheduledAt`; the season-sync piggyback publishes it when due.

## Step 5 — the release email

There is no separate email step: `publishProductRelease` runs `notifyProductRelease` unless
you pass `notify: false` (API: `{ "publish": true, "notify": false }`). It emails every
targeted member who has the `product_updates` preference on, includes the unsubscribe link,
sends the in-app notification, and records per-user rows in `product_release_deliveries`.

Read the result honestly:

- `delivery: "sent"` — report `emailsSent` / `inAppSent` counts to the owner.
- `delivery: "setup_required"` (HTTP 503) — the release **is** published; email needs
  `RESEND_API_KEY` + `AUTH_EMAIL_FROM`. Tell the owner exactly that.

## End-to-end example

Owner: *"Release this as the new version."* Last release: `1.4.0`, published 2026-08-01.

```sh
git log --oneline --no-merges --since="2026-08-01"
# 80859a3 Make Team calendar, chat, and playbook usable on first open.
# 110bca4 Fix scouting form dropping the last match entry
# 35a5bb5 Add pit-repair triage board
```

Draft (agent-authored), validated by `composeReleaseNotes`:

```ts
const result = composeReleaseNotes(
  { version: "1.5.0", since: { gitLog: logLines } },
  {
    headline: "Scouting keeps every entry, and the pit gets a triage board",
    highlights: [
      "The pit crew can rank broken subsystems on one board and clear the queue fastest-first.",
      "Team calendar, chat, and playbook are ready the moment they open — no setup detour.",
    ],
    fixes: [
      "The scouting form no longer drops the final match entry when submitted quickly.",
    ],
  },
);
// result.ok === true → releaseNotesToMarkdown(result.notes)
```

Then: `POST /api/admin/releases` (status `draft`, slug `v1-5-0`, versionLabel `1.5.0`,
audienceType `all`) → owner approves → `PATCH { id, publish: true }` → report the notify
counts (or the `setup_required` reason) back to the owner. Done.
