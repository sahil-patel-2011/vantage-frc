import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCodexTurn, type CodexRpc, type CodexRpcMessage, type CodexTurnResult, type CodexFeatureTools } from "../codex-app-server.js";
import { personalEnvironment } from "./personal-environment.js";

export async function executePersonalCodex(prompt: string, options: { userId: string; timeoutMs: number; signal?: AbortSignal; onDelta?: (text: string) => void; testOnly?: boolean; tools?: CodexFeatureTools }): Promise<CodexTurnResult> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.userId)) return { ok: false, errorClass: "not_authenticated", errorMessage: "Re-pair this connection to your personal Vantage account." };
  const { env, directory: profileHome } = personalEnvironment(options.userId, "codex");
  await mkdir(profileHome, { recursive: true, mode: 0o700 });
  const cwd = await mkdtemp(join(tmpdir(), "vantage-codex-"));
  const args = ["app-server", "--listen", "stdio://"];
  const child = process.platform === "win32"
    ? spawn("cmd.exe", ["/d", "/s", "/c", "codex", ...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
    : spawn("codex", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
  const processClosed = new Promise<void>((resolve) => { child.once("close", () => resolve()); });
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  const listeners = new Set<(message: CodexRpcMessage) => void>();
  let sequence = 0;
  let buffer = "";
  let closed = false;
  const fail = () => {
    if (closed) return;
    closed = true;
    for (const call of pending.values()) call.reject(new Error("The local Codex App Server disconnected."));
    pending.clear();
    for (const listener of listeners) listener({ method: "vantage/connectionClosed", params: {} });
  };
  child.on("error", fail);
  child.on("close", fail);
  child.stdin.on("error", fail);
  // Never send local process stderr to Vantage; it may include personal configuration.
  child.stderr.resume();
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    if (buffer.length > 4 * 1024 * 1024) { fail(); child.kill(); return; }
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let message: CodexRpcMessage;
      try { message = JSON.parse(line) as CodexRpcMessage; } catch { fail(); child.kill(); return; }
      if (typeof message.id === "number" && !message.method && pending.has(message.id)) {
        const call = pending.get(message.id)!;
        pending.delete(message.id);
        if (message.error) call.reject(new Error(message.error.message ?? "Codex request failed."));
        else call.resolve((message.result ?? {}) as Record<string, unknown>);
      } else for (const listener of listeners) listener(message);
    }
  });
  const send = (message: unknown) => { if (closed) throw new Error("The local Codex connection is closed."); child.stdin.write(JSON.stringify(message) + "\n"); };
  const rpc: CodexRpc = {
    request: (method, params) => new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      try { send({ id, method, params }); } catch (error) { pending.delete(id); reject(error); }
    }),
    notify: (method, params) => send({ method, params }),
    respond: (id, result) => send({ id, result }),
    listen: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    close: () => { fail(); child.stdin.end(); },
  };
  try { return await runCodexTurn({ rpc, prompt, cwd, timeoutMs: options.timeoutMs, signal: options.signal, onDelta: options.onDelta, testOnly: options.testOnly, tools: options.tools }); }
  finally {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (child.exitCode !== null || !child.pid) return resolve();
        // Windows npm shims launch a child executable. Stop only this job's tracked
        // process tree, after allowing App Server to exit cleanly on stdin EOF.
        if (process.platform === "win32") {
          const stop = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
          stop.once("close", () => resolve()); stop.once("error", () => resolve());
        } else { child.kill(); resolve(); }
      }, 2000);
      void processClosed.then(() => { clearTimeout(timer); resolve(); });
    });
    await rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}
