import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import type {
  Clock,
  FileSystemLike,
  JsonHttpTransport,
  JsonResponse,
  SpawnRunResult,
  SpawnSyncResult,
  Spawner,
} from "../ports.js";

/**
 * Real Node implementations of the injected ports. This module (plus
 * ./storage-server.ts) is the ONLY place the package touches fetch, child_process, fs,
 * os, or timers — everything else stays pure and unit-testable. Nothing here runs at
 * module scope: importing this file resolves no secrets and opens no connections.
 */

export function nodeHome(): string {
  return homedir();
}

export function nodeMachineName(): string {
  return hostname() || "connector";
}

export const nodeClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      signal?.addEventListener("abort", onAbort, { once: true });
    }),
};

const DEFAULT_HTTP_TIMEOUT_MS = 15_000;

async function requestJson(
  url: string,
  init: { method: string; body?: string; token?: string; timeoutMs?: number },
): Promise<JsonResponse> {
  const response = await fetch(url, {
    method: init.method,
    headers: {
      ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body,
    signal: AbortSignal.timeout(init.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS),
  });
  const text = await response.text();
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = text ? JSON.parse(text) : {};
    // Tolerate JSON bodies that are not objects (bare arrays…) by wrapping honestly.
    data = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : Array.isArray(parsed)
        ? { data: parsed }
        : {};
  } catch {
    /* non-JSON body */
  }
  return { ok: response.ok, status: response.status, data };
}

/** fetch-backed transport (mirrors bridge.mjs api() / storage-node postJson semantics). */
export const fetchTransport: JsonHttpTransport = {
  postJson: (url, body, opts) =>
    requestJson(url, {
      method: opts?.method ?? "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      token: opts?.token,
      timeoutMs: opts?.timeoutMs,
    }),
  getJson: (url, opts) => requestJson(url, { method: "GET", token: opts?.token, timeoutMs: opts?.timeoutMs }),
};

const DETECT_TIMEOUT_MS = 10_000;

function runSyncImpl(
  command: string,
  args: string[],
  opts?: { timeoutMs?: number; input?: string },
): SpawnSyncResult {
  // Direct spawn first (finds .exe on every platform). npm-style .cmd shims are not
  // found by CreateProcess, so retry through cmd.exe on Windows when that happens.
  // (Ported from bridge.mjs runSync.)
  let result = spawnSync(command, args, {
    encoding: "utf8",
    timeout: opts?.timeoutMs ?? DETECT_TIMEOUT_MS,
    input: opts?.input,
  });
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT" && process.platform === "win32") {
    result = spawnSync("cmd.exe", ["/d", "/s", "/c", command, ...args.map((a) => (a === "" ? '""' : a))], {
      encoding: "utf8",
      timeout: opts?.timeoutMs ?? DETECT_TIMEOUT_MS,
      input: opts?.input,
      windowsVerbatimArguments: false,
    });
  }
  return {
    error: Boolean(result.error),
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
  };
}

function runImpl(
  command: string,
  args: string[],
  opts: { input?: string; timeoutMs: number; cwd?: string },
): Promise<SpawnRunResult> {
  return new Promise((resolve) => {
    // cwd defaults to a temp dir so the CLI never picks up a project's CLAUDE.md or
    // settings (ported from bridge.mjs runJobCli).
    const child = spawn(command, args, { cwd: opts.cwd ?? tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr: String(error), timedOut: false, spawnError: true });
    });
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk));
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
    child.stdin.write(opts.input ?? "");
    child.stdin.end();
  });
}

export const nodeSpawner: Spawner = {
  runSync: runSyncImpl,
  run: runImpl,
};

export const nodeFileSystem: FileSystemLike = {
  readFile: (path) => readFile(path, "utf8"),
  writeFile: (path, content, opts) =>
    writeFile(path, content, { encoding: "utf8", ...(opts?.mode !== undefined ? { mode: opts.mode } : {}) }),
  mkdir: async (path, opts) => {
    await mkdir(path, { recursive: opts?.recursive ?? false });
  },
  readdir: (path) => readdir(path),
  rm: (path, opts) => rm(path, { force: opts?.force ?? true, recursive: opts?.recursive ?? false }),
  stat: async (path) => {
    const info = await stat(path);
    return { isFile: info.isFile(), isDirectory: info.isDirectory() };
  },
  chmod: async (path, mode) => {
    await chmod(path, mode);
  },
};
