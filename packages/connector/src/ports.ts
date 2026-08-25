/**
 * Injected environment ports. Every capability and the supervisor speak ONLY to these
 * interfaces, never to fetch / child_process / fs / timers directly — that is what makes
 * the whole package unit-testable without network, processes, or real clocks, and lets the
 * Electron host and the headless CLI host supply their own implementations.
 * Real Node implementations live in ./node/adapters.ts.
 */

export type Logger = (message: string) => void;

export type Clock = {
  /** Milliseconds since the epoch (or any monotonic base — only differences are used). */
  now(): number;
  /** Resolves after `ms`, or EARLY (without throwing) when `signal` aborts. */
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
};

export type JsonResponse = {
  ok: boolean;
  status: number;
  /** Parsed JSON body; {} when the body was empty or not JSON (mirrors storage-node postJson). */
  data: Record<string, unknown>;
};

/**
 * JSON-over-HTTP port. Implementations THROW on network-level failure (unreachable,
 * timeout) and RETURN non-2xx responses — the same split bridge.mjs relies on, so callers
 * can distinguish "cloud said no" (status) from "cloud unreachable" (catch).
 */
export type JsonHttpTransport = {
  postJson(
    url: string,
    body: unknown,
    opts?: { token?: string; timeoutMs?: number; method?: "POST" | "PATCH" | "PUT" },
  ): Promise<JsonResponse>;
  getJson(url: string, opts?: { token?: string; timeoutMs?: number }): Promise<JsonResponse>;
};

export type SpawnSyncResult = {
  /** True when the process could not be started at all (ENOENT after platform retries…). */
  error: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
};

export type SpawnRunResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  /** True when spawn itself failed (command missing) rather than the process exiting. */
  spawnError?: boolean;
};

/** Child-process port. Injected so engine detection and job execution are testable. */
export type Spawner = {
  /** Short synchronous probe (version/auth checks). */
  runSync(command: string, args: string[], opts?: { timeoutMs?: number; input?: string }): SpawnSyncResult;
  /**
   * Long-running job execution: writes `input` to stdin, kills the process at `timeoutMs`.
   * Implementations default cwd to a temp dir so a CLI never picks up a project's
   * CLAUDE.md or settings (see bridge.mjs runJobCli).
   */
  run(
    command: string,
    args: string[],
    opts: { input?: string; timeoutMs: number; cwd?: string },
  ): Promise<SpawnRunResult>;
};

export type FileStat = { isFile: boolean; isDirectory: boolean };

/**
 * Minimal filesystem port (UTF-8 text only — binary media is the storage server's own
 * concern and stays behind its injected `serve` function).
 */
export type FileSystemLike = {
  /** Throws when the path does not exist. */
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string, opts?: { mode?: number }): Promise<void>;
  mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  readdir(path: string): Promise<string[]>;
  rm(path: string, opts?: { force?: boolean; recursive?: boolean }): Promise<void>;
  /** Throws when the path does not exist. */
  stat(path: string): Promise<FileStat>;
  /** Best-effort on platforms without POSIX modes (Windows); may be absent entirely. */
  chmod?(path: string, mode: number): Promise<void>;
};

/** Join path segments with forward slashes (Node's fs accepts them on every platform). */
export function joinPath(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .join("/")
    .replace(/\/{2,}/g, "/");
}

export async function readIfExists(fs: FileSystemLike, path: string): Promise<string | null> {
  try {
    return await fs.readFile(path);
  } catch {
    return null;
  }
}

export async function dirExists(fs: FileSystemLike, path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

export async function fileExists(fs: FileSystemLike, path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile;
  } catch {
    return false;
  }
}
