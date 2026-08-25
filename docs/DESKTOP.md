# Vantage desktop

Windows desktop shell around the hosted Vantage web app (`https://vantage-frc-web.vercel.app`).
It is not a second backend. Auth, RLS, billing, and CAD jobs stay on the web deployment.

## Requirements

**A Vantage account.** The shell is account-gated: with no session it shows a local
"Sign in to continue" screen and only permits the sign-in flow (Google OAuth / email OTP)
plus the public marketing pages. Access to Vantage itself is closed — your team owner or
admin invites your exact email; everyone else lands on the waitlist.

## What the desktop build adds

- **Stays signed in.** The session lives in a persisted Electron partition
  (`persist:vantage`), so one sign-in survives restarts until the session expires
  or you sign out.
- **Account gate.** Signed out, the shell hard-blocks navigation to anything but the
  sign-in flow and public pages; signing in (or out) flips the gate live via the
  session cookie — no restart needed.
- **Native window behavior.** Window size/position/maximized state restore between
  launches (`window-state.json` under the app's user-data dir, clamped to the current
  displays), a real app menu with standard shortcuts (reload, zoom, back/forward,
  fullscreen), and single-instance focus.
- **Locked-down navigation.** An allowlist covers production Vantage, localhost dev,
  and the OAuth/checkout hosts the product actually uses (Google, Stripe, Onshape,
  GitHub); anything else opens in the system browser instead of the shell.
- **Branded offline screen** with a retry button when the hosted app is unreachable.
- **Deep links.** `vantage-frc://open/<path>` (e.g. `vantage-frc://open/build?tab=cad`)
  focuses the running window and routes into the app; signed out, the link is held
  until sign-in completes.

There is **no auto-update**: install a newer release yourself when one is tagged.

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

## Implementation notes

- `apps/desktop/src/allowlist.ts` — pure navigation/gate/deep-link policy (unit-tested in
  `apps/desktop/test/allowlist.test.ts`).
- `apps/desktop/src/window-state.ts` — pure bounds sanitizing/clamping.
- `apps/desktop/src/main.ts` — wiring: cookie-jar session check
  (Better Auth `…session_token` cookie presence gates the shell; the server stays the
  authority on validity), navigation guards, menu, offline/gate pages, protocol handler.
- `apps/desktop/gate.html` / `offline.html` — local shell pages, shipped in the package.
