import type { Browser, BrowserContext } from "playwright";
import { createOnshapeUiEngine } from "./engine";
import { ONSHAPE_UI_CONTROLS } from "./atlas";
import { validateOnshapeUiUrl } from "./protocol";
import type { createOnshapeUiSetup } from "./setup";
import type { UiCommand } from "./types";

/** Lazily owns one browser. Creating this controller performs no IO or launch. */
export function createOnshapeUiBrowserSession(options: {
  setup: ReturnType<typeof createOnshapeUiSetup>;
  launch: (executablePath?: string) => Promise<Browser>;
  resolveBrowser?: () => Promise<string>;
}) {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let engine: ReturnType<typeof createOnshapeUiEngine> | undefined;
  let launching: Promise<Browser> | undefined;
  let closing: Promise<void> | undefined;
  let generation = 0;
  let activeToken: string | undefined;
  let popupVersion = 0;
  let starting = false;
  let closureUnconfirmed = false;

  function stop(): Promise<void> {
    if (closing) return closing;
    ++generation;
    const owned = browser;
    const ownedContext = context;
    const pendingLaunch = launching;
    launching = undefined;
    browser = undefined; context = undefined; engine = undefined; activeToken = undefined; starting = false;
    closing = Promise.resolve().then(async () => {
      await ownedContext?.close().catch(() => undefined);
      const lateBrowser = await pendingLaunch?.catch(() => undefined);
      for (const candidate of new Set([owned, lateBrowser])) {
        if (!candidate) continue;
        await candidate.close().catch(() => undefined);
        if (candidate.isConnected()) {
          // Keep ownership for a retry and refuse another writer. Never turn an
          // unconfirmed shutdown into a successful "browser closed" response.
          browser = candidate;
          closureUnconfirmed = true;
          if (candidate === owned) context = ownedContext;
          throw new Error("Browser closure could not be confirmed. Close its visible window and stop again before starting another session.");
        }
      }
      closureUnconfirmed = false;
    }).finally(() => { closing = undefined; });
    return closing;
  }
  async function authorize() {
    try {
      const credential = await options.setup.authorize();
      if (!activeToken || credential.deviceToken !== activeToken) throw new Error("The Vantage device pairing changed. Open a new browser session before continuing.");
    } catch (error) { await stop(); throw error; }
  }
  function current() {
    if (!engine || !browser) throw new Error("Open Onshape with onshape_ui_start after completing setup.");
    return engine;
  }
  return {
    async status() {
      const setup = await options.setup.status();
      if (browser && setup.status !== "eligible") await stop();
      if (options.resolveBrowser) {
        try { await options.resolveBrowser(); }
        catch {
          if (browser) await stop();
          return { ...setup, pairingStatus: setup.status, status: "setup_required", browser: "closed", message: "The matching packaged browser is missing or invalid. Install the approved extension for this computer. No browser was downloaded or launched." };
        }
      }
      return { ...setup, browser: closureUnconfirmed ? "closure_unconfirmed" : browser ? "open" : starting ? "starting" : "closed", message: closureUnconfirmed ? "Browser closure could not be confirmed. Close its visible window and stop again before starting another session." : browser ? `${setup.message} Sign-in and geometry must still be verified in the visible browser.` : setup.message };
    },
    async start(rawUrl: string) {
      const url = validateOnshapeUiUrl(rawUrl);
      if (browser || starting || closing) throw new Error("Stop the current browser session before opening another.");
      const currentGeneration = ++generation;
      starting = true;
      try {
        const credential = await options.setup.authorize();
        if (generation !== currentGeneration) throw new Error("Browser opening was cancelled.");
        let executable: string | undefined;
        try { executable = await options.resolveBrowser?.(); }
        catch { throw new Error("The matching packaged browser is missing or invalid. Install the approved extension for this computer; setup tools remain available."); }
        if (generation !== currentGeneration) throw new Error("Browser opening was cancelled.");
        activeToken = credential.deviceToken;
        launching = options.launch(executable);
        const owned = await launching;
        launching = undefined;
        if (generation !== currentGeneration) { throw new Error("Browser opening was cancelled."); }
        browser = owned;
        owned.once("disconnected", () => { if (browser === owned) void stop().catch(() => undefined); });
        context = await owned.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: false });
        const ownedContext = context;
        if (generation !== currentGeneration) { await ownedContext.close(); throw new Error("Browser opening was cancelled."); }
        const page = await ownedContext.newPage();
        if (generation !== currentGeneration) throw new Error("Browser opening was cancelled.");
        // Popup sign-in stays human-controlled; a new tab never silently becomes
        // the engine's document, and all children close with the owned context.
        ownedContext.on("page", () => { popupVersion += 1; });
        page.once("close", () => { if (browser === owned) void stop().catch(() => undefined); });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
        if (generation !== currentGeneration) throw new Error("Browser opening was cancelled.");
        engine = createOnshapeUiEngine({ page, controls: ONSHAPE_UI_CONTROLS, authorize });
        starting = false;
        return { browser: "open", message: "Onshape is open. Sign in yourself, then observe and bind the intended document. No geometry has been created or verified." };
      } catch (error) {
        if (generation === currentGeneration) await stop();
        throw error;
      } finally { if (generation === currentGeneration) starting = false; }
    },
    async observe() { return current().observe(); },
    async bind(observationId: string) { return current().bind(observationId); },
    async action(command: UiCommand) {
      const beforePopup = popupVersion;
      const result = await current().execute(command);
      if (popupVersion !== beforePopup) return { ...result, status: "unverified" as const, verification: "none" as const, message: "The action opened another browser tab. This engine still owns its original page; inspect the new tab manually. Geometry and navigation were not verified." };
      return result;
    },
    stop,
  };
}
