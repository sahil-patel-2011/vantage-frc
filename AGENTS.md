# Base44 dev environment notes

Run the stack with `docker compose -f docker-compose.base44.yml up -d` (web on host port 3000).
Services: `db` (postgres 17) → `install` (npm install) → `migrate` (`npm run db:migrate`) →
`roles` (creates the `vantage_*_login` logins the app URLs use) → `web` (`next dev`).

Non-obvious findings:

- **Use Alpine/musl images.** The `@next/swc-linux-x64-gnu` native binary crashes with `SIGBUS`
  on this microVM, which makes `next dev` print "Ready" and then exit 0 with no error. The musl
  build (`node:22-alpine`) works, so all Node services run on Alpine. If `node_modules` was
  installed by a glibc image, delete it and reinstall.
- `.next` and `/root/.cache/next-swc` live in named volumes, not the bind mount.
- Local Postgres has no SSL, so every connection URL carries `?sslmode=disable`.
  `scripts/run-migrations.mjs` was taught to honour `sslmode=disable` (it previously only skipped
  SSL for `localhost` hostnames).
- Migrations create the group roles (`vantage_app`, `vantage_auth`, `vantage_marketing`,
  `vantage_worker`) as NOLOGIN; the `roles` service adds one login per group.
- The app boots without external credentials — Stripe/Resend/CAD surfaces report
  `setup_required` by design. Outside production, sign-in emails go to an in-memory mailbox;
  use `npm run dev:otp` to read a code.

Verify: `curl -s -o /dev/null -w '%{http_code}' localhost:3000/` → 200.
