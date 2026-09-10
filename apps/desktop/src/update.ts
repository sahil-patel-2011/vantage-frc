/**
 * Desktop update policy — pure decisions, no IO.
 *
 * Two different things get called "an update" around this shell, and conflating
 * them is how you end up shipping an updater that does nothing useful:
 *
 *  1. **The web app deployed.** Vantage is a hosted product; the window is a
 *     Chromium view of `vantage-frc-web.vercel.app`. A deploy reaches the user
 *     the moment the page reloads. That needs no binary at all — see
 *     `shouldReloadWeb` / `WEB_*` below.
 *  2. **The shell itself is out of date.** The navigation allowlist, the deep
 *     link scheme, the session gate, the preload bridge, and the Chromium/Node
 *     runtime all live in the installed .exe. A web deploy that adds an OAuth
 *     host or a new deep link *is* a shell change, and no amount of reloading
 *     fixes it. That is the only thing this module downloads.
 *
 * The owner's requirement is "update within 2 days, close the old version, pull
 * the new one, run it". The deadline here is real, but the *moment* of install
 * is never chosen by the clock alone. FRC teams run this at competitions on
 * unreliable wifi, and an installer that restarts the app during a match is a
 * worse bug than being two days stale. So the deadline decides *whether* an
 * update is owed; `installWindow` decides *when*, and it only ever says yes at
 * a moment when nothing is happening — or the app is already quitting.
 */

/** How long an update may sit un-installed before it is considered overdue. */
export const UPDATE_DEADLINE_MS = 2 * 24 * 60 * 60 * 1000;

/** No auto-install until the window has been untouched this long. */
export const IDLE_BEFORE_INSTALL_MS = 5 * 60 * 1000;

/** A long idle stretch is also when a stale page gets refreshed for free. */
export const IDLE_BEFORE_WEB_RELOAD_MS = 30 * 60 * 1000;

/** How often to ask for the manifest. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** First check waits this long so launch is not competing with the app loading. */
export const FIRST_CHECK_DELAY_MS = 45 * 1000;

/**
 * Product surfaces a team is actively using during a match or a pit cycle.
 * While the window is on one of these, no install is offered, no matter how
 * overdue — the page is the only reason the laptop is open.
 */
const LIVE_PATHS = [
  "/matches",
  "/scouting",
  "/pit",
  "/pit-repair-triage",
  "/display",
  "/strategy",
  "/command",
  "/whiteboard",
  "/alliance-selection-desk",
  "/field-reset-timer",
  "/match-checklist",
  "/inspection",
  "/hours/kiosk",
  "/chat",
];

/** Hosts an installer may be downloaded from. Anything else is refused. */
const DOWNLOAD_HOSTS = [
  "github.com",
  "objects.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "vantage-frc-web.vercel.app",
];

export type ReleaseManifest = {
  /** Newest published shell version, e.g. "0.3.0". */
  version: string;
  /**
   * Oldest shell version the *web app* still works with. When the running
   * shell is below this, the product is genuinely broken in this window and
   * the update stops being optional.
   */
  minimumVersion: string;
  /** https URL of the Windows NSIS installer. */
  url: string;
  /** Lowercase hex SHA-256 of the file at `url`. */
  sha256: string;
  notes?: string;
};

export type UpdateState = {
  /** When this shell first saw this version offered (ms epoch). */
  firstSeenAt?: number;
  /** Version the user pushed off, and until when. */
  deferredVersion?: string;
  deferredUntil?: number;
};

export type UpdatePlan =
  | { kind: "none" }
  | { kind: "optional"; version: string; deadlineAt: number }
  | { kind: "overdue"; version: string; deadlineAt: number }
  | { kind: "required"; version: string; deadlineAt: number };

/** "desktop-v0.2.0" / "v0.2.0" / "0.2.0" → [0, 2, 0]. */
export function parseVersion(raw: string | undefined | null): number[] | null {
  if (typeof raw !== "string") return null;
  const match = /(\d+(?:\.\d+)*)/.exec(raw.trim());
  if (!match) return null;
  const parts = match[1]!.split(".").map((piece) => Number.parseInt(piece, 10));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  return parts;
}

/** -1 / 0 / 1. Unparseable versions sort as equal so a bad manifest is inert. */
export function compareVersions(a: string | undefined, b: string | undefined): number {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return 0;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i] ?? 0;
    const r = right[i] ?? 0;
    if (l !== r) return l < r ? -1 : 1;
  }
  return 0;
}

function isAllowedDownloadUrl(raw: unknown): raw is string {
  if (typeof raw !== "string") return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return DOWNLOAD_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Validate a manifest off the network. Everything is checked before it is
 * allowed to influence anything: an attacker who can serve this file still
 * cannot point the shell at an arbitrary download host or a non-https URL, and
 * the digest is what actually authorises running the file (see the signing
 * note in docs/DESKTOP.md — these builds are unsigned, so the digest plus TLS
 * is the whole trust story and it is stated rather than pretended away).
 */
export function parseManifest(raw: unknown): ReleaseManifest | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const version = typeof row.version === "string" ? row.version.trim() : "";
  if (!parseVersion(version)) return null;

  const downloads =
    row.downloads && typeof row.downloads === "object" ? (row.downloads as Record<string, unknown>) : {};
  const url = isAllowedDownloadUrl(row.url)
    ? row.url
    : isAllowedDownloadUrl(downloads.win_nsis)
      ? downloads.win_nsis
      : null;
  if (!isAllowedDownloadUrl(url)) return null;

  const sha256 = typeof row.sha256 === "string" ? row.sha256.trim().toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;

  // A manifest that omits it means "no floor" — every version is still supported.
  const minimumRaw =
    typeof row.minimumSupported === "string"
      ? row.minimumSupported.trim()
      : typeof row.minimumVersion === "string"
        ? row.minimumVersion.trim()
        : "";
  const minimumVersion = parseVersion(minimumRaw) ? minimumRaw : "0.0.0";
  // A floor above the release being offered would strand the shell with nothing
  // to install; clamp it to the offered version.
  const clamped = compareVersions(minimumVersion, version) > 0 ? version : minimumVersion;

  const notes = typeof row.notes === "string" ? row.notes.slice(0, 2000) : undefined;
  return { version, minimumVersion: clamped, url, sha256, ...(notes ? { notes } : {}) };
}

/**
 * The GitHub Releases API payload for `desktop-v*` tags, reduced to a manifest.
 * The workflow publishes `latest.json` as a release asset because the API gives
 * no per-asset digest, so this is only the fallback shape for the asset list.
 */
export function manifestUrlForRepo(repo: string): string {
  return `https://github.com/${repo}/releases/latest/download/latest.json`;
}

/**
 * What, if anything, is owed. `state.firstSeenAt` is when this shell first saw
 * this version — the two-day clock starts there, not at the release date, so a
 * laptop that was in a bag for a month gets its full grace period.
 */
export function decideUpdate(input: {
  currentVersion: string;
  manifest: ReleaseManifest | null;
  now: number;
  state?: UpdateState;
}): UpdatePlan {
  const { currentVersion, manifest, now } = input;
  if (!manifest) return { kind: "none" };
  if (compareVersions(currentVersion, manifest.version) >= 0) return { kind: "none" };

  const state = input.state ?? {};
  const firstSeenAt = typeof state.firstSeenAt === "number" && state.firstSeenAt > 0 ? state.firstSeenAt : now;
  const deadlineAt = firstSeenAt + UPDATE_DEADLINE_MS;

  // Below the floor the web app declares: this window cannot work correctly, so
  // there is nothing to defer to. This is the only state that takes the window.
  if (compareVersions(currentVersion, manifest.minimumVersion) < 0) {
    return { kind: "required", version: manifest.version, deadlineAt };
  }

  const deferredHere =
    state.deferredVersion === manifest.version &&
    typeof state.deferredUntil === "number" &&
    state.deferredUntil > now;
  if (deferredHere) return { kind: "optional", version: manifest.version, deadlineAt };

  if (now >= deadlineAt) return { kind: "overdue", version: manifest.version, deadlineAt };
  return { kind: "optional", version: manifest.version, deadlineAt };
}

export type InstallContext = {
  plan: UpdatePlan;
  /** A verified installer is already on disk. Nothing installs without one. */
  downloadReady: boolean;
  now: number;
  /** ms since the last keyboard/pointer event in the window. */
  idleMs: number;
  windowFocused: boolean;
  /** Current page URL, or "" when the shell is on a local page. */
  currentUrl: string;
  online: boolean;
  /** Portable builds have no installer to run in place. */
  portable: boolean;
  /** The user pressed "Restart and update". Skips the idle requirement. */
  userRequested?: boolean;
};

export type InstallDecision = { install: boolean; reason: string };

export function isLiveOpsUrl(currentUrl: string): boolean {
  if (!currentUrl) return false;
  let path: string;
  try {
    path = new URL(currentUrl).pathname;
  } catch {
    return false;
  }
  const normalized = path.replace(/\/+$/, "") || "/";
  return LIVE_PATHS.some((live) => normalized === live || normalized.startsWith(`${live}/`));
}

/**
 * The competition-day safeguard, in one function.
 *
 * Nothing here can be reached by the deadline alone. Even an `overdue` or
 * `required` update has to clear: a verified download, an unfocused window,
 * five minutes without a keystroke, and a page that is not a live-ops surface.
 * A team scouting matches at an event fails the last three of those all day, so
 * the install simply waits — and lands the moment they close the laptop, via
 * `shouldInstallOnQuit`, which is the path that actually fires in practice.
 */
export function installWindow(context: InstallContext): InstallDecision {
  const { plan } = context;
  if (plan.kind === "none") return { install: false, reason: "up-to-date" };
  if (!context.downloadReady) return { install: false, reason: "no-verified-download" };
  if (context.portable) return { install: false, reason: "portable-build" };
  if (!context.online) return { install: false, reason: "offline" };

  if (context.userRequested) return { install: true, reason: "user-requested" };

  // Optional updates never interrupt anything; they ride out on quit.
  if (plan.kind === "optional") return { install: false, reason: "not-due-yet" };

  if (isLiveOpsUrl(context.currentUrl)) return { install: false, reason: "live-ops-surface" };
  if (context.windowFocused) return { install: false, reason: "window-in-use" };
  if (context.idleMs < IDLE_BEFORE_INSTALL_MS) return { install: false, reason: "recently-used" };

  return { install: true, reason: plan.kind === "required" ? "required-and-idle" : "overdue-and-idle" };
}

/**
 * Quitting is the one moment an install is free: the session is ending anyway,
 * so there is no match to interrupt and no unsaved page to lose. This is the
 * path that satisfies "within 2 days" for a team that closes the laptop nightly.
 */
export function shouldInstallOnQuit(input: {
  plan: UpdatePlan;
  downloadReady: boolean;
  portable: boolean;
}): boolean {
  if (input.portable || !input.downloadReady) return false;
  return input.plan.kind !== "none";
}

/**
 * Stale hosted page after a web deploy.
 *
 * The symptom is a 404 on a content-hashed `/_next/static/...` chunk: the build
 * the page was rendered from no longer exists on the origin, so the next route
 * change throws instead of navigating. Reloading fixes it, and reloading is
 * cheap — but not while somebody is typing into it.
 */
export function isStaleAssetRequest(url: string, statusCode: number): boolean {
  if (statusCode !== 404 && statusCode !== 403) return false;
  return /\/_next\/static\//.test(url);
}

export function shouldReloadWeb(input: {
  staleAssetSeen: boolean;
  idleMs: number;
  windowFocused: boolean;
  currentUrl: string;
  online: boolean;
  /** The page already failed to render — there is nothing left to protect. */
  pageBroken?: boolean;
}): boolean {
  if (!input.online) return false;
  if (!input.currentUrl.startsWith("http")) return false;
  if (input.pageBroken) return true;
  if (isLiveOpsUrl(input.currentUrl) && input.windowFocused) return false;
  if (input.staleAssetSeen && !input.windowFocused) return true;
  return input.idleMs >= IDLE_BEFORE_WEB_RELOAD_MS && !input.windowFocused;
}
