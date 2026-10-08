/** Bundled only for Electron utilityProcess. Not a CLI and never a network server. */
import { randomUUID } from "node:crypto";
import { chromium, type Browser } from "playwright";
import { createOnshapeUiEngine } from "../../packages/vantage-cad-cli/src/onshape-ui/engine";
import { ONSHAPE_UI_ATLAS_STATUS, ONSHAPE_UI_CONTROLS } from "../../packages/vantage-cad-cli/src/onshape-ui/atlas";
import { validateOnshapeUiUrl, validateUiToolArguments } from "../../packages/vantage-cad-cli/src/onshape-ui/protocol";
import type { UiCommand } from "../../packages/vantage-cad-cli/src/onshape-ui/types";

type Parent = { postMessage(value: unknown): void; on(event: "message", callback: (event: { data: unknown }) => void): void };
const parent = (process as NodeJS.Process & { parentPort?: Parent }).parentPort;
if (!parent) throw new Error("The CAD worker must be started by Vantage desktop.");
let browser: Browser | null = null;
let launching: Promise<Browser> | null = null;
let engine: ReturnType<typeof createOnshapeUiEngine> | null = null;
let busy = false;
let popupVersion = 0;
let closing: Promise<void> | null = null;
const pendingAccess = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();

function authorize(): Promise<void> {
  if (closing) return Promise.reject(new Error("CAD is stopping."));
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { pendingAccess.delete(id); reject(new Error("Current Vantage access could not be verified.")); }, 12_000);
    pendingAccess.set(id, { resolve, reject, timer });
    parent!.postMessage({ type: "authorize", id });
  });
}

function stop(): Promise<void> {
  if (closing) return closing;
  closing = Promise.resolve().then(async () => {
    for (const pending of pendingAccess.values()) { clearTimeout(pending.timer); pending.reject(new Error("CAD is stopping.")); }
    pendingAccess.clear();
    const opened = browser ?? await launching?.catch(() => null);
    await opened?.close().catch(() => undefined);
    process.exit(0);
  });
  return closing;
}
process.once("SIGINT", () => { void stop(); });
process.once("SIGTERM", () => { void stop(); });

parent.on("message", (event) => {
  const message = event.data as Record<string, unknown> | null;
  if (!message || typeof message !== "object" || Array.isArray(message)) return;
  if (message.type === "stop") { void stop(); return; }
  if (message.type === "authorization" && typeof message.id === "string") {
    const pending = pendingAccess.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer); pendingAccess.delete(message.id);
    if (message.allowed === true) pending.resolve();
    else pending.reject(new Error("Current team membership or sign-in requirements denied CAD access."));
    return;
  }
  if (typeof message.id !== "string" || !["start", "tool"].includes(String(message.type))) return;
  const id = message.id;
  if (busy || closing) { parent.postMessage({ type: "result", id, ok: false, error: "CAD is busy or stopping." }); return; }
  busy = true;
  void (async () => {
    let value: unknown;
    if (message.type === "start") {
      if (browser || engine || typeof message.url !== "string" || typeof message.browserExecutable !== "string") throw new Error("Invalid CAD startup request.");
      const url = validateOnshapeUiUrl(message.url);
      await authorize();
      launching = chromium.launch({ headless: false, executablePath: message.browserExecutable, timeout: 15_000 });
      browser = await launching;
      if (closing) throw new Error("CAD is stopping.");
      browser.once("disconnected", () => { void stop(); });
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: false });
      const page = await context.newPage();
      page.once("close", () => { void stop(); });
      // Human SSO may need a popup. Keep it in the owned context for cleanup,
      // but never silently adopt it as the engine's automation target.
      context.on("page", (openedPage) => { if (openedPage !== page) popupVersion += 1; });
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      engine = createOnshapeUiEngine({ page, controls: ONSHAPE_UI_CONTROLS, authorize });
      value = { browserOpen: true, onshapeSignInVerified: false };
    } else {
      if (!engine) throw new Error("Open the CAD browser first.");
      const tool = message.tool as { name?: string; arguments?: unknown } | undefined;
      if (!tool || !["observe", "bind", "action", "capabilities"].includes(String(tool.name))) throw new Error("Unknown CAD tool.");
      const name = `onshape_ui_${tool.name}`;
      const args = validateUiToolArguments(name, tool.arguments);
      if (tool.name === "observe") value = await engine.observe();
      else if (tool.name === "bind") value = await engine.bind(args.observationId as string);
      else if (tool.name === "action") {
        const before = popupVersion;
        const result = await engine.execute(args as UiCommand);
        value = before === popupVersion ? result : {
          ...result, status: "unverified", verification: "none",
          message: "This action opened another tab. That tab has not been observed or bound; inspect it before claiming the action is complete.",
        };
      }
      else { await authorize(); value = { ...ONSHAPE_UI_ATLAS_STATUS, controls: ONSHAPE_UI_CONTROLS }; }
    }
    if (!closing) parent.postMessage({ type: "result", id, ok: true, value });
  })().catch((error: unknown) => {
    if (!closing) parent.postMessage({ type: "result", id, ok: false, error: error instanceof Error ? error.message.slice(0, 400) : "CAD operation was not confirmed." });
  }).finally(() => { busy = false; });
});
