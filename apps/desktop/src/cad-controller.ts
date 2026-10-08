import { readFile, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { parseCadDesktopStart, parseCadDesktopTool, type CadDesktopStatus } from "./cad-contract";

export type CadDesktopAssets = { worker: string; browserExecutable: string; root: string };
export type CadWorkerHandle = {
  postMessage(value: unknown): void;
  kill(): void;
  onMessage(listener: (value: unknown) => void): void;
  onExit(listener: () => void): void;
};

/** No downloads, installs, cache lookup or developer-source fallback. */
export async function inspectCadDesktopAssets(root: string, platform = process.platform, arch = process.arch): Promise<CadDesktopAssets | null> {
  try {
    const metadata = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as Record<string, unknown>;
    if (metadata.version !== 1 || metadata.platform !== platform || metadata.arch !== arch || typeof metadata.browserExecutable !== "string") return null;
    const browserExecutable = await realpath(resolve(root, metadata.browserExecutable));
    const actualRoot = await realpath(root);
    const child = relative(actualRoot, browserExecutable);
    if (!child || child.startsWith("..") || isAbsolute(child)) return null;
    const worker = await realpath(join(root, "worker.cjs"));
    const workerChild = relative(actualRoot, worker);
    if (!workerChild || workerChild.startsWith("..") || isAbsolute(workerChild)) return null;
    if (!(await stat(worker)).isFile() || !(await stat(browserExecutable)).isFile() ||
      !(await stat(join(root, "node_modules", "playwright", "package.json"))).isFile() ||
      !(await stat(join(root, "node_modules", "playwright-core", "package.json"))).isFile()) return null;
    return { worker, browserExecutable, root };
  } catch { return null; }
}

const IDLE: CadDesktopStatus = { phase: "idle", message: "Open Onshape when you are ready. No CAD process is running." };
const MISSING: CadDesktopStatus = { phase: "setup_required", message: "This desktop build does not include the required Onshape browser resources. Nothing was installed or started." };
type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };

export class CadDesktopController {
  private state: CadDesktopStatus = IDLE;
  private worker: CadWorkerHandle | null = null;
  private identity: string | null = null;
  private generation = 0;
  private pending = new Map<string, Pending>();
  private stopping: Promise<CadDesktopStatus> | null = null;
  private toolBusy = false;

  constructor(private readonly options: {
    assets: () => Promise<CadDesktopAssets | null>;
    sessionIdentity: () => Promise<string | null>;
    authorize: (orgId: string) => Promise<void>;
    spawn: (assets: CadDesktopAssets) => CadWorkerHandle;
    changed: (state: CadDesktopStatus) => void;
  }) {}

  get running(): boolean { return this.worker !== null || this.state.phase === "starting"; }
  private set(state: CadDesktopStatus) { this.state = state; this.options.changed({ ...state }); return { ...state }; }

  async status(): Promise<CadDesktopStatus> {
    if (this.running || this.state.phase === "error" || this.state.phase === "stopping") return { ...this.state };
    const generation = this.generation;
    const assets = await this.options.assets();
    if (generation !== this.generation || this.running) return { ...this.state };
    return this.set(assets ? IDLE : MISSING);
  }

  async sessionChanged(): Promise<void> {
    if (this.running && this.identity !== await this.options.sessionIdentity()) await this.stop();
  }

  private async authorize(): Promise<void> {
    const orgId = this.state.orgId;
    if (!orgId || !this.identity || this.identity !== await this.options.sessionIdentity()) throw new Error("Your Vantage sign-in changed. Reopen CAD from your current account.");
    await this.options.authorize(orgId);
    if (this.identity !== await this.options.sessionIdentity()) throw new Error("Your Vantage sign-in changed. Reopen CAD from your current account.");
  }

  async start(raw: unknown): Promise<CadDesktopStatus> {
    const input = parseCadDesktopStart(raw);
    if (this.running || this.stopping) throw new Error("Close the current CAD browser before opening another team or document.");
    const generation = ++this.generation;
    this.set({ phase: "starting", orgId: input.orgId, message: "Checking desktop resources and current team access…" });
    try {
      const assets = await this.options.assets();
      if (generation !== this.generation) return { ...this.state };
      if (!assets) return this.set(MISSING);
      this.identity = await this.options.sessionIdentity();
      await this.authorize();
      if (generation !== this.generation) return { ...this.state };
      const worker = this.options.spawn(assets);
      this.worker = worker;
      worker.onExit(() => {
        if (this.worker !== worker) return;
        this.worker = null;
        this.rejectPending("The CAD browser closed. Inspect the document before continuing.");
        if (this.state.phase !== "stopping") this.set(IDLE);
      });
      worker.onMessage((value) => { void this.receive(worker, value).catch(() => this.stop()); });
      await this.request({ type: "start", url: input.url, browserExecutable: assets.browserExecutable }, 45_000);
      if (this.worker === worker && generation === this.generation) return this.set({ phase: "browser_open", orgId: input.orgId, message: "Onshape browser is open. Sign in there; model work still requires observation and verification." });
      return { ...this.state };
    } catch (error) {
      if (generation !== this.generation) return { ...this.state };
      await this.stop();
      return this.set({ phase: "error", message: error instanceof Error ? error.message : "The CAD browser could not be opened." });
    }
  }

  async tool(raw: unknown): Promise<unknown> {
    const input = parseCadDesktopTool(raw);
    if (!this.worker || this.state.phase !== "browser_open") throw new Error("Open the Onshape browser first.");
    if (this.toolBusy) throw new Error("A CAD action is already in progress. Wait for its result or stop the browser.");
    const worker = this.worker;
    const generation = this.generation;
    this.toolBusy = true;
    try {
      try { await this.authorize(); }
      catch (error) {
        if (this.worker === worker && this.generation === generation) await this.stop();
        throw error;
      }
      if (this.worker !== worker || this.generation !== generation || this.state.phase !== "browser_open") {
        throw new Error("The CAD browser changed while access was being checked. Observe the current session before continuing.");
      }
      return await this.request({ type: "tool", tool: input }, 45_000);
    } finally {
      // An old authorization response must not release the new session's writer lock.
      if (this.generation === generation) this.toolBusy = false;
    }
  }

  private async receive(worker: CadWorkerHandle, value: unknown) {
    if (this.worker !== worker || !value || typeof value !== "object") return;
    const message = value as Record<string, unknown>;
    if (message.type === "authorize" && typeof message.id === "string") {
      let allowed = false;
      try { await this.authorize(); allowed = this.worker === worker; } catch { /* Fail closed. */ }
      if (this.worker === worker) {
        worker.postMessage({ type: "authorization", id: message.id, allowed });
        if (!allowed) await this.stop();
      }
      return;
    }
    if (message.type !== "result" || typeof message.id !== "string") return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(message.id);
    if (message.ok === true) pending.resolve(message.value);
    else pending.reject(new Error(typeof message.error === "string" ? message.error.slice(0, 400) : "CAD operation was not confirmed."));
  }

  private request(message: Record<string, unknown>, timeout: number): Promise<unknown> {
    const worker = this.worker;
    if (!worker) return Promise.reject(new Error("The CAD browser is closed."));
    return new Promise((resolveResult, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("CAD did not confirm the operation in time. The browser is stopping; inspect the document before retrying."));
        void this.stop();
      }, timeout);
      this.pending.set(id, { resolve: resolveResult, reject, timer });
      try { worker.postMessage({ ...message, id }); }
      catch { clearTimeout(timer); this.pending.delete(id); reject(new Error("The CAD browser is no longer reachable.")); }
    });
  }

  private rejectPending(message: string) {
    for (const item of this.pending.values()) { clearTimeout(item.timer); item.reject(new Error(message)); }
    this.pending.clear();
  }

  stop(): Promise<CadDesktopStatus> {
    if (this.stopping) return this.stopping;
    ++this.generation;
    const worker = this.worker;
    this.identity = null;
    this.rejectPending("CAD stopped. A partially completed operation must be inspected before retrying.");
    this.set({ phase: "stopping", message: "Closing the CAD browser…" });
    this.stopping = Promise.resolve().then(async () => {
      if (worker) await new Promise<void>((resolveStopped) => {
        let finished = false;
        const finish = () => { if (finished) return; finished = true; clearTimeout(timer); resolveStopped(); };
        // The worker may still be launching Chromium (bounded at 15 seconds).
        // Let it close that child before terminating its utility process.
        const timer = setTimeout(() => { worker.kill(); finish(); }, 20_000);
        worker.onExit(finish);
        try { worker.postMessage({ type: "stop" }); } catch { worker.kill(); finish(); }
      });
      if (this.worker === worker) this.worker = null;
      this.toolBusy = false;
      const next = await this.options.assets() ? IDLE : MISSING;
      this.stopping = null;
      return this.set(next);
    });
    return this.stopping;
  }
}
