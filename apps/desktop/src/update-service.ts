/**
 * The IO half of desktop updating. Every decision lives in `update.ts` (pure,
 * unit-tested); this file only fetches, hashes, writes, and spawns.
 *
 * What it actually updates, and what it deliberately does not:
 *
 *  - **The hosted web app** is not downloaded. It is a website; a deploy lands
 *    when the page reloads. `noteAssetStatus` + `maybeReloadWeb` do that, and
 *    they are the part that fires for almost every real "the web app updated"
 *    event.
 *  - **The shell binary** — allowlist, deep links, preload bridge, Chromium — is
 *    the only thing fetched, because it is the only thing a reload cannot fix.
 *
 * Trust model, stated rather than implied: these builds are **unsigned**
 * (`signAndEditExecutable: false`, no Authenticode cert). So the chain is TLS to
 * an allowlisted host plus a SHA-256 from the manifest, checked before the file
 * is ever executed. That is strictly weaker than a signed installer — anyone who
 * can serve both the manifest and the asset over a trusted host could serve a
 * different build. It is the strongest thing available without certificates, and
 * `electron-updater` would be no stronger here for the same reason.
 */
import { app, BrowserWindow, net, shell, type Session } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, promises as fs } from "node:fs";
import { basename, join } from "node:path";
import { pipeline } from "node:stream/promises";
import {
  CHECK_INTERVAL_MS,
  FIRST_CHECK_DELAY_MS,
  decideUpdate,
  installWindow,
  isLiveOpsUrl,
  isStaleAssetRequest,
  manifestUrlForRepo,
  parseManifest,
  shouldInstallOnQuit,
  shouldReloadWeb,
  type ReleaseManifest,
  type UpdatePlan,
  type UpdateState,
} from "./update";

const REPO = "sahil-patel-2011/vantage-frc";
const STATE_FILE = "update-state.json";
const DOWNLOAD_DIR = "updates";
/** A shell that cannot even reach the manifest should not spin on it. */
const FETCH_TIMEOUT_MS = 20_000;
/** Guardrail against a manifest pointing at something enormous. */
const MAX_INSTALLER_BYTES = 400 * 1024 * 1024;
/** One self-heal reload per this window, so a down server cannot become a loop. */
const HEAL_COOLDOWN_MS = 2 * 60 * 1000;

export type UpdateStatus = {
  currentVersion: string;
  plan: UpdatePlan;
  manifest: ReleaseManifest | null;
  downloadReady: boolean;
  downloading: boolean;
  portable: boolean;
  lastError: string | null;
};

/**
 * electron-builder's portable target sets this. A portable .exe has no
 * installer to re-run in place, so it is told, never restarted.
 */
function isPortableBuild(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_FILE);
}

export class UpdateService {
  private readonly origin: string;
  private manifest: ReleaseManifest | null = null;
  private state: UpdateState = {};
  private downloadedPath: string | null = null;
  private downloading = false;
  private lastError: string | null = null;
  private lastInputAt = Date.now();
  private staleAssetSeen = false;
  private timers: NodeJS.Timeout[] = [];
  private installing = false;
  private lastHealAt = 0;
  private onChange: (status: UpdateStatus) => void = () => undefined;

  constructor(origin: string) {
    this.origin = origin;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async start(onChange: (status: UpdateStatus) => void) {
    this.onChange = onChange;
    this.state = await this.readState();
    this.timers.push(setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS));
    this.timers.push(setInterval(() => void this.check(), CHECK_INTERVAL_MS));
    // The install window is a *moment*, not an event — poll for it rather than
    // hoping a blur or an idle timer lines up with the deadline.
    this.timers.push(setInterval(() => void this.maybeInstall(), 60_000));
    this.timers.push(setInterval(() => this.maybeReloadWeb(), 60_000));
  }

  stop() {
    for (const timer of this.timers) clearTimeout(timer as NodeJS.Timeout);
    for (const timer of this.timers) clearInterval(timer as NodeJS.Timeout);
    this.timers = [];
  }

  /** Keyboard/pointer activity in the window resets the idle clock. */
  trackWindow(window: BrowserWindow) {
    const touch = () => {
      this.lastInputAt = Date.now();
    };
    window.webContents.on("input-event", touch);
    window.on("focus", touch);
    window.webContents.on("did-navigate", touch);
    window.webContents.on("did-navigate-in-page", touch);
  }

  /**
   * A 404 on a content-hashed `/_next/static/` chunk means the build this page
   * was rendered from is gone from the origin — i.e. the web app deployed under
   * us. That is the signal to reload, once it is safe to.
   */
  watchSession(session: Session) {
    session.webRequest.onCompleted({ urls: [`${this.origin}/_next/static/*`] }, (details) => {
      if (isStaleAssetRequest(details.url, details.statusCode)) this.staleAssetSeen = true;
    });
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  private currentVersion(): string {
    return app.getVersion();
  }

  plan(): UpdatePlan {
    return decideUpdate({
      currentVersion: this.currentVersion(),
      manifest: this.manifest,
      now: Date.now(),
      state: this.state,
    });
  }

  status(): UpdateStatus {
    return {
      currentVersion: this.currentVersion(),
      plan: this.plan(),
      manifest: this.manifest,
      downloadReady: this.downloadedPath !== null,
      downloading: this.downloading,
      portable: isPortableBuild(),
      lastError: this.lastError,
    };
  }

  private emit() {
    try {
      this.onChange(this.status());
    } catch {
      // A broken listener must never take the shell down.
    }
  }

  // -------------------------------------------------------------------------
  // Manifest
  // -------------------------------------------------------------------------

  private async fetchJson(url: string): Promise<unknown> {
    const response = await net.fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`${response.status}`);
    return (await response.json()) as unknown;
  }

  /**
   * The web app gets first say, because it is the thing that knows which shell
   * versions it still supports (`minimumVersion`). That endpoint is optional —
   * it lives in apps/web, which this agent does not own — and its absence is a
   * 404, not an error, so the GitHub release manifest is the always-present
   * fallback and the shell works today either way.
   */
  async check(): Promise<void> {
    if (this.installing) return;
    const sources = [`${this.origin}/api/desktop/release`, manifestUrlForRepo(REPO)];
    for (const source of sources) {
      try {
        const manifest = parseManifest(await this.fetchJson(source));
        if (!manifest) continue;
        this.applyManifest(manifest);
        this.lastError = null;
        this.emit();
        await this.maybeDownload();
        await this.maybeInstall();
        return;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : String(error);
      }
    }
    this.emit();
  }

  private applyManifest(manifest: ReleaseManifest) {
    const changed = this.manifest?.version !== manifest.version;
    this.manifest = manifest;
    if (changed) {
      // A new version resets both the two-day clock and any stale download.
      this.state = { firstSeenAt: Date.now() };
      this.downloadedPath = null;
      void this.writeState();
    } else if (!this.state.firstSeenAt) {
      this.state = { ...this.state, firstSeenAt: Date.now() };
      void this.writeState();
    }
  }

  // -------------------------------------------------------------------------
  // Download + verify
  // -------------------------------------------------------------------------

  private downloadDir(): string {
    return join(app.getPath("userData"), DOWNLOAD_DIR);
  }

  private async maybeDownload(): Promise<void> {
    const manifest = this.manifest;
    if (!manifest || this.downloading || this.downloadedPath) return;
    if (this.plan().kind === "none") return;
    // Nothing to run in place; the portable build is told, not updated.
    if (isPortableBuild()) return;

    this.downloading = true;
    this.emit();
    try {
      const dir = join(this.downloadDir(), manifest.version);
      await fs.mkdir(dir, { recursive: true });
      const name = basename(new URL(manifest.url).pathname) || "Vantage-setup.exe";
      const target = join(dir, name.replace(/[^A-Za-z0-9._-]/g, "_"));

      const existing = await this.digestOf(target).catch(() => null);
      if (existing === manifest.sha256) {
        this.downloadedPath = target;
        return;
      }

      const response = await net.fetch(manifest.url, {
        cache: "no-store",
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      if (!response.ok || !response.body) throw new Error(`download ${response.status}`);
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > MAX_INSTALLER_BYTES) throw new Error("installer too large");

      const partial = `${target}.part`;
      await pipeline(response.body as unknown as NodeJS.ReadableStream, createWriteStream(partial));

      const digest = await this.digestOf(partial);
      if (digest !== manifest.sha256) {
        await fs.rm(partial, { force: true });
        throw new Error("digest mismatch");
      }
      await fs.rename(partial, target);
      this.downloadedPath = target;
      this.lastError = null;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
    } finally {
      this.downloading = false;
      this.emit();
    }
  }

  private async digestOf(path: string): Promise<string> {
    const hash = createHash("sha256");
    const handle = await fs.open(path, "r");
    try {
      const stream = handle.createReadStream();
      for await (const chunk of stream) hash.update(chunk as Buffer);
    } finally {
      await handle.close();
    }
    return hash.digest("hex");
  }

  // -------------------------------------------------------------------------
  // Install
  // -------------------------------------------------------------------------

  private context(userRequested: boolean) {
    const window = BrowserWindow.getAllWindows()[0];
    return {
      plan: this.plan(),
      downloadReady: this.downloadedPath !== null,
      now: Date.now(),
      idleMs: Date.now() - this.lastInputAt,
      windowFocused: Boolean(window?.isFocused()),
      currentUrl: window?.webContents.getURL() ?? "",
      online: net.isOnline(),
      portable: isPortableBuild(),
      userRequested,
    };
  }

  /** Called on a timer and after every check. Says no far more often than yes. */
  async maybeInstall(userRequested = false): Promise<boolean> {
    if (this.installing) return false;
    if (!this.downloadedPath) {
      await this.maybeDownload();
      if (!this.downloadedPath) return false;
    }
    const decision = installWindow(this.context(userRequested));
    if (!decision.install) return false;
    return this.runInstaller();
  }

  /**
   * Quit-time install. The session is already over, so there is no match to
   * interrupt — this is the path that actually delivers "within 2 days" for a
   * team that closes the laptop at the end of the day.
   */
  installOnQuit(): boolean {
    if (this.installing || !this.downloadedPath) return false;
    if (!shouldInstallOnQuit({ plan: this.plan(), downloadReady: true, portable: isPortableBuild() })) {
      return false;
    }
    return this.spawnInstaller(this.downloadedPath, false);
  }

  private runInstaller(): boolean {
    const path = this.downloadedPath;
    if (!path) return false;
    this.installing = true;
    this.emit();
    const spawned = this.spawnInstaller(path, true);
    if (!spawned) {
      this.installing = false;
      this.emit();
      return false;
    }
    // Give the detached installer a moment to take its own lock before the
    // running app releases the files it is about to replace.
    setTimeout(() => app.quit(), 1_500);
    return true;
  }

  /**
   * NSIS silent install, detached so it survives this process exiting. It
   * relaunches Vantage itself (`--force-run` is electron-builder's NSIS flag
   * for exactly that), which is the "close the old version and run the new
   * one" half of the requirement.
   */
  private spawnInstaller(path: string, relaunch: boolean): boolean {
    try {
      const args = relaunch ? ["/S", "--force-run"] : ["/S"];
      const child = spawn(path, args, { detached: true, stdio: "ignore", windowsHide: true });
      child.unref();
      return true;
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /**
   * May the shell replace what is on screen right now?
   *
   * Even a `required` update — one where the web app has declared this shell
   * unsupported — must not swap a scout's match form for an update notice
   * mid-match. When this says no, the takeover waits: the state event still
   * fires, and the gate applies at the next navigation or the next launch.
   */
  canInterruptNow(): boolean {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window || window.isDestroyed()) return false;
    const url = window.webContents.getURL();
    if (!isLiveOpsUrl(url)) return true;
    return !window.isFocused();
  }

  /** Portable builds and any failed install still get a way forward. */
  async openDownloadPage(): Promise<void> {
    const url = this.manifest?.url ?? `https://github.com/${REPO}/releases/latest`;
    await shell.openExternal(url).catch(() => undefined);
  }

  /** "Not now" from the update page: push this version out by a day. */
  async defer(hours = 24): Promise<void> {
    if (!this.manifest) return;
    this.state = {
      ...this.state,
      deferredVersion: this.manifest.version,
      deferredUntil: Date.now() + hours * 60 * 60 * 1000,
    };
    await this.writeState();
    this.emit();
  }

  // -------------------------------------------------------------------------
  // Stale web page
  // -------------------------------------------------------------------------

  /**
   * Called from did-fail-load. One hard reload heals a page whose build was
   * deployed away under it — but a server that is actually down would turn that
   * into a reload loop, so it is allowed once per HEAL_COOLDOWN_MS and the
   * caller falls back to the offline screen when this returns false.
   */
  noteBrokenPage(): boolean {
    const now = Date.now();
    if (now - this.lastHealAt < HEAL_COOLDOWN_MS) return false;
    const window = BrowserWindow.getAllWindows()[0];
    if (!window || window.isDestroyed()) return false;
    if (!net.isOnline()) return false;
    this.lastHealAt = now;
    this.staleAssetSeen = false;
    window.webContents.reloadIgnoringCache();
    return true;
  }

  maybeReloadWeb(pageBroken = false) {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window || window.isDestroyed()) return;
    const currentUrl = window.webContents.getURL();
    const reload = shouldReloadWeb({
      staleAssetSeen: this.staleAssetSeen,
      idleMs: Date.now() - this.lastInputAt,
      windowFocused: window.isFocused(),
      currentUrl,
      online: net.isOnline(),
      pageBroken,
    });
    if (!reload) return;
    this.staleAssetSeen = false;
    window.webContents.reloadIgnoringCache();
  }

  // -------------------------------------------------------------------------
  // State file
  // -------------------------------------------------------------------------

  private stateFile(): string {
    return join(app.getPath("userData"), STATE_FILE);
  }

  private async readState(): Promise<UpdateState> {
    try {
      const raw = JSON.parse(await fs.readFile(this.stateFile(), "utf8")) as Record<string, unknown>;
      const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
      return {
        firstSeenAt: num(raw.firstSeenAt),
        deferredVersion: typeof raw.deferredVersion === "string" ? raw.deferredVersion : undefined,
        deferredUntil: num(raw.deferredUntil),
      };
    } catch {
      return {};
    }
  }

  private async writeState(): Promise<void> {
    try {
      await fs.writeFile(this.stateFile(), JSON.stringify(this.state), "utf8");
    } catch {
      // A read-only profile must not break the shell.
    }
  }
}
