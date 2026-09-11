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

## Updating

Two different things get called "an update", and the shell treats them differently
because only one of them needs a download.

**The web app deploying.** Vantage is a hosted product; this window is a Chromium
view of it. A deploy reaches you when the page reloads — no binary involved. The
shell notices a deploy two ways: a 404 on a content-hashed `/_next/static/` chunk
(the build the open page came from is gone), and a main-frame load failure on the
app origin. It then does one hard reload, but only when that is safe — never while
the window is focused on a match-day screen, and at most once every two minutes so
an origin that is genuinely down turns into the offline screen instead of a reload
loop. A window left idle for 30 minutes refreshes anyway, which is how most deploys
land without anyone noticing.

**The shell binary being out of date.** The navigation allowlist, deep links, the
preload bridge, and the Chromium/Node runtime live in the installed .exe, and no
amount of reloading updates those. This is the only thing the shell downloads.

### How the binary update works

`apps/desktop/src/update.ts` holds every decision (pure, unit-tested in
`test/update.test.ts`); `update-service.ts` does the fetching and spawning.

1. On launch (+45 s) and every 6 h the shell fetches a manifest — first
   `<app origin>/api/desktop/release`, then, as the always-present fallback,
   `https://github.com/<repo>/releases/latest/download/latest.json`, published by
   `.github/workflows/desktop.yml`. Shape:
   `{ version, minimumVersion, url, sha256 }`.
2. The manifest is validated before it can influence anything: https only, host on
   a short allowlist (github.com / its asset hosts / the app origin), and a
   64-hex SHA-256. A malformed manifest is inert, not fatal.
3. If `version` is newer, the installer is downloaded to the app's user-data dir
   and its SHA-256 checked. A mismatch deletes the file.
4. **A two-day clock starts the first time this shell sees that version** — not at
   the release date, so a laptop that spent a month in a bag still gets its full
   grace period.

### When it actually installs — the competition-day rule

An FRC team runs this at events on unreliable wifi. An installer that restarts the
app during a match is worse than being two days stale, so the deadline decides
*whether* an update is owed and never *when* it lands. Every install has to clear
all of:

- a verified download on disk,
- the window not focused,
- five minutes with no keyboard or pointer input,
- the current page not a live-ops surface (`/matches`, `/scouting`, `/pit`,
  `/display/*`, `/strategy`, `/command`, `/whiteboard`, `/hours/kiosk`, …),
- online.

A team scouting at an event fails three of those all day, so nothing happens.

The path that actually delivers "within two days" is **quit**: on `before-quit` a
pending installer is spawned detached with `/S --force-run`, which replaces the app
and relaunches it. The session was already over, so there is nothing to interrupt.
"Update and restart" in the update window is the manual override and skips the idle
wait — a person asking for it is not mid-match.

The one case that takes the window is a **required** update: `minimumVersion` above
the running version means the web app has declared this shell unsupported, so the
product is already broken here and `update.html` says so instead of pretending.
Raise `MINIMUM_SHELL_VERSION` in the release workflow only when that is really true.

### What unsigned builds mean for this

These are unsigned (`signAndEditExecutable: false`, no Authenticode cert), so the
trust chain is **TLS to an allowlisted host plus the manifest's SHA-256** — checked
before the file is executed. That is genuinely weaker than a signed installer:
anyone who could serve both the manifest and the asset from a trusted host could
serve a different build. `electron-updater` would be no stronger here for exactly
the same reason, which is why this is a small hand-rolled updater instead — it also
handles the **portable** target, which electron-updater cannot update at all. The
portable build is told about the new version and pointed at the download; it is
never restarted, because there is no installer to run in place.

`/api/desktop/release` is public. It returns `{ version, minimumSupported, url, sha256, downloads: { win_msi, win_nsis, mac_dmg }, unsigned: true }` from GitHub `latest.json`, or 503 with an honest empty body when no `desktop-v*` release exists.

## Signing and notarization (owner must buy)

Builds are unsigned unless these env vars exist on the GitHub Actions runners:

| Variable | What it is |
|---|---|
| `CSC_LINK` | Path or URL to the Windows Authenticode (or macOS Developer ID) certificate |
| `CSC_KEY_PASSWORD` | Password for that certificate |
| `APPLE_ID` | Apple ID for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password |
| `APPLE_TEAM_ID` | Apple Team ID |

Until those are set, `CSC_IDENTITY_AUTO_DISCOVERY=false` and the installer license (`apps/desktop/build/UNSIGNED.txt`) says the build is unsigned. SmartScreen and Gatekeeper will warn. That is honest, not a bug.

macOS DMG/universal builds run on `macos-latest` in `.github/workflows/desktop.yml`. They cannot be produced on a Windows shop laptop.

## Installer (unsigned)

```text
npm run desktop:dist        # Windows NSIS + MSI + portable
npm run dist:mac --workspace=@vantage/desktop   # macOS DMG + zip (macOS only)
```

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

Outputs under `apps/desktop/release/` (NSIS setup + portable exe). Windows SmartScreen will warn until Authenticode certs exist. Fusion CAD still uses `vantage-cad` on the machine (`docs/CAD_RELAY.md`).

Tagged builds (`desktop-v*`) also publish those exes to GitHub Releases. Marketing copy lives at `/desktop`.

Google sign-in uses a Chromium user agent with the Electron token stripped so OAuth is not treated as an embedded WebView.

## Implementation notes

- `apps/desktop/src/allowlist.ts` — pure navigation/gate/deep-link policy (unit-tested in
  `apps/desktop/test/allowlist.test.ts`).
- `apps/desktop/src/window-state.ts` — pure bounds sanitizing/clamping.
- `apps/desktop/src/main.ts` — wiring: cookie-jar session check
  (Better Auth `…session_token` cookie presence gates the shell; the server stays the
  authority on validity), navigation guards, menu, offline/gate pages, protocol handler.
- `apps/desktop/src/update.ts` — update policy: version compare, manifest validation,
  the two-day clock, and the install-window / web-reload safeguards (unit-tested).
- `apps/desktop/src/update-service.ts` — the IO: manifest fetch, download + SHA-256,
  detached silent install, stale-page reload.
- `apps/desktop/gate.html` / `offline.html` / `update.html` — local shell pages,
  shipped in the package.
