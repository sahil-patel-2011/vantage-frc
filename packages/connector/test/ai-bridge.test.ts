import { describe, expect, it } from "vitest";
import {
  AiBridgeCapability,
  classifySpawnFailure,
  detectClaude,
  detectCodex,
  detectEngines,
  detectRateLimit,
  executeClaude,
  jobTimeoutMs,
  parseClaudeCliOutput,
  pickEngine,
} from "../src/ai-bridge.js";
import { ConnectorAuthError, type CapabilityContext } from "../src/capability.js";
import { DEFAULT_CONNECTOR_ENDPOINTS } from "../src/endpoints.js";
import type { ConnectorConfig } from "../src/config.js";
import {
  FakeSpawner,
  FakeTransport,
  ManualClock,
  MemoryFileSystem,
  claudeInstalledSync,
  flushMicrotasks,
  ok,
} from "./helpers.js";

/**
 * Captured VERBATIM from a real `claude -p --output-format json --tools "" \
 * --no-session-persistence --disable-slash-commands` run (Claude Code 2.1.241,
 * Windows, 2026-08-24) — the same capture packages/agent/test/subscription-bridge.test.ts
 * verifies bridge.mjs against. Note the CLI exits 0 even for this error — failures must
 * be read from the JSON. The port must classify it identically.
 */
const REAL_NOT_LOGGED_IN_FIXTURE = `{"is_error":true,"duration_api_ms":0,"num_turns":1,"stop_reason":"stop_sequence","session_id":"2d90a1b2-5d41-462f-a3a4-d81bc5b2063d","total_cost_usd":0,"usage":{"output_tokens_details":{"thinking_tokens":0},"input_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,"output_tokens":0,"server_tool_use":{"web_search_requests":0,"web_fetch_requests":0},"service_tier":"standard","cache_creation":{"ephemeral_1h_input_tokens":0,"ephemeral_5m_input_tokens":0},"inference_geo":"","iterations":[],"speed":"standard"},"modelUsage":{},"permission_denials":[],"terminal_reason":"api_error","fast_mode_state":"off","fast_mode_disabled_reason":"sdk_opt_in_required","subagent_stats":{"spawned":0,"requested":{"background":0,"foreground":0,"unset":0},"started_in_background":0,"max_depth":0,"spawned_by_subagents":0,"completed":0,"failed":0,"killed":{"parent":0,"user":0,"system":0},"refused":{"depth_limit":0,"concurrency_limit":0,"budget":0},"by_type":{}},"subtype":"success","api_error_status":null,"result":"Not logged in · Please run /login","type":"result","duration_ms":337,"uuid":"7ff2494b-b7ee-40cb-98f7-8ff6a75bbb2e"}`;

/** Success-shaped output following the exact schema observed above (is_error false). */
const SUCCESS_FIXTURE = JSON.stringify({
  is_error: false,
  type: "result",
  subtype: "success",
  result: "Swerve modules need their azimuth encoders re-zeroed after a gear swap.",
  total_cost_usd: 0,
  usage: { input_tokens: 812, output_tokens: 96, cache_read_input_tokens: 640 },
  modelUsage: { "claude-fable-5": { inputTokens: 812, outputTokens: 96 } },
});

const RATE_LIMIT_FIXTURE = JSON.stringify({
  is_error: true,
  type: "result",
  result: "5-hour limit reached · Your limit will reset at 7:00 PM (America/New_York).",
  usage: { input_tokens: 0, output_tokens: 0 },
  modelUsage: {},
});

describe("ported CLI output parsing (must match bridge.mjs semantics)", () => {
  it("classifies the real not-logged-in output as not_authenticated", () => {
    const parsed = parseClaudeCliOutput(REAL_NOT_LOGGED_IN_FIXTURE);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("unreachable");
    expect(parsed.errorClass).toBe("not_authenticated");
    expect(parsed.errorMessage).toContain("Not logged in");
  });

  it("parses a successful turn: text, model from modelUsage, real token usage", () => {
    const parsed = parseClaudeCliOutput(SUCCESS_FIXTURE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    expect(parsed.text).toContain("azimuth encoders");
    expect(parsed.model).toBe("claude-fable-5");
    expect(parsed.usage).toMatchObject({ inputTokens: 812, outputTokens: 96, cacheReadInputTokens: 640 });
  });

  it("classifies rate-limit output and surfaces the reset text verbatim", () => {
    const parsed = parseClaudeCliOutput(RATE_LIMIT_FIXTURE);
    if (parsed.ok) throw new Error("unreachable");
    expect(parsed.errorClass).toBe("rate_limited");
    expect(parsed.errorMessage).toContain("reset at 7:00 PM (America/New_York)");
    const limit = detectRateLimit("Your limit will reset at 7:00 PM (America/New_York).");
    expect(limit.rateLimited).toBe(true);
    expect(limit.resetText).toContain("reset at 7:00 PM");
  });

  it("never throws on non-JSON output — classifies as cli_error", () => {
    const parsed = parseClaudeCliOutput("segfault: core dumped");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error("unreachable");
    expect(parsed.errorClass).toBe("cli_error");
  });

  it("clamps the enqueued per-job CLI budget and defaults when absent", () => {
    expect(jobTimeoutMs({ timeoutMs: 240_000 })).toBe(240_000);
    expect(jobTimeoutMs({ timeoutMs: 5 })).toBe(30_000);
    expect(jobTimeoutMs({ timeoutMs: 99_999_999 })).toBe(300_000);
    expect(jobTimeoutMs({})).toBe(90_000);
    expect(jobTimeoutMs(null)).toBe(90_000);
    expect(jobTimeoutMs({ timeoutMs: "not-a-number" })).toBe(90_000);
    expect(jobTimeoutMs({}, 120_000)).toBe(120_000); // host-supplied default honored
  });

  it("classifies spawn failures: timeout, rate-limit text, generic exit", () => {
    expect(classifySpawnFailure({ timedOut: true, status: null, timeoutMs: 90_000 })).toMatchObject({
      errorClass: "cli_timeout",
    });
    expect(
      classifySpawnFailure({ timedOut: false, status: 1, stderr: "Weekly limit reached, resets Thursday" }),
    ).toMatchObject({ errorClass: "rate_limited" });
    expect(classifySpawnFailure({ timedOut: false, status: 2, stderr: "kaboom" })).toMatchObject({
      errorClass: "cli_error",
    });
  });

  it("picks engines honoring requests and claude-first preference", () => {
    const both = { claude: { available: true }, codex: { available: true } };
    expect(pickEngine(both, null)).toBe("claude");
    expect(pickEngine(both, "codex")).toBe("codex");
    expect(pickEngine({ codex: { available: true } }, null)).toBe("codex");
    expect(pickEngine({}, "claude")).toBeNull();
  });
});

describe("engine detection through the injected spawner", () => {
  it("reports claude with version + auth state when the CLI answers", () => {
    const spawner = new FakeSpawner({ sync: claudeInstalledSync });
    const report = detectClaude(spawner);
    expect(report).toEqual({ available: true, version: "2.1.241", authenticated: true });
  });

  it("reports unavailable when the CLI is missing — never a guessed install", () => {
    const spawner = new FakeSpawner();
    expect(detectClaude(spawner)).toEqual({ available: false });
    expect(detectCodex(spawner)).toEqual({ available: false });
    expect(detectEngines(spawner)).toEqual({ claude: { available: false }, codex: { available: false } });
  });

  it("reports authenticated: null when auth output is not the JSON shape we know", () => {
    const spawner = new FakeSpawner({
      sync: {
        ...claudeInstalledSync,
        "claude auth status": { error: false, status: 0, stdout: "Logged in as someone", stderr: "" },
      },
    });
    expect(detectClaude(spawner).authenticated).toBeNull();
  });

  it("marks codex experimental with the trailing version token", () => {
    const spawner = new FakeSpawner({
      sync: { "codex --version": { error: false, status: 0, stdout: "codex-cli 0.29.0\n", stderr: "" } },
    });
    expect(detectCodex(spawner)).toEqual({
      available: true,
      version: "0.29.0",
      authenticated: null,
      experimental: true,
    });
  });
});

describe("executeClaude flag contract", () => {
  it("passes the verified headless flag set and never --bare", async () => {
    const spawner = new FakeSpawner({
      run: () => ({ status: 0, stdout: SUCCESS_FIXTURE, stderr: "", timedOut: false }),
    });
    const result = await executeClaude(spawner, "why did auton fail?", 90_000);
    expect(result.ok).toBe(true);
    const call = spawner.runCalls[0]!;
    expect(call.command).toBe("claude");
    expect(call.args).toEqual([
      "-p",
      "--output-format",
      "json",
      "--tools",
      "",
      "--no-session-persistence",
      "--disable-slash-commands",
      "--setting-sources",
      "",
    ]);
    expect(call.args).not.toContain("--bare");
    expect(call.input).toBe("why did auton fail?"); // prompt via stdin, not argv
    expect(call.timeoutMs).toBe(90_000);
  });
});

/* ------------------------------------------------------------------ */
/* Capability job loop                                                 */
/* ------------------------------------------------------------------ */

const config: ConnectorConfig = {
  version: 1,
  baseUrl: "https://vantage-frc-web.vercel.app",
  machineName: "shop-pc",
  deviceToken: "tok",
  deviceId: "dev",
  orgId: "org",
  capabilities: { "ai-bridge": true },
};

function contextFor(transport: FakeTransport, spawner: FakeSpawner, controller: AbortController): CapabilityContext {
  return {
    config,
    endpoints: DEFAULT_CONNECTOR_ENDPOINTS,
    transport,
    spawner,
    fs: new MemoryFileSystem(),
    clock: new ManualClock(),
    log: () => {},
    signal: controller.signal,
  };
}

describe("AiBridgeCapability job loop", () => {
  it("claims a job, executes it through the CLI, and reports done with real usage", async () => {
    const jobs: Array<Record<string, unknown>> = [
      {
        jobId: "job-1",
        leaseToken: "lease-1",
        feature: "chat",
        messages: { prompt: "why did auton fail?", timeoutMs: 240_000 },
      },
    ];
    const transport = new FakeTransport([
      {
        match: "/api/ai-bridge/device/jobs",
        handler: (request) => {
          if (request.method === "PATCH") return ok({ ok: true });
          const job = jobs.shift();
          return job ? ok(job) : ok({}, 204);
        },
      },
    ]);
    const spawner = new FakeSpawner({
      sync: claudeInstalledSync,
      run: () => ({ status: 0, stdout: SUCCESS_FIXTURE, stderr: "", timedOut: false }),
    });
    const capability = new AiBridgeCapability();
    const controller = new AbortController();
    const loop = capability.start(contextFor(transport, spawner, controller));
    await flushMicrotasks();
    controller.abort();
    await loop;

    // Enqueued budget honored (clamp path) and prompt passed through.
    expect(spawner.runCalls[0]?.timeoutMs).toBe(240_000);
    const patch = transport.requests.find((request) => request.method === "PATCH");
    expect(patch?.token).toBe("tok");
    expect(patch?.body).toEqual({
      jobId: "job-1",
      leaseToken: "lease-1",
      state: "done",
      result: {
        text: "Swerve modules need their azimuth encoders re-zeroed after a gear swap.",
        model: "claude-fable-5",
        usage: { inputTokens: 812, outputTokens: 96, cacheReadInputTokens: 640 },
        engine: "claude",
      },
    });
    expect(capability.status().data?.stats).toEqual({ jobsServedThisSession: 1 });
  });

  it("reports failed with the bridge taxonomy when the CLI is rate limited", async () => {
    const jobs: Array<Record<string, unknown>> = [
      { jobId: "job-2", leaseToken: "lease-2", feature: "chat", messages: { prompt: "hi" } },
    ];
    const transport = new FakeTransport([
      {
        match: "/api/ai-bridge/device/jobs",
        handler: (request) => {
          if (request.method === "PATCH") return ok({ ok: true });
          const job = jobs.shift();
          return job ? ok(job) : ok({}, 204);
        },
      },
    ]);
    const spawner = new FakeSpawner({
      sync: claudeInstalledSync,
      run: () => ({ status: 0, stdout: RATE_LIMIT_FIXTURE, stderr: "", timedOut: false }),
    });
    const capability = new AiBridgeCapability();
    const controller = new AbortController();
    const loop = capability.start(contextFor(transport, spawner, controller));
    await flushMicrotasks();
    controller.abort();
    await loop;

    const patch = transport.requests.find((request) => request.method === "PATCH");
    expect(patch?.body).toMatchObject({
      jobId: "job-2",
      state: "failed",
      errorClass: "rate_limited",
    });
    expect((patch?.body as { errorMessage: string }).errorMessage).toContain("reset at 7:00 PM");
  });

  it("reports an honest cli_error when no installed engine can serve the job", async () => {
    const jobs: Array<Record<string, unknown>> = [
      { jobId: "job-3", leaseToken: "lease-3", messages: { prompt: "hi" } },
    ];
    const transport = new FakeTransport([
      {
        match: "/api/ai-bridge/device/jobs",
        handler: (request) => {
          if (request.method === "PATCH") return ok({ ok: true });
          const job = jobs.shift();
          return job ? ok(job) : ok({}, 204);
        },
      },
    ]);
    const spawner = new FakeSpawner(); // nothing installed
    const capability = new AiBridgeCapability();
    const controller = new AbortController();
    const loop = capability.start(contextFor(transport, spawner, controller));
    await flushMicrotasks();
    controller.abort();
    await loop;
    const patch = transport.requests.find((request) => request.method === "PATCH");
    expect(patch?.body).toMatchObject({
      state: "failed",
      errorClass: "cli_error",
      errorMessage: "No installed CLI engine can serve this job.",
    });
  });

  it("throws ConnectorAuthError when the claim answers 401 (token revoked)", async () => {
    const transport = new FakeTransport([
      { match: "/api/ai-bridge/device/jobs", handler: () => ok({ error: "revoked" }, 401) },
    ]);
    const spawner = new FakeSpawner({ sync: claudeInstalledSync });
    const capability = new AiBridgeCapability();
    const controller = new AbortController();
    await expect(capability.start(contextFor(transport, spawner, controller))).rejects.toBeInstanceOf(
      ConnectorAuthError,
    );
  });

  it("detect() is honest about a machine with no CLI installed", async () => {
    const capability = new AiBridgeCapability();
    const controller = new AbortController();
    const detection = await capability.detect(contextFor(new FakeTransport([]), new FakeSpawner(), controller));
    expect(detection.available).toBe(false);
    expect(detection.detail).toContain("Neither the Claude Code CLI nor the Codex CLI is installed");
  });
});
