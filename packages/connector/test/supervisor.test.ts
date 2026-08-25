import { describe, expect, it } from "vitest";
import {
  ConnectorSupervisor,
  RESTART_BACKOFF_MS,
  restartDelayMs,
  type SupervisorEvent,
} from "../src/supervisor.js";
import {
  ConnectorAuthError,
  type CapabilityContext,
  type CapabilityId,
  type ConnectorCapability,
} from "../src/capability.js";
import type { ConnectorConfig } from "../src/config.js";
import { FakeSpawner, FakeTransport, ManualClock, MemoryFileSystem, flushMicrotasks, ok } from "./helpers.js";

const config: ConnectorConfig = {
  version: 1,
  baseUrl: "https://vantage-frc-web.vercel.app",
  machineName: "shop-pc",
  deviceToken: "tok",
  deviceId: "dev",
  orgId: "org",
  capabilities: { "local-models": true },
};

/** Scriptable fake capability: waits on the signal by default, or crashes N times. */
class FakeCapability implements ConnectorCapability {
  readonly label: string;
  starts = 0;
  stops = 0;
  detects = 0;
  available = true;
  crashesRemaining = 0;
  /** Simulated healthy runtime (via ctx.clock.sleep) before each crash. */
  runBeforeCrashMs = 0;
  lastHeartbeatPayload: Record<string, unknown> | null = null;

  constructor(readonly id: CapabilityId) {
    this.label = `fake ${id}`;
  }

  async detect(): Promise<{ available: boolean; detail: string }> {
    this.detects += 1;
    return this.available
      ? { available: true, detail: `${this.id} ready` }
      : { available: false, detail: `${this.id} needs setup` };
  }

  async start(ctx: CapabilityContext): Promise<void> {
    this.starts += 1;
    if (this.crashesRemaining > 0) {
      this.crashesRemaining -= 1;
      if (this.runBeforeCrashMs > 0) await ctx.clock.sleep(this.runBeforeCrashMs, ctx.signal);
      if (ctx.signal.aborted) return;
      throw new Error("boom");
    }
    while (!ctx.signal.aborted) await ctx.clock.sleep(1_000_000, ctx.signal);
  }

  async stop(): Promise<void> {
    this.stops += 1;
  }

  status() {
    return { detail: `${this.id} status`, data: { starts: this.starts } };
  }

  onHeartbeatResponse(data: Record<string, unknown>): void {
    this.lastHeartbeatPayload = data;
  }
}

function heartbeatTransport(extra: Record<string, unknown> = {}) {
  return new FakeTransport([{ match: "/api/connector/heartbeat", handler: () => ok({ ok: true, ...extra }) }]);
}

function makeSupervisor(options: {
  capabilities: ConnectorCapability[];
  transport?: FakeTransport;
  clock?: ManualClock;
  config?: ConnectorConfig;
  onEvent?: (event: SupervisorEvent) => void;
}) {
  const clock = options.clock ?? new ManualClock();
  const transport = options.transport ?? heartbeatTransport();
  const supervisor = new ConnectorSupervisor({
    config: options.config ?? config,
    capabilities: options.capabilities,
    transport,
    clock,
    spawner: new FakeSpawner(),
    fs: new MemoryFileSystem(),
    onEvent: options.onEvent,
  });
  return { supervisor, clock, transport };
}

describe("restartDelayMs", () => {
  it("walks the ladder and clamps at the last rung", () => {
    expect(restartDelayMs(1)).toBe(5_000);
    expect(restartDelayMs(2)).toBe(15_000);
    expect(restartDelayMs(3)).toBe(60_000);
    expect(restartDelayMs(4)).toBe(300_000);
    expect(restartDelayMs(99)).toBe(300_000);
    expect(restartDelayMs(0)).toBe(RESTART_BACKOFF_MS[0]);
  });
});

describe("capability enable/disable", () => {
  it("starts only enabled capabilities", async () => {
    const enabled = new FakeCapability("local-models");
    const disabled = new FakeCapability("ai-bridge"); // not in config.capabilities
    const { supervisor } = makeSupervisor({ capabilities: [enabled, disabled] });
    supervisor.start();
    await flushMicrotasks();
    expect(enabled.starts).toBe(1);
    expect(disabled.starts).toBe(0);
    expect(disabled.detects).toBe(0);
    const report = supervisor.status();
    expect(report.capabilities.find((entry) => entry.id === "local-models")?.state).toBe("running");
    expect(report.capabilities.find((entry) => entry.id === "ai-bridge")?.state).toBe("disabled");
    await supervisor.stop();
  });

  it("setEnabled(true) launches a stopped capability; setEnabled(false) stops a running one", async () => {
    const cap = new FakeCapability("mcp");
    const { supervisor } = makeSupervisor({ capabilities: [cap] });
    supervisor.start();
    await flushMicrotasks();
    expect(cap.starts).toBe(0);

    supervisor.setEnabled("mcp", true);
    await flushMicrotasks();
    expect(cap.starts).toBe(1);
    expect(supervisor.status().capabilities[0]?.state).toBe("running");

    supervisor.setEnabled("mcp", false);
    await flushMicrotasks();
    expect(cap.stops).toBeGreaterThan(0);
    expect(supervisor.status().capabilities[0]?.state).toBe("disabled");

    // Re-enable relaunches cleanly.
    supervisor.setEnabled("mcp", true);
    await flushMicrotasks();
    expect(cap.starts).toBe(2);
    await supervisor.stop();
  });

  it("stop() halts everything and reports stopped", async () => {
    const cap = new FakeCapability("local-models");
    const events: SupervisorEvent[] = [];
    const { supervisor } = makeSupervisor({ capabilities: [cap], onEvent: (event) => events.push(event) });
    supervisor.start();
    await flushMicrotasks();
    await supervisor.stop();
    expect(cap.stops).toBeGreaterThan(0);
    expect(supervisor.status().capabilities[0]?.state).toBe("stopped");
    expect(events.some((event) => event.type === "stopped")).toBe(true);
  });
});

describe("restart with backoff", () => {
  it("restarts a crashing capability on the 5s/15s/60s/300s ladder", async () => {
    const cap = new FakeCapability("local-models");
    cap.crashesRemaining = 5;
    const restartDetails: string[] = [];
    const { supervisor, clock } = makeSupervisor({
      capabilities: [cap],
      onEvent: (event) => {
        if (event.type === "capability-state" && event.state === "restarting") restartDetails.push(event.detail);
      },
    });
    supervisor.start();
    await flushMicrotasks();
    expect(cap.starts).toBe(1); // crashed instantly, now waiting 5s

    await clock.advance(5_000);
    expect(cap.starts).toBe(2);
    await clock.advance(15_000);
    expect(cap.starts).toBe(3);
    await clock.advance(60_000);
    expect(cap.starts).toBe(4);
    await clock.advance(300_000);
    expect(cap.starts).toBe(5);
    await clock.advance(300_000); // clamped at the last rung
    expect(cap.starts).toBe(6);

    expect(restartDetails).toHaveLength(5);
    expect(restartDetails[0]).toContain("restart 1 in 5s");
    expect(restartDetails[1]).toContain("restart 2 in 15s");
    expect(restartDetails[2]).toContain("restart 3 in 60s");
    expect(restartDetails[3]).toContain("restart 4 in 300s");
    expect(restartDetails[4]).toContain("restart 5 in 300s");

    // Sixth run has no crashes left: it settles into running.
    expect(supervisor.status().capabilities[0]?.state).toBe("running");
    await supervisor.stop();
  });

  it("a run that stays healthy past healthyResetMs resets the ladder to the first rung", async () => {
    const cap = new FakeCapability("local-models");
    cap.crashesRemaining = 3;
    const restartDetails: string[] = [];
    const { supervisor, clock } = makeSupervisor({
      capabilities: [cap],
      onEvent: (event) => {
        if (event.type === "capability-state" && event.state === "restarting") restartDetails.push(event.detail);
      },
    });
    supervisor.start();
    await flushMicrotasks(); // crash 1 → 5s
    await clock.advance(5_000); // crash 2 → 15s
    // Third run: healthy for 10+ minutes before crashing.
    cap.runBeforeCrashMs = 10 * 60_000;
    await clock.advance(15_000); // starts run 3
    await clock.advance(10 * 60_000); // run 3 crashes AFTER a healthy stretch
    expect(restartDetails[0]).toContain("restart 1 in 5s");
    expect(restartDetails[1]).toContain("restart 2 in 15s");
    // Ladder reset: back to the first rung, not 60s.
    expect(restartDetails[2]).toContain("restart 1 in 5s");
    await supervisor.stop();
  });

  it("an unavailable capability waits and re-detects instead of crash-looping", async () => {
    const cap = new FakeCapability("local-models");
    cap.available = false;
    const { supervisor, clock } = makeSupervisor({ capabilities: [cap] });
    supervisor.start();
    await flushMicrotasks();
    expect(cap.starts).toBe(0);
    const entry = supervisor.status().capabilities[0];
    expect(entry?.state).toBe("unavailable");
    expect(entry?.stateDetail).toContain("needs setup"); // the capability's honest words
    expect(entry?.restarts).toBe(0);

    // Setup completes on the machine → the next detect pass starts it.
    cap.available = true;
    await clock.advance(30_000);
    expect(cap.starts).toBe(1);
    expect(supervisor.status().capabilities[0]?.state).toBe("running");
    await supervisor.stop();
  });

  it("ConnectorAuthError is fatal: no restart, state auth-revoked, event emitted", async () => {
    const cap = new FakeCapability("local-models");
    cap.start = async () => {
      throw new ConnectorAuthError();
    };
    const events: SupervisorEvent[] = [];
    const { supervisor, clock } = makeSupervisor({ capabilities: [cap], onEvent: (event) => events.push(event) });
    supervisor.start();
    await flushMicrotasks();
    expect(supervisor.status().capabilities[0]?.state).toBe("auth-revoked");
    expect(events.some((event) => event.type === "auth-revoked")).toBe(true);
    await clock.advance(600_000);
    expect(supervisor.status().capabilities[0]?.state).toBe("auth-revoked"); // still down, no loop
    await supervisor.stop();
  });
});

describe("combined heartbeat", () => {
  it("reports one beat with every capability's state and data", async () => {
    const running = new FakeCapability("local-models");
    const disabled = new FakeCapability("mcp");
    const { supervisor, transport } = makeSupervisor({ capabilities: [running, disabled] });
    supervisor.start();
    await flushMicrotasks();

    const beat = transport.requests.find((request) => request.url.includes("/api/connector/heartbeat"));
    expect(beat).toBeDefined();
    expect(beat?.token).toBe("tok");
    const body = beat?.body as {
      connectorVersion: string;
      machineName: string;
      capabilities: Record<string, { enabled: boolean; state: string; detail: string; data?: unknown }>;
    };
    expect(body.machineName).toBe("shop-pc");
    expect(body.capabilities["local-models"]).toMatchObject({
      enabled: true,
      state: "running",
      detail: "local-models status",
      data: { starts: 1 },
    });
    expect(body.capabilities["mcp"]).toMatchObject({ enabled: false, state: "disabled" });
    await supervisor.stop();
  });

  it("delivers per-capability heartbeat-response instructions (storage scrub contract)", async () => {
    const cap = new FakeCapability("storage-node");
    const transport = heartbeatTransport({
      capabilities: { "storage-node": { pendingShas: ["a".repeat(64)] } },
    });
    const { supervisor } = makeSupervisor({
      capabilities: [cap],
      transport,
      config: { ...config, capabilities: { "storage-node": true } },
    });
    supervisor.start();
    await flushMicrotasks();
    expect(cap.lastHeartbeatPayload).toEqual({ pendingShas: ["a".repeat(64)] });
    await supervisor.stop();
  });

  it("a failing heartbeat retries instead of taking the connector down", async () => {
    const cap = new FakeCapability("local-models");
    let calls = 0;
    const transport = new FakeTransport([
      {
        match: "/api/connector/heartbeat",
        handler: () => {
          calls += 1;
          if (calls === 1) throw new Error("fetch failed: offline");
          return ok({ ok: true });
        },
      },
    ]);
    const events: SupervisorEvent[] = [];
    const { supervisor, clock } = makeSupervisor({
      capabilities: [cap],
      transport,
      onEvent: (event) => events.push(event),
    });
    supervisor.start();
    await flushMicrotasks();
    expect(events.some((event) => event.type === "heartbeat-failed")).toBe(true);
    expect(supervisor.status().capabilities[0]?.state).toBe("running"); // untouched
    await clock.advance(60_000);
    expect(events.some((event) => event.type === "heartbeat-ok")).toBe(true);
    await supervisor.stop();
  });

  it("a 401 heartbeat means the token was revoked: everything stops, host told to re-pair", async () => {
    const cap = new FakeCapability("local-models");
    const transport = new FakeTransport([
      { match: "/api/connector/heartbeat", handler: () => ok({ error: "revoked" }, 401) },
    ]);
    const events: SupervisorEvent[] = [];
    const { supervisor } = makeSupervisor({
      capabilities: [cap],
      transport,
      onEvent: (event) => events.push(event),
    });
    supervisor.start();
    await flushMicrotasks();
    expect(events.some((event) => event.type === "auth-revoked")).toBe(true);
    expect(events.some((event) => event.type === "stopped")).toBe(true);
    expect(cap.stops).toBeGreaterThan(0);
  });
});
