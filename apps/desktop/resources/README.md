# Optional Onshape UI resources

The normal desktop shell can ship without these resources. Its CAD entry reports
`setup_required`; it never installs or downloads a browser at runtime.

The explicit release helper `scripts/cad/bundle-desktop-ui.mjs` bundles the isolated
UI worker and stages the already available Playwright packages plus an explicitly
supplied browser directory. It does not install dependencies, download Chromium or
launch anything. Generated `onshape-ui/<platform>-<arch>/` directories are ignored
by Git and copied recursively into Electron's resources by `build.extraResources`.
Each directory contains its own worker, manifest, Playwright packages and browser.

Run staging only in an authorized release environment with a browser build matching
the pinned Playwright version. The operator supplies `--browser-dir` and
`--browser-executable` as absolute paths to that pre-provisioned browser.

Resources are specific to the release host's OS and CPU architecture. The staging
helper replaces only its host's directory and preserves other target directories.
For a universal macOS release, stage on each corresponding authorized host and
assemble both `onshape-ui/darwin-arm64/` and `onshape-ui/darwin-x64/` in the release
resources before packaging. Windows x64 uses `onshape-ui/win32-x64/`.
The running shell selects only its matching platform/architecture directory,
checks the manifest and refuses mismatches. Missing matching resources report
`setup_required`; there is no fallback to a different architecture. Accept each
architecture separately, including its signing and browser launch behavior.

The worker communicates only with Electron's parent message port. It exposes no
TCP server, does not reuse the legacy API MCP transport and receives no Vantage
session cookies. The main process rechecks the current session and Team 6925
eligibility before browser commands. Closing CAD, leaving its owning Vantage page,
changing the Vantage account, or quitting the app stops the worker and browser.

Packaged macOS/Windows execution, signing/notarization, browser cleanup and full CAD
acceptance remain unverified. Staging files is not production-readiness evidence.
