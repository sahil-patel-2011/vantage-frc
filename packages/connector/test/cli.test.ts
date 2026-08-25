import { describe, expect, it } from "vitest";
import {
  buildStatusSnapshot,
  formatAge,
  formatStatusText,
  parseCliArgs,
  runCli,
  type CliHost,
} from "../src/cli.js";
import {
  connectorConfigPath,
  legacyBridgeConfigPath,
  saveConnectorConfig,
  type ConnectorConfig,
} from "../src/config.js";
import { runtimeStatePath, type ConnectorRuntimeState } from "../src/runtime-state.js";
import type {
  CapabilityContext,
  CapabilityDetection,
  CapabilityId,
  ConnectorCapability,
} from "../src/capability.js";
import { FakeSpawner, FakeTransport, ManualClock, MemoryFileSystem, flushMicrotasks, ok } from "./helpers.js";

const HOME = "/home/frc";

const paired: ConnectorConfig = {
  version: 1,
  baseUrl: "https://vantage-frc-web.vercel.app",
  machineName: "shop-pc",
  deviceToken: "tok_plaintext",
  deviceId: "dev-1",
  orgId: "org-1",
  capabilities: {},
};

/** Minimal capability double: scripted detection, loops until the signal aborts. */
class TestCapability implements ConnectorCapability {
  readonly label: string;
  starts = 0;
  stops = 0;
  detects = 0;
  detection: CapabilityDetection = { available: true, detail: "ready to go" };

  constructor(readonly id: CapabilityId) {
    this.label = `test ${id}`;
  }

  async detect(): Promise<CapabilityDetection> {
    this.detects += 1;
    return this.detection;
  }

  async start(ctx: CapabilityContext): Promise<void> {
    this.starts += 1;
    while (!ctx.signal.aborted) await ctx.clock.sleep(1_000_000, ctx.signal);
  }

  async stop(): Promise<void> {
    this.stops += 1;
  }

  status() {
    return { detail: `${this.id} idle` };
  }
}

type TestHost = CliHost & {
  out: string[];
  err: string[];
  fs: MemoryFileSystem;
  clock: ManualClock;
  capabilities: TestCapability[];
  fireShutdown: (reason: string) => void;
};

function makeHost(options: {
  argv: string[];
  fs?: MemoryFileSystem;
  transport?: FakeTransport;
  capabilityIds?: CapabilityId[];
  alivePids?: number[];
}): TestHost {
  const out: string[] = [];
  const err: string[] = [];
  const fs = options.fs ?? new MemoryFileSystem();
  const clock = new ManualClock();
  const capabilities = (options.capabilityIds ?? ["ai-bridge", "cad-relay"]).map((id) => new TestCapability(id));
  let shutdownHandler: ((reason: string) => void) | null = null;
  const host: TestHost = {
    argv: options.argv,
    home: HOME,
    machineName: "this-machine",
    env: {},
    fs,
    clock,
    transport: options.transport ?? new FakeTransport([]),
    spawner: new FakeSpawner(),
    io: { out: (line) => out.push(line), err: (line) => err.push(line) },
    createCapabilities: () => capabilities,
    onShutdown: (handler) => {
      shutdownHandler = handler;
      return () => {
        shutdownHandler = null;
      };
    },
    pid: 4242,
    isProcessAlive: (pid) => (options.alivePids ?? []).includes(pid),
    supervisor: { heartbeatIntervalMs: 60_000 },
    out,
    err,
    capabilities,
    fireShutdown: (reason) => shutdownHandler?.(reason),
  };
  return host;
}

async function readJson(fs: MemoryFileSystem, path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(path)) as Record<string, unknown>;
}

/* ------------------------------------------------------------------ */

describe("parseCliArgs", () => {
  it("defaults to running the supervisor", () => {
    expect(parseCliArgs([])).toEqual({ kind: "run" });
  });

  it("accepts both --flag and bare-word spellings of each command", () => {
    expect(parseCliArgs(["--status"])).toEqual({ kind: "status", json: false });
    expect(parseCliArgs(["status"])).toEqual({ kind: "status", json: false });
    expect(parseCliArgs(["--status", "--json"])).toEqual({ kind: "status", json: true });
    expect(parseCliArgs(["--setup"])).toEqual({ kind: "setup", baseUrl: null, force: false });
    expect(parseCliArgs(["setup", "--url", "https://vantage.example", "--force"])).toEqual({
      kind: "setup",
      baseUrl: "https://vantage.example",
      force: true,
    });
    expect(parseCliArgs(["mcp"])).toEqual({ kind: "mcp" });
    expect(parseCliArgs(["--mcp"])).toEqual({ kind: "mcp" });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["--version"])).toEqual({ kind: "version" });
  });

  it("parses capability toggles and rejects unknown ids", () => {
    expect(parseCliArgs(["--enable", "storage-node"])).toEqual({
      kind: "toggle",
      id: "storage-node",
      enabled: true,
    });
    expect(parseCliArgs(["--disable", "mcp"])).toEqual({ kind: "toggle", id: "mcp", enabled: false });
    const unknown = parseCliArgs(["--enable", "turbo"]);
    expect(unknown.kind).toBe("usage-error");
    expect(unknown.kind === "usage-error" && unknown.message).toContain("turbo");
  });

  it("reports usage errors instead of guessing", () => {
    expect(parseCliArgs(["--enable"]).kind).toBe("usage-error");
    expect(parseCliArgs(["--url"]).kind).toBe("usage-error");
    expect(parseCliArgs(["--url", "--force"]).kind).toBe("usage-error");
    expect(parseCliArgs(["--url", "https://x"]).kind).toBe("usage-error"); // --url without --setup
    expect(parseCliArgs(["--force"]).kind).toBe("usage-error");
    expect(parseCliArgs(["--setup", "--json"]).kind).toBe("usage-error");
    expect(parseCliArgs(["--status", "--force"]).kind).toBe("usage-error");
    expect(parseCliArgs(["--enable", "mcp", "--json"]).kind).toBe("usage-error");
    expect(parseCliArgs(["--setup", "--status"]).kind).toBe("usage-error");
    expect(parseCliArgs(["--status", "--enable", "mcp"]).kind).toBe("usage-error");
    expect(parseCliArgs(["--enable", "mcp", "--disable", "mcp"]).kind).toBe("usage-error");
    expect(parseCliArgs(["--nope"]).kind).toBe("usage-error");
  });

  it("tolerates the same command repeated (systemd unit files duplicate flags)", () => {
    expect(parseCliArgs(["--status", "status"])).toEqual({ kind: "status", json: false });
  });
});

describe("help and version", () => {
  it("prints the config path in help and exits 0", async () => {
    const host = makeHost({ argv: ["--help"] });
    expect(await runCli(host)).toBe(0);
    expect(host.out.join("\n")).toContain(connectorConfigPath(HOME));
  });

  it("returns 1 and explains a usage error without touching the filesystem", async () => {
    const host = makeHost({ argv: ["--enable", "turbo"] });
    expect(await runCli(host)).toBe(1);
    expect(host.err.join("\n")).toContain("Known capabilities");
    expect(host.fs.files.size).toBe(0);
  });
});

describe("--status on a machine that has never been set up", () => {
  it("reports not-paired / no-heartbeat instead of zeros", async () => {
    const host = makeHost({ argv: ["--status"] });
    expect(await runCli(host)).toBe(0);
    const text = host.out.join("\n");
    expect(text).toContain("not paired yet");
    expect(text).toContain("no heartbeat yet — this connector has never run on this machine.");
    expect(text).toContain("nothing runs until this machine is paired and a capability is enabled.");
    // Every capability listed, all off, none pretending to have been detected.
    expect(text).toContain("ai-bridge");
    expect(text).toContain("storage-node");
    expect(text).not.toMatch(/\bready\b/);
    // Read-only: status must never create the config it is reporting on.
    expect(host.fs.files.size).toBe(0);
  });

  it("does not probe capabilities that cannot run yet", async () => {
    const host = makeHost({ argv: ["--status"] });
    await runCli(host);
    expect(host.capabilities.every((capability) => capability.detects === 0)).toBe(true);
  });

  it("says an adoptable AI bridge pairing is present rather than claiming to be paired", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile(legacyBridgeConfigPath(HOME), JSON.stringify({ baseUrl: "https://x", deviceToken: "t" }));
    const host = makeHost({ argv: ["--status"], fs });
    await runCli(host);
    const snapshot = await buildStatusSnapshot(host);
    expect(snapshot.paired).toBe(false);
    expect(snapshot.legacyBridgeAvailable).toBe(true);
    expect(host.out.join("\n")).toContain("already runs the AI bridge");
    // Still read-only: reporting the legacy file must not adopt it.
    expect(fs.files.has(connectorConfigPath(HOME))).toBe(false);
  });

  it("--json omits the device token and marks runtime as null", async () => {
    const fs = new MemoryFileSystem();
    await saveConnectorConfig(fs, HOME, { ...paired, capabilities: { "ai-bridge": true } });
    const host = makeHost({ argv: ["--status", "--json"], fs });
    expect(await runCli(host)).toBe(0);
    const parsed = JSON.parse(host.out.join("\n")) as Record<string, unknown>;
    expect(JSON.stringify(parsed)).not.toContain("tok_plaintext");
    expect(parsed.paired).toBe(true);
    expect(parsed.runtime).toBeNull();
  });
});

describe("--status on a paired machine", () => {
  it("probes only enabled capabilities and labels the detection as live", async () => {
    const fs = new MemoryFileSystem();
    await saveConnectorConfig(fs, HOME, { ...paired, capabilities: { "ai-bridge": true } });
    const host = makeHost({ argv: ["--status"], fs });
    host.capabilities[0]!.detection = { available: true, detail: "Claude Code 2.1.241" };
    await runCli(host);
    expect(host.capabilities[0]!.detects).toBe(1);
    expect(host.capabilities[1]!.detects).toBe(0);
    const text = host.out.join("\n");
    expect(text).toContain("ready — Claude Code 2.1.241");
    expect(text).not.toContain("as of the last run");
  });

  it("falls back to the last recorded run for disabled capabilities and reports a dead pid honestly", async () => {
    const fs = new MemoryFileSystem();
    await saveConnectorConfig(fs, HOME, paired);
    const state: ConnectorRuntimeState = {
      version: 1,
      pid: 4242,
      startedAt: "2026-08-24T10:00:00.000Z",
      lastHeartbeatAt: "2026-08-24T10:05:00.000Z",
      lastHeartbeatOk: true,
      lastHeartbeatDetail: null,
      stoppedAt: null,
      capabilities: [
        {
          id: "cad-relay",
          label: "Fusion CAD relay",
          enabled: true,
          state: "unavailable",
          stateDetail: "Fusion add-in not running",
          detection: { available: false, detail: "Fusion add-in not running" },
        },
      ],
    };
    await fs.writeFile(runtimeStatePath(HOME), JSON.stringify(state));
    const host = makeHost({ argv: ["--status"], fs, alivePids: [] });
    await runCli(host);
    const text = host.out.join("\n");
    expect(text).toContain("as of the last run: not ready — Fusion add-in not running");
    expect(text).toContain("last accepted 2026-08-24T10:05:00.000Z");
    expect(text).toContain("pid 4242 is gone");
  });
});

describe("--enable / --disable persistence", () => {
  it("round-trips a toggle through connector.json with mode 0600", async () => {
    const fs = new MemoryFileSystem();
    await saveConnectorConfig(fs, HOME, paired);

    const enable = makeHost({ argv: ["--enable", "ai-bridge"], fs });
    expect(await runCli(enable)).toBe(0);
    expect((await readJson(fs, connectorConfigPath(HOME))).capabilities).toEqual({ "ai-bridge": true });
    expect(fs.modes.get(connectorConfigPath(HOME))).toBe(0o600);
    // Enabling immediately reports whether this machine can actually do the job.
    expect(enable.out.join("\n")).toContain("ready — ready to go");

    const disable = makeHost({ argv: ["--disable", "ai-bridge"], fs });
    expect(await runCli(disable)).toBe(0);
    expect((await readJson(fs, connectorConfigPath(HOME))).capabilities).toEqual({ "ai-bridge": false });

    // Everything else is preserved across both writes.
    const finalConfig = await readJson(fs, connectorConfigPath(HOME));
    expect(finalConfig.deviceToken).toBe("tok_plaintext");
    expect(finalConfig.orgId).toBe("org-1");
  });

  it("surfaces a setup-required capability instead of pretending it is ready", async () => {
    const fs = new MemoryFileSystem();
    await saveConnectorConfig(fs, HOME, paired);
    const host = makeHost({ argv: ["--enable", "cad-relay"], fs });
    host.capabilities[1]!.detection = { available: false, detail: "Fusion add-in not running" };
    expect(await runCli(host)).toBe(0);
    expect(host.out.join("\n")).toContain("setup required — Fusion add-in not running");
  });

  it("is idempotent and does not rewrite an unchanged toggle", async () => {
    const fs = new MemoryFileSystem();
    await saveConnectorConfig(fs, HOME, { ...paired, capabilities: { mcp: true } });
    const host = makeHost({ argv: ["--enable", "mcp"], fs });
    expect(await runCli(host)).toBe(0);
    expect(host.out.join("\n")).toContain("already enabled");
  });

  it("refuses to toggle before pairing", async () => {
    const host = makeHost({ argv: ["--enable", "ai-bridge"] });
    expect(await runCli(host)).toBe(1);
    expect(host.err.join("\n")).toContain("Not paired yet");
    expect(host.fs.files.size).toBe(0);
  });
});

describe("--setup", () => {
  it("adopts an existing ai-bridge.json instead of asking for a new pairing code", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile(
      legacyBridgeConfigPath(HOME),
      JSON.stringify({
        baseUrl: "https://vantage-frc-web.vercel.app",
        machineName: "mentor-desktop",
        deviceToken: "bridge_token_123",
        deviceId: "bridge-dev-9",
        orgId: "org-77",
      }),
    );
    const transport = new FakeTransport([]); // any pairing request would throw
    const host = makeHost({ argv: ["--setup"], fs, transport });
    expect(await runCli(host)).toBe(0);
    expect(transport.requests).toHaveLength(0);
    const saved = await readJson(fs, connectorConfigPath(HOME));
    expect(saved.deviceToken).toBe("bridge_token_123");
    expect(saved.capabilities).toEqual({ "ai-bridge": true });
    expect(host.out.join("\n")).toContain("Adopted the AI bridge pairing");
  });

  it("shows the 8-character code, waits for approval, then saves a 0600 config", async () => {
    let polls = 0;
    const transport = new FakeTransport([
      {
        match: "/api/connector/pair/start",
        handler: () =>
          ok({
            userCode: "H7K2M4PQ",
            verificationUri: "https://vantage-frc-web.vercel.app/team/connector",
            pollToken: "poll_secret",
            interval: 3,
            expiresIn: 600,
          }),
      },
      {
        match: "/api/connector/pair/poll",
        handler: () => {
          polls += 1;
          return polls === 1
            ? ok({ status: "pending" })
            : ok({ status: "approved", deviceToken: "dev_token", deviceId: "dev-9", orgId: "org-3" });
        },
      },
    ]);
    const host = makeHost({ argv: ["--setup"], transport });
    const running = runCli(host);
    await flushMicrotasks();
    expect(host.out.join("\n")).toContain("H7K2M4PQ");
    await host.clock.advance(3_000);
    await host.clock.advance(3_000);
    expect(await running).toBe(0);

    const saved = await readJson(host.fs, connectorConfigPath(HOME));
    expect(saved.deviceToken).toBe("dev_token");
    expect(saved.orgId).toBe("org-3");
    // Fresh pairings enable nothing: turning a capability on stays a human decision.
    expect(saved.capabilities).toEqual({});
    expect(host.fs.modes.get(connectorConfigPath(HOME))).toBe(0o600);
    // The poll token is a device secret and must never be printed.
    expect(host.out.join("\n")).not.toContain("poll_secret");
  });

  it("keeps an existing pairing unless --force is given", async () => {
    const fs = new MemoryFileSystem();
    await saveConnectorConfig(fs, HOME, paired);
    const transport = new FakeTransport([]);
    const host = makeHost({ argv: ["--setup"], fs, transport });
    expect(await runCli(host)).toBe(0);
    expect(transport.requests).toHaveLength(0);
    expect(host.out.join("\n")).toContain("--setup --force");
  });

  it("reports an unreachable host as a failure rather than writing a half config", async () => {
    const host = makeHost({ argv: ["--setup"] });
    expect(await runCli(host)).toBe(1);
    expect(host.err.join("\n")).toContain("Could not reach");
    expect(host.fs.files.has(connectorConfigPath(HOME))).toBe(false);
  });
});

describe("running the supervisor", () => {
  function heartbeatHost(argv: string[] = []) {
    const fs = new MemoryFileSystem();
    const transport = new FakeTransport([
      { match: "/api/connector/heartbeat", handler: () => ok({ ok: true }) },
    ]);
    return { fs, transport, argv };
  }

  it("refuses to run before pairing", async () => {
    const host = makeHost({ argv: [] });
    expect(await runCli(host)).toBe(1);
    expect(host.err.join("\n")).toContain("--setup");
  });

  it("starts enabled capabilities, records a heartbeat, and shuts down cleanly on a signal", async () => {
    const { fs, transport } = heartbeatHost();
    await saveConnectorConfig(fs, HOME, { ...paired, capabilities: { "ai-bridge": true } });
    const host = makeHost({ argv: [], fs, transport });

    const running = runCli(host);
    await flushMicrotasks();
    expect(host.capabilities[0]!.starts).toBe(1);
    expect(host.capabilities[1]!.starts).toBe(0); // disabled capability never starts

    host.fireShutdown("Received SIGINT");
    expect(await running).toBe(0);

    expect(host.capabilities[0]!.stops).toBe(1);
    expect(host.out.join("\n")).toContain("Connector stopped.");

    const state = await readJson(fs, runtimeStatePath(HOME));
    expect(state.lastHeartbeatOk).toBe(true);
    expect(typeof state.lastHeartbeatAt).toBe("string");
    expect(typeof state.stoppedAt).toBe("string");
    expect(state.pid).toBe(4242);
    // The runtime file records liveness only — never the device token.
    expect(JSON.stringify(state)).not.toContain("tok_plaintext");
  });

  it("runs (and heartbeats) with nothing enabled, but says so plainly", async () => {
    const { fs, transport } = heartbeatHost();
    await saveConnectorConfig(fs, HOME, paired);
    const host = makeHost({ argv: [], fs, transport });
    const running = runCli(host);
    await flushMicrotasks();
    host.fireShutdown("Received SIGTERM");
    expect(await running).toBe(0);
    expect(host.out.join("\n")).toContain("No capabilities are enabled");
    expect(host.capabilities.every((capability) => capability.starts === 0)).toBe(true);
  });

  it("exits non-zero when the cloud revokes the device token", async () => {
    const fs = new MemoryFileSystem();
    await saveConnectorConfig(fs, HOME, { ...paired, capabilities: { "ai-bridge": true } });
    const transport = new FakeTransport([
      { match: "/api/connector/heartbeat", handler: () => ok({ error: "revoked" }, 401) },
    ]);
    const host = makeHost({ argv: [], fs, transport });
    expect(await runCli(host)).toBe(1);
    expect(host.err.join("\n")).toContain("revoked");
    expect(host.capabilities[0]!.stops).toBe(1);
  });

  it("adopts a legacy bridge pairing on first run instead of demanding --setup", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile(
      legacyBridgeConfigPath(HOME),
      JSON.stringify({ baseUrl: "https://x", machineName: "m", deviceToken: "t", deviceId: "d", orgId: "o" }),
    );
    const transport = new FakeTransport([
      { match: "/api/connector/heartbeat", handler: () => ok({ ok: true }) },
    ]);
    const host = makeHost({ argv: [], fs, transport });
    const running = runCli(host);
    await flushMicrotasks();
    host.fireShutdown("Received SIGINT");
    expect(await running).toBe(0);
    expect(host.out.join("\n")).toContain("Adopted the AI bridge pairing");
    expect(host.capabilities[0]!.starts).toBe(1); // ai-bridge, the one the bridge already did
  });
});

describe("formatting helpers", () => {
  it("formats ages in human units and refuses to invent one", () => {
    expect(formatAge(1_000)).toBe("just now");
    expect(formatAge(30_000)).toBe("30s ago");
    expect(formatAge(10 * 60_000)).toBe("10m ago");
    expect(formatAge(5 * 3_600_000)).toBe("5h ago");
    expect(formatAge(3 * 86_400_000)).toBe("3d ago");
    expect(formatAge(Number.NaN)).toBe("unknown");
  });

  it("renders a started-but-not-yet-beating connector without faking a timestamp", () => {
    const text = formatStatusText({
      connectorVersion: "0.1.0",
      generatedAt: "2026-08-24T10:00:30.000Z",
      configPath: "/home/frc/.vantage/connector.json",
      machineName: "shop-pc",
      paired: true,
      baseUrl: "https://vantage-frc-web.vercel.app",
      orgId: "org-1",
      deviceId: "dev-1",
      adoptedFrom: null,
      legacyBridgeAvailable: false,
      capabilities: [],
      runtime: {
        pid: 12,
        processAlive: true,
        startedAt: "2026-08-24T10:00:00.000Z",
        lastHeartbeatAt: null,
        lastHeartbeatOk: null,
        lastHeartbeatDetail: null,
        stoppedAt: null,
      },
    });
    expect(text).toContain("no heartbeat yet — the connector started 2026-08-24T10:00:00.000Z (30s ago)");
    expect(text).toContain("running as pid 12");
    expect(text).toContain("(team org-1, device dev-1)");
  });
});
