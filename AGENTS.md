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

- Media is temporarily disabled with the shared `MEDIA_ENABLED` switch in
  `apps/web/lib/media-availability.ts`. It gates media routes, hub tabs, upload
  routing, scouting media queues and photo controls. Set it to true and redeploy
  to restore the feature; no stored media or schemas were deleted. Existing
  financial receipts and branding may still be viewed, but not newly uploaded.
- Home uses `DashboardHomeView` and the existing saved board API again. Do not
  rewire it to `dashboard-redesign.tsx`: that older mock uses invented metrics,
  and `scouting-filter.tsx` scales totals rather than filtering real records.
  Card task/scouting actions reuse `/api/todos` and the real `ScoutingClient`.
- PostgreSQL remains the app's database. No Base44 database migration has been
  performed: native Base44 database provisioning/access is unavailable in this
  imported-app environment. A second PostgreSQL connection is not configured.
- Regression checks: `npm test -- apps/web/lib/media-availability.test.ts
  apps/web/lib/dashboard/grid-drag.test.ts apps/web/lib/dashboard/catalog.test.ts`.
