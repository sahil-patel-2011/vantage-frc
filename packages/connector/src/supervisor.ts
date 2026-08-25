import {
  ConnectorAuthError,
  type CapabilityContext,
  type CapabilityDetection,
  type CapabilityId,
  type ConnectorCapability,
} from "./capability.js";
import { cloudUrl, resolveEndpoints, type ConnectorEndpoints } from "./endpoints.js";
import { isCapabilityEnabled, type ConnectorConfig } from "./config.js";
import { CONNECTOR_VERSION } from "./version.js";
import type { Clock, FileSystemLike, JsonHttpTransport, Logger, Spawner } from "./ports.js";

/**
 * The connector supervisor: starts the ENABLED capabilities, restarts a crashed one with
 * backoff, and reports ONE combined heartbeat for the whole device — one pairing, one
 * token, one liveness signal, instead of four separate services each doing their own.
 *
 * Heartbeat semantics follow bridge.mjs: failures are logged and retried (never fatal),
 * and a 401 means the device token was revoked — everything stops and the host is told to
 * re-pair. Restart semantics: a capability crash restarts on the RESTART_BACKOFF_MS
 * ladder; a run that stayed healthy for `healthyResetMs` resets the ladder. An
 * unavailable capability (detect() said no) is re-probed on `detectRetryMs` — "Fusion is
 * not open yet" is a waiting state, not a crash loop.
 */

export const HEARTBEAT_INTERVAL_MS = 60_000;
export const DETECT_RETRY_MS = 30_000;
export const RESTART_BACKOFF_MS = [5_000, 15_000, 60_000, 300_000] as const;
export const HEALTHY_RESET_MS = 10 * 60_000;

/** Pure backoff ladder: attempt 1 → first delay, clamped at the last rung. */
export function restartDelayMs(
  restartCount: number,
  ladder: readonly number[] = RESTART_BACKOFF_MS,
): number {
  if (ladder.length === 0) return 0;
  const index = Math.min(Math.max(restartCount - 1, 0), ladder.length - 1);
  return ladder[index]!;
}

export type CapabilityRunState =
  | "disabled"
  | "detecting"
  | "unavailable"
  | "running"
  | "restarting"
  | "stopped"
  | "auth-revoked";

export type CapabilityStatusEntry = {
  id: CapabilityId;
  label: string;
  enabled: boolean;
  state: CapabilityRunState;
  /** Lifecycle explanation (why unavailable / when restarting), honest and human-readable. */
  stateDetail: string;
  restarts: number;
  detection: CapabilityDetection | null;
  report: { detail: string; data?: Record<string, unknown> };
};

export type ConnectorStatusReport = {
  connectorVersion: string;
  machineName: string;
  orgId: string | null;
  baseUrl: string;
  capabilities: CapabilityStatusEntry[];
};

export type SupervisorEvent =
  | { type: "capability-state"; id: CapabilityId; state: CapabilityRunState; detail: string }
  | { type: "heartbeat-ok" }
  | { type: "heartbeat-failed"; detail: string }
  | { type: "auth-revoked"; detail: string }
  | { type: "stopped" };

export type ConnectorSupervisorOptions = {
  config: ConnectorConfig;
  capabilities: ConnectorCapability[];
  transport: JsonHttpTransport;
  clock: Clock;
  spawner: Spawner;
  fs: FileSystemLike;
  log?: Logger;
  endpoints?: Partial<ConnectorEndpoints>;
  heartbeatIntervalMs?: number;
  detectRetryMs?: number;
  restartBackoffMs?: readonly number[];
  healthyResetMs?: number;
  onEvent?: (event: SupervisorEvent) => void;
};

type Runner = {
  capability: ConnectorCapability;
  enabled: boolean;
  state: CapabilityRunState;
  stateDetail: string;
  restarts: number;
  detection: CapabilityDetection | null;
  controller: AbortController | null;
  loop: Promise<void> | null;
};

export class ConnectorSupervisor {
  private readonly runners = new Map<CapabilityId, Runner>();
  private readonly endpoints: ConnectorEndpoints;
  private readonly log: Logger;
  private config: ConnectorConfig;
  private rootController: AbortController | null = null;
  private heartbeatLoop: Promise<void> | null = null;
  private stopping = false;

  constructor(private readonly options: ConnectorSupervisorOptions) {
    this.config = options.config;
    this.endpoints = resolveEndpoints(options.endpoints);
    this.log = options.log ?? (() => {});
    for (const capability of options.capabilities) {
      this.runners.set(capability.id, {
        capability,
        enabled: isCapabilityEnabled(this.config, capability.id),
        state: "disabled",
        stateDetail: "Not enabled.",
        restarts: 0,
        detection: null,
        controller: null,
        loop: null,
      });
    }
  }

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  start(): void {
    if (this.rootController) return; // already started
    this.stopping = false;
    this.rootController = new AbortController();
    for (const runner of this.runners.values()) {
      if (runner.enabled) this.launch(runner);
    }
    this.heartbeatLoop = this.runHeartbeats();
  }

  async stop(): Promise<void> {
    if (!this.rootController) return;
    this.stopping = true;
    this.rootController.abort();
    for (const runner of this.runners.values()) {
      runner.controller?.abort();
    }
    const loops = [...this.runners.values()].map((runner) => runner.loop).filter(Boolean) as Promise<void>[];
    if (this.heartbeatLoop) loops.push(this.heartbeatLoop);
    await Promise.all(loops.map((loop) => loop.catch(() => {})));
    for (const runner of this.runners.values()) {
      await runner.capability.stop().catch(() => {});
      if (runner.state !== "auth-revoked") this.setState(runner, "stopped", "Connector stopped.");
      runner.controller = null;
      runner.loop = null;
    }
    this.rootController = null;
    this.heartbeatLoop = null;
    this.options.onEvent?.({ type: "stopped" });
  }

  /** Toggle a capability at runtime (persisting the config is the host's job). */
  setEnabled(id: CapabilityId, enabled: boolean): void {
    const runner = this.runners.get(id);
    if (!runner || runner.enabled === enabled) return;
    runner.enabled = enabled;
    this.config = {
      ...this.config,
      capabilities: { ...this.config.capabilities, [id]: enabled },
    };
    if (!enabled) {
      runner.controller?.abort();
      runner.controller = null;
      void runner.capability.stop().catch(() => {});
      this.setState(runner, "disabled", "Disabled.");
      return;
    }
    if (this.rootController && !this.stopping) this.launch(runner);
  }

  /** Swap in an updated config snapshot (base URL, extra model endpoints, dirs…). */
  updateConfig(config: ConnectorConfig): void {
    this.config = config;
    for (const [id, runner] of this.runners) {
      const enabled = isCapabilityEnabled(config, id);
      if (enabled !== runner.enabled) this.setEnabled(id, enabled);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Capability run loop (detect → start → restart with backoff)          */
  /* ------------------------------------------------------------------ */

  private context(signal: AbortSignal): CapabilityContext {
    return {
      config: this.config,
      endpoints: this.endpoints,
      transport: this.options.transport,
      spawner: this.options.spawner,
      fs: this.options.fs,
      clock: this.options.clock,
      log: this.log,
      signal,
    };
  }

  private setState(runner: Runner, state: CapabilityRunState, detail: string): void {
    runner.state = state;
    runner.stateDetail = detail;
    this.options.onEvent?.({ type: "capability-state", id: runner.capability.id, state, detail });
  }

  private launch(runner: Runner): void {
    const controller = new AbortController();
    runner.controller = controller;
    runner.restarts = 0;
    runner.loop = this.runCapability(runner, controller).catch((error) => {
      // runCapability handles its own errors; this guards the unexpected.
      this.log(`${runner.capability.id}: runner crashed: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private async runCapability(runner: Runner, controller: AbortController): Promise<void> {
    const clock = this.options.clock;
    const detectRetryMs = this.options.detectRetryMs ?? DETECT_RETRY_MS;
    const ladder = this.options.restartBackoffMs ?? RESTART_BACKOFF_MS;
    const healthyResetMs = this.options.healthyResetMs ?? HEALTHY_RESET_MS;

    while (!controller.signal.aborted) {
      this.setState(runner, "detecting", "Checking whether this machine can run the capability.");
      let detection: CapabilityDetection;
      try {
        detection = await runner.capability.detect(this.context(controller.signal));
      } catch (error) {
        detection = {
          available: false,
          detail: `Detection failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      runner.detection = detection;
      if (controller.signal.aborted) break;
      if (!detection.available) {
        // Honest waiting state — "not installed / not configured" is not a crash.
        this.setState(runner, "unavailable", detection.detail);
        await clock.sleep(detectRetryMs, controller.signal);
        continue;
      }

      this.setState(runner, "running", detection.detail);
      const startedAt = clock.now();
      let crashDetail: string | null = null;
      try {
        await runner.capability.start(this.context(controller.signal));
        if (!controller.signal.aborted) {
          crashDetail = "Capability loop returned unexpectedly.";
        }
      } catch (error) {
        if (error instanceof ConnectorAuthError) {
          this.setState(runner, "auth-revoked", error.message);
          this.options.onEvent?.({ type: "auth-revoked", detail: error.message });
          controller.abort();
          return;
        }
        crashDetail = error instanceof Error ? error.message : String(error);
      }
      if (controller.signal.aborted) break;

      // Crash accounting: survive healthyResetMs and the ladder starts over.
      if (clock.now() - startedAt >= healthyResetMs) runner.restarts = 1;
      else runner.restarts += 1;
      const delay = restartDelayMs(runner.restarts, ladder);
      this.setState(
        runner,
        "restarting",
        `Crashed (${crashDetail ?? "unknown"}); restart ${runner.restarts} in ${Math.round(delay / 1000)}s.`,
      );
      this.log(`${runner.capability.id}: ${runner.stateDetail}`);
      await clock.sleep(delay, controller.signal);
    }
  }

  /* ------------------------------------------------------------------ */
  /* Combined heartbeat                                                  */
  /* ------------------------------------------------------------------ */

  status(): ConnectorStatusReport {
    return {
      connectorVersion: CONNECTOR_VERSION,
      machineName: this.config.machineName,
      orgId: this.config.orgId,
      baseUrl: this.config.baseUrl,
      capabilities: [...this.runners.values()].map((runner) => ({
        id: runner.capability.id,
        label: runner.capability.label,
        enabled: runner.enabled,
        state: runner.state,
        stateDetail: runner.stateDetail,
        restarts: runner.restarts,
        detection: runner.detection,
        report: runner.capability.status(),
      })),
    };
  }

  /**
   * One combined heartbeat: everything the cloud needs to render the device honestly.
   * Returns true when accepted; throws ConnectorAuthError on 401 (token revoked).
   */
  async heartbeatOnce(): Promise<boolean> {
    const report = this.status();
    const body = {
      connectorVersion: report.connectorVersion,
      machineName: report.machineName,
      capabilities: Object.fromEntries(
        report.capabilities.map((entry) => [
          entry.id,
          {
            enabled: entry.enabled,
            state: entry.state,
            detail: entry.report.detail,
            ...(entry.report.data ? { data: entry.report.data } : {}),
          },
        ]),
      ),
    };
    const response = await this.options.transport.postJson(
      cloudUrl(this.config.baseUrl, this.endpoints.heartbeat),
      body,
      { token: this.config.deviceToken },
    );
    if (response.status === 401) {
      throw new ConnectorAuthError("Device token was revoked in Vantage. Re-pair this connector.");
    }
    if (!response.ok) return false;
    // Per-capability instructions ride the response (e.g. storage scrub pendingShas).
    const instructions = response.data.capabilities;
    if (instructions && typeof instructions === "object" && !Array.isArray(instructions)) {
      for (const [id, payload] of Object.entries(instructions as Record<string, unknown>)) {
        const runner = this.runners.get(id as CapabilityId);
        if (runner?.capability.onHeartbeatResponse && payload && typeof payload === "object") {
          try {
            runner.capability.onHeartbeatResponse(payload as Record<string, unknown>);
          } catch {
            /* a capability's instruction handler must never take down the heartbeat */
          }
        }
      }
    }
    return true;
  }

  private async runHeartbeats(): Promise<void> {
    const controller = this.rootController;
    if (!controller) return;
    const interval = this.options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;
    // start() launches every capability's runCapability() loop synchronously, then calls
    // this method synchronously too — without a yield here, the first heartbeat's status
    // snapshot is taken before those loops get even one microtask turn to leave their
    // initial "detecting" placeholder state. One tick is enough to give them that turn.
    await Promise.resolve();
    while (!controller.signal.aborted) {
      try {
        const accepted = await this.heartbeatOnce();
        if (accepted) this.options.onEvent?.({ type: "heartbeat-ok" });
        else this.options.onEvent?.({ type: "heartbeat-failed", detail: "Cloud rejected the heartbeat." });
      } catch (error) {
        if (error instanceof ConnectorAuthError) {
          this.log(error.message);
          this.options.onEvent?.({ type: "auth-revoked", detail: error.message });
          // Revoked token: stop everything; a human must re-pair.
          void this.stop();
          return;
        }
        const detail = error instanceof Error ? error.message : String(error);
        this.log(`Heartbeat failed (will retry): ${detail}`);
        this.options.onEvent?.({ type: "heartbeat-failed", detail });
      }
      await this.options.clock.sleep(interval, controller.signal);
    }
  }
}
