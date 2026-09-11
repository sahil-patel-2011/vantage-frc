# Push notifications & the TBA Firehose

*For operators configuring notifications, and contributors. Last updated 2026-08-24.*

How Vantage pings the right person at the right moment — "you're scouting 254 in Qual 42,
seven minutes out" — and exactly what happens when the keys are not configured.

Two independent halves:

| Half | What it does | Fails how |
| --- | --- | --- |
| **Web Push** (VAPID) | Delivers a notification to a member's phone/laptop, app closed | No VAPID keys → nothing leaves the server; in-app inbox still works |
| **TBA webhooks** (Firehose) | Tells us a match is coming up / scores posted / schedule moved | No `TBA_WEBHOOK_SECRET` → every delivery is refused with 503 |

Neither one invents data. If TBA never sends a scheduled time we say "coming up", not a
made-up countdown; if a match arrives without scores we say the result posted rather than
printing `0 – 0`.

---

## 1. Web Push setup (VAPID)

### Generate a key pair

The key pair is a P-256 ECDH key. Generate it once, store it in the deployment's env, and
**never rotate it casually** — every stored browser subscription is bound to the public key
it was created with, so a new key silently orphans every registered device.

```sh
node -e "const {generateKeyPairSync}=require('node:crypto');const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});const pub=publicKey.export({format:'jwk'});const priv=privateKey.export({format:'jwk'});const b64=(x)=>Buffer.from(x,'base64url').toString('base64url');console.log('VAPID_PUBLIC_KEY='+Buffer.concat([Buffer.from([4]),Buffer.from(pub.x,'base64url'),Buffer.from(pub.y,'base64url')]).toString('base64url'));console.log('VAPID_PRIVATE_KEY='+b64(priv.d));"
```

### Environment variables

```sh
VAPID_PUBLIC_KEY=BB...      # 65-byte uncompressed P-256 point, base64url (starts with 0x04)
VAPID_PRIVATE_KEY=...       # 32-byte private scalar, base64url
VAPID_SUBJECT=mailto:ops@yourteam.org   # or https://your-deployment — a contact the push service can reach
```

`apps/web/lib/push/vapid.ts` validates all three at request time and reports **every**
missing/invalid one at once, so a coach configuring this does not fix one variable per
deploy. Anything invalid ⇒ `state: "setup_required"` from `GET /api/push`, the subscribe
button explains why, and notifications quietly stay in-app only.

There is **no `web-push` dependency**. RFC 8291 (`aes128gcm` + HKDF) and RFC 8292 (the
VAPID ES256 JWT) are implemented on `node:crypto` in `lib/push/encrypt.ts` and
`lib/push/vapid.ts`, and pinned against the RFC 8291 §5 test vector in `encrypt.test.ts`.

### Wiring a UI

```ts
import { readPushClientState, subscribeToPush, unsubscribeFromPush } from "@/lib/push/client";

const state = await readPushClientState();   // unsupported | ios_needs_home_screen | setup_required | denied | available | subscribed
await subscribeToPush(activeOrgId);          // MUST be called from a click handler
await unsubscribeFromPush();
```

`subscribeToPush` prompts for permission, subscribes through the already-registered
service worker, and POSTs the subscription to `/api/push`. Call it from a real user
gesture — browsers reject `Notification.requestPermission()` otherwise.

### Browser reality (say this in the UI, don't paper over it)

- Chrome, Edge, Firefox, Opera — desktop and Android: works.
- **iOS / iPadOS: Safari 16.4+ and only after the user adds Vantage to the Home Screen.**
  In a normal Safari tab `PushManager` does not exist. `readPushClientState()` returns
  `ios_needs_home_screen` so the UI can say "Share → Add to Home Screen" instead of
  showing a dead button.
- A member who blocked notifications at the browser level returns `denied`; only they can
  undo that, in browser settings.

### Devices, pruning, rotation

- One row per browser registration (`push_subscriptions.endpoint` is globally unique).
- Rows are **user-owned**: RLS lets a member see and delete only their own devices — an
  owner cannot enumerate a student's phones. `org_id` is a hint about which workspace the
  device was registered from, never an authorization check; fan-out re-verifies membership.
- A push service answering **404/410** means the subscription is gone; it is deleted on
  the spot (`pruneDeadSubscription`). Other failures set `failed_at` and keep the row.
- Browsers rotate subscriptions on their own schedule. The service worker's
  `pushsubscriptionchange` handler re-subscribes and POSTs the new endpoint with
  `previousEndpoint`, so the stale row is dropped instead of lingering.

---

## 2. TBA Firehose webhooks

TBA POSTs `{ "message_type": …, "message_data": { … } }` to a registered URL with an
`X-TBA-HMAC` header, and expects a response within **10 seconds**. Endpoints that time out
or error get disabled.

### Register the webhook (account-bound, web UI only)

1. Sign in at <https://www.thebluealliance.com/account>.
2. Under **Webhooks**, add: URL `https://<your-deployment>/api/webhooks/tba`, and a secret
   you generate (`openssl rand -hex 32`).
3. Set that same value as `TBA_WEBHOOK_SECRET` in the deployment env and redeploy **before**
   verifying — the handler refuses deliveries (503) while the secret is missing.
4. Press **Verify**. TBA posts a `verification` message; the handler logs

   ```
   [tba-webhook] VERIFICATION CODE: <code> — paste this into thebluealliance.com/account …
   ```

   Read it from the deployment logs and type it into the TBA page.
5. Press **Ping** to confirm a live 200.
6. Request **Firehose** access from TBA if you want every event rather than only your own
   team's. One platform-level subscription serves every Vantage team; we fan out by org
   internally, so teams never register anything themselves.

### Request handling (the 10-second rule)

`apps/web/app/api/webhooks/tba/route.ts`:

1. `await request.text()` — the HMAC covers the **raw bytes**. Verifying a re-serialized
   object would change key order and whitespace and never match.
2. `verifyTbaWebhook` — HMAC-SHA256 of the body keyed with the secret, compared in constant
   time. Missing secret ⇒ 503; bad/absent header ⇒ 401.
3. `verification` and `ping` answer immediately and store nothing.
4. Everything else is INSERTed into `tba_webhook_events` and answered `200` right away.
5. Fan-out runs **after** the response via `after()`. If the function is frozen mid-way the
   row stays pending and `/api/webhooks/tba/drain` (CRON_SECRET-guarded) picks it up. Rows
   are claimed with `FOR UPDATE SKIP LOCKED`, retried up to 5 times, then parked with
   `last_error` set.
6. A database failure still returns 200 with `recorded: false` — a non-2xx counts against
   the endpoint's health at TBA, and losing one delivery beats losing the subscription.

Add the drain to your ticker (Vercel cron, GitHub Action, whatever runs the other workers):

```
GET /api/webhooks/tba/drain?limit=25     Authorization: Bearer $CRON_SECRET
```

### Fan-out rules

An event key maps to orgs via `org_active_context.active_event_key` — a team only hears
about the event it is actually attending.

| Message | Who gets it | Notification type |
| --- | --- | --- |
| `upcoming_match` | Every member with a `scout_assignments` row on that match (their assigned robots are named in the body) | `scout_reminder` |
| `upcoming_match`, our robot on the field | Owners/admins not already pinged as scouts | `match_alert` |
| `match_score` | Scouts who covered the match; plus owners/admins when our robot played | `match_alert` |
| `schedule_updated` | Owners/admins | `match_alert` |
| `alliance_selection` | Owners/admins | `match_alert` |
| anything else | recorded, no notification | — |

Every recipient is re-checked against `memberships` at send time, and the in-app
preference (`scoutReminders`, `matchAlerts` in `profiles.notification_prefs`) gates both
the inbox row **and** the push — one switch, not two half-switches. The inbox row is
written first because it is the durable copy that works with no VAPID keys at all.

---

## 3. Service worker

`apps/web/public/sw.js` gained `push`, `notificationclick`, and `pushsubscriptionchange`
handlers; the offline shell caching is untouched. The payload contract is
`apps/web/lib/push/payload.ts`:

```json
{ "title": "Qual 42 in 7 minutes", "body": "You have 254. Head to your station.",
  "url": "/scouting", "tag": "upcoming:2026mil_qm42", "type": "scout_reminder", "urgent": true }
```

- `url` is always a same-origin path (the server strips anything else).
- `tag` collapses an updated ping onto the old one instead of stacking; `renotify` still buzzes.
- `urgent` ⇒ `requireInteraction` + vibration + `Urgency: high`, for competition-day pings.
- Clicking focuses an open Vantage window and navigates it, or opens a new one.
- The whole payload must fit one `aes128gcm` record (3993 bytes); the body is truncated on a
  UTF-8 boundary, the title never is.

---

## 4. Failure modes, plainly

| Situation | What the member sees |
| --- | --- |
| No VAPID keys | Preferences say push is not configured; in-app inbox still fills |
| No `TBA_WEBHOOK_SECRET` | TBA deliveries refused (503); no match pings at all |
| iOS Safari tab (not installed) | "Add to Home Screen first" — not a dead toggle |
| Permission denied in browser | Explained, with no way for us to re-prompt |
| Subscription expired (404/410) | Row deleted; the next visit re-subscribes |
| Push service slow/erroring | Marked `failed_at`, kept, retried on the next event |
| Member muted the category | No inbox row and no push |

## 5. Local testing

```sh
# 1. Sign a body with your secret and post it as TBA would
BODY='{"message_type":"ping","message_data":{"title":"test"}}'
HMAC=$(node -e "console.log(require('node:crypto').createHmac('sha256',process.env.TBA_WEBHOOK_SECRET).update(process.argv[1]).digest('hex'))" "$BODY")
curl -sS -X POST http://localhost:3001/api/webhooks/tba \
  -H "Content-Type: application/json" -H "X-TBA-HMAC: $HMAC" -d "$BODY"

# 2. Drain anything left pending
curl -sS "http://localhost:3001/api/webhooks/tba/drain?limit=5" -H "Authorization: Bearer $CRON_SECRET"
```

Unit tests: `npx vitest run apps/web/lib/push apps/web/lib/webhooks`.
