import type {
  Clock,
  FileSystemLike,
  JsonHttpTransport,
  JsonResponse,
  SpawnRunResult,
  SpawnSyncResult,
  Spawner,
} from "../src/ports.js";

/**
 * Deterministic test doubles. No network, no child processes, no real timers —
 * the whole point of the injected ports.
 */

export async function flushMicrotasks(rounds = 20): Promise<void> {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

type PendingSleep = { due: number; resolve: () => void; settled: boolean };

/** Manual clock: `sleep` pends until `advance` crosses its deadline (or its signal aborts). */
export class ManualClock implements Clock {
  private nowValue = 0;
  private pending: PendingSleep[] = [];
  /** Every requested sleep duration, in order — lets tests assert backoff ladders. */
  readonly sleeps: number[] = [];

  now(): number {
    return this.nowValue;
  }

  sleep(ms: number, signal?: AbortSignal): Promise<void> {
    this.sleeps.push(ms);
    if (signal?.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const entry: PendingSleep = { due: this.nowValue + ms, resolve, settled: false };
      const settle = () => {
        if (entry.settled) return;
        entry.settled = true;
        resolve();
      };
      signal?.addEventListener("abort", settle, { once: true });
      entry.resolve = settle;
      this.pending.push(entry);
    });
  }

  async advance(ms: number): Promise<void> {
    this.nowValue += ms;
    for (const entry of [...this.pending]) {
      if (!entry.settled && entry.due <= this.nowValue) entry.resolve();
    }
    this.pending = this.pending.filter((entry) => !entry.settled && entry.due > this.nowValue);
    await flushMicrotasks();
  }
}

/** In-memory FileSystemLike. Directories are implicit; modes are recorded for asserts. */
export class MemoryFileSystem implements FileSystemLike {
  readonly files = new Map<string, string>();
  readonly modes = new Map<string, number>();
  readonly dirs = new Set<string>();

  async readFile(path: string): Promise<string> {
    const value = this.files.get(path);
    if (value === undefined) throw new Error(`ENOENT: ${path}`);
    return value;
  }

  async writeFile(path: string, content: string, opts?: { mode?: number }): Promise<void> {
    this.files.set(path, content);
    if (opts?.mode !== undefined) this.modes.set(path, opts.mode);
    // Register implicit parent directories.
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i += 1) this.dirs.add(parts.slice(0, i).join("/"));
  }

  async mkdir(path: string): Promise<void> {
    const parts = path.split("/");
    for (let i = 1; i <= parts.length; i += 1) this.dirs.add(parts.slice(0, i).join("/"));
  }

  async readdir(path: string): Promise<string[]> {
    const prefix = `${path.replace(/\/+$/, "")}/`;
    const out = new Set<string>();
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) out.add(file.slice(prefix.length).split("/")[0]!);
    }
    for (const dir of this.dirs) {
      if (dir.startsWith(prefix)) out.add(dir.slice(prefix.length).split("/")[0]!);
    }
    if (out.size === 0 && !this.dirs.has(path.replace(/\/+$/, ""))) throw new Error(`ENOENT: ${path}`);
    return [...out];
  }

  async rm(path: string): Promise<void> {
    this.files.delete(path);
    this.modes.delete(path);
  }

  async stat(path: string): Promise<{ isFile: boolean; isDirectory: boolean }> {
    if (this.files.has(path)) return { isFile: true, isDirectory: false };
    const normalized = path.replace(/\/+$/, "");
    if (this.dirs.has(normalized)) return { isFile: false, isDirectory: true };
    // A path that prefixes any file also counts as a directory.
    for (const file of this.files.keys()) {
      if (file.startsWith(`${normalized}/`)) return { isFile: false, isDirectory: true };
    }
    throw new Error(`ENOENT: ${path}`);
  }

  async chmod(path: string, mode: number): Promise<void> {
    this.modes.set(path, mode);
  }
}

export type RecordedRequest = {
  method: string;
  url: string;
  body: unknown;
  token?: string;
};

export type RouteHandler = (request: RecordedRequest) => JsonResponse | Promise<JsonResponse> | never;

/**
 * Scripted transport: URL-substring → handler. Unrouted requests throw (network error),
 * which is exactly how an unreachable server behaves through the real transport.
 */
export class FakeTransport implements JsonHttpTransport {
  readonly requests: RecordedRequest[] = [];
  constructor(private readonly routes: Array<{ match: string | RegExp; handler: RouteHandler }>) {}

  private async dispatch(request: RecordedRequest): Promise<JsonResponse> {
    this.requests.push(request);
    for (const route of this.routes) {
      const hit =
        typeof route.match === "string" ? request.url.includes(route.match) : route.match.test(request.url);
      if (hit) return route.handler(request);
    }
    throw new Error(`fetch failed: no route for ${request.url}`);
  }

  postJson(url: string, body: unknown, opts?: { token?: string; method?: "POST" | "PATCH" | "PUT" }) {
    return this.dispatch({ method: opts?.method ?? "POST", url, body, token: opts?.token });
  }

  getJson(url: string, opts?: { token?: string }) {
    return this.dispatch({ method: "GET", url, body: undefined, token: opts?.token });
  }
}

export const ok = (data: Record<string, unknown>, status = 200): JsonResponse => ({
  ok: status >= 200 && status < 300,
  status,
  data,
});

/** Scripted spawner: exact `command arg0 arg1…` string → result. Unknown commands = not installed. */
export class FakeSpawner implements Spawner {
  readonly syncCalls: string[] = [];
  readonly runCalls: Array<{ command: string; args: string[]; input?: string; timeoutMs: number }> = [];
  constructor(
    private readonly script: {
      sync?: Record<string, SpawnSyncResult>;
      run?: (command: string, args: string[], input: string | undefined) => SpawnRunResult;
    } = {},
  ) {}

  runSync(command: string, args: string[]): SpawnSyncResult {
    const key = [command, ...args].join(" ").trim();
    this.syncCalls.push(key);
    return this.script.sync?.[key] ?? { error: true, status: null, stdout: "", stderr: "" };
  }

  async run(
    command: string,
    args: string[],
    opts: { input?: string; timeoutMs: number },
  ): Promise<SpawnRunResult> {
    this.runCalls.push({ command, args, input: opts.input, timeoutMs: opts.timeoutMs });
    if (!this.script.run) return { status: null, stdout: "", stderr: "spawn ENOENT", timedOut: false, spawnError: true };
    return this.script.run(command, args, opts.input);
  }
}

export const claudeInstalledSync: Record<string, SpawnSyncResult> = {
  "claude --version": { error: false, status: 0, stdout: "2.1.241 (Claude Code)\n", stderr: "" },
  "claude auth status": { error: false, status: 0, stdout: JSON.stringify({ loggedIn: true }), stderr: "" },
};
