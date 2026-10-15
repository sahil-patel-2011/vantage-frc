import {
  DEFAULT_LM_STUDIO_URL,
  checkLocalAiRequirements,
  localChat,
  localEngineReport,
  parseModelList,
  pickLocalModel,
  sanitizeLocalModelUrl,
  type RequirementReport,
} from "./local-ai";

/**
 * Local AI service: pairs this desktop app as the signed-in person's personal AI connection (the
 * same pairing the bridge CLI uses, approved on /team/ai-bridge) and answers that person's queued
 * AI requests with the model loaded in LM Studio.
 *
 * Nothing here reads a key or a password. The device token the pairing returns is stored with the
 * OS keychain (Electron safeStorage) when it is available, and the server only ever sends this
 * device the paired person's own requests.
 */

export type LocalAiConfig = {
  enabled: boolean;
  baseUrl: string;
  model: string | null;
  deviceToken: string | null;
  deviceId: string | null;
  orgId: string | null;
  userId: string | null;
};

export type LocalAiStatus = {
  requirements: RequirementReport;
  enabled: boolean;
  baseUrl: string;
  reachable: boolean;
  models: string[];
  model: string | null;
  paired: boolean;
  pairing: { userCode: string; verificationUri: string } | null;
  running: boolean;
  jobsServed: number;
  lastJobAt: string | null;
  lastError: string | null;
};

export type LocalAiDeps = {
  origin: string;
  machineName: string;
  bridgeVersion: string;
  fetcher: typeof fetch;
  readConfig: () => Promise<Partial<LocalAiConfig> | null>;
  writeConfig: (config: LocalAiConfig) => Promise<void>;
  system: () => Promise<{ totalMemBytes: number; freeDiskBytes: number | null }>;
  openApproval: (url: string) => void;
  onStatus: (status: LocalAiStatus) => void;
  sleep?: (ms: number) => Promise<void>;
};

/** One queued request, as the device claim route sends it. */
type BridgeJob = { jobId: string; orgId: string; userId: string; feature: string; messages?: { prompt?: string; timeoutMs?: number }; leaseToken: string };

const HEARTBEAT_MS = 30_000;
const CLAIM_MS = 2_500;
const MODEL_CHECK_MS = 20_000;
/** Matches the bridge's long-job budget; a 9B model on a laptop is slower than a hosted one. */
const MAX_JOB_MS = 300_000;

const EMPTY: LocalAiConfig = {
  enabled: false,
  baseUrl: DEFAULT_LM_STUDIO_URL,
  model: null,
  deviceToken: null,
  deviceId: null,
  orgId: null,
  userId: null,
};

export class LocalAiService {
  private config: LocalAiConfig = { ...EMPTY };
  private requirements: RequirementReport = { ok: false, ramGb: 0, freeDiskGb: 0, problems: [] };
  private reachable = false;
  private models: string[] = [];
  private pairing: LocalAiStatus["pairing"] = null;
  private pairingRun = 0;
  private running = false;
  private stopRequested = false;
  private jobsServed = 0;
  private lastJobAt: string | null = null;
  private lastError: string | null = null;
  private loop: Promise<void> | null = null;
  private current: AbortController | null = null;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly deps: LocalAiDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async start() {
    const saved = await this.deps.readConfig().catch(() => null);
    this.config = { ...EMPTY, ...(saved ?? {}), baseUrl: sanitizeLocalModelUrl(saved?.baseUrl) };
    this.requirements = checkLocalAiRequirements(await this.deps.system());
    await this.refreshModels();
    if (this.config.enabled) this.ensureLoop();
    this.emit();
  }

  status(): LocalAiStatus {
    return {
      requirements: this.requirements,
      enabled: this.config.enabled,
      baseUrl: this.config.baseUrl,
      reachable: this.reachable,
      models: this.models,
      model: this.config.model,
      paired: Boolean(this.config.deviceToken),
      pairing: this.pairing,
      running: this.running,
      jobsServed: this.jobsServed,
      lastJobAt: this.lastJobAt,
      lastError: this.lastError,
    };
  }

  /** Ask LM Studio which models are loaded; keeps the saved choice when it is still there. */
  async refreshModels() {
    try {
      const response = await this.deps.fetcher(`${this.config.baseUrl}/models`, { signal: AbortSignal.timeout(2_500) });
      this.models = response.ok ? parseModelList(await response.json()) : [];
      this.reachable = response.ok;
    } catch {
      this.models = [];
      this.reachable = false;
    }
    const model = pickLocalModel(this.models, this.config.model);
    if (model !== this.config.model && model) {
      this.config.model = model;
      await this.save();
    }
    this.emit();
    return this.status();
  }

  async setModel(model: string) {
    if (!this.models.includes(model)) return this.status();
    this.config.model = model;
    await this.save();
    this.emit();
    return this.status();
  }

  async setBaseUrl(raw: string) {
    this.config.baseUrl = sanitizeLocalModelUrl(raw);
    await this.save();
    return this.refreshModels();
  }

  /** Switch answering on or off. On needs the machine to meet the bar and a pairing. */
  async setEnabled(enabled: boolean) {
    if (enabled && !this.requirements.ok) {
      this.lastError = this.requirements.problems[0] ?? "This computer doesn't meet the Local AI requirements.";
      this.emit();
      return this.status();
    }
    this.config.enabled = enabled;
    this.lastError = null;
    await this.save();
    if (enabled) this.ensureLoop();
    else this.stopLoop();
    this.emit();
    return this.status();
  }

  /** Start pairing: shows a code and opens the approval page (signed in, in the app). */
  async pair() {
    const run = ++this.pairingRun;
    this.lastError = null;
    try {
      const start = await this.post("/api/ai-bridge/device/pair/start", {
        machineName: this.deps.machineName,
        bridgeVersion: this.deps.bridgeVersion,
      });
      const started = (await start.json()) as { userCode?: string; pollToken?: string; verificationUri?: string; interval?: number; error?: string };
      if (!start.ok || !started.userCode || !started.pollToken || !started.verificationUri) {
        throw new Error(started.error || "Pairing couldn't start. Try again in a moment.");
      }
      if (!started.verificationUri.startsWith(this.deps.origin)) throw new Error("Pairing answered with an unexpected address.");
      this.pairing = { userCode: started.userCode, verificationUri: started.verificationUri };
      this.emit();
      this.deps.openApproval(started.verificationUri);
      const deadline = Date.now() + 10 * 60_000;
      while (Date.now() < deadline && run === this.pairingRun) {
        await this.sleep((started.interval ?? 3) * 1000);
        if (run !== this.pairingRun) return this.status();
        const poll = await this.post("/api/ai-bridge/device/pair/poll", { pollToken: started.pollToken });
        const data = (await poll.json()) as { status?: string; deviceToken?: string; deviceId?: string; orgId?: string; userId?: string; error?: string };
        if (data.status === "pending") continue;
        if (data.status === "approved" && data.deviceToken && data.userId) {
          this.config = { ...this.config, deviceToken: data.deviceToken, deviceId: data.deviceId ?? null, orgId: data.orgId ?? null, userId: data.userId };
          this.pairing = null;
          await this.save();
          if (this.config.enabled) this.ensureLoop();
          this.emit();
          return this.status();
        }
        throw new Error(data.error ? `Pairing ${data.status ?? "failed"}: ${data.error}` : `Pairing ${data.status ?? "failed"}.`);
      }
      throw new Error("The pairing code expired. Start again.");
    } catch (error) {
      if (run === this.pairingRun) {
        this.pairing = null;
        this.lastError = error instanceof Error ? error.message : "Pairing failed.";
        this.emit();
      }
      return this.status();
    }
  }

  cancelPairing() {
    this.pairingRun += 1;
    this.pairing = null;
    this.emit();
    return this.status();
  }

  /** Forget this computer's pairing (revoke it on /team/ai-bridge too). */
  async unpair() {
    this.stopLoop();
    this.config = { ...this.config, enabled: false, deviceToken: null, deviceId: null, orgId: null, userId: null };
    await this.save();
    this.emit();
    return this.status();
  }

  stop() {
    this.stopLoop();
  }

  private ensureLoop() {
    if (this.loop || !this.config.deviceToken) return;
    this.stopRequested = false;
    this.loop = this.runLoop().finally(() => {
      this.loop = null;
      this.running = false;
      this.emit();
    });
  }

  private stopLoop() {
    this.stopRequested = true;
    this.current?.abort();
  }

  private async runLoop() {
    this.running = true;
    this.emit();
    let lastHeartbeat = 0;
    let lastModelCheck = 0;
    while (!this.stopRequested && this.config.enabled && this.config.deviceToken) {
      const now = Date.now();
      if (now - lastModelCheck >= MODEL_CHECK_MS) {
        await this.refreshModels();
        lastModelCheck = now;
      }
      if (now - lastHeartbeat >= HEARTBEAT_MS) {
        const alive = await this.heartbeat();
        lastHeartbeat = now;
        if (!alive) break;
      }
      if (!this.reachable || !this.config.model) {
        await this.sleep(CLAIM_MS * 2);
        continue;
      }
      let job: BridgeJob | null = null;
      try {
        const claim = await this.post("/api/ai-bridge/device/jobs", undefined, true);
        if (claim.status === 401) {
          await this.revoked();
          break;
        }
        if (claim.status === 200) job = (await claim.json()) as BridgeJob;
      } catch {
        // Network blip: try again on the next tick.
      }
      if (!job?.jobId) {
        await this.sleep(CLAIM_MS);
        continue;
      }
      await this.serve(job);
    }
  }

  private async serve(job: BridgeJob) {
    let outcome: Awaited<ReturnType<typeof localChat>>;
    if (job.userId !== this.config.userId || (this.config.orgId && job.orgId !== this.config.orgId)) {
      outcome = { ok: false, errorClass: "cli_error", errorMessage: "This request doesn't belong to the person this computer is paired to." };
    } else {
      const controller = new AbortController();
      this.current = controller;
      const leaseCheck = this.watchLease(job, controller);
      try {
        const budget = Math.min(MAX_JOB_MS, Math.max(30_000, Number(job.messages?.timeoutMs) || MAX_JOB_MS));
        outcome = await localChat({
          fetcher: this.deps.fetcher,
          baseUrl: this.config.baseUrl,
          model: this.config.model!,
          prompt: String(job.messages?.prompt ?? ""),
          timeoutMs: budget,
          signal: controller.signal,
        });
      } finally {
        controller.abort();
        await leaseCheck;
        this.current = null;
      }
    }
    try {
      await this.post(
        "/api/ai-bridge/device/jobs",
        outcome.ok
          ? {
              jobId: job.jobId,
              leaseToken: job.leaseToken,
              state: "done",
              result: { text: outcome.text, model: `local:${outcome.model}`, usage: outcome.usage, engine: "lmstudio" },
            }
          : { jobId: job.jobId, leaseToken: job.leaseToken, state: "failed", errorClass: outcome.errorClass, errorMessage: outcome.errorMessage },
        true,
        "PATCH",
      );
    } catch {
      // The lease expires on its own; the web caller falls back to the team's normal AI.
    }
    if (outcome.ok) {
      this.jobsServed += 1;
      this.lastJobAt = new Date().toISOString();
      this.lastError = null;
    } else {
      this.lastError = outcome.errorMessage;
    }
    this.emit();
  }

  /** The web caller can stop waiting; stop generating when the lease is no longer active. */
  private async watchLease(job: { jobId: string; leaseToken: string }, controller: AbortController) {
    while (!controller.signal.aborted) {
      await this.sleep(CLAIM_MS);
      if (controller.signal.aborted) return;
      try {
        const response = await this.post("/api/ai-bridge/device/jobs", { jobId: job.jobId, leaseToken: job.leaseToken }, true, "PUT");
        const data = (await response.json()) as { active?: boolean };
        if (!response.ok || data.active !== true) controller.abort();
      } catch {
        controller.abort();
      }
    }
  }

  private async heartbeat(): Promise<boolean> {
    try {
      const response = await this.post(
        "/api/ai-bridge/device/heartbeat",
        {
          bridgeVersion: this.deps.bridgeVersion,
          engines: localEngineReport({ reachable: this.reachable, model: this.config.model, enabled: this.config.enabled }),
          stats: { jobsServedThisSession: this.jobsServed },
        },
        true,
      );
      if (response.status === 401) {
        await this.revoked();
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }

  private async revoked() {
    this.lastError = "This computer's pairing was removed in Vantage. Pair again to keep using Local AI.";
    this.config = { ...this.config, enabled: false, deviceToken: null, deviceId: null };
    await this.save();
  }

  private post(path: string, body: unknown, withToken = false, method = "POST") {
    return this.deps.fetcher(new URL(path, this.deps.origin), {
      method,
      headers: {
        "content-type": "application/json",
        ...(withToken && this.config.deviceToken ? { authorization: `Bearer ${this.config.deviceToken}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  }

  private async save() {
    await this.deps.writeConfig(this.config).catch(() => undefined);
  }

  private emit() {
    try {
      this.deps.onStatus(this.status());
    } catch {
      // A closed window never breaks the service.
    }
  }
}
