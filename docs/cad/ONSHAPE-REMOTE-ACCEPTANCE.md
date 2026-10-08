# One-off remote acceptance: Onshape browser CAD

Status: **prepared, not executed**. This document is a proposed runbook, not
authorization to run a workflow, install dependencies, use a database or deploy.
Never execute it on the user's laptop. Record the approved remote hosts, exact
candidate commit, operator and verified remaining allowance before starting.

October 8 decision: the user has no remote Mac/Windows machines and explicitly
deferred installed-app testing. Continue source review without repeatedly asking
for hosts. Deferred checks remain unverified; do not report them as passed or the
desktop feature as production accepted.

The user explicitly prohibited Neon access on October 8. The database procedure
below is a description of the current PostgreSQL implementation's requirements,
not permission to use Neon or another provider. No authorized replacement test
database or NAS has been supplied. Do not run that procedure or apply production
migrations until an allowed destination exists; do not bypass the schema gate.

## Smallest useful run

Use one authorized Windows x64 release host and one authorized macOS release host
for source checks and staging. A universal Mac release additionally needs both
`darwin-arm64` and `darwin-x64` resources, and native installed acceptance on each
Mac architecture. Do not call one ARM Mac run proof of Intel compatibility.
One authorized isolated remote PostgreSQL destination can serve the schema test;
do not create a database on either developer laptop or use production data.

Run the scoped source checks once at the candidate commit. Repeat only the
platform-dependent checks on the other OS, and rerun affected checks after fixes.
Run the real model journey on each supported installed target. Retain private
evidence for that commit; avoid repeated full workflows or automatic deployments.

Required input record:

| Input | Required evidence |
| --- | --- |
| Remote hosts | Names, OS, CPU architecture, interactive desktop access and explicit owner authorization |
| Compute allowance | Actual remaining included allowance and cost ceiling; no inference from plan names |
| Candidate | Commit SHA and private artifact destination; use an ordinary branch, not a release tag |
| Browser | Already provisioned Chromium build matching installed Playwright 1.61.1; full directory and executable paths |
| Credential adapter | Already provisioned target `keytar` package with its compiled `keytar.node`; mandatory for Windows MCP pairing |
| MCP client | Named/versioned desktop client supporting MCPB and Node 22, installed on the authorized host |
| Hosted candidate | Existing approved test deployment, named member accounts and permitted disposable Onshape folder |
| Database | Isolated remote database named with a `test` or `ci` segment, approved hostname, migration-owner credential and no existing Team 6925 |
| Native AI journey | Approved provider configuration and actual budget; external MCP client and native Vantage AI are separate paths |

## Existing workflow limitations

`.github/workflows/desktop.yml` is manual-only and repository Actions remains
disabled. **Do not enable or dispatch it without fresh authorization and verified
allowance.** This runbook does not change that state.

The saved desktop workflow is insufficient for CAD acceptance: it packages the
shell without staging the CAD worker/browser, does not build MCPB, and does not
exercise an installed Electron app. Its release job now requires both platform
jobs to succeed and both Windows NSIS and macOS DMG artifacts to exist, but still
marks the release latest. Do not
use its tag path for private acceptance or count its unsigned shell artifacts as
accepted CAD releases. No replacement workflow is required to follow this recipe
on already authorized remote release hosts.

The root Vitest configuration includes `*.test.ts`; it does **not** include the
Node test `scripts/cad/packaging-resources.test.mjs`, which needs the separate
command below. Existing `tests/browser/*onshape*` specifications exercise older
hosted CAD/link flows, not the new Playwright-owned browser or MCPB lifecycle.

## 1. Scoped source verification

On an authorized remote checkout of the exact candidate, provision lockfile
dependencies once if absent. Do not run repository install/build scripts on the
laptop. Keep production credentials and `.env.production.local` out of the test
checkout. Database tests are excluded from this source-only pass.

From the repository root:

```sh
npm ci
npm run typecheck --workspace=@vantage/cad-cli
npm run typecheck --workspace=@vantage/desktop
npm run typecheck --workspace=@vantage/web
npm test -- packages/vantage-cad-cli/src/onshape-ui packages/vantage-cad-cli/test/onshape-ui-intent.test.ts packages/vantage-cad-cli/test/onshape-ui-workflows.test.ts apps/desktop/test apps/web/app/api/cad/browser-agent apps/web/app/api/cad/pair apps/web/lib/cad/browser-pilot-access.test.ts apps/web/lib/cad/browser-turn.test.ts apps/web/lib/cad/browser-progress.test.ts apps/web/proxy-browser-pilot.test.ts scripts/production-schema-preflight.test.ts
node --test scripts/cad/packaging-resources.test.mjs
npm run build --workspace=@vantage/web
```

Stop on failures. Keep the normal production-schema gate enabled; a nonproduction
build is not proof that production migrations exist. Capture actual test counts,
skips and diagnostics. The symlink fixture is deliberately skipped on Windows
because creating links may require privileges; it must pass on macOS, followed
by real archive/extraction verification on Windows.

On the second OS, at minimum repeat desktop tests, browser setup/lifecycle and
extension tests, the packaging header checks, and native staging/installation.
Pure route mocks and the remote SQL fixture do not need duplicate OS runs unless
the candidate changed or a platform-specific failure requires them.

## 2. Isolated schema and authorization verification

Use a separate remote checkout/session with only the authorized **test** migration
credential. The full ordered migration chain is required, including 0710–0716;
applying 0716 alone to an incomplete schema is not supported. Inspect the target
hostname/database name before authorizing the runner. The runner has no CAD-specific
test-host guard and must never inherit a production database URL.

The operator supplies a protected test-only env file and sets
`ONSHAPE_PILOT_TEST_DATABASE_URL` and `ONSHAPE_PILOT_TEST_DATABASE_HOST` in the remote
secret environment. Do not paste credentials into commands or captured output.
The test credential must insert isolated fixture rows and `SET LOCAL ROLE` to
`vantage_pairing` and `vantage_app`; an ordinary application login is insufficient.

```sh
node scripts/run-migrations.mjs --migration-env-file /authorized/private/onshape-test.env
npm test -- packages/db/src/onshape-browser-pilot-postgres.test.ts
```

The env-file path above is an operator-supplied placeholder. The migration runner
prefers process variables over that file, so the remote session must have no
conflicting `DATABASE_ADMIN_URL`, unpooled aliases or production variables.
Require **one executed SQL test, zero skipped tests**, and rollback of its fixture
transaction. With no `ONSHAPE_PILOT_TEST_DATABASE_URL`, this suite skips rather
than proving anything. It rejects loopback hosts, a hostname different from the
explicit approved host, a database without a `test`/`ci` name segment, and an
existing Team 6925 fixture.

The fixture proves the database-function role boundary, enrollment session,
membership departure, org binding, wrong platform/scope, revocation, auth method,
email verification and MFA expiry. It does not exercise delivered sign-in emails,
browser session cookies, HTTP middleware, real pairing UI, or packaged credential
storage. Those remain in the hosted journey below.

## 3. Stage native artifacts once

For each target, the release operator provides `CAD_BROWSER_DIR`,
`CAD_BROWSER_EXECUTABLE`, and, where needed, `CAD_KEYTAR_DIR` as paths to already
provisioned matching assets. Do not substitute a browser from another CPU, a
system browser with an unknown version, or a package missing its native adapter.

On macOS (shell environment paths are operator-provided):

```sh
node scripts/cad/bundle-desktop-ui.mjs --browser-dir "$CAD_BROWSER_DIR" --browser-executable "$CAD_BROWSER_EXECUTABLE"
node scripts/cad/bundle-onshape-mcpb.mjs --keytar-dir "$CAD_KEYTAR_DIR"
```

On Windows PowerShell:

```powershell
node scripts/cad/bundle-desktop-ui.mjs --browser-dir "$env:CAD_BROWSER_DIR" --browser-executable "$env:CAD_BROWSER_EXECUTABLE"
node scripts/cad/bundle-onshape-mcpb.mjs --keytar-dir "$env:CAD_KEYTAR_DIR"
```

Mac can omit `--keytar-dir` only when deliberately accepting the documented local
file credential fallback. Confirm that choice in evidence; do not accidentally
lose access to an existing OS-vault pairing. Windows staging requires the native
adapter. Header checks prove binary architecture, not successful loading or
Chromium revision compatibility.

For the universal Mac shell, securely transfer the two staged architecture
directories from their respective authorized hosts into the same release
checkout, preserving relative framework links and executable modes. Require both
`apps/desktop/resources/onshape-ui/darwin-arm64/` and `darwin-x64/` before packaging.
Do not rebuild one staged directory with the other architecture's browser.

```sh
npm run dist:mac --workspace=@vantage/desktop
```

On Windows:

```powershell
npm run dist --workspace=@vantage/desktop
```

Use the **already provisioned official MCPB tooling** to validate, pack and sign
each `dist/onshape-mcpb/<platform>-<arch>/` directory. For Windows x64, the
[official CLI](https://github.com/modelcontextprotocol/mcpb/blob/main/CLI.md)
commands are:

```sh
mcpb validate dist/onshape-mcpb/win32-x64/manifest.json
mcpb pack dist/onshape-mcpb/win32-x64 dist/onshape-mcpb/vantage-onshape-win32-x64.mcpb
```

Repeat with `darwin-arm64` and `darwin-x64` on their respective targets. Signed
release acceptance additionally runs `mcpb sign` with the approved certificate/key
paths and `mcpb verify` on each archive; do not substitute a self-signed development
certificate for client trust. Do not use `npx` to fetch a different release during acceptance.
Keep architecture in the archive name. The staging helper produces a directory,
not an installable signed extension, and must not be reported as the latter.

Inspect the extracted installed artifact, not just the checkout: worker at the
matching resource path, both Playwright packages with matching versions, native
browser and complete framework/data files, and working OS credential adapter in
the MCPB package. Verify all paths stay inside the installed artifact.

## 4. Hosted and installed acceptance matrix

Install only on the named remote machines. Use disposable Onshape documents and
test members. Do not make production enrollment or document changes for a fixture.

| Journey | Required observed result |
| --- | --- |
| MCPB install and initialize | Client displays tools promptly with no browser launch, polling loop or credential prompt in chat |
| New pairing | Human follows Vantage link, sees Onshape selected, chooses authorized team; one check saves server-issued credential; no token in client output/logs |
| Pilot enrollment | Pairing alone is denied; current Browser CAD approval makes status eligible |
| Existing pairing | Reused without overwrite; replacement requires explicit intent; failed approval/save leaves existing credential intact |
| Wrong/expired approval | Another team or wrong CAD platform cannot open the pilot; expired code, denied MFA, revoked device and departed member fail closed |
| Native app | Sign in in Vantage, open Browser CAD, explicitly launch, send a native AI turn; credentials/observations stay tied to the owning page/account |
| Browser lifecycle | Start/stop, close window, app quit, leave CAD page, sign out, early stop during launch, denied access and network loss leave no owned browser/worker after confirmed stop |
| Missing assets | Missing/wrong-architecture browser or native credential adapter produces setup required; no download/API fallback |
| Stale or unsafe action | Changed observation, duplicate tree names, wrong document/tab, unsupported action and popup pause; uncertain action is not retried blindly |
| Model | Create a new 60 × 40 × 10 mm block, reopen dimensions, assign Aluminum 6061, inspect selected-part volume/mass/inertia and frame; no missing material is treated as zero mass |
| Correction | Change an explicit dimension, observe regeneration and independently reread dimensions/properties; preserve original user documents |
| Multi-team/account | Second team/account cannot see or execute the first team's browser session; switching account stops the previous owner |
| Provider/client failure | Cancellation, malformed AI plan, provider limit/error, stale response and image bounds fail cleanly without duplicate usage or geometry changes |

Record the exact app/client/browser versions, OS/CPU, candidate SHA, screenshots
of final geometry/properties, safe tool transcript, artifact digests, test output
and OS process evidence after stop. Mask credentials and private account data.
No performance claim follows from a simple block: benchmark agreed complex
drawings separately, with time to clarification, regeneration, recovery and final
verification included. Report medians and tail times, not a four-minute guarantee.

## Signing boundary and remaining harness gaps

Unsigned private artifacts can establish that an installed process launches and
the UI workflow operates on the remote machine. They cannot establish trusted
installation, updater provenance, Gatekeeper/notarization or SmartScreen behavior.
The current Windows config deliberately sets `signAndEditExecutable: false` and
the saved workflow disables certificate discovery. A signed release needs an
authorized signing configuration and Authenticode certificate/key access; adding
credentials alone does not override that false setting. Do not publish unsigned
acceptance artifacts as a signed production release.

Mac production requires the approved Apple Developer ID identity and notarization
credentials/service access, correct entitlements and signing of nested browser
helpers/frameworks followed by stapling/verification. MCPB signing and target
client trust are separate acceptance items. Keys must stay in the remote secret
store and must not appear in this repository, screenshots or logs.

Current automated source tests use fake browser/controller transports. There is
no installed-Electron acceptance harness, MCPB import/launch harness, full
human-sign-in Onshape fixture, or automated end-to-end browser pairing test. The
matrix above must be run interactively and recorded until those harnesses exist;
unit tests must not be used to mark those rows passed. Packaging file checks do
not verify native addon loading, framework extraction or runtime process cleanup.

After this matrix passes, production migrations, deployment allowance, signing,
one intentional deployment and a hosted smoke check remain separate authorized
release steps. A failure at any gate keeps the candidate in its draft PR. Record
failure and fix, then rerun the affected path at the new commit before advancing.
