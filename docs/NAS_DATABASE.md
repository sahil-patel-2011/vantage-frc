# Running Vantage's database on a team NAS

Vantage needs one Postgres database. This guide puts it on a NAS you own (Synology, QNAP,
TrueNAS, Unraid, or any always-on Linux box) instead of a paid host. The website on Vercel
reaches it over the internet; every connection is encrypted **and verified** against your own
certificate authority, and team data stays behind the same `org_id` row-level security as any
other host (`withRls`, `vantage_app`). Google is the backup, not the database:

| Copy | What it is | How it is made |
|---|---|---|
| **NAS Postgres** | The database. Source of truth. | This guide |
| **Encrypted snapshot in Google** | The whole database, encrypted, for disaster recovery | `scripts/recovery-checkpoint.mjs` + `scripts/recovery-google-checkpoint.ts` ([Backups](#backups)) |
| **Google Sheets / Excel copies** | Each team's own data, readable by people | Connectors → Spreadsheet copies ([SPREADSHEET_MIRROR.md](SPREADSHEET_MIRROR.md)) |

Nothing here costs money beyond the NAS and its power.

## Before you start: what this means

- **The app is up when the NAS is up.** A power cut, a router reboot or an ISP outage takes
  Vantage offline for everyone until it is back. Pages then show their "can't reach the
  database" state within about ten seconds instead of hanging (self-hosted pools give up
  after 10 s and stay small; `packages/db/src/postgres-url.ts`). A UPS on the NAS and router
  is worth it before an event. You are emailed when it happens:
  [When the NAS goes down](#when-the-nas-goes-down).
- **The NAS needs to be reachable from the internet** on one TCP port. That needs a public IP
  (most home connections have one; if your ISP uses CGNAT, port forwarding cannot work: ask the
  ISP for a public IPv4) and a name that follows it (DDNS: Synology, QNAP and most routers
  include one for free).
- **Distance adds time to every page.** Each page makes a few round trips to the database. Pick
  the Vercel function region closest to the NAS (Vercel → Project → Settings → Functions →
  Region, e.g. `iad1` for the US east coast) so each trip is short.
- Vercel's outgoing addresses are not fixed, so the port cannot be limited to Vercel by IP.
  Security comes from TLS, `scram-sha-256` passwords, and only two non-superuser logins being
  allowed from outside (below).

## 1. Make your certificate authority and the server certificate

Run once, on any computer with `openssl`. Keep `nas-ca.key` offline (a USB stick in a drawer):
it is what lets you issue certificates. Replace `vantage-db.example.ddns.net` with your DDNS name.

```sh
NAME=vantage-db.example.ddns.net
openssl req -x509 -newkey rsa:4096 -nodes -keyout nas-ca.key -out nas-ca.pem -days 3650 -subj "/CN=Vantage NAS CA"
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=$NAME"
printf "subjectAltName=DNS:%s\n" "$NAME" > san.ext
openssl x509 -req -in server.csr -CA nas-ca.pem -CAkey nas-ca.key -CAcreateserial -out server.crt -days 825 -extfile san.ext
```

The name in the certificate must be the name in the connection URL; a connection by IP address
or by a different name is refused. Renew `server.crt` before 825 days with the same commands
(the CA stays the same, so Vercel needs no change).

## 2. Run Postgres 17 on the NAS

Use the NAS's container app (Synology Container Manager, QNAP Container Station, TrueNAS Apps,
Unraid Docker). Postgres **17** matches what production has used, so a dump never downgrades.
Put `server.crt` and `server.key` in a folder on the NAS (e.g. `/volume1/vantage/certs`;
the key must be readable only by the container: `chmod 600 server.key`, owner uid 999).

`compose.yaml`:

```yaml
services:
  postgres:
    image: postgres:17
    restart: unless-stopped
    # Host networking keeps each client's real address, which the pg_hba.conf rules below
    # depend on. With published ports, Docker can make every client look like its own gateway.
    network_mode: host
    environment:
      POSTGRES_PASSWORD: "<long random superuser password, LAN only>"
      POSTGRES_DB: vantage
    command: >
      postgres
      -c ssl=on
      -c ssl_cert_file=/certs/server.crt
      -c ssl_key_file=/certs/server.key
      -c ssl_min_protocol_version=TLSv1.2
      -c password_encryption=scram-sha-256
      -c max_connections=150
      -c hba_file=/etc/postgresql/pg_hba.conf
    volumes:
      - /volume1/vantage/data:/var/lib/postgresql/data
      - /volume1/vantage/certs:/certs:ro
      - /volume1/vantage/pg_hba.conf:/etc/postgresql/pg_hba.conf:ro
```

`pg_hba.conf` (adjust `192.168.1.0/24` to your home network):

```text
# TYPE   DATABASE  USER            ADDRESS          METHOD
# The socket inside the container only (the image's first-start setup needs it).
local    all       all                              trust
# The superuser and migrations: only from home, still over TLS.
hostssl  all       postgres        192.168.1.0/24   scram-sha-256
hostssl  all       postgres        0.0.0.0/0        reject
# The website (Vercel): only the two app logins, only over TLS.
hostssl  vantage   vantage_app     0.0.0.0/0        scram-sha-256
hostssl  vantage   vantage_worker  0.0.0.0/0        scram-sha-256
# Everything else, including any non-TLS connection, is refused.
host     all       all             0.0.0.0/0        reject
host     all       all             ::/0             reject
```

Then forward TCP port 5432 on the router to the NAS. Keep the same number outside and inside,
so one URL works from home and from Vercel. If the DDNS name does not work from inside your own
network (no "NAT loopback" on the router), add a hosts-file line on your home computer mapping
the name to the NAS's home address; the certificate still matches because the name is the same.

## 3. Create the schema and the two logins

From a computer **on the home network** (not the cloud), with the repo checked out. Write a
private env file that is never committed, e.g. `~/vantage-nas-migrate.env`:

```text
DATABASE_ADMIN_URL=postgresql://postgres:<superuser password>@vantage-db.example.ddns.net:5432/vantage
DATABASE_SSL_CA=<base64 of nas-ca.pem: base64 -w0 nas-ca.pem  (macOS: base64 -i nas-ca.pem)>
```

```sh
npm ci
npm run db:migrate -- --migration-env-file ~/vantage-nas-migrate.env
```

The runner applies every file in `packages/db/migrations/` in order and records each in
`schema_migrations`; running it again only applies new files. Migration `0001` creates the
`vantage_*` roles (the worker with `BYPASSRLS`) because it runs as the superuser. Always run
migrations this way, as `postgres` from home: the tables belong to `postgres`, so later
migrations need it too.

Give the two app roles a login. Connect as `postgres` (e.g. `psql` with the same URL) and run,
with two new long random passwords (`openssl rand -base64 32`):

```sql
ALTER ROLE vantage_app    WITH LOGIN PASSWORD '<app password>';
ALTER ROLE vantage_worker WITH LOGIN PASSWORD '<worker password>';
```

The website never logs in as `postgres`. `vantage_app` is under row-level security: a team can
only ever see its own rows. `vantage_worker` is for background jobs and the deploy check only.

Create the platform owner (your account) once, with the worker URL from the next step:

```sh
DATABASE_ADMIN_URL=... DATABASE_SSL_CA=... PLATFORM_OWNER_EMAIL=you@example.com \
PLATFORM_OWNER_PASSWORD='<12+ chars>' npx tsx scripts/bootstrap-platform-owner.ts
```

## 4. Point Vercel at it

Vercel → Project → Settings → Environment Variables (Production). Use the DDNS name, and
URL-encode any special characters in the passwords.

| Variable | Value |
|---|---|
| `DATABASE_URL` | `postgresql://vantage_app:<app password>@vantage-db.example.ddns.net:5432/vantage?sslmode=verify-full` |
| `DATABASE_AUTH_URL` | same as `DATABASE_URL` |
| `MARKETING_DATABASE_URL` | same as `DATABASE_URL` (until a separate marketing role is split out) |
| `DATABASE_ADMIN_URL` | `postgresql://vantage_worker:<worker password>@vantage-db.example.ddns.net:5432/vantage?sslmode=verify-full` |
| `DATABASE_SSL_CA` | base64 of `nas-ca.pem` (one line). PEM text also works. |

Leave `DATABASE_DRIVER` unset: a self-hosted host already uses node-postgres. The optional
per-feature URLs in `.env.example` (`DATABASE_BILLING_URL`, `DATABASE_DISPLAY_URL`, …) fall back
to `DATABASE_URL` when unset.

How the CA is used: with `DATABASE_SSL_CA` set, every connection (the website, sign-in, the
migration runner, the production schema check, and backups) is verified against your CA, and any
`sslmode` in the URL is dropped so it cannot replace that check
(`packages/db/src/postgres-url.ts`, `scripts/lib/database-ssl.mjs`). Verification is never
switched off. A wrong name, a certificate from another CA, or plain-text Postgres is refused.

The production build runs a read-only schema check (`scripts/production-schema-preflight.mjs`)
as `vantage_worker`: apply migrations (step 3) **before** deploying code that needs them, or
the deploy stops with the list of missing files.

## Backups

Two backups, on different hardware and a different provider from the NAS:

1. **NAS snapshots of the data folder** (Btrfs/ZFS snapshots, Hyper Backup, etc.) to a second
   disk. Fast to restore after a bad change; useless if the NAS itself dies.
2. **An encrypted full snapshot in Google**, off-site:

   ```sh
   # on a home computer with pg_dump 17: a consistent, encrypted dump; the key stays in --directory
   node scripts/recovery-checkpoint.mjs --env-file ~/vantage-nas-migrate.env --pg-dump "$(which pg_dump)" --directory ~/vantage-recovery
   # prove it restores, then upload it (the restore needs a throwaway Postgres on the same
   # machine: it only accepts a new localhost database named recovery_test, never a real one)
   TEST_RESTORE_DATABASE_URL=postgresql://localhost/recovery_test node scripts/verify-recovery-checkpoint.mjs --manifest ~/vantage-recovery/<id>.manifest.json
   npx tsx scripts/recovery-google-checkpoint.ts --bridge-config <private bridge.json> --key-file <separately kept key> --manifest ~/vantage-recovery/<id>.manifest.json
   ```

   The dump is encrypted before it touches the disk (AES-256-GCM), uploaded through your Google
   Apps Script bridge, and read back to check it. Keep `recovery-key.base64` somewhere other
   than Google: whoever holds the key and the snapshot holds every team's data.

Teams that also want their own data readable in a spreadsheet turn on
[Spreadsheet copies](SPREADSHEET_MIRROR.md). Those copies are per team and human-readable; they
are not a way to rebuild the database.

Run a restore drill before the season and after any big change: a backup that has never been
restored is a guess.

## When the NAS goes down

If the NAS loses power or internet, or Postgres stops, Vantage emails **you only** (the address
in `PLATFORM_OWNER_EMAIL`) with what failed, why, and what to try first: "Postgres isn't
accepting connections" (container stopped), "The NAS can't be reached" (offline, or the
internet / port forward is down), "The NAS's address doesn't resolve" (DDNS), a certificate
problem (`DATABASE_SSL_CA`), a rejected password, a full disk, too many connections, and so on
(`apps/web/lib/outage/classify.ts`). Nobody else hears about it unless you decide they should.

- **One email per outage.** The first failure sends it. You get another only if the cause
  changes, as a reminder every 6 hours while it stays down, and once when the database answers
  again ("Vantage is back", with how long it was down).
- **The email links to the outage console** (`/status/outage`, no sign-in: the link is signed
  with `BETTER_AUTH_SECRET`, works for 24 hours, and each reminder brings a fresh one). It shows
  the live status and the cause, and lets you **email everyone** that Vantage is running with
  limited features (you edit the message and type `SEND`), turn on a calm "Vantage is limited
  right now" banner in the app, and later send "Vantage is back" and turn the banner off.
  Everyone gets their own email, a couple per second, so a free email plan isn't rate-limited.
- **What keeps working:** scouting keeps saving on phones and syncs when the database is back,
  and each team's [spreadsheet copy](SPREADSHEET_MIRROR.md) stays readable. The banner links to
  it on every device that opened Vantage while it worked.

### Detecting an outage when nobody is using the app

Vercel crons are off, so detection comes from traffic: `/api/health`, `/api/me` and the
sign-in check in front of every signed-in page report each database failure (after the
response, so nobody waits on it). Add a free external uptime monitor so an outage at 3 a.m. is
noticed too:

1. [UptimeRobot](https://uptimerobot.com) (free, 5-minute checks) or
   [cron-job.org](https://cron-job.org) → new HTTP(S) monitor.
2. URL: `https://<your Vantage domain>/api/health`, every **5 minutes**. It answers 200 when the
   database works and 503 when it doesn't, and never says why (safe to be public).
3. Its own alert email is optional: Vantage's email already says what's wrong.

### Settings (Vercel → Environment Variables, Production)

| Variable | Needed for |
|---|---|
| `PLATFORM_OWNER_EMAIL` | Who the alert goes to. If unset, nothing is emailed (a warning naming the variable is logged). |
| `RESEND_API_KEY` + `AUTH_EMAIL_FROM` (or `GMAIL_SMTP_USER` + `GMAIL_SMTP_APP_PASSWORD`) | Sending the alert and the "email everyone" notice. |
| `BETTER_AUTH_SECRET` | Already set for sign-in. Signs the console link and encrypts the contact list. |
| `OUTAGE_REDIS_URL` + `OUTAGE_REDIS_TOKEN` (optional) | A free [Upstash](https://upstash.com) Redis REST database. Falls back to `RATE_LIMIT_REDIS_URL` / `RATE_LIMIT_REDIS_TOKEN` when those are set. |
| `OUTAGE_ALERT_TIMEZONE` (optional) | Time zone for times in the email, e.g. `America/Chicago` (UTC otherwise). |

**Why the extra key-value store.** During an outage the database can't tell Vantage who to email,
whether you already sent the notice, or whether the banner is on. Those live in a small Redis
store that isn't on the NAS. The list of addresses is copied there automatically every 12 hours
while a platform admin is signed in (the admin page shows "Outage contact list: N people,
refreshed … — Refresh now"; migration `0718_service_notice_recipients.sql`), and it is
encrypted (AES-256-GCM, key derived from `BETTER_AUTH_SECRET`) so Upstash only ever sees
ciphertext. Without the store, each Vercel server keeps its own memory: the alert still
arrives (possibly once from each server that noticed, capped at a few an hour), but the console
can only email you, not everyone, and the banner may not show on every server.

## Checklist

- [ ] UPS on the NAS and router
- [ ] DDNS name resolves to your public IP; port forward in place
- [ ] `psql "postgresql://vantage_app:...@<name>:<port>/vantage?sslmode=verify-full&sslrootcert=nas-ca.pem"` works from a phone hotspot (outside your network)
- [ ] The same as `postgres` from the hotspot is **refused**
- [ ] `npm run db:migrate -- --migration-env-file …` ends with every file `OK` or `SKIP`
- [ ] Vercel variables set; a deploy passes the schema check; sign-in works
- [ ] First encrypted snapshot uploaded and a restore drill done
- [ ] `PLATFORM_OWNER_EMAIL` and email set; an uptime monitor checks `/api/health` every 5 minutes
- [ ] (Optional) `OUTAGE_REDIS_URL` / `OUTAGE_REDIS_TOKEN` set, and the admin page shows the outage contact list
