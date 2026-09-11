# Putting Vantage on your own domain

*For operators of a self-hosted deployment. Last reviewed September 2026.*

By default a deployment lives at its `*.vercel.app` address. Attaching your own domain (say,
`vantage.yourteam.org`) takes five steps: Vercel, environment variables, Google, Stripe, email.

## 1. Vercel

1. Project → **Settings → Domains** → add the domain (add both the bare domain and `www`, and
   redirect one to the other).
2. Follow Vercel's DNS instructions and wait until the certificate shows **Ready**.
3. After the environment changes below, redeploy production.

## 2. Environment variables (Production)

| Variable | Set to |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | `https://your-domain` (no trailing slash) — used for canonical links, social previews, the sitemap and robots |
| `NEXT_PUBLIC_APP_URL` | The same origin — used for in-app links and trusted origins |
| `BETTER_AUTH_URL` | The same origin — sign-in and OAuth callbacks |
| `AUTH_TRUSTED_ORIGINS` | Optional, comma-separated: any other hosts that must keep working (for example `https://www.your-domain`, or the old Vercel address during the switch) |

## 3. Google sign-in

In the Google Cloud console, add `https://your-domain/api/auth/callback/google` as an authorized
redirect URI. Keep the old Vercel address listed until the switch is complete, then remove it.

## 4. Stripe (only if billing is enabled)

Checkout success and cancel pages are built from the address the checkout was opened on, so once the
new domain is primary, open checkout from it. Update the Customer Portal return URL and the webhook
endpoint in the Stripe dashboard if they still point at the Vercel address, and keep
`STRIPE_WEBHOOK_SECRET` matching the endpoint you use.

## 5. Email (Resend)

If your sending address changes with the domain, verify the new sending domain in Resend
(SPF and DKIM) and update `AUTH_EMAIL_FROM`.

## Check that it worked

- `https://your-domain/sitemap.xml` lists the new host
- View source on the home page: the canonical link and `og:url` use the new domain
- Sign in, including Google, round-trips on the new domain
- The waitlist form still submits

Until you have a domain, leave `NEXT_PUBLIC_SITE_URL` unset or pointed at the Vercel address;
everything falls back safely.
