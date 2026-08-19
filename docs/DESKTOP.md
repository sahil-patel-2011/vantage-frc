# Vantage desktop

Windows desktop shell around the hosted Vantage web app (`https://vantage-frc-web.vercel.app`).
It is not a second backend. Auth, RLS, billing, and CAD jobs stay on the web deployment.

## Run

```text
npm install
npm run desktop:dev
```

Local web instead of production:

```text
$env:VANTAGE_URL="http://localhost:3001"
npm run desktop:dev
```

Hostile `VANTAGE_URL` values are ignored and production is used.

## Installer (unsigned)

```text
npm run desktop:dist
```

Outputs under `apps/desktop/release/` (NSIS setup + portable exe). Windows SmartScreen will warn until Authenticode certs exist. Fusion CAD still uses `vantage-cad` on the machine (`CAD_RELAY.md`).

Tagged builds (`desktop-v*`) also publish those exes to GitHub Releases. Marketing copy lives at `/desktop`.

Google sign-in uses a Chromium user agent with the Electron token stripped so OAuth is not treated as an embedded WebView.
