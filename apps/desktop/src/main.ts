import {
  app,
  BrowserWindow,
  Menu,
  session,
  shell,
  type MenuItemConstructorOptions,
  type WebContents,
} from "electron";
import { join } from "node:path";
import {
  DEFAULT_PRODUCTION_ORIGIN,
  isAllowedNavigation,
  sanitizeAppOrigin,
  shouldOpenExternally,
  stripElectronUserAgent,
} from "./allowlist";

const PARTITION = "persist:vantage";
const startOrigin = sanitizeAppOrigin(process.env.VANTAGE_URL);

function asWindow(win: unknown): BrowserWindow | undefined {
  return win instanceof BrowserWindow ? win : undefined;
}

function attachNavigationGuards(contents: WebContents) {
  const guard = (href: string) => {
    if (isAllowedNavigation(href)) return true;
    if (shouldOpenExternally(href)) void shell.openExternal(href).catch(() => undefined);
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
    if (isAllowedNavigation(url)) {
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

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    title: "Vantage",
    backgroundColor: "#f7f6f2",
    autoHideMenuBar: false,
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

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
    void window.loadFile(join(__dirname, "..", "offline.html"));
  });

  void window.loadURL(startOrigin);
  return window;
}

function openPath(window: BrowserWindow, path: string) {
  const url = new URL(path, startOrigin);
  if (!isAllowedNavigation(url.href)) return;
  void window.loadURL(url.href);
}

function reloadApp(win: unknown) {
  const window = asWindow(win);
  if (window) void window.loadURL(startOrigin);
}

function installMenu() {
  const template: MenuItemConstructorOptions[] = [
    {
      label: "File",
      submenu: [
        {
          label: "Open in browser",
          click: (_item, browserWindow) => {
            const window = asWindow(browserWindow);
            const href = window?.webContents.getURL() || startOrigin;
            if (shouldOpenExternally(href) && isAllowedNavigation(href)) void shell.openExternal(href);
          },
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "View",
      submenu: [
        {
          label: "Reload",
          accelerator: "CmdOrCtrl+R",
          click: (_item, win) => reloadApp(win),
        },
        {
          label: "Force reload",
          accelerator: "CmdOrCtrl+Shift+R",
          click: (_item, win) => reloadApp(win),
        },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: "Go",
      submenu: [
        { label: "Home", click: (_item, win) => { const w = asWindow(win); if (w) openPath(w, "/"); } },
        { label: "Sign in", click: (_item, win) => { const w = asWindow(win); if (w) openPath(w, "/signin"); } },
        { label: "Dashboard", click: (_item, win) => { const w = asWindow(win); if (w) openPath(w, "/dashboard"); } },
        { label: "CAD", click: (_item, win) => { const w = asWindow(win); if (w) openPath(w, "/build?tab=cad"); } },
        { label: "AI Bugbot", click: (_item, win) => { const w = asWindow(win); if (w) openPath(w, "/build?tab=bugbot"); } },
      ],
    },
    {
      label: "Help",
      submenu: [
        { label: "Desktop notes", click: (_item, win) => { const w = asWindow(win); if (w) openPath(w, "/desktop"); } },
        { label: "CAD relay setup", click: (_item, win) => { const w = asWindow(win); if (w) openPath(w, "/cad/setup"); } },
        { type: "separator" },
        { label: "Privacy", click: () => void shell.openExternal(`${DEFAULT_PRODUCTION_ORIGIN}/privacy`) },
        { label: "Terms", click: () => void shell.openExternal(`${DEFAULT_PRODUCTION_ORIGIN}/terms`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing) {
      if (existing.isMinimized()) existing.restore();
      existing.focus();
    }
  });

  app.on("web-contents-created", (_event, contents) => {
    attachNavigationGuards(contents);
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("app.vantage.frc");
    app.setName("Vantage");
    const ses = session.fromPartition(PARTITION);
    ses.setUserAgent(stripElectronUserAgent(ses.getUserAgent()));
    ses.setPermissionCheckHandler((_webContents, permission) => {
      return (
        permission === "media" ||
        permission === "notifications" ||
        permission === "clipboard-sanitized-write" ||
        permission === "clipboard-read"
      );
    });
    installMenu();
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
