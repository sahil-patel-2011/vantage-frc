import {
  ConnectorAuthError,
  type CapabilityContext,
  type CapabilityDetection,
  type CapabilityReport,
  type ConnectorCapability,
} from "./capability.js";
import { cloudUrl } from "./endpoints.js";
import type { Spawner } from "./ports.js";
import { personalFeatureToolRegistry } from "./feature-tools.js";
import type { CodexFeatureTools } from "./codex-app-server.js";

/**
 * Execute the paired person's requests using their isolated local subscriber account.
 * The standalone bridge and connector share the same App Server implementation.
 *
 * Verified against Claude Code 2.1.241 on Windows: `claude -p --output-format json`
 * emits a single JSON object with {is_error, result, usage:{input_tokens, output_tokens},
 * modelUsage:{<model-id>: …}} and EXIT CODE 0 even for errors — failures must be read
 * from the JSON, not the exit code. Codex uses App Server streaming and typed Vantage tools.
 */

export const AI_BRIDGE_DEFAULT_JOB_TIMEOUT_MS = 90_000;
export const AI_BRIDGE_CLAIM_INTERVAL_MS = 2_500;
export const AI_BRIDGE_DETECT_TIMEOUT_MS = 10_000;
/** How stale a cached engine detection may get before status()/the loop re-probes. */
export const AI_BRIDGE_ENGINE_REFRESH_MS = 60_000;

export type EngineId = "claude" | "codex";

export type EngineDetection = {
  available: boolean;
  version?: string | null;
  /** true/false when the CLI answered a known auth probe; null when it could not say. */
  authenticated?: boolean | null;
  experimental?: boolean;
};

export type EngineMap = Partial<Record<EngineId, EngineDetection>>;

export type BridgeExecutionSuccess = {
  ok: true;
  text: string;
  model: string | null;
  usage: { inputTokens: number; outputTokens: number; cacheReadInputTokens?: number };
};

export type BridgeExecutionFailure = {
  ok: false;
  errorClass: "not_authenticated" | "rate_limited" | "cli_error" | "cli_timeout" | "cancelled";
  errorMessage: string;
  resetText?: string | null;
};

export type BridgeExecutionResult = BridgeExecutionSuccess | BridgeExecutionFailure;

/* ------------------------------------------------------------------ */
/* Pure helpers (ported 1:1 from bridge.mjs; semantics must not drift) */
/* ------------------------------------------------------------------ */

/**
 * Detect provider rate-limit / usage-window messages in CLI output. When the text names
 * a reset time we surface it VERBATIM so the app can show it honestly.
 */
export function detectRateLimit(text: unknown): { rateLimited: boolean; resetText: string | null } {
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
 */
export function parseClaudeCliOutput(stdout: unknown): BridgeExecutionResult {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(String(stdout ?? "").trim()) as Record<string, unknown>;
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
    return {
      ok: false,
      errorClass: "cli_error",
      errorMessage: (text || "Claude CLI reported an error").slice(0, 1000),
    };
  }
  const usage = (parsed.usage && typeof parsed.usage === "object" ? parsed.usage : {}) as Record<string, unknown>;
  const modelUsage = (
    parsed.modelUsage && typeof parsed.modelUsage === "object" ? parsed.modelUsage : {}
  ) as Record<string, unknown>;
  const model = Object.keys(modelUsage)[0] ?? null;
  return {
    ok: true,
    text,
    model,
    usage: {
      inputTokens: Number.isFinite(usage.input_tokens) ? (usage.input_tokens as number) : 0,
      outputTokens: Number.isFinite(usage.output_tokens) ? (usage.output_tokens as number) : 0,
      cacheReadInputTokens: Number.isFinite(usage.cache_read_input_tokens)
        ? (usage.cache_read_input_tokens as number)
        : 0,
    },
  };
}

/**
 * Per-job CLI budget: the web enqueues messages.timeoutMs (90s interactive, 240s for
 * heavy jobs when this device covers everything). Clamped so a malformed queue row can
 * neither spin the CLI forever nor kill it instantly; absent → the provided default.
 * (bridge.mjs reads VANTAGE_BRIDGE_JOB_TIMEOUT_MS at module scope; here the default is a
 * parameter so hosts pass their env once and imports stay side-effect free.)
 */
export function jobTimeoutMs(messages: unknown, defaultMs = AI_BRIDGE_DEFAULT_JOB_TIMEOUT_MS): number {
  const requested = Number((messages as Record<string, unknown> | null | undefined)?.timeoutMs);
  if (!Number.isFinite(requested) || requested <= 0) return defaultMs;
  return Math.min(Math.max(requested, 30_000), 300_000);
}

/** Classify a non-zero exit / timeout spawn into the bridge's error taxonomy. */
export function classifySpawnFailure(input: {
  timedOut: boolean;
  status: number | null;
  stderr?: string;
  stdout?: string;
  timeoutMs?: number;
}): { errorClass: "cli_timeout" | "rate_limited" | "cli_error"; errorMessage: string } {
  if (input.timedOut) {
    return {
      errorClass: "cli_timeout",
      errorMessage: `CLI did not finish within ${(input.timeoutMs ?? AI_BRIDGE_DEFAULT_JOB_TIMEOUT_MS) / 1000}s.`,
    };
  }
  const text = `${input.stderr ?? ""}\n${input.stdout ?? ""}`.trim();
  const limit = detectRateLimit(text);
  if (limit.rateLimited) return { errorClass: "rate_limited", errorMessage: text.slice(0, 1000) };
  return {
    errorClass: "cli_error",
    errorMessage: `CLI exited with status ${input.status}: ${text.slice(0, 800)}`,
  };
}

/** Honor an explicit engine; personal Codex is the default. */
export function pickEngine(engines: EngineMap, requestedEngine: EngineId | null): EngineId | null {
  if (requestedEngine) return engines[requestedEngine]?.available ? requestedEngine : null;
  if (engines.codex?.available) return "codex";
  if (engines.claude?.available) return "claude";
  return null;
}

/* ------------------------------------------------------------------ */
/* Engine detection + execution (Spawner-injected ports of bridge.mjs) */
/* ------------------------------------------------------------------ */

/** `claude --version` + `claude auth status` (both verified on 2.1.241). */
export function detectClaude(spawner: Spawner, userId?: string): EngineDetection {
  const version = spawner.runSync("claude", ["--version"], { timeoutMs: AI_BRIDGE_DETECT_TIMEOUT_MS });
  if (version.error || version.status !== 0) return { available: false };
  const report: EngineDetection = {
    available: true,
    version: String(version.stdout ?? "").trim().split(/\s+/)[0] || null,
  };
  if (!userId) return { ...report, authenticated: false };
  const auth = spawner.runSync("claude", ["auth", "status"], { timeoutMs: AI_BRIDGE_DETECT_TIMEOUT_MS, personalUserId: userId });
  if (!auth.error && typeof auth.stdout === "string") {
    try {
      report.authenticated = Boolean((JSON.parse(auth.stdout) as Record<string, unknown>).loggedIn);
    } catch {
      report.authenticated = null; // CLI answered but not in the JSON shape we know.
    }
  }
  return report;
}

/** Version detection does not establish personal authentication. */
export function detectCodex(spawner: Spawner): EngineDetection {
  const version = spawner.runSync("codex", ["--version"], { timeoutMs: AI_BRIDGE_DETECT_TIMEOUT_MS });
  if (version.error || version.status !== 0) return { available: false };
  return {
    available: true,
    version: String(version.stdout ?? "").trim().split(/\s+/).pop() || null,
    authenticated: null,
  };
}

export function detectEngines(spawner: Spawner, userId?: string): EngineMap {
  return { claude: detectClaude(spawner, userId), codex: detectCodex(spawner) };
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
export async function executeClaude(
  spawner: Spawner,
  prompt: string,
  timeoutMs: number,
  personal?: { userId: string; signal?: AbortSignal },
): Promise<BridgeExecutionResult> {
  if (!personal?.userId) return { ok: false, errorClass: "not_authenticated", errorMessage: "Pair your personal connection before using Claude." };
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
  const run = await spawner.run("claude", args, { input: prompt, timeoutMs, personalUserId: personal.userId, signal: personal.signal });
  if (run.timedOut || run.spawnError || run.status !== 0) {
    return { ok: false, ...classifySpawnFailure({ ...run, timeoutMs }) };
  }
  return parseClaudeCliOutput(run.stdout);
}

/** Supported App Server execution, bound to the person who paired the connection. */
export async function executeCodex(
  spawner: Spawner,
  prompt: string,
  timeoutMs: number,
  personal?: { userId: string; signal?: AbortSignal; onDelta?: (text: string) => void; tools?: CodexFeatureTools },
): Promise<BridgeExecutionResult> {
  if (!personal?.userId || !spawner.codexSession) return { ok: false, errorClass: "not_authenticated", errorMessage: "Pair your own connection and update the connector to use Codex App Server." };
  return spawner.codexSession(prompt, { ...personal, timeoutMs });
}

/* ------------------------------------------------------------------ */
/* Capability (claim → execute → report loop; heartbeat is supervisor-owned) */
/* ------------------------------------------------------------------ */

type ClaimedJob = {
  jobId: string;
  userId?: string;
  orgId?: string;
  leaseToken?: string;
  feature?: string;
  messages?: Record<string, unknown>;
  requestedEngine?: EngineId | null;
};

export type AiBridgeCapabilityOptions = {
  claimIntervalMs?: number;
  defaultJobTimeoutMs?: number;
  engineRefreshMs?: number;
};

export class AiBridgeCapability implements ConnectorCapability {
  readonly id = "ai-bridge" as const;
  readonly label = "AI subscription bridge";

  private engines: EngineMap = {};
  private enginesDetectedAt = -Infinity;
  private jobsServed = 0;
  private lastError: string | null = null;

  constructor(private readonly options: AiBridgeCapabilityOptions = {}) {}

  private async refreshEngines(ctx: CapabilityContext, force = false): Promise<EngineMap> {
    const maxAge = this.options.engineRefreshMs ?? AI_BRIDGE_ENGINE_REFRESH_MS;
    if (force || ctx.clock.now() - this.enginesDetectedAt >= maxAge) {
      this.engines = detectEngines(ctx.spawner, ctx.config.userId ?? undefined);
      if (this.engines.codex?.available && ctx.config.userId && ctx.spawner.codexSession) {
        const test = await ctx.spawner.codexSession("", { userId: ctx.config.userId, timeoutMs: AI_BRIDGE_DETECT_TIMEOUT_MS, signal: ctx.signal, testOnly: true });
        this.engines.codex.authenticated = test.ok ? true : test.errorClass === "not_authenticated" ? false : null;
      }
      this.enginesDetectedAt = ctx.clock.now();
    }
    return this.engines;
  }

  async detect(ctx: CapabilityContext): Promise<CapabilityDetection> {
    const engines = await this.refreshEngines(ctx, true);
    const parts: string[] = [];
    if (engines.claude?.available) parts.push(`Claude Code ${engines.claude.version ?? ""}`.trim());
    if (engines.codex?.available) parts.push(`Codex ${engines.codex.version ?? ""} (${engines.codex.authenticated === true ? "signed in" : engines.codex.authenticated === false ? "personal sign-in required" : "authentication not checked"})`.trim());
    if (parts.length === 0) {
      return {
        available: false,
        detail:
          "Neither the Claude Code CLI nor the Codex CLI is installed. Install one and sign in first (Claude Pro/Max: `claude auth login`; ChatGPT/Codex: `codex login`).",
        data: { engines },
      };
    }
    return { available: true, detail: `Engines: ${parts.join(", ")}.`, data: { engines } };
  }

  async start(ctx: CapabilityContext): Promise<void> {
    const claimInterval = this.options.claimIntervalMs ?? AI_BRIDGE_CLAIM_INTERVAL_MS;
    const jobsUrl = cloudUrl(ctx.config.baseUrl, ctx.endpoints.aiBridgeJobs);
    await this.refreshEngines(ctx, true);

    while (!ctx.signal.aborted) {
      await this.refreshEngines(ctx);
      let job: ClaimedJob | null = null;
      try {
        const claim = await ctx.transport.postJson(jobsUrl, {}, { token: ctx.config.deviceToken });
        if (claim.status === 401) {
          // Restarting cannot fix a revoked token — surface "re-pair" instead of spinning.
          throw new ConnectorAuthError("Device token rejected — re-pair this connector.");
        }
        if (claim.status === 200 && typeof claim.data.jobId === "string") {
          job = claim.data as ClaimedJob;
        }
      } catch (error) {
        if (error instanceof ConnectorAuthError) throw error;
        this.lastError = `Claim failed (will retry): ${error instanceof Error ? error.message : String(error)}`;
        ctx.log(`ai-bridge: ${this.lastError}`);
      }
      if (!job?.jobId) {
        await ctx.clock.sleep(claimInterval, ctx.signal);
        continue;
      }
      if (!ctx.config.userId || job.userId !== ctx.config.userId || job.orgId !== ctx.config.orgId) {
        throw new ConnectorAuthError("The request does not belong to this personal connection. Re-pair and update Vantage.");
      }

      const prompt = String(job.messages?.prompt ?? "");
      const timeoutMs = jobTimeoutMs(job.messages, this.options.defaultJobTimeoutMs);
      const requested = job.requestedEngine === "claude" || job.requestedEngine === "codex" ? job.requestedEngine : null;
      const engine = pickEngine(this.engines, requested);
      let outcome: BridgeExecutionResult;
      if (!engine) {
        outcome = { ok: false, errorClass: "cli_error", errorMessage: "No installed CLI engine can serve this job." };
      } else {
        ctx.log(
          `ai-bridge: job ${job.jobId} (${job.feature ?? "chat"}, ${Math.round(timeoutMs / 1000)}s budget) → ${engine}`,
        );
        {
          const controller = new AbortController();
          const stopped = () => controller.abort();
          ctx.signal.addEventListener("abort", stopped, { once: true });
          if (ctx.signal.aborted) controller.abort();
          const checkLease = async () => {
            while (!controller.signal.aborted) {
              await ctx.clock.sleep(claimInterval, controller.signal);
              if (controller.signal.aborted) return;
              try {
                const response = await ctx.transport.postJson(jobsUrl, { jobId: job!.jobId, leaseToken: job!.leaseToken }, { token: ctx.config.deviceToken, method: "PUT" });
                if (!response.ok || response.data.active !== true) controller.abort();
              } catch { controller.abort(); }
            }
          };
          const checking = checkLease();
          try {
            const personal = { userId: ctx.config.userId, signal: controller.signal, tools: personalFeatureToolRegistry(ctx.transport, async () => ctx.config) };
            outcome = engine === "claude" ? await executeClaude(ctx.spawner, prompt, timeoutMs, personal) : await executeCodex(ctx.spawner, prompt, timeoutMs, personal);
          }
          finally { controller.abort(); ctx.signal.removeEventListener("abort", stopped); await checking; }
        }
      }
      try {
        await ctx.transport.postJson(
          jobsUrl,
          outcome.ok
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
          { method: "PATCH", token: ctx.config.deviceToken },
        );
        if (outcome.ok) {
          this.jobsServed += 1;
          this.lastError = null;
        } else {
          this.lastError = `${outcome.errorClass} — ${outcome.errorMessage}`;
          ctx.log(`ai-bridge: job ${job.jobId} failed: ${this.lastError}`);
        }
      } catch (error) {
        ctx.log(
          `ai-bridge: could not report job result (${error instanceof Error ? error.message : String(error)}) — the lease will expire on its own.`,
        );
      }
    }
  }

  async stop(): Promise<void> {
    // The claim loop honors ctx.signal; nothing else to release.
  }

  status(): CapabilityReport {
    const engineList = Object.entries(this.engines)
      .filter(([, engine]) => engine?.available)
      .map(([id, engine]) => `${id}${engine?.version ? ` ${engine.version}` : ""}`);
    return {
      detail:
        engineList.length === 0
          ? "No CLI engine detected."
          : `Serving with ${engineList.join(", ")}; ${this.jobsServed} job(s) this session.`,
      data: {
        engines: this.engines,
        stats: { jobsServedThisSession: this.jobsServed },
        ...(this.lastError ? { lastError: this.lastError } : {}),
      },
    };
  }
}
