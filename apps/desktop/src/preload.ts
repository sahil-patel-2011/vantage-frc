import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { LinkState } from "./link";
import type { UpdateStatus } from "./update-service";
import type { LocalAiStatus } from "./local-ai-service";

/**
 * Bridge for the local shell pages (gate.html). The browser-link IPC handlers
 * in main.ts additionally refuse calls from anything but the bundled file://
 * shell pages, so the hosted web app cannot drive sign-in machinery even
 * though this preload runs for it too.
 */
contextBridge.exposeInMainWorld("vantageDesktop", {
  isDesktop: true,
  platform: process.platform,
  /** Bundled file:// pages only: try the app again. Main refuses this from the website. */
  retry: (): Promise<void> => ipcRenderer.invoke("desktop-shell:retry"),
  link: {
    /** Start (or restart) the browser sign-in flow. */
    start: (): Promise<void> => ipcRenderer.invoke("desktop-link:start"),
    /** Cancel the in-flight flow (its verifier is discarded). */
    cancel: (): Promise<void> => ipcRenderer.invoke("desktop-link:cancel"),
    /** Re-open the approval page in the system browser (same trusted URL). */
    reopenApproval: (): Promise<void> => ipcRenderer.invoke("desktop-link:open-approval"),
    /** Fallback: open the Vantage web app in the system browser. */
    openInBrowser: (): Promise<void> => ipcRenderer.invoke("desktop-link:open-site"),
    /** Open the public waitlist in the system browser. The page cannot choose the URL. */
    requestAccess: (): Promise<void> => ipcRenderer.invoke("desktop-link:open-waitlist"),
    /** Subscribe to state updates; returns an unsubscribe function. */
    onState: (callback: (state: LinkState) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, state: LinkState) => callback(state);
      ipcRenderer.on("desktop-link:state", listener);
      return () => ipcRenderer.removeListener("desktop-link:state", listener);
    },
  },
  /**
   * Update bridge for update.html. Same shape as `link`: the main-process
   * handlers refuse anything whose sender is not a bundled file:// page, so the
   * hosted web app cannot ask the shell to run an installer even though this
   * preload runs for it too.
   */
  update: {
    status: (): Promise<UpdateStatus | null> => ipcRenderer.invoke("desktop-update:status"),
    check: (): Promise<UpdateStatus | null> => ipcRenderer.invoke("desktop-update:check"),
    /** Download (if needed), verify, run the installer, and relaunch. */
    install: (): Promise<boolean> => ipcRenderer.invoke("desktop-update:install"),
    /** Portable builds and failed installs: open the release in the browser. */
    openDownload: (): Promise<void> => ipcRenderer.invoke("desktop-update:open-download"),
    /** Push an optional update out by a day. Required updates ignore this. */
    defer: (): Promise<UpdateStatus | null> => ipcRenderer.invoke("desktop-update:defer"),
    onState: (callback: (status: UpdateStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: UpdateStatus) => callback(status);
      ipcRenderer.on("desktop-update:state", listener);
      return () => ipcRenderer.removeListener("desktop-update:state", listener);
    },
  },
  /**
   * Local AI (experimental). `open` is the one call the hosted app may make (it only shows the
   * local settings window); everything else is refused by main unless it comes from that
   * bundled file:// page.
   */
  localAi: {
    open: (): Promise<void> => ipcRenderer.invoke("desktop-local-ai:open"),
    status: (): Promise<LocalAiStatus | null> => ipcRenderer.invoke("desktop-local-ai:status"),
    refresh: (): Promise<LocalAiStatus | null> => ipcRenderer.invoke("desktop-local-ai:refresh"),
    setModel: (model: string): Promise<LocalAiStatus | null> => ipcRenderer.invoke("desktop-local-ai:set-model", model),
    setBaseUrl: (url: string): Promise<LocalAiStatus | null> => ipcRenderer.invoke("desktop-local-ai:set-base-url", url),
    pair: (): Promise<LocalAiStatus | null> => ipcRenderer.invoke("desktop-local-ai:pair"),
    cancelPairing: (): Promise<LocalAiStatus | null> => ipcRenderer.invoke("desktop-local-ai:cancel-pairing"),
    unpair: (): Promise<LocalAiStatus | null> => ipcRenderer.invoke("desktop-local-ai:unpair"),
    setEnabled: (enabled: boolean): Promise<LocalAiStatus | null> => ipcRenderer.invoke("desktop-local-ai:set-enabled", enabled),
    onState: (callback: (status: LocalAiStatus) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, status: LocalAiStatus) => callback(status);
      ipcRenderer.on("desktop-local-ai:state", listener);
      return () => ipcRenderer.removeListener("desktop-local-ai:state", listener);
    },
  },
});
