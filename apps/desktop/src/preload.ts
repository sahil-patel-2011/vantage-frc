import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";
import type { LinkState } from "./link";

/**
 * Bridge for the local shell pages (gate.html). The browser-link IPC handlers
 * in main.ts additionally refuse calls from anything but the bundled file://
 * shell pages, so the hosted web app cannot drive sign-in machinery even
 * though this preload runs for it too.
 */
contextBridge.exposeInMainWorld("vantageDesktop", {
  isDesktop: true,
  platform: process.platform,
  link: {
    /** Start (or restart) the browser sign-in flow. */
    start: (): Promise<void> => ipcRenderer.invoke("desktop-link:start"),
    /** Cancel the in-flight flow (its verifier is discarded). */
    cancel: (): Promise<void> => ipcRenderer.invoke("desktop-link:cancel"),
    /** Re-open the approval page in the system browser (same trusted URL). */
    reopenApproval: (): Promise<void> => ipcRenderer.invoke("desktop-link:open-approval"),
    /** Fallback: open the Vantage web app in the system browser. */
    openInBrowser: (): Promise<void> => ipcRenderer.invoke("desktop-link:open-site"),
    /** Subscribe to state updates; returns an unsubscribe function. */
    onState: (callback: (state: LinkState) => void): (() => void) => {
      const listener = (_event: IpcRendererEvent, state: LinkState) => callback(state);
      ipcRenderer.on("desktop-link:state", listener);
      return () => ipcRenderer.removeListener("desktop-link:state", listener);
    },
  },
});
