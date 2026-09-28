#!/usr/bin/env node
/**
 * Vantage AI subscription bridge — single-file, stdlib-only local service.
 *
 * A team member who already pays for Claude Pro/Max (which includes the Claude Code CLI)
 * or ChatGPT (which includes the Codex CLI) runs this on an always-on computer. It pairs
 * with the team's Vantage workspace via an 8-character code, then polls for queued chat
 * requests belonging to the person who paired it. Your account, your machine, your
 * provider's usage windows. Other teammates cannot use this connection.
 *
 *   node bridge.mjs --setup [--url https://your-vantage-host]   # pair this machine
 *   node bridge.mjs                                             # run the bridge loop
 *   node bridge.mjs --status                                    # engine detection report
 *
 * Docs (systemd unit, Windows service, terms/limits): docs/AI_BRIDGE.md in the repo.
 *
 * Verified against Claude Code 2.1.241 on Windows: `claude -p --output-format json`
 * emits a single JSON object with {is_error, result, usage:{input_tokens, output_tokens},
 * modelUsage:{<model-id>: …}} and EXIT CODE 0 even for errors — failures must be read
 * from the JSON, not the exit code. Codex uses its supported App Server protocol and
 * an isolated personal profile; existing terminal conversations are never imported.
 */

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

export const BRIDGE_VERSION = "0.2.0";
const profileFlag = process.argv.indexOf("--profile");
const PROFILE_NAME = (profileFlag >= 0 ? process.argv[profileFlag + 1] : process.env.VANTAGE_PROFILE)?.toLowerCase();
if (PROFILE_NAME && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(PROFILE_NAME)) throw new Error("Use --profile with your Vantage user ID from Personal connections.");
const CONFIG_PATH = PROFILE_NAME ? join(homedir(), ".vantage", "profiles", PROFILE_NAME, "ai-bridge.json") : null;
// Canonical production origin. Must stay byte-identical to DEFAULT_PRODUCTION_ORIGIN in
// apps/desktop/src/allowlist.ts, SITE_URL in apps/web/lib/site.ts, and the origin added in
// packages/core/src/access-policy.ts — `--setup` with no --url/VANTAGE_URL pairs against
// this host, so drift here silently points mentors at a deployment that does not exist.
// vantage-frc-web.vercel.app is retired and answers DEPLOYMENT_NOT_FOUND, so a
// bridge set up with neither --url nor VANTAGE_URL paired against nothing.
export const CANONICAL_BASE_URL = "https://vantagefrc.vercel.app";
const DEFAULT_BASE_URL = process.env.VANTAGE_URL || CANONICAL_BASE_URL;
const JOB_TIMEOUT_MS = Number(process.env.VANTAGE_BRIDGE_JOB_TIMEOUT_MS || 90_000);
const HEARTBEAT_INTERVAL_MS = 60_000;
const CLAIM_INTERVAL_MS = 2_500;
const DETECT_TIMEOUT_MS = 10_000;

/* ------------------------------------------------------------------ */
/* Pure helpers (exported for tests in packages/agent/test)            */
/* ------------------------------------------------------------------ */

/**
 * Detect provider rate-limit / usage-window messages in CLI output. When the text names
 * a reset time we surface it VERBATIM so the app can show it honestly.
 */
export function detectRateLimit(text) {
  const value = String(text ?? "");
  const rateLimited =
    /rate.?limit|usage limit|too many requests|out of (?:usage|credits|quota)|quota exceeded|limit (?:will )?reset|5.?hour limit|weekly limit/i.test(
      value,
    );
  if (!rateLimited) return { rateLimited: false, resetText: null };
  const reset = value.match(/[^.\n]*reset[^.\n]*/i);
  return { rateLimited: true, resetText: reset ? reset[0].trim() : null };
}

/**
 * Parse the single JSON object printed by `claude -p --output-format json` into the
 * bridge's normalized result. Never throws: unparseable output classifies as cli_error.
 * Returns {ok, text, model, usage} or {ok:false, errorClass, errorMessage}.
 */
export function parseClaudeCliOutput(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(String(stdout ?? "").trim());
  } catch {
    return {
      ok: false,
      errorClass: "cli_error",
      errorMessage: `Claude CLI printed non-JSON output: ${String(stdout ?? "").slice(0, 400)}`,
    };
  }
  const text = typeof parsed.result === "string" ? parsed.result : "";
  if (parsed.is_error) {
    if (/not logged in|please run \/login|authentication/i.test(text)) {
      return { ok: false, errorClass: "not_authenticated", errorMessage: text.slice(0, 1000) };
    }
    const limit = detectRateLimit(text);
    if (limit.rateLimited) {
      return {
        ok: false,
        errorClass: "rate_limited",
        // Verbatim provider text — includes the reset time when the CLI reports one.
        errorMessage: text.slice(0, 1000),
        resetText: limit.resetText,
      };
    }
    return { ok: false, errorClass: "cli_error", errorMessage: (text || "Claude CLI reported an error").slice(0, 1000) };
  }
  const usage = parsed.usage && typeof parsed.usage === "object" ? parsed.usage : {};
  const modelUsage = parsed.modelUsage && typeof parsed.modelUsage === "object" ? parsed.modelUsage : {};
  const model = Object.keys(modelUsage)[0] ?? null;
  return {
    ok: true,
    text,
    model,
    usage: {
      inputTokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
      outputTokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0,
      cacheReadInputTokens: Number.isFinite(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : 0,
    },
  };
}

/**
 * Per-job CLI budget: the web enqueues messages.timeoutMs (90s interactive, 240s for
 * heavy jobs when this device covers everything). Clamped so a malformed queue row can
 * neither spin the CLI forever nor kill it instantly; absent → the env/default budget.
 */
export function jobTimeoutMs(messages) {
  const requested = Number(messages?.timeoutMs);
  if (!Number.isFinite(requested) || requested <= 0) return JOB_TIMEOUT_MS;
  return Math.min(Math.max(requested, 30_000), 300_000);
}

/** Classify a non-zero exit / timeout spawn into the bridge's error taxonomy. */
export function classifySpawnFailure({ timedOut, status, stderr, stdout, timeoutMs }) {
  if (timedOut) {
    return { errorClass: "cli_timeout", errorMessage: `CLI did not finish within ${(timeoutMs ?? JOB_TIMEOUT_MS) / 1000}s.` };
  }
  const text = `${stderr ?? ""}\n${stdout ?? ""}`.trim();
  const limit = detectRateLimit(text);
  if (limit.rateLimited) return { errorClass: "rate_limited", errorMessage: text.slice(0, 1000) };
  return {
    errorClass: "cli_error",
    errorMessage: `CLI exited with status ${status}: ${text.slice(0, 800)}`,
  };
}

/* ------------------------------------------------------------------ */
/* Engine detection + execution                                        */
/* ------------------------------------------------------------------ */

function runSync(command, args, { timeoutMs = DETECT_TIMEOUT_MS, input, userId } = {}) {
  let env;
  if (command === "claude" && args[0] !== "--version") {
    try { env = personalEnvironment(userId || "", "claude").env; }
    catch { return { error: true, status: null, stdout: "", stderr: "Personal sign-in required." }; }
  }
  // Direct spawn first (finds .exe on every platform). npm-style .cmd shims are not
  // found by CreateProcess, so retry through cmd.exe on Windows when that happens.
  let result = spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs, input, env, windowsHide: true });
  if (result.error && result.error.code === "ENOENT" && process.platform === "win32") {
    result = spawnSync("cmd.exe", ["/d", "/s", "/c", command, ...args.map((a) => (a === "" ? '""' : a))], {
      encoding: "utf8",
      timeout: timeoutMs,
      input,
      env,
      windowsHide: true,
      windowsVerbatimArguments: false,
    });
  }
  return result;
}

/** `claude --version` + `claude auth status` (both verified on 2.1.241). */
export function detectClaude(userId) {
  const version = runSync("claude", ["--version"]);
  if (version.error || version.status !== 0) return { available: false };
  const report = { available: true, version: String(version.stdout ?? "").trim().split(/\s+/)[0] || null };
  if (!userId) return { ...report, authenticated: false };
  const auth = runSync("claude", ["auth", "status"], { userId });
  if (!auth.error && typeof auth.stdout === "string") {
    try {
      report.authenticated = Boolean(JSON.parse(auth.stdout).loggedIn);
    } catch {
      report.authenticated = null; // CLI answered but not in the JSON shape we know.
    }
  }
  return report;
}

/** Version detection is separate from the personal account test. */
export function detectCodex() {
  const version = runSync("codex", ["--version"]);
  if (version.error || version.status !== 0) return { available: false };
  return {
    available: true,
    version: String(version.stdout ?? "").trim().split(/\s+/).pop() || null,
    authenticated: null,
  };
}

export function detectEngines(userId) {
  return { claude: detectClaude(userId), codex: detectCodex() };
}

async function personalEngines(config) {
  const engines = detectEngines(config?.userId);
  if (engines.codex?.available && config?.userId) {
    const result = await executePersonalCodex("", { userId: config.userId, timeoutMs: DETECT_TIMEOUT_MS, testOnly: true });
    engines.codex.authenticated = result.ok ? true : result.errorClass === "not_authenticated" ? false : null;
  }
  return engines;
}

function runJobCli(command, args, prompt, timeoutMs = JOB_TIMEOUT_MS, personal = {}) {
  if (personal.signal?.aborted) return Promise.resolve({ status: null, stdout: "", stderr: "Request cancelled.", timedOut: false });
  const { env } = personalEnvironment(personal.userId || "", "claude");
  return new Promise((resolve) => {
    // cwd = temp dir so the CLI never picks up a project's CLAUDE.md or settings.
    const child = spawn(command, args, { cwd: tmpdir(), env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    const cancel = () => child.kill("SIGKILL");
    personal.signal?.addEventListener("abort", cancel, { once: true });
    const cleanup = () => { clearTimeout(timer); personal.signal?.removeEventListener("abort", cancel); };
    child.on("error", (error) => {
      cleanup();
      resolve({ status: null, stdout, stderr: String(error), timedOut: false, spawnError: true });
    });
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => {
      cleanup();
      resolve({ status, stdout, stderr, timedOut });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/**
 * Execute a chat job through Claude Code in headless print mode. Flag set verified
 * against `claude --help` (2.1.241): -p prints and exits, --output-format json emits one
 * JSON object, --tools "" disables ALL tool use (pure chat turn), --no-session-persistence
 * keeps the subscriber's session history clean, --setting-sources "" and
 * --disable-slash-commands keep their personal config out of team answers.
 * NOTE: never pass --bare — it restricts auth to ANTHROPIC_API_KEY and would bypass the
 * subscription OAuth that is the whole point of this bridge.
 */
async function executeClaude(prompt, timeoutMs = JOB_TIMEOUT_MS, personal = {}) {
  if (!personal.userId) return { ok: false, errorClass: "not_authenticated", errorMessage: "Pair your personal connection before using Claude." };
  const args = [
    "-p",
    "--output-format",
    "json",
    "--tools",
    "",
    "--no-session-persistence",
    "--disable-slash-commands",
    "--setting-sources",
    "",
  ];
  const run = await runJobCli("claude", args, prompt, timeoutMs, personal);
  if (run.timedOut || run.spawnError || run.status !== 0) {
    return { ok: false, ...classifySpawnFailure({ ...run, timeoutMs }) };
  }
  return parseClaudeCliOutput(run.stdout);
}

/** Execute only the paired person's isolated Codex App Server profile. */
async function executeCodex(prompt, timeoutMs = JOB_TIMEOUT_MS, personal = {}) {
  const tools = standaloneFeatureTools(personal.signal);
  return executePersonalCodex(prompt, { userId: personal.userId || '', timeoutMs, signal: personal.signal, tools });
}
function standaloneFeatureTools(signal) {
  return personalFeatureToolRegistry({
    postJson: async (url, body, opts) => {
      const response = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${opts.token}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.any([AbortSignal.timeout(opts.timeoutMs), ...(signal ? [signal] : [])]) });
      return { ok: response.ok, status: response.status, data: await response.json() };
    },
  }, async () => loadConfig());
}

/** Honor an explicit engine; personal Codex is the default. */
export function pickEngine(engines, requestedEngine) {
  if (requestedEngine) return engines[requestedEngine]?.available ? requestedEngine : null;
  if (engines.codex?.available) return "codex";
  if (engines.claude?.available) return "claude";
  return null;
}

/* ------------------------------------------------------------------ */
/* Config + HTTP                                                       */
/* ------------------------------------------------------------------ */

function loadConfig() {
  let config;
  try {
    config = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
  if (config?.userId?.toLowerCase() !== PROFILE_NAME) throw new Error("This pairing belongs to a different person. Pair your own Vantage profile.");
  return config;
}

function saveConfig(config) {
  if (config?.userId?.toLowerCase() !== PROFILE_NAME) throw new Error("Approve pairing using the Vantage account shown in your personal setup command.");
  mkdirSync(dirname(CONFIG_PATH), { recursive: true });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
}

async function api(config, path, { method = "POST", body, token } = {}) {
  const response = await fetch(new URL(path, config.baseUrl), {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  return response;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------------------ */
/* Setup (pairing)                                                     */
/* ------------------------------------------------------------------ */

async function setup(baseUrl) {
  const config = { baseUrl, machineName: hostname() };
  const engines = detectEngines();
  console.log(`Engines detected: claude=${engines.claude.available ? engines.claude.version : "no"} codex=${engines.codex.available ? engines.codex.version : "no"}`);
  if (!engines.claude.available && !engines.codex.available) {
    console.log("Neither the Claude Code CLI nor the Codex CLI is installed. Install one and sign in first:");
    console.log("  Claude Pro/Max: https://docs.anthropic.com/en/docs/claude-code  then `claude auth login`");
    console.log("  ChatGPT/Codex:  https://developers.openai.com/codex/cli        then `codex login`");
    process.exitCode = 1;
    return;
  }
  const start = await api(config, "/api/ai-bridge/device/pair/start", {
    body: { machineName: config.machineName, bridgeVersion: BRIDGE_VERSION },
  });
  const started = await start.json();
  if (!start.ok) throw new Error(started.error || "Pairing could not start");
  console.log("");
  console.log(`  Pairing code:  ${started.userCode}`);
  console.log(`  Approve at:    ${started.verificationUri}`);
  console.log("");
  console.log("Waiting for approval (10 minute window)…");
  for (;;) {
    await sleep((started.interval ?? 3) * 1000);
    const poll = await api(config, "/api/ai-bridge/device/pair/poll", { body: { pollToken: started.pollToken } });
    const data = await poll.json();
    if (data.status === "pending") continue;
    if (data.status === "approved") {
      if (!data.userId) throw new Error("Update Vantage before pairing a personal connection.");
      saveConfig({ ...config, deviceToken: data.deviceToken, deviceId: data.deviceId, orgId: data.orgId, userId: data.userId });
      console.log(`Paired to your personal account. Config saved to ${CONFIG_PATH}. Sign in with node bridge.mjs --profile ${PROFILE_NAME} --codex-login, then run node bridge.mjs --profile ${PROFILE_NAME}.`);
      return;
    }
    throw new Error(`Pairing ${data.status ?? "failed"}${data.error ? `: ${data.error}` : ""}`);
  }
}

/* ------------------------------------------------------------------ */
/* Main loop                                                           */
/* ------------------------------------------------------------------ */

async function runLoop() {
  const config = loadConfig();
  if (!config?.deviceToken || !config.userId) {
    console.error(`Not paired yet — run: node bridge.mjs --setup   (config: ${CONFIG_PATH})`);
    process.exitCode = 1;
    return;
  }
  let engines = await personalEngines(config);
  let jobsServed = 0;
  let stopping = false;
  const controller = new AbortController();
  const stop = () => {
    stopping = true;
    controller.abort();
    console.log("Cancelling the current request and stopping…");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  async function heartbeat() {
    engines = await personalEngines(config);
    try {
      const response = await api(config, "/api/ai-bridge/device/heartbeat", {
        token: config.deviceToken,
        body: { bridgeVersion: BRIDGE_VERSION, engines, stats: { jobsServedThisSession: jobsServed } },
      });
      if (response.status === 401) {
        console.error("Device token was revoked in Vantage. Re-pair with --setup.");
        stopping = true;
      }
    } catch (error) {
      console.error(`Heartbeat failed (will retry): ${error}`);
    }
  }

  await heartbeat();
  console.log(`Vantage AI bridge running as "${config.machineName}". Ctrl+C to stop.`);
  let lastHeartbeat = Date.now();

  while (!stopping) {
    if (Date.now() - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      await heartbeat();
      lastHeartbeat = Date.now();
    }
    let job = null;
    try {
      const claim = await api(config, "/api/ai-bridge/device/jobs", { token: config.deviceToken });
      if (claim.status === 401) {
        console.error("Device token rejected — re-pair with --setup.");
        break;
      }
      if (claim.status === 200) job = await claim.json();
    } catch (error) {
      console.error(`Claim failed (will retry): ${error}`);
    }
    if (!job?.jobId) {
      await sleep(CLAIM_INTERVAL_MS);
      continue;
    }
    if (job.userId !== config.userId || job.orgId !== config.orgId) throw new Error("This request does not belong to your personal profile. Update Vantage and re-pair.");

    const prompt = String(job.messages?.prompt ?? "");
    const timeoutMs = jobTimeoutMs(job.messages);
    const engine = pickEngine(engines, job.requestedEngine ?? null);
    let outcome;
    if (!engine) {
      outcome = { ok: false, errorClass: "cli_error", errorMessage: "No installed CLI engine can serve this job." };
    } else {
      console.log(`Job ${job.jobId} (${job.feature}, ${Math.round(timeoutMs / 1000)}s budget) → ${engine}`);
      {
        const requestController = new AbortController();
        const cancel = () => requestController.abort();
        controller.signal.addEventListener("abort", cancel, { once: true });
        if (controller.signal.aborted) cancel();
        const checking = (async () => {
          while (!requestController.signal.aborted) {
            await sleep(CLAIM_INTERVAL_MS);
            if (requestController.signal.aborted) return;
            try {
              const response = await api(config, "/api/ai-bridge/device/jobs", { method: "PUT", token: config.deviceToken, body: { jobId: job.jobId, leaseToken: job.leaseToken } });
              const data = await response.json();
              if (!response.ok || data.active !== true) requestController.abort();
            } catch { requestController.abort(); }
          }
        })();
        try {
          const personal = { userId: config.userId, signal: requestController.signal };
          outcome = engine === "claude" ? await executeClaude(prompt, timeoutMs, personal) : await executeCodex(prompt, timeoutMs, personal);
        }
        finally { requestController.abort(); controller.signal.removeEventListener("abort", cancel); await checking; }
      }
    }
    try {
      await api(config, "/api/ai-bridge/device/jobs", {
        method: "PATCH",
        token: config.deviceToken,
        body: outcome.ok
          ? {
              jobId: job.jobId,
              leaseToken: job.leaseToken,
              state: "done",
              result: { text: outcome.text, model: outcome.model, usage: outcome.usage, engine },
            }
          : {
              jobId: job.jobId,
              leaseToken: job.leaseToken,
              state: "failed",
              errorClass: outcome.errorClass,
              errorMessage: outcome.errorMessage,
            },
      });
      if (outcome.ok) jobsServed += 1;
      else console.error(`Job ${job.jobId} failed: ${outcome.errorClass} — ${outcome.errorMessage}`);
    } catch (error) {
      console.error(`Could not report job result (${error}) — the lease will expire on its own.`);
    }
  }
  console.log(`Bridge stopped. Jobs served this session: ${jobsServed}.`);
}

/* ------------------------------------------------------------------ */
/* Entrypoint                                                          */
/* ------------------------------------------------------------------ */

// BEGIN GENERATED PERSONAL CODEX
/**
 * mcp capability — expose Vantage as an MCP stdio server to Claude Code / Cursor on this
 * machine. Standard MCP stdio uses newline-delimited JSON. The decoder also accepts the
 * legacy CAD connector's Content-Length framing for compatibility; responses always use
 * standard stdio. The method surface (initialize, ping,
 * tools/list, tools/call), but the TOOLS are an injected registry instead of a hard-coded
 * CAD list — the actual Vantage tool surface is wired by the hosts.
 *
 * Unlike the resident capabilities, an MCP server is launched ON DEMAND by the editor
 * (Claude Code / Cursor spawns the host command and speaks stdio). So the supervisor-run
 * capability below only reports availability honestly; `runConnectorMcp` is what a host
 * binds to its stdio when the editor launches it.
 */
export const MCP_PROTOCOL_VERSION = "2025-11-25";
const SUPPORTED_MCP_VERSIONS = new Set([MCP_PROTOCOL_VERSION, "2025-06-18", "2025-03-26", "2024-11-05"]);
/** A registry with no tools — the honest default until the host wires the real surface. */
export function emptyToolRegistry() {
    return {
        list: () => [],
        call: async (name) => {
            throw new Error(`No tool named ${JSON.stringify(name)} is registered on this connector.`);
        },
    };
}
/**
 * One genuinely local, self-contained tool: the live status of this connector (which
 * capabilities are enabled/running, what was detected). Hosts pass the supervisor's
 * status() so an editor session can ask "is the team bridge up?" without leaving chat.
 */
export function connectorStatusToolRegistry(getStatus) {
    const definition = {
        name: "vantage_connector_status",
        description: "Live status of the Vantage connector on this machine: paired org, enabled capabilities, their run state, and last detection details.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
    };
    return {
        list: () => [definition],
        call: async (name) => {
            if (name !== definition.name) {
                throw new Error(`No tool named ${JSON.stringify(name)} is registered on this connector.`);
            }
            return getStatus();
        },
    };
}
/** Merge registries (first match wins on duplicate tool names). */
export function combineToolRegistries(...registries) {
    return {
        list: () => {
            const seen = new Set();
            const out = [];
            for (const registry of registries) {
                for (const tool of registry.list()) {
                    if (seen.has(tool.name))
                        continue;
                    seen.add(tool.name);
                    out.push(tool);
                }
            }
            return out;
        },
        call: async (name, args) => {
            for (const registry of registries) {
                if (registry.list().some((tool) => tool.name === name))
                    return registry.call(name, args);
            }
            throw new Error(`No tool named ${JSON.stringify(name)} is registered on this connector.`);
        },
    };
}
export async function dispatchConnectorMcp(message, registry, write, hooks = {}) {
    const method = String(message.method ?? "");
    const id = message.id;
    if (method === "initialize") {
        const requestedVersion = message.params?.protocolVersion;
        write({
            jsonrpc: "2.0",
            id,
            result: {
                protocolVersion: typeof requestedVersion === "string" && SUPPORTED_MCP_VERSIONS.has(requestedVersion) ? requestedVersion : MCP_PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: { name: "vantage-connector", version: BRIDGE_VERSION },
            },
        });
        return;
    }
    if (method === "notifications/initialized" || method === "initialized")
        return;
    if (method === "ping") {
        if (id !== undefined && id !== null)
            write({ jsonrpc: "2.0", id, result: {} });
        return;
    }
    if (method === "tools/list") {
        write({ jsonrpc: "2.0", id, result: { tools: registry.list() } });
        return;
    }
    if (method === "tools/call") {
        const params = message.params ?? {};
        const name = String(params.name ?? "");
        const args = (params.arguments ?? {});
        try {
            const result = await registry.call(name, args);
            write({
                jsonrpc: "2.0",
                id,
                result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
            });
            if (hooks.onToolCall)
                await Promise.resolve(hooks.onToolCall(name, args, true)).catch(() => undefined);
        }
        catch (error) {
            const text = error instanceof Error ? error.message : "Connector tool failed";
            write({
                jsonrpc: "2.0",
                id,
                result: { content: [{ type: "text", text }], isError: true },
            });
            if (hooks.onToolCall)
                await Promise.resolve(hooks.onToolCall(name, args, false, text)).catch(() => undefined);
        }
        return;
    }
    if (id !== undefined && id !== null) {
        write({ jsonrpc: "2.0", id, error: { code: -32601, message: `Unsupported method ${method || "(none)"}` } });
    }
}
/** Serialize a message as a Content-Length framed MCP frame. */
export function encodeMcpFrame(message) {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    return Buffer.concat([Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "utf8"), payload]);
}
/** MCP stdio messages contain exactly one JSON value per line. */
export function encodeMcpStdio(message) {
    return Buffer.from(`${JSON.stringify(message)}\n`, "utf8");
}
/**
 * Incremental frame decoder: feed chunks, get parsed messages. Handles Content-Length
 * framing and the line-delimited JSON fallback some clients speak (same tolerance as
 * mcp-stdio.ts). Pure state machine — testable without streams.
 */
export class McpFrameDecoder {
    buffer = Buffer.alloc(0);
    push(chunk) {
        this.buffer = Buffer.concat([this.buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, "utf8")]);
        const messages = [];
        for (;;) {
            const headerEnd = this.buffer.indexOf("\r\n\r\n");
            if (headerEnd === -1) {
                const asText = this.buffer.toString("utf8");
                const nl = asText.indexOf("\n");
                if (nl !== -1 && asText.trimStart().startsWith("{")) {
                    const line = asText.slice(0, nl).trim();
                    this.buffer = Buffer.from(asText.slice(nl + 1), "utf8");
                    try {
                        messages.push(JSON.parse(line));
                    }
                    catch {
                        /* ignore incomplete */
                    }
                    continue;
                }
                return messages;
            }
            const header = this.buffer.subarray(0, headerEnd).toString("utf8");
            const match = /Content-Length:\s*(\d+)/i.exec(header);
            if (!match) {
                this.buffer = this.buffer.subarray(headerEnd + 4);
                continue;
            }
            const length = Number(match[1]);
            const bodyStart = headerEnd + 4;
            if (this.buffer.length < bodyStart + length)
                return messages;
            const body = this.buffer.subarray(bodyStart, bodyStart + length).toString("utf8");
            this.buffer = this.buffer.subarray(bodyStart + length);
            try {
                messages.push(JSON.parse(body));
            }
            catch {
                /* ignore */
            }
        }
    }
}
/**
 * Bind the MCP server to a pair of streams (a host wires process.stdin/stdout here when
 * the editor launches `<host> mcp`). Returns an unsubscribe function.
 */
export function runConnectorMcp(registry, io, hooks = {}) {
    const decoder = new McpFrameDecoder();
    const write = (message) => {
        io.output.write(encodeMcpStdio(message));
    };
    io.input.on("data", (chunk) => {
        for (const message of decoder.push(chunk)) {
            void dispatchConnectorMcp(message, registry, write, hooks);
        }
    });
}
/* ------------------------------------------------------------------ */
/* Capability                                                          */
/* ------------------------------------------------------------------ */
export class McpCapability {
    options;
    id = "mcp";
    label = "MCP server (Codex / Claude Code / Cursor)";
    constructor(options = {}) {
        this.options = options;
    }
    registry() {
        return this.options.registry ?? emptyToolRegistry();
    }
    async detect() {
        const tools = this.registry().list();
        return {
            available: true,
            detail: tools.length === 0
                ? "MCP stdio server is available; no Vantage tools are wired yet (the host provides the registry)."
                : `MCP stdio server with ${tools.length} tool(s), served on demand.`,
            data: { tools: tools.map((tool) => tool.name) },
        };
    }
    async start(ctx) {
        // Nothing resident to run: editors spawn the host's `mcp` command on demand and the
        // host calls runConnectorMcp with its stdio. This loop just holds the "enabled" state.
        while (!ctx.signal.aborted) {
            await ctx.clock.sleep(60_000, ctx.signal);
        }
    }
    async stop() {
        // Nothing to release.
    }
    status() {
        const tools = this.registry().list();
        return {
            detail: "Served on demand over stdio when Codex, Claude Code or Cursor launches the connector's mcp command.",
            data: { tools: tools.map((tool) => tool.name) },
        };
    }
}

const string = (maxLength, minLength = 0) => ({ type: "string", minLength, maxLength });
const season = { type: "integer", minimum: 1992, maximum: 2100 };
const limit = { type: "integer", minimum: 1, maximum: 20 };
function tool(service, description, properties, required = [], mutation = false) {
    return {
        name: `vantage_${service.replaceAll(".", "_")}`,
        service, description, mutation,
        inputSchema: { type: "object", properties, required, additionalProperties: false },
        annotations: { readOnlyHint: !mutation, destructiveHint: false, idempotentHint: !mutation, openWorldHint: false },
    };
}
/** Explicit service allowlist. Identity, SQL, shell commands and credentials are never tool inputs. */
export const PERSONAL_FEATURE_TOOLS = [
    tool("scouting.team", "Read your team's observations and supporting match data for a robot.", { teamKey: { ...string(16, 4), pattern: "^frc[0-9]+$" } }, ["teamKey"]),
    tool("scouting.schema", "Read the configured scouting fields and units for a season.", { seasonYear: season }),
    tool("inventory.availability", "Search stock and BOM availability in your team.", { query: string(160), subsystem: string(120), limit: { ...limit, maximum: 40 } }),
    tool("knowledge.search", "Search your team's wiki and saved decisions.", { query: string(200, 1), limit }, ["query"]),
    tool("cad.briefs", "Read your team's recent CAD briefs and their actual job status.", { limit }),
    tool("my_day.summary", "Read your event context and next-match readiness.", {}),
    tool("finance.create_purchase_request", "Propose a purchase request. A person must confirm it in Vantage; this tool never places an order or spends money.", { title: string(200, 1), justification: string(2000, 1), quantity: { type: "integer", minimum: 1, maximum: 9999 }, estimateUsd: { type: "number", minimum: 0, maximum: 1_000_000 }, itemUrl: string(2000), vendor: string(120), seasonYear: season }, ["title", "justification"], true),
    tool("cad.create_brief", "Propose a CAD engineering brief. A person must confirm it in Vantage before a job is created.", { request: string(12000, 1), title: string(160), matchKey: string(80), seasonYear: season }, ["request"], true),
];
export function validateFeatureToolInput(name, value) {
    const definition = PERSONAL_FEATURE_TOOLS.find((entry) => entry.name === name);
    if (!definition)
        throw new Error("This Vantage tool is not available.");
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Tool arguments must be an object.");
    const input = value;
    for (const key of definition.inputSchema.required)
        if (!(key in input))
            throw new Error(`${key} is required.`);
    for (const [key, fieldValue] of Object.entries(input)) {
        const field = definition.inputSchema.properties[key];
        if (!field)
            throw new Error(`Unsupported tool argument: ${key}.`);
        if (field.type === "string") {
            if (typeof fieldValue !== "string" || fieldValue.trim().length < (field.minLength ?? 0) || fieldValue.length > (field.maxLength ?? Infinity) || (field.pattern && !new RegExp(field.pattern).test(fieldValue)))
                throw new Error(`${key} is invalid.`);
        }
        else if (typeof fieldValue !== "number" || !Number.isFinite(fieldValue) || (field.type === "integer" && !Number.isInteger(fieldValue)) || fieldValue < (field.minimum ?? -Infinity) || fieldValue > (field.maximum ?? Infinity))
            throw new Error(`${key} is invalid.`);
    }
    return { tool: definition, input };
}
/** Reads the selected profile again for every call, so token revocation/re-pairing takes effect. */
export function personalFeatureToolRegistry(transport, loadConfig) {
    return {
        list: () => PERSONAL_FEATURE_TOOLS.map((entry) => ({ name: entry.name, description: entry.description, inputSchema: entry.inputSchema, annotations: entry.annotations })),
        async call(name, input) {
            validateFeatureToolInput(name, input);
            const config = await loadConfig();
            if (!config?.userId || !config.orgId)
                throw new Error("Pair your personal Vantage profile first.");
            const base = new URL(config.baseUrl);
            if (base.protocol !== "https:" && !(base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)))
                throw new Error("Vantage connections require HTTPS.");
            const response = await transport.postJson(new URL("/api/ai-bridge/device/tools", base).toString(), { name, input }, { token: config.deviceToken, timeoutMs: 30_000 });
            if (!response.ok)
                throw new Error(typeof response.data.error === "string" ? response.data.error : `Vantage tool failed (${response.status}).`);
            return response.data.result;
        },
    };
}

/** A fresh ephemeral thread contains only this Vantage request. No terminal history APIs. */
export async function runCodexTurn(options) {
    const { rpc } = options;
    let threadId = null;
    let turnId = null;
    let model = null;
    let text = "";
    let usage = { inputTokens: 0, outputTokens: 0 };
    let finished = false;
    let resolveOutcome;
    const outcome = new Promise((resolve) => { resolveOutcome = resolve; });
    const finish = (value) => { if (!finished) {
        finished = true;
        resolveOutcome(value);
    } };
    const interrupt = (errorClass) => {
        if (threadId && turnId)
            void rpc.request("turn/interrupt", { threadId, turnId }).catch(() => { });
        finish({ ok: false, errorClass, errorMessage: errorClass === "cancelled" ? "Your Vantage request was cancelled." : "Codex did not finish within the request's time limit." });
    };
    const abort = () => interrupt("cancelled");
    const timer = setTimeout(() => interrupt("cli_timeout"), options.timeoutMs);
    options.signal?.addEventListener("abort", abort, { once: true });
    const unsubscribe = rpc.listen((message) => {
        if (message.method === "vantage/connectionClosed") {
            finish({ ok: false, errorClass: "cli_error", errorMessage: "The local Codex App Server disconnected." });
            return;
        }
        const params = message.params ?? {};
        if (message.id !== undefined && message.method) {
            if (message.method === "item/tool/call") {
                const id = message.id;
                const allowed = !finished && threadId && turnId && params.threadId === threadId && params.turnId === turnId
                    && !params.namespace && typeof params.tool === "string" && options.tools?.list().some((tool) => tool.name === params.tool);
                if (!allowed) {
                    rpc.respond(id, { success: false, contentItems: [{ type: "inputText", text: "This tool call does not belong to the active Vantage request." }] });
                    return;
                }
                const args = params.arguments;
                if (!args || typeof args !== "object" || Array.isArray(args)) {
                    rpc.respond(id, { success: false, contentItems: [{ type: "inputText", text: "Tool arguments must be an object." }] });
                    return;
                }
                void options.tools.call(params.tool, args).then((value) => {
                    if (!finished)
                        rpc.respond(id, { success: true, contentItems: [{ type: "inputText", text: JSON.stringify(value) }] });
                }).catch((error) => {
                    if (!finished)
                        rpc.respond(id, { success: false, contentItems: [{ type: "inputText", text: error instanceof Error ? error.message : "The Vantage tool failed." }] });
                });
                return;
            }
            // This chat transport cannot grant arbitrary shell, filesystem or account access.
            // Typed Vantage tools have a separate application permission/approval boundary.
            const method = message.method;
            if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval")
                rpc.respond(message.id, { decision: "decline" });
            else if (method === "item/permissions/requestApproval")
                rpc.respond(message.id, { permissions: {}, scope: "turn" });
            else if (method === "mcpServer/elicitation/request")
                rpc.respond(message.id, { action: "decline", content: null });
            else if (method === "item/tool/requestUserInput")
                rpc.respond(message.id, { answers: {} });
            else
                rpc.respond(message.id, { success: false, contentItems: [{ type: "inputText", text: "This request is unavailable in Vantage chat." }] });
            return;
        }
        if (!threadId || params.threadId !== threadId || finished)
            return;
        const turn = params.turn;
        if (message.method === "turn/started" && turn?.id && !turnId)
            turnId = turn.id;
        const eventTurn = typeof params.turnId === "string" ? params.turnId : turn?.id;
        if (eventTurn && turnId && eventTurn !== turnId)
            return;
        if (message.method === "item/agentMessage/delta" && typeof params.delta === "string") {
            text += params.delta;
            options.onDelta?.(params.delta);
        }
        if (message.method === "item/completed") {
            const item = params.item;
            if (item?.type === "agentMessage" && typeof item.text === "string" && item.phase !== "commentary")
                text = item.text;
        }
        if (message.method === "thread/tokenUsage/updated") {
            const reported = params.tokenUsage;
            if (reported?.last)
                usage = { inputTokens: reported.last.inputTokens ?? 0, outputTokens: reported.last.outputTokens ?? 0 };
        }
        if (message.method === "turn/completed") {
            if (turn?.status === "completed" && text)
                finish({ ok: true, text, model, usage });
            else {
                const errorMessage = turn?.error?.message ?? "Codex ended without a completed answer.";
                const errorClass = /rate.?limit|usage limit|quota|credits/i.test(errorMessage) ? "rate_limited" : turn?.status === "interrupted" ? "cancelled" : "cli_error";
                finish({ ok: false, errorClass, errorMessage: errorMessage.slice(0, 2000) });
            }
        }
    });
    try {
        if (options.signal?.aborted)
            return { ok: false, errorClass: "cancelled", errorMessage: "Your Vantage request was cancelled." };
        const execute = async () => {
            await rpc.request("initialize", { clientInfo: { name: "vantage_personal_bridge", title: "Vantage personal connection", version: "0.2.0" }, capabilities: { experimentalApi: true } });
            rpc.notify("initialized", {});
            const account = await rpc.request("account/read", { refreshToken: false });
            if (account.account?.type !== "chatgpt")
                return finish({ ok: false, errorClass: "not_authenticated", errorMessage: "Sign in to your own ChatGPT account in this Vantage profile using codex login." });
            if (options.testOnly)
                return finish({ ok: true, text: "Your personal Codex account is connected.", model: null, usage: { inputTokens: 0, outputTokens: 0 } });
            if (finished)
                return;
            const started = await rpc.request("thread/start", {
                cwd: options.cwd, ephemeral: true, approvalPolicy: "on-request", sandbox: "read-only", serviceName: "vantage",
                config: { "features.shell_tool": false, "features.multi_agent": false, "features.remote_plugin": false, web_search: "disabled" },
                dynamicTools: options.tools?.list().map((tool) => ({ type: "function", name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) ?? [],
                baseInstructions: "Answer the submitted Vantage request using its supplied context and authorized Vantage feature tools. Write tools return proposals; the person must confirm them in Vantage. Never claim a proposed action is completed. Do not inspect local files, credentials, or unrelated conversations. Do not run shell commands or change files.",
            });
            threadId = started.thread?.id ?? null;
            model = typeof started.model === "string" ? started.model : null;
            if (!threadId)
                throw new Error("Codex did not return a new thread.");
            if (finished)
                return;
            const startedTurn = await rpc.request("turn/start", { threadId, input: [{ type: "text", text: options.prompt, text_elements: [] }], sandboxPolicy: { type: "readOnly", networkAccess: false }, approvalPolicy: "on-request" });
            const returnedId = startedTurn.turn?.id;
            if (!returnedId || (turnId && turnId !== returnedId))
                throw new Error("Codex returned an inconsistent turn identity.");
            turnId = returnedId;
            if (finished)
                void rpc.request("turn/interrupt", { threadId, turnId }).catch(() => { });
        };
        void execute().catch((error) => finish({ ok: false, errorClass: "cli_error", errorMessage: error instanceof Error ? error.message.slice(0, 2000) : "The Codex connection failed." }));
        return await outcome;
    }
    finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
        unsubscribe();
        rpc.close();
    }
}

/** Provider credentials and unrelated connector settings never enter a personal CLI. */
export function personalEnvironment(userId, engine, inherited = process.env, home = homedir()) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId))
        throw new Error("Pair this connection to a personal Vantage account.");
    const directory = join(home, ".vantage", "profiles", userId.toLowerCase(), engine);
    const env = {};
    for (const key of ["PATH", "Path", "PATHEXT", "SystemRoot", "SYSTEMROOT", "WINDIR", "COMSPEC", "TEMP", "TMP", "TMPDIR", "HOME", "USERPROFILE", "APPDATA", "LOCALAPPDATA"]) {
        if (inherited[key] !== undefined)
            env[key] = inherited[key];
    }
    env[engine === "codex" ? "CODEX_HOME" : "CLAUDE_CONFIG_DIR"] = directory;
    return { env, directory };
}

export async function executePersonalCodex(prompt, options) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(options.userId))
        return { ok: false, errorClass: "not_authenticated", errorMessage: "Re-pair this connection to your personal Vantage account." };
    const { env, directory: profileHome } = personalEnvironment(options.userId, "codex");
    await mkdir(profileHome, { recursive: true, mode: 0o700 });
    const cwd = await mkdtemp(join(tmpdir(), "vantage-codex-"));
    const args = ["app-server", "--listen", "stdio://"];
    const child = process.platform === "win32"
        ? spawn("cmd.exe", ["/d", "/s", "/c", "codex", ...args], { cwd, env, stdio: ["pipe", "pipe", "pipe"], windowsHide: true })
        : spawn("codex", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const processClosed = new Promise((resolve) => { child.once("close", () => resolve()); });
    const pending = new Map();
    const listeners = new Set();
    let sequence = 0;
    let buffer = "";
    let closed = false;
    const fail = () => {
        if (closed)
            return;
        closed = true;
        for (const call of pending.values())
            call.reject(new Error("The local Codex App Server disconnected."));
        pending.clear();
        for (const listener of listeners)
            listener({ method: "vantage/connectionClosed", params: {} });
    };
    child.on("error", fail);
    child.on("close", fail);
    child.stdin.on("error", fail);
    // Never send local process stderr to Vantage; it may include personal configuration.
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
        buffer += chunk;
        if (buffer.length > 4 * 1024 * 1024) {
            fail();
            child.kill();
            return;
        }
        let end;
        while ((end = buffer.indexOf("\n")) >= 0) {
            const line = buffer.slice(0, end);
            buffer = buffer.slice(end + 1);
            if (!line.trim())
                continue;
            let message;
            try {
                message = JSON.parse(line);
            }
            catch {
                fail();
                child.kill();
                return;
            }
            if (typeof message.id === "number" && !message.method && pending.has(message.id)) {
                const call = pending.get(message.id);
                pending.delete(message.id);
                if (message.error)
                    call.reject(new Error(message.error.message ?? "Codex request failed."));
                else
                    call.resolve((message.result ?? {}));
            }
            else
                for (const listener of listeners)
                    listener(message);
        }
    });
    const send = (message) => { if (closed)
        throw new Error("The local Codex connection is closed."); child.stdin.write(JSON.stringify(message) + "\n"); };
    const rpc = {
        request: (method, params) => new Promise((resolve, reject) => {
            const id = ++sequence;
            pending.set(id, { resolve, reject });
            try {
                send({ id, method, params });
            }
            catch (error) {
                pending.delete(id);
                reject(error);
            }
        }),
        notify: (method, params) => send({ method, params }),
        respond: (id, result) => send({ id, result }),
        listen: (listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
        close: () => { fail(); child.stdin.end(); },
    };
    try {
        return await runCodexTurn({ rpc, prompt, cwd, timeoutMs: options.timeoutMs, signal: options.signal, onDelta: options.onDelta, testOnly: options.testOnly, tools: options.tools });
    }
    finally {
        await new Promise((resolve) => {
            const timer = setTimeout(() => {
                if (child.exitCode !== null || !child.pid)
                    return resolve();
                // Windows npm shims launch a child executable. Stop only this job's tracked
                // process tree, after allowing App Server to exit cleanly on stdin EOF.
                if (process.platform === "win32") {
                    const stop = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
                    stop.once("close", () => resolve());
                    stop.once("error", () => resolve());
                }
                else {
                    child.kill();
                    resolve();
                }
            }, 2000);
            void processClosed.then(() => { clearTimeout(timer); resolve(); });
        });
        await rm(cwd, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
}
// END GENERATED PERSONAL CODEX

/** True when run as `node bridge.mjs` (not when imported by tests). */
function executedDirectly() {
  try {
    if (!process.argv[1]) return false;
    const self = fileURLToPath(import.meta.url);
    const invoked = resolvePath(process.argv[1]);
    return self === invoked || self === `${invoked}.mjs`;
  } catch {
    return false;
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (!PROFILE_NAME) throw new Error("Use --profile <your Vantage user ID> from Personal connections. Each person must pair their own profile.");
  if (args.includes("--mcp")) {
    const config = loadConfig();
    if (!config?.userId || !config.deviceToken) throw new Error("Pair your personal profile before connecting MCP.");
    runConnectorMcp(combineToolRegistries(
      connectorStatusToolRegistry(() => ({ bridgeVersion: BRIDGE_VERSION, paired: true, userId: config.userId, orgId: config.orgId, machineName: config.machineName })),
      standaloneFeatureTools(),
    ), { input: process.stdin, output: process.stdout });
    return;
  }
  if (args.includes("--codex-login") || args.includes("--claude-login")) {
    const config = loadConfig();
    const engine = args.includes("--codex-login") ? "codex" : "claude";
    const { env, directory } = personalEnvironment(config?.userId || "", engine);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const loginArgs = engine === "codex" ? ["login"] : ["auth", "login"];
    const child = process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", engine, ...loginArgs], { env, stdio: "inherit", windowsHide: true })
      : spawn(engine, loginArgs, { env, stdio: "inherit" });
    await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Personal ${engine} sign-in did not complete.`))); });
    return;
  }
  if (args.includes("--status")) {
    const config = loadConfig();
    console.log(JSON.stringify({ bridgeVersion: BRIDGE_VERSION, engines: await personalEngines(config), paired: Boolean(config?.userId) }, null, 2));
    return;
  }
  if (args.includes("--test")) {
    const config = loadConfig();
    if (!config?.userId || !config.deviceToken) throw new Error("Pair this personal profile first with --setup.");
    const result = await executePersonalCodex("", { userId: config.userId, timeoutMs: DETECT_TIMEOUT_MS, testOnly: true });
    if (!result.ok) throw new Error(result.errorMessage);
    const engines = await personalEngines(config);
    const response = await api(config, "/api/ai-bridge/device/heartbeat", { token: config.deviceToken, body: { bridgeVersion: BRIDGE_VERSION, engines } });
    if (!response.ok) throw new Error("Vantage rejected this personal connection. Check the server and re-pair if it was revoked.");
    const data = await response.json();
    if (data.device?.userId !== config.userId || data.device?.orgId !== config.orgId) throw new Error("The server returned a different personal identity. Update Vantage and re-pair.");
    console.log("Personal Codex sign-in and Vantage connection verified. Start the connector to receive your requests.");
    return;
  }
  if (args.includes("--setup")) {
    const urlFlag = args.indexOf("--url");
    await setup(urlFlag >= 0 && args[urlFlag + 1] ? args[urlFlag + 1] : loadConfig()?.baseUrl || DEFAULT_BASE_URL);
    return;
  }
  await runLoop();
}

if (executedDirectly() || process.env.VANTAGE_BRIDGE_FORCE_MAIN === "1") {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
