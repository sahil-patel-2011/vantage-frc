# Custom domain readiness (marketing + auth)

When you buy a domain for Vantage (e.g. `vantagefrc.com`), attach it in Vercel and set the
env vars below so SEO canonicals, Open Graph, Better Auth, and Stripe redirects leave
`*.vercel.app`.

## Vercel
1. Project **vantage-frc-web** → Settings → Domains → add the apex + `www` (redirect one to the other).
2. Wait for DNS + certificate Ready.
3. Production redeploy after env changes.

## Required env (Production)
| Key | Set to |
| --- | --- |
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain.com` (no trailing slash) — drives `metadataBase`, OG, sitemap, robots, `/llms.txt` |
| `NEXT_PUBLIC_APP_URL` | Same origin — used across app links and trusted-origin resolution |
| `BETTER_AUTH_URL` | Same origin — Better Auth base URL / OAuth callbacks |
| `AUTH_TRUSTED_ORIGINS` | Optional comma list if you keep preview or alternate hosts (e.g. `https://www.your-domain.com`) |

`packages/core` `resolveAuthTrustedOrigins` already allows `NEXT_PUBLIC_SITE_URL`,
`NEXT_PUBLIC_APP_URL`, the production Vercel host, and `AUTH_TRUSTED_ORIGINS`.

## Google OAuth
Add authorized redirect URI:
`https://your-domain.com/api/auth/callback/google`
(and keep the Vercel URL until cutover is complete).

## Stripe
Checkout `success_url` / `cancel_url` are built from the **request origin** in
`apps/web/app/api/billing/checkout/route.ts`. After the custom domain is primary, open
checkout from that host. Update Stripe Customer Portal / webhook endpoint URLs if they
still point at `vantage-frc-web.vercel.app`. Keep `STRIPE_SECRET_KEY` and
`STRIPE_WEBHOOK_SECRET` in sync with the Dashboard endpoint you use.

## Email (Resend)
If `AUTH_EMAIL_FROM` / magic links embed an origin, ensure links resolve on the new domain.
Update any Resend domain auth (SPF/DKIM) for the sending domain.

## Verify after cutover
- `https://your-domain.com/sitemap.xml` uses the new host
- View-source: `og:url` / canonical match the custom domain
- `https://your-domain.com/llms.txt` and `/llms-full.txt` load
- Sign-in + Google OAuth round-trip
- Waitlist submit still works

Until the domain is purchased, leave `NEXT_PUBLIC_SITE_URL` unset or pointed at
`https://vantage-frc-web.vercel.app` — SEO helpers fall back safely.
