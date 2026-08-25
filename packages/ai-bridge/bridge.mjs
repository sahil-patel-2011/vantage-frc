#!/usr/bin/env node
/**
 * Vantage AI subscription bridge — single-file, stdlib-only local service.
 *
 * A team member who already pays for Claude Pro/Max (which includes the Claude Code CLI)
 * or ChatGPT (which includes the Codex CLI) runs this on an always-on computer. It pairs
 * with the team's Vantage workspace via an 8-character code, then polls for queued chat
 * jobs and executes them through the locally-authenticated CLI — so those turns cost the
 * team $0 in API usage. Your subscription, your machine, your provider's usage windows.
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
 * from the JSON, not the exit code. The Codex path is EXPERIMENTAL (detect-only unless
 * present; see executeCodex below).
 */

import { spawn, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, hostname, tmpdir } from "node:os";
import { dirname, join, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

export const BRIDGE_VERSION = "0.1.0";
const CONFIG_PATH = join(homedir(), ".vantage", "ai-bridge.json");
// Canonical production origin. Must stay byte-identical to DEFAULT_PRODUCTION_ORIGIN in
// apps/desktop/src/allowlist.ts, SITE_URL in apps/web/lib/site.ts, and the origin added in
// packages/core/src/access-policy.ts — `--setup` with no --url/VANTAGE_URL pairs against
// this host, so drift here silently points mentors at a deployment that does not exist.
export const CANONICAL_BASE_URL = "https://vantage-frc-web.vercel.app";
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

function runSync(command, args, { timeoutMs = DETECT_TIMEOUT_MS, input } = {}) {
  // Direct spawn first (finds .exe on every platform). npm-style .cmd shims are not
  // found by CreateProcess, so retry through cmd.exe on Windows when that happens.
  let result = spawnSync(command, args, { encoding: "utf8", timeout: timeoutMs, input });
  if (result.error && result.error.code === "ENOENT" && process.platform === "win32") {
    result = spawnSync("cmd.exe", ["/d", "/s", "/c", command, ...args.map((a) => (a === "" ? '""' : a))], {
      encoding: "utf8",
      timeout: timeoutMs,
      input,
      windowsVerbatimArguments: false,
    });
  }
  return result;
}

/** `claude --version` + `claude auth status` (both verified on 2.1.241). */
export function detectClaude() {
  const version = runSync("claude", ["--version"]);
  if (version.error || version.status !== 0) return { available: false };
  const report = { available: true, version: String(version.stdout ?? "").trim().split(/\s+/)[0] || null };
  const auth = runSync("claude", ["auth", "status"]);
  if (!auth.error && typeof auth.stdout === "string") {
    try {
      report.authenticated = Boolean(JSON.parse(auth.stdout).loggedIn);
    } catch {
      report.authenticated = null; // CLI answered but not in the JSON shape we know.
    }
  }
  return report;
}

/** Codex CLI detection. Execution below is EXPERIMENTAL — detection alone is safe. */
export function detectCodex() {
  const version = runSync("codex", ["--version"]);
  if (version.error || version.status !== 0) return { available: false };
  return {
    available: true,
    version: String(version.stdout ?? "").trim().split(/\s+/).pop() || null,
    authenticated: null, // No verified non-interactive auth probe; jobs report honestly.
    experimental: true,
  };
}

export function detectEngines() {
  return { claude: detectClaude(), codex: detectCodex() };
}

function runJobCli(command, args, prompt, timeoutMs = JOB_TIMEOUT_MS) {
  return new Promise((resolve) => {
    // cwd = temp dir so the CLI never picks up a project's CLAUDE.md or settings.
    const child = spawn(command, args, { cwd: tmpdir(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ status: null, stdout, stderr: String(error), timedOut: false, spawnError: true });
    });
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("close", (status) => {
      clearTimeout(timer);
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
async function executeClaude(prompt, timeoutMs = JOB_TIMEOUT_MS) {
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
  const run = await runJobCli("claude", args, prompt, timeoutMs);
  if (run.timedOut || run.spawnError || run.status !== 0) {
    return { ok: false, ...classifySpawnFailure({ ...run, timeoutMs }) };
  }
  return parseClaudeCliOutput(run.stdout);
}

/**
 * EXPERIMENTAL — Codex CLI execution. The Codex CLI was not installed on the machine
 * this bridge was built on, so this follows OpenAI's documented `codex exec --json`
 * non-interactive interface (JSONL events on stdout; the agent's reply arrives as an
 * item.completed event with item.type "agent_message"). If the interface differs on
 * your version, this ONE function is the only thing to fix. Detection (detectCodex)
 * gates it: orgs without a working codex never route jobs here.
 */
async function executeCodex(prompt, timeoutMs = JOB_TIMEOUT_MS) {
  const run = await runJobCli("codex", ["exec", "--json", "--skip-git-repo-check", prompt.slice(0, 100_000)], "", timeoutMs);
  if (run.timedOut || run.spawnError || run.status !== 0) {
    return { ok: false, ...classifySpawnFailure({ ...run, timeoutMs }) };
  }
  let text = "";
  let model = null;
  for (const line of String(run.stdout).split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      const event = JSON.parse(trimmed);
      if (event?.item?.type === "agent_message" && typeof event.item.text === "string") text = event.item.text;
      if (typeof event?.model === "string") model = event.model;
    } catch {
      // Ignore non-JSON lines.
    }
  }
  if (!text) return { ok: false, errorClass: "cli_error", errorMessage: "Codex CLI produced no agent_message output." };
  return { ok: true, text, model: model ?? "codex-cli", usage: { inputTokens: 0, outputTokens: 0 } };
}

/** Pick the engine for a job: honor requested_engine, else prefer claude, else codex. */
export function pickEngine(engines, requestedEngine) {
  if (requestedEngine) return engines[requestedEngine]?.available ? requestedEngine : null;
  if (engines.claude?.available) return "claude";
  if (engines.codex?.available) return "codex";
  return null;
}

/* ------------------------------------------------------------------ */
/* Config + HTTP                                                       */
/* ------------------------------------------------------------------ */

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return null;
  }
}

function saveConfig(config) {
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
      saveConfig({ ...config, deviceToken: data.deviceToken, deviceId: data.deviceId, orgId: data.orgId });
      console.log(`Paired. Config saved to ${CONFIG_PATH}. Start the bridge with: node bridge.mjs`);
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
  if (!config?.deviceToken) {
    console.error(`Not paired yet — run: node bridge.mjs --setup   (config: ${CONFIG_PATH})`);
    process.exitCode = 1;
    return;
  }
  let engines = detectEngines();
  let jobsServed = 0;
  let stopping = false;
  const stop = () => {
    stopping = true;
    console.log("Shutting down after the current job…");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  async function heartbeat() {
    engines = detectEngines();
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

    const prompt = String(job.messages?.prompt ?? "");
    const timeoutMs = jobTimeoutMs(job.messages);
    const engine = pickEngine(engines, job.requestedEngine ?? null);
    let outcome;
    if (!engine) {
      outcome = { ok: false, errorClass: "cli_error", errorMessage: "No installed CLI engine can serve this job." };
    } else {
      console.log(`Job ${job.jobId} (${job.feature}, ${Math.round(timeoutMs / 1000)}s budget) → ${engine}`);
      outcome = engine === "claude" ? await executeClaude(prompt, timeoutMs) : await executeCodex(prompt, timeoutMs);
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
  if (args.includes("--status")) {
    console.log(JSON.stringify({ bridgeVersion: BRIDGE_VERSION, engines: detectEngines(), config: Boolean(loadConfig()) }, null, 2));
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
