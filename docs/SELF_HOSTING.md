# Self-hosting Vantage

*For a team or organization that wants to run its own copy. Expect about an hour the first time.
Last reviewed September 2026.*

> **Before you start:** the hosted version at **https://vantage-frc-web.vercel.app** is free, already
> set up end to end, and needs nothing installed. Self-host only if you specifically want your own
> deployment on your own accounts.

## What you will end up with

- The Vantage web app running on **Vercel**
- A **PostgreSQL** database on **Neon** (the path this guide follows; a Supabase Postgres host also
  works — see [SUPABASE_CUTOVER.md](SUPABASE_CUTOVER.md))
- Sign-in by email code, optionally Google
- A first administrator account, ready to create your team and invite members

Everything else — CAD, GitHub, Discord, Slack, billing, a storage node, a Pi relay — is optional and
can be added later from the app's **Connectors** page, which tells you exactly what to set for each.

## What you need

- A GitHub account (to fork the repository)
- A Vercel account (the free Hobby plan is enough)
- A Neon account (the free plan is enough to start)
- Node.js 22 or newer on your computer, for running migrations
- Optional: a domain name

## 1. Fork and clone

Fork https://github.com/sahil-patel-2011/vantage-frc on GitHub, then clone your fork and install:

```sh
git clone https://github.com/<you>/vantage-frc.git
cd vantage-frc
npm install
```

## 2. Create the database

1. In Neon, create a project on **PostgreSQL 17** (the version the hosted deployment runs).
2. Copy the connection strings. Neon gives you a *pooled* and an *unpooled* URL; you will use both.
3. Create the login roles Vantage expects. The migrations create the group roles (`vantage_app`,
   `vantage_worker`, `vantage_auth`, `vantage_marketing`, `vantage_pairing`); you create one login
   per group and grant it the group. The exact SQL is in
   [DEPLOYMENT.md, section 2](DEPLOYMENT.md#2-neon-postgres-and-migrations).
4. Apply every migration, in order, with the admin URL:

```sh
DATABASE_ADMIN_URL="postgres://…" npm run db:migrate
```

There is no automatic migration on deploy. Each time you pull new migrations, run this again.

## 3. Create the Vercel project

1. Import your fork into Vercel. **Root Directory: the repository root** (not `apps/web`). The root
   `vercel.json` carries the monorepo build and the two scheduled jobs.
2. Add the environment variables. The minimum set is:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | Pooled URL, as the `vantage_app` login |
| `DATABASE_AUTH_URL` | Pooled URL, as the `vantage_auth` login |
| `DATABASE_ADMIN_URL` | Unpooled URL, as the `vantage_worker` login (used only by background jobs) |
| `MARKETING_DATABASE_URL` | Pooled URL, as the `vantage_marketing` login |
| `BETTER_AUTH_URL` | Your app's exact HTTPS origin, e.g. `https://vantage.yourteam.org` |
| `BETTER_AUTH_SECRET` | A long random string |
| `CRON_SECRET` | A long random string; the scheduled jobs refuse to run without it |
| `PLATFORM_OWNER_EMAIL` | The email address of your first administrator |
| `RESEND_API_KEY`, `AUTH_EMAIL_FROM` | Email delivery (sign-in codes, invitations) |

The complete list, with what each optional integration needs, is in
[DEPLOYMENT.md](DEPLOYMENT.md). If you used the Vercel–Neon integration, its variable names differ;
`node scripts/map-neon-env.mjs` maps them.

3. Deploy. The build needs no database or credentials to succeed.
4. Run the preflight against your environment and fix any FAIL rows:

```sh
npm run deploy:preflight
```

## 4. Create the first administrator

Vantage is invitation-only: a platform administrator creates each team and its owner, then owners
invite their members. Bootstrap the first administrator once, using the address in
`PLATFORM_OWNER_EMAIL`:

```sh
npx tsx scripts/bootstrap-platform-owner.ts
```

Then sign in, open **Admin** (the Global Team Manager at `/admin`), create your team with its owner,
and invite people. The security details of platform-admin access are in
[../SECURITY_OPERATIONS.md](../SECURITY_OPERATIONS.md).

## 5. Add integrations when you want them

Open **Settings → Connectors** in the app. Each connector shows its state — connected, ready, or
exactly which variable to set and which callback URL to register — so you can add them one at a
time:

- **Google sign-in**, **GitHub**, **Onshape** — OAuth apps you register with the provider
- **The Blue Alliance** — a free read key; without it, Competition screens stay empty
- **Discord**, **Slack** — a webhook pasted from your server
- **Stripe** — only if you intend to charge for plans
- **Storage node**, **Pi relay**, **Fusion relay** — devices you pair with a code

## 6. Keep it up to date

```sh
git pull upstream main
npm install
DATABASE_ADMIN_URL="postgres://…" npm run db:migrate
```

then let Vercel deploy `main`. Migrations are append-only, so running the command again is always
safe. Read [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md) before your first real event.

## Where to get help

- The runbook with every variable: [DEPLOYMENT.md](DEPLOYMENT.md)
- Custom domains: [CUSTOM_DOMAIN.md](CUSTOM_DOMAIN.md)
- Something broken: open an issue on GitHub with the output of `npm run deploy:preflight` (it prints
  no secrets)
