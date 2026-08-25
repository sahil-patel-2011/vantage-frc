import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  screen,
  session,
  shell,
  type IpcMainInvokeEvent,
  type Session,
  type WebContents,
} from "electron";
import { promises as fs } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { runLinkFlow, type LinkState } from "./link";
import {
  cookieMatchesHost,
  isAllowedNavigation,
  isAllowedWhileSignedOut,
  isSessionCookieName,
  parseDeepLinkPath,
  sanitizeAppOrigin,
  shouldOpenExternally,
  stripElectronUserAgent,
} from "./allowlist";
import {
  DEFAULT_WINDOW_STATE,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  parseWindowState,
  serializeWindowState,
  type WindowState,
} from "./window-state";

const PARTITION = "persist:vantage";
const DEEP_LINK_SCHEME = "vantage-frc";
const startOrigin = sanitizeAppOrigin(process.env.VANTAGE_URL);
const appHost = new URL(startOrigin).hostname;

/** Cached session state; refreshed from the cookie jar on every change event. */
let signedIn = false;
/** Deep-link path waiting for sign-in (or for the window to exist). */
let pendingDeepLinkPath: string | null = null;

function asWindow(win: unknown): BrowserWindow | undefined {
  return win instanceof BrowserWindow ? win : undefined;
}

function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0];
}

function appSession(): Session {
  return session.fromPartition(PARTITION);
}

async function hasSessionCookie(): Promise<boolean> {
  try {
    const cookies = await appSession().cookies.get({});
    return cookies.some(
      (cookie) => isSessionCookieName(cookie.name) && cookieMatchesHost(cookie.domain, appHost),
    );
  } catch {
    return false;
  }
}

function loadShellPage(window: BrowserWindow, page: "gate.html" | "offline.html", extra?: Record<string, string>) {
  void window.loadFile(join(__dirname, "..", page), {
    query: { origin: startOrigin, ...extra },
  });
}

function loadApp(window: BrowserWindow, path = "/") {
  const url = new URL(path, startOrigin);
  if (!isAllowedNavigation(url.href)) return;
  void window.loadURL(url.href);
}

/** Account gate: signed out → local sign-in screen; signed in → the app (plus any pending deep link). */
function applyGate(window: BrowserWindow) {
  if (signedIn) {
    const path = pendingDeepLinkPath ?? "/";
    pendingDeepLinkPath = null;
    loadApp(window, path);
  } else {
    loadShellPage(window, "gate.html");
  }
}

function attachNavigationGuards(contents: WebContents) {
  const guard = (href: string) => {
    if (!isAllowedNavigation(href)) {
      if (shouldOpenExternally(href)) void shell.openExternal(href).catch(() => undefined);
      return false;
    }
    if (signedIn || isAllowedWhileSignedOut(href, startOrigin)) return true;
    // Signed-out and headed somewhere gated. Cookie events are async, so re-check the
    // jar before deciding: a just-finished sign-in re-loads the target, otherwise gate.
    void hasSessionCookie().then((present) => {
      signedIn = present;
      const window = asWindow(BrowserWindow.fromWebContents(contents)) ?? mainWindow();
      if (!window) return;
      if (present) void window.loadURL(href);
      else loadShellPage(window, "gate.html");
    });
    return false;
  };

  contents.on("will-navigate", (event, href) => {
    if (!guard(href)) event.preventDefault();
  });
  contents.on("will-redirect", (event, href) => {
    if (!guard(href)) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
  });
  contents.setWindowOpenHandler(({ url }) => {
    if (isAllowedNavigation(url) && (signedIn || isAllowedWhileSignedOut(url, startOrigin))) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          webPreferences: {
            partition: PARTITION,
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    if (shouldOpenExternally(url)) void shell.openExternal(url).catch(() => undefined);
    return { action: "deny" };
  });
}

// ---------------------------------------------------------------------------
// Browser-link sign-in (gate.html ⇄ main ⇄ system browser)
// ---------------------------------------------------------------------------

/** One in-flight sign-in attempt; the verifier lives inside runLinkFlow only. */
let linkRun: { id: number; cancelled: boolean; verificationUri: string | null } | null = null;
let linkRunCounter = 0;

/** The link IPC is for the bundled shell pages only — never the hosted app. */
function senderIsShellPage(event: IpcMainInvokeEvent): boolean {
  try {
    const url = event.senderFrame?.url ?? event.sender.getURL();
    return typeof url === "string" && url.startsWith("file:");
  } catch {
    return false;
  }
}

function sendLinkState(window: BrowserWindow, state: LinkState) {
  if (!window.isDestroyed()) window.webContents.send("desktop-link:state", state);
}

async function fetchLinkJson(path: string, body: unknown): Promise<{ status: number; json: unknown }> {
  const response = await fetch(new URL(path, startOrigin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { status: response.status, json };
}

function startLinkFlow(window: BrowserWindow) {
  if (linkRun) linkRun.cancelled = true;
  linkRunCounter += 1;
  const run = { id: linkRunCounter, cancelled: false, verificationUri: null as string | null };
  linkRun = run;

  void runLinkFlow({
    origin: startOrigin,
    machineName: hostname() || "Windows PC",
    desktopVersion: app.getVersion(),
    fetchJson: fetchLinkJson,
    openExternal: (url) => {
      run.verificationUri = url;
      void shell.openExternal(url).catch(() => undefined);
    },
    installCookie: async (details) => {
      const ses = appSession();
      await ses.cookies.set(details);
      await ses.cookies.flushStore().catch(() => undefined);
    },
    onState: (state) => {
      if (linkRun !== run || run.cancelled) return;
      sendLinkState(window, state);
    },
    delay: (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms)),
    isCancelled: () => run.cancelled,
  }).then(async (terminal) => {
    if (linkRun !== run) return;
    if (terminal.phase === "success") {
      // The cookies "changed" listener also flips the gate; this makes it
      // immediate instead of waiting on the event round-trip.
      signedIn = await hasSessionCookie();
      if (signedIn) applyGate(window);
    }
  });
}

function installLinkIpc() {
  ipcMain.handle("desktop-link:start", (event) => {
    if (!senderIsShellPage(event)) return;
    const window = asWindow(BrowserWindow.fromWebContents(event.sender)) ?? mainWindow();
    if (window) startLinkFlow(window);
  });
  ipcMain.handle("desktop-link:cancel", (event) => {
    if (!senderIsShellPage(event)) return;
    if (linkRun) linkRun.cancelled = true;
    const window = asWindow(BrowserWindow.fromWebContents(event.sender)) ?? mainWindow();
    if (window) sendLinkState(window, { phase: "idle" });
  });
  ipcMain.handle("desktop-link:open-approval", (event) => {
    if (!senderIsShellPage(event)) return;
    // Only the URL the active flow already validated against the app origin.
    const uri = linkRun && !linkRun.cancelled ? linkRun.verificationUri : null;
    if (uri) void shell.openExternal(uri).catch(() => undefined);
  });
  ipcMain.handle("desktop-link:open-site", (event) => {
    if (!senderIsShellPage(event)) return;
    void shell.openExternal(startOrigin).catch(() => undefined);
  });
}

// ---------------------------------------------------------------------------
// Window state persistence
// ---------------------------------------------------------------------------

function windowStateFile(): string {
  return join(app.getPath("userData"), "window-state.json");
}

async function readWindowState(): Promise<WindowState> {
  let raw: string | undefined;
  try {
    raw = await fs.readFile(windowStateFile(), "utf8");
  } catch {
    raw = undefined;
  }
  const displays = screen.getAllDisplays().map((display) => display.bounds);
  return parseWindowState(raw, displays);
}

function captureWindowState(window: BrowserWindow): WindowState {
  if (window.isMaximized() || window.isFullScreen()) {
    // Persist the last normal bounds so un-maximizing later is sane.
    const normal = window.getNormalBounds();
    return { ...normal, maximized: true };
  }
  const bounds = window.getBounds();
  return { ...bounds };
}

function persistWindowState(window: BrowserWindow) {
  try {
    const state = captureWindowState(window);
    void fs.writeFile(windowStateFile(), serializeWindowState(state), "utf8").catch(() => undefined);
  } catch {
    // Never let state persistence break the shell.
  }
}

function trackWindowState(window: BrowserWindow) {
  let timer: NodeJS.Timeout | undefined;
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => persistWindowState(window), 500);
  };
  window.on("resize", debounced);
  window.on("move", debounced);
  window.on("close", () => {
    if (timer) clearTimeout(timer);
    persistWindowState(window);
  });
}

// ---------------------------------------------------------------------------
// Window + menu
// ---------------------------------------------------------------------------

async function createWindow() {
  const state = await readWindowState().catch(() => ({ ...DEFAULT_WINDOW_STATE }));
  const window = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: "Vantage",
    backgroundColor: "#f7f6f2",
    // No menu bar: Vantage is an application, not a browser. Alt must not reveal one.
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });
  if (state.maximized) window.maximize();
  window.setMenuBarVisibility(false);
  installShortcuts(window);
  trackWindowState(window);

  window.webContents.session.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(
      permission === "media" ||
        permission === "notifications" ||
        permission === "clipboard-sanitized-write" ||
        permission === "clipboard-read",
    );
  });

  window.webContents.on("did-fail-load", (_event, errorCode, _errorDescription, _validatedURL, isMainFrame) => {
    if (!isMainFrame || errorCode === -3) return;
    loadShellPage(window, "offline.html");
  });

  signedIn = await hasSessionCookie();
  applyGate(window);
  return window;
}

/** Reload semantics: local shell pages retry the app; app pages just reload. */
function reloadCurrent(win: unknown, ignoreCache = false) {
  const window = asWindow(win) ?? mainWindow();
  if (!window) return;
  const current = window.webContents.getURL();
  if (!current || current.startsWith("file:")) {
    applyGate(window);
    return;
  }
  if (ignoreCache) window.webContents.reloadIgnoringCache();
  else window.webContents.reload();
}

function openPath(window: BrowserWindow, path: string) {
  if (!signedIn) {
    pendingDeepLinkPath = path;
    loadShellPage(window, "gate.html");
    return;
  }
  loadApp(window, path);
}

/**
 * Vantage ships as an application, not a browser around a website: there is no
 * File/Edit/View menu bar. Removing the menu also removes the accelerators those
 * roles registered, so the shell-level shortcuts (reload, zoom, history, F11)
 * are re-bound in installShortcuts. Clipboard/undo keys keep working natively
 * in the renderer on Windows/Linux; only macOS needs them re-bound.
 */
function installMenu() {
  Menu.setApplicationMenu(null);
}

/**
 * Re-bind the shortcuts the removed menu used to own.
 *
 * Editing keys (copy/cut/paste/select-all/undo/redo) are re-bound on macOS
 * ONLY: without an application menu, Chromium on macOS drops them, but on
 * Windows/Linux the renderer handles them natively — and intercepting them
 * here would preventDefault the keydown before the page ever sees it,
 * breaking in-app editors (chat, playbook, code views) that implement their
 * own copy/undo behavior on those same keys.
 */
function installShortcuts(window: BrowserWindow) {
  const contents = window.webContents;
  contents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    const mod = process.platform === "darwin" ? input.meta : input.control;
    const key = input.key.toLowerCase();
    const handled = () => event.preventDefault();

    if (mod && !input.alt) {
      if (process.platform === "darwin") {
        // Clipboard + undo: these are the ones that silently break on macOS
        // once the application menu is gone.
        if (key === "c" && !input.shift) return handled(), contents.copy();
        if (key === "x" && !input.shift) return handled(), contents.cut();
        if (key === "v" && !input.shift) return handled(), contents.paste();
        if (key === "a" && !input.shift) return handled(), contents.selectAll();
        if (key === "z" && !input.shift) return handled(), contents.undo();
        if ((key === "z" && input.shift) || key === "y") return handled(), contents.redo();
      }
      if (key === "r") return handled(), reloadCurrent(window, input.shift);
      if (key === "0") return handled(), void contents.setZoomLevel(0);
      if (key === "=" || key === "+") return handled(), void contents.setZoomLevel(contents.getZoomLevel() + 0.5);
      if (key === "-") return handled(), void contents.setZoomLevel(contents.getZoomLevel() - 0.5);
      if (key === "o" && input.shift) {
        const href = contents.getURL() || startOrigin;
        if (shouldOpenExternally(href) && isAllowedNavigation(href)) void shell.openExternal(href);
        return handled();
      }
    }
    if (input.alt && !mod) {
      if (key === "arrowleft" && contents.navigationHistory.canGoBack()) {
        return handled(), contents.navigationHistory.goBack();
      }
      if (key === "arrowright" && contents.navigationHistory.canGoForward()) {
        return handled(), contents.navigationHistory.goForward();
      }
      if (key === "home") return handled(), openPath(window, "/");
    }
    if (key === "f11") return handled(), window.setFullScreen(!window.isFullScreen());
  });
}

// ---------------------------------------------------------------------------
// Deep links (vantage-frc://open/<path>)
// ---------------------------------------------------------------------------

function registerDeepLinkScheme() {
  if (process.defaultApp) {
    // Dev: `electron .` needs the app path baked into the registration.
    const appPath = process.argv[1];
    if (appPath) {
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [resolve(appPath)]);
    }
  } else {
    app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);
  }
}

function handleDeepLink(raw: string) {
  const path = parseDeepLinkPath(raw);
  if (!path) return;
  const window = mainWindow();
  if (!window) {
    pendingDeepLinkPath = path;
    return;
  }
  if (window.isMinimized()) window.restore();
  window.focus();
  openPath(window, path);
}

function deepLinkFromArgv(argv: string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(`${DEEP_LINK_SCHEME}://`));
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const existing = mainWindow();
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
    const link = deepLinkFromArgv(argv);
    if (link) handleDeepLink(link);
  });

  // macOS deep links (harmless on Windows).
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  app.on("web-contents-created", (_event, contents) => {
    attachNavigationGuards(contents);
  });

  app.whenReady().then(async () => {
    app.setAppUserModelId("app.vantage.frc");
    app.setName("Vantage");
    registerDeepLinkScheme();

    const ses = appSession();
    ses.setUserAgent(stripElectronUserAgent(ses.getUserAgent()));
    ses.setPermissionCheckHandler((_webContents, permission) => {
      return (
        permission === "media" ||
        permission === "notifications" ||
        permission === "clipboard-sanitized-write" ||
        permission === "clipboard-read"
      );
    });

    // Keep the gate in sync with sign-in / sign-out without polling.
    ses.cookies.on("changed", (_event, cookie) => {
      if (!isSessionCookieName(cookie.name) || !cookieMatchesHost(cookie.domain, appHost)) return;
      void hasSessionCookie().then((present) => {
        const wasSignedIn = signedIn;
        signedIn = present;
        const window = mainWindow();
        if (!window) return;
        const current = window.webContents.getURL();
        // Signed in while sitting on the local gate → enter the app.
        if (!wasSignedIn && present && current.startsWith("file:")) applyGate(window);
        // Signed out (cookie cleared) while inside the app → back to the gate.
        if (wasSignedIn && !present && !isAllowedWhileSignedOut(current, startOrigin)) applyGate(window);
      });
    });

    installMenu();
    installLinkIpc();

    const link = deepLinkFromArgv(process.argv);
    if (link) {
      const path = parseDeepLinkPath(link);
      if (path) pendingDeepLinkPath = path;
    }

    await createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
