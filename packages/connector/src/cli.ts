import {
  CAPABILITY_IDS,
  isCapabilityId,
  type CapabilityContext,
  type CapabilityDetection,
  type CapabilityId,
  type ConnectorCapability,
} from "./capability.js";
import {
  connectorConfigPath,
  enabledCapabilities,
  isCapabilityEnabled,
  legacyBridgeConfigPath,
  loadConnectorConfig,
  loadOrAdoptConnectorConfig,
  saveConnectorConfig,
  setCapabilityEnabled,
  type ConnectorConfig,
} from "./config.js";
import { resolveEndpoints } from "./endpoints.js";
import { PairingFlow, configFromPairing } from "./pairing.js";
import { fileExists, type Clock, type FileSystemLike, type JsonHttpTransport, type Spawner } from "./ports.js";
import {
  readRuntimeState,
  snapshotFromStatus,
  writeRuntimeState,
  type ConnectorRuntimeState,
} from "./runtime-state.js";
import { ConnectorSupervisor, type CapabilityRunState, type SupervisorEvent } from "./supervisor.js";
import { CONNECTOR_VERSION, defaultBaseUrl } from "./version.js";
import { connectorStatusToolRegistry, runConnectorMcp } from "./mcp.js";

/**
 * Headless CLI host for the connector — what a mentor actually runs on the always-on shop
 * PC or the Raspberry Pi. Plain Node, no native modules, no dependencies.
 *
 *   vantage-connector --setup     pair this machine (8-character code)
 *   vantage-connector             run the supervisor until SIGINT/SIGTERM
 *   vantage-connector --status    what is paired / enabled / detected / last heartbeat
 *   vantage-connector --enable <capability> | --disable <capability>
 *   vantage-connector mcp         stdio MCP server for Claude Code / Cursor
 *
 * Everything the CLI touches arrives through `CliHost` (the same injected-port discipline
 * as the rest of the package), so every command is unit-testable with no process, socket,
 * timer, or real filesystem. The Node wiring lives in ./node/cli-main.ts.
 */

export type CliIo = {
  out(line: string): void;
  err(line: string): void;
};

export type CliStdio = {
  input: { on(event: "data", listener: (chunk: Buffer) => void): unknown };
  output: { write(chunk: Buffer): unknown };
};

export type CliHost = {
  argv: string[];
  home: string;
  /** This computer's name, used when pairing a fresh machine. */
  machineName: string;
  env: Record<string, string | undefined>;
  fs: FileSystemLike;
  clock: Clock;
  transport: JsonHttpTransport;
  spawner: Spawner;
  io: CliIo;
  /** Capability instances this host can run; called once per command that needs them. */
  createCapabilities(): ConnectorCapability[];
  /**
   * Register a shutdown request (SIGINT/SIGTERM on the Node host); the returned function
   * unregisters it. A host with no signals may return a no-op — the run loop then only
   * ends on auth revocation.
   */
  onShutdown(handler: (reason: string) => void): () => void;
  /** Recorded in the runtime state file so `--status` can tell whether it is still alive. */
  pid?: number | null;
  isProcessAlive?: (pid: number) => boolean;
  /** Required only by the `mcp` command. */
  stdio?: CliStdio;
  /** Supervisor knobs; tests shorten the intervals. */
  supervisor?: {
    heartbeatIntervalMs?: number;
    detectRetryMs?: number;
    restartBackoffMs?: readonly number[];
  };
};

/* ------------------------------------------------------------------ */
/* Argument parsing (pure)                                             */
/* ------------------------------------------------------------------ */

export type CliCommand =
  | { kind: "run" }
  | { kind: "setup"; baseUrl: string | null; force: boolean }
  | { kind: "status"; json: boolean }
  | { kind: "toggle"; id: CapabilityId; enabled: boolean }
  | { kind: "mcp" }
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "usage-error"; message: string };

/** Both spellings are accepted: `--status` (bridge.mjs style) and `status` (vantage-cad style). */
function commandWord(token: string): "run" | "setup" | "status" | "mcp" | "help" | "version" | null {
  switch (token) {
    case "--setup":
    case "setup":
      return "setup";
    case "--status":
    case "status":
      return "status";
    case "--mcp":
    case "mcp":
      return "mcp";
    case "--help":
    case "-h":
    case "help":
      return "help";
    case "--version":
    case "-v":
      return "version";
    default:
      return null;
  }
}

export function parseCliArgs(argv: readonly string[]): CliCommand {
  let command: "run" | "setup" | "status" | "mcp" | "help" | "version" = "run";
  let commandSeen: string | null = null;
  let baseUrl: string | null = null;
  let force = false;
  let json = false;
  let toggle: { id: CapabilityId; enabled: boolean } | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    const word = commandWord(token);
    if (word) {
      if (commandSeen && word !== command) {
        return {
          kind: "usage-error",
          message: `Pick one command: ${commandSeen} and ${token} cannot run together.`,
        };
      }
      command = word;
      commandSeen = token;
      continue;
    }
    if (token === "--url") {
      const value = argv[i + 1];
      if (!value || value.startsWith("-")) {
        return { kind: "usage-error", message: "--url needs a Vantage host, e.g. --url https://vantage.example" };
      }
      baseUrl = value;
      i += 1;
      continue;
    }
    if (token === "--force") {
      force = true;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--enable" || token === "--disable" || token === "enable" || token === "disable") {
      const value = argv[i + 1];
      const enabled = token === "--enable" || token === "enable";
      if (!value) {
        return {
          kind: "usage-error",
          message: `${token} needs a capability: ${CAPABILITY_IDS.join(", ")}`,
        };
      }
      if (!isCapabilityId(value)) {
        return {
          kind: "usage-error",
          message: `Unknown capability ${JSON.stringify(value)}. Known capabilities: ${CAPABILITY_IDS.join(", ")}`,
        };
      }
      if (toggle && (toggle.id !== value || toggle.enabled !== enabled)) {
        return { kind: "usage-error", message: "Toggle one capability at a time." };
      }
      toggle = { id: value, enabled };
      i += 1;
      continue;
    }
    return { kind: "usage-error", message: `Unknown argument ${JSON.stringify(token)}. Try --help.` };
  }

  // A modifier that does not apply to the chosen command is a usage error, never a
  // silently ignored flag: `--setup --json` must not look like it worked.
  const stray = (allowed: { url?: boolean; force?: boolean; json?: boolean }): string | null => {
    if (baseUrl !== null && !allowed.url) return "--url only applies to --setup.";
    if (force && !allowed.force) return "--force only applies to --setup.";
    if (json && !allowed.json) return "--json only applies to --status.";
    return null;
  };

  if (toggle) {
    if (commandSeen) {
      return { kind: "usage-error", message: `${commandSeen} and --enable/--disable cannot run together.` };
    }
    const message = stray({});
    if (message) return { kind: "usage-error", message };
    return { kind: "toggle", id: toggle.id, enabled: toggle.enabled };
  }
  if (command === "setup") {
    const message = stray({ url: true, force: true });
    return message ? { kind: "usage-error", message } : { kind: "setup", baseUrl, force };
  }
  if (command === "status") {
    const message = stray({ json: true });
    return message ? { kind: "usage-error", message } : { kind: "status", json };
  }
  const message = stray({});
  if (message) return { kind: "usage-error", message };
  if (command === "mcp") return { kind: "mcp" };
  if (command === "help") return { kind: "help" };
  if (command === "version") return { kind: "version" };
  return { kind: "run" };
}

export function helpText(configPath: string): string {
  return [
    `Vantage connector ${CONNECTOR_VERSION} — one paired machine, six toggleable capabilities.`,
    "",
    "  vantage-connector                       run every enabled capability until Ctrl+C",
    "  vantage-connector --setup [--url URL] [--force]",
    "                                          pair this machine with your Vantage team",
    "  vantage-connector --status [--json]     pairing, capabilities, detection, last heartbeat",
    "  vantage-connector --enable <capability>",
    "  vantage-connector --disable <capability>",
    "  vantage-connector mcp                   stdio MCP server for Claude Code / Cursor",
    "  vantage-connector --version",
    "",
    `Capabilities: ${CAPABILITY_IDS.join(", ")}`,
    `Config file:  ${configPath}`,
  ].join("\n");
}

/* ------------------------------------------------------------------ */
/* Status snapshot (pure data) + rendering                             */
/* ------------------------------------------------------------------ */

export type CliCapabilityStatus = {
  id: CapabilityId;
  label: string;
  enabled: boolean;
  detection: { available: boolean; detail: string } | null;
  /** Where `detection` came from — never presented as live when it is not. */
  detectionSource: "probe" | "last-run" | "none";
  lastRunState: CapabilityRunState | null;
};

export type CliStatusSnapshot = {
  connectorVersion: string;
  generatedAt: string;
  configPath: string;
  machineName: string;
  paired: boolean;
  baseUrl: string | null;
  orgId: string | null;
  deviceId: string | null;
  /** "ai-bridge" when this pairing was adopted from ~/.vantage/ai-bridge.json. */
  adoptedFrom: string | null;
  /** Unpaired machine that already runs the standalone bridge: --setup adopts, never re-pairs. */
  legacyBridgeAvailable: boolean;
  capabilities: CliCapabilityStatus[];
  /** null when the connector has never run on this machine. */
  runtime: {
    pid: number | null;
    /** null when this host cannot check whether the pid is alive. */
    processAlive: boolean | null;
    startedAt: string;
    lastHeartbeatAt: string | null;
    lastHeartbeatOk: boolean | null;
    lastHeartbeatDetail: string | null;
    stoppedAt: string | null;
  } | null;
};

export function formatAge(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "unknown";
  const seconds = Math.floor(ms / 1000);
  if (seconds < 5) return "just now";
  if (seconds < 90) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 90) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function ageBetween(fromIso: string | null, toIso: string): string | null {
  if (!fromIso) return null;
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return formatAge(to - from);
}

export function formatStatusText(snapshot: CliStatusSnapshot): string {
  const lines: string[] = [`Vantage connector ${snapshot.connectorVersion}`];
  lines.push(`  config file   ${snapshot.configPath}${snapshot.paired ? "" : " (not created yet)"}`);
  if (snapshot.paired) {
    const identity = [
      snapshot.orgId ? `team ${snapshot.orgId}` : null,
      snapshot.deviceId ? `device ${snapshot.deviceId}` : null,
    ].filter((part): part is string => part !== null);
    lines.push(
      `  pairing       paired with ${snapshot.baseUrl}${identity.length > 0 ? ` (${identity.join(", ")})` : ""}`,
    );
    if (snapshot.adoptedFrom) {
      lines.push(`                adopted from the existing ${snapshot.adoptedFrom} pairing on this machine`);
    }
    lines.push(`  machine name  ${snapshot.machineName}`);
  } else {
    lines.push("  pairing       not paired yet — run `vantage-connector --setup` to pair this machine");
    if (snapshot.legacyBridgeAvailable) {
      lines.push("                this machine already runs the AI bridge; --setup adopts that pairing instead of");
      lines.push("                asking for a new code.");
    }
    lines.push(`  machine name  ${snapshot.machineName} (this computer; sent when you pair)`);
  }

  lines.push("");
  lines.push("capabilities");
  for (const capability of snapshot.capabilities) {
    lines.push(`  ${pad(capability.id, 14)}${pad(capability.enabled ? "enabled" : "disabled", 10)}${capability.label}`);
    if (capability.detection) {
      const prefix = capability.detectionSource === "probe" ? "" : "as of the last run: ";
      lines.push(
        `  ${" ".repeat(14)}${prefix}${capability.detection.available ? "ready" : "not ready"} — ${capability.detection.detail}`,
      );
    }
    if (capability.enabled && !capability.detection) {
      lines.push(`  ${" ".repeat(14)}not checked yet — detection runs when the connector runs`);
    }
  }
  if (!snapshot.paired) {
    lines.push("  nothing runs until this machine is paired and a capability is enabled.");
  } else if (snapshot.capabilities.every((capability) => !capability.enabled)) {
    lines.push(`  nothing is enabled — turn one on with \`vantage-connector --enable <capability>\`.`);
  }

  lines.push("");
  lines.push("heartbeat");
  const runtime = snapshot.runtime;
  if (!runtime) {
    lines.push("  no heartbeat yet — this connector has never run on this machine.");
  } else if (!runtime.lastHeartbeatAt) {
    const age = ageBetween(runtime.startedAt, snapshot.generatedAt);
    lines.push(
      `  no heartbeat yet — the connector started ${runtime.startedAt}${age ? ` (${age})` : ""} and has not completed one.`,
    );
  } else {
    const age = ageBetween(runtime.lastHeartbeatAt, snapshot.generatedAt);
    const verdict = runtime.lastHeartbeatOk === true ? "accepted" : "rejected";
    lines.push(
      `  last ${verdict} ${runtime.lastHeartbeatAt}${age ? ` (${age})` : ""}` +
        `${runtime.lastHeartbeatDetail ? ` — ${runtime.lastHeartbeatDetail}` : ""}`,
    );
  }
  if (runtime) {
    if (runtime.stoppedAt) {
      lines.push(`  the connector shut down cleanly at ${runtime.stoppedAt}.`);
    } else if (runtime.pid !== null && runtime.processAlive === false) {
      lines.push(`  pid ${runtime.pid} is gone — the connector is not running (it was killed or crashed).`);
    } else if (runtime.pid !== null && runtime.processAlive === true) {
      lines.push(`  running as pid ${runtime.pid}.`);
    } else if (runtime.pid !== null) {
      lines.push(`  recorded by pid ${runtime.pid}; this host cannot tell whether it is still running.`);
    }
  }
  return lines.join("\n");
}

/* ------------------------------------------------------------------ */
/* Shared helpers                                                      */
/* ------------------------------------------------------------------ */

function nowIso(host: CliHost): string {
  return new Date(host.clock.now()).toISOString();
}

function detectionContext(host: CliHost, config: ConnectorConfig, signal: AbortSignal): CapabilityContext {
  return {
    config,
    endpoints: resolveEndpoints(),
    transport: host.transport,
    spawner: host.spawner,
    fs: host.fs,
    clock: host.clock,
    log: () => {},
    signal,
  };
}

/** One bounded, read-only probe. The capability contract says detect never throws; belt and braces anyway. */
async function detectOnce(
  host: CliHost,
  config: ConnectorConfig,
  capability: ConnectorCapability,
): Promise<CapabilityDetection> {
  const controller = new AbortController();
  try {
    return await capability.detect(detectionContext(host, config, controller.signal));
  } catch (error) {
    return {
      available: false,
      detail: `Detection failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

async function loadConfigOrExplain(
  host: CliHost,
): Promise<{ config: ConnectorConfig; adopted: boolean } | null> {
  const result = await loadOrAdoptConnectorConfig(host.fs, host.home, () => host.clock.now());
  if (result) return result;
  host.io.err("Not paired yet — run `vantage-connector --setup` to pair this machine.");
  host.io.err(`(config: ${connectorConfigPath(host.home)})`);
  return null;
}

/* ------------------------------------------------------------------ */
/* Commands                                                            */
/* ------------------------------------------------------------------ */

export async function buildStatusSnapshot(host: CliHost): Promise<CliStatusSnapshot> {
  // Status is READ-ONLY: it never adopts (which would write connector.json), it only
  // reports that an adoptable bridge pairing is sitting there.
  const config = await loadConnectorConfig(host.fs, host.home);
  const legacyBridgeAvailable =
    config === null && (await fileExists(host.fs, legacyBridgeConfigPath(host.home)));
  const capabilities = host.createCapabilities();
  const runtime = await readRuntimeState(host.fs, host.home);
  const lastRun = new Map(runtime?.capabilities.map((entry) => [entry.id, entry]) ?? []);

  const entries: CliCapabilityStatus[] = [];
  for (const id of CAPABILITY_IDS) {
    const capability = capabilities.find((candidate) => candidate.id === id);
    const enabled = config ? isCapabilityEnabled(config, id) : false;
    const recorded = lastRun.get(id) ?? null;
    let detection: { available: boolean; detail: string } | null = null;
    let detectionSource: CliCapabilityStatus["detectionSource"] = "none";
    if (config && enabled && capability) {
      // Probing is read-only (CLI version checks, loopback/LAN GETs, directory stats), so
      // it is safe to run alongside a live supervisor.
      const probed = await detectOnce(host, config, capability);
      detection = { available: probed.available, detail: probed.detail };
      detectionSource = "probe";
    } else if (recorded?.detection) {
      detection = recorded.detection;
      detectionSource = "last-run";
    }
    entries.push({
      id,
      label: capability?.label ?? recorded?.label ?? id,
      enabled,
      detection,
      detectionSource,
      lastRunState: recorded?.state ?? null,
    });
  }

  const pid = runtime?.pid ?? null;
  const processAlive =
    pid === null || !host.isProcessAlive ? null : Boolean(host.isProcessAlive(pid));

  return {
    connectorVersion: CONNECTOR_VERSION,
    generatedAt: nowIso(host),
    configPath: connectorConfigPath(host.home),
    machineName: config?.machineName ?? host.machineName,
    paired: config !== null,
    baseUrl: config?.baseUrl ?? null,
    orgId: config?.orgId ?? null,
    deviceId: config?.deviceId ?? null,
    adoptedFrom: config?.adopted?.from ?? null,
    legacyBridgeAvailable,
    capabilities: entries,
    runtime: runtime
      ? {
          pid,
          processAlive,
          startedAt: runtime.startedAt,
          lastHeartbeatAt: runtime.lastHeartbeatAt,
          lastHeartbeatOk: runtime.lastHeartbeatOk,
          lastHeartbeatDetail: runtime.lastHeartbeatDetail,
          stoppedAt: runtime.stoppedAt,
        }
      : null,
  };
}

async function runStatus(host: CliHost, json: boolean): Promise<number> {
  const snapshot = await buildStatusSnapshot(host);
  // The device token is deliberately absent from the snapshot: --status output gets pasted
  // into chat threads and issue reports.
  host.io.out(json ? JSON.stringify(snapshot, null, 2) : formatStatusText(snapshot));
  return 0;
}

async function runSetup(host: CliHost, requestedBaseUrl: string | null, force: boolean): Promise<number> {
  const existing = await loadOrAdoptConnectorConfig(host.fs, host.home, () => host.clock.now());
  if (existing?.adopted) {
    // The whole point of adoption: a member already running the standalone AI bridge is
    // NOT sent through pairing again — their device token carries over untouched.
    host.io.out(
      `Adopted the AI bridge pairing already on this machine (${existing.config.machineName} → ${existing.config.baseUrl}).`,
    );
    host.io.out(`Config written to ${connectorConfigPath(host.home)} with ai-bridge enabled; ai-bridge.json is left in place.`);
    host.io.out("Add more capabilities with `vantage-connector --enable <capability>`, then run `vantage-connector`.");
    return 0;
  }
  if (existing && !force) {
    host.io.out(`Already paired with ${existing.config.baseUrl} as "${existing.config.machineName}".`);
    host.io.out("Run `vantage-connector --status` to see it, or `vantage-connector --setup --force` to pair again.");
    return 0;
  }

  const baseUrl = requestedBaseUrl ?? existing?.config.baseUrl ?? defaultBaseUrl(host.env);
  const machineName = existing?.config.machineName ?? host.machineName;
  const flow = new PairingFlow({
    transport: host.transport,
    clock: host.clock,
    baseUrl,
    machineName,
    endpoints: resolveEndpoints(),
    requestedCapabilities: existing ? enabledCapabilities(existing.config) : [],
  });

  host.io.out(`Pairing "${machineName}" with ${baseUrl}…`);
  const started = await flow.start();
  if (started.phase === "failed") {
    host.io.err(started.detail);
    return 1;
  }
  if (started.phase === "waiting_approval") {
    host.io.out("");
    host.io.out(`  Pairing code:  ${started.userCode}`);
    host.io.out(`  Approve at:    ${started.verificationUri}`);
    host.io.out("");
    host.io.out("Waiting for an owner or admin to approve (10 minute window)…");
  }
  const final = await flow.waitForApproval();
  if (final.phase !== "approved") {
    host.io.err(final.phase === "failed" ? final.detail : "Pairing did not complete.");
    return 1;
  }

  // Re-pairing keeps the capability choices and per-capability settings already made on
  // this machine; only the device identity is replaced.
  const config: ConnectorConfig = {
    ...configFromPairing(final.result, {
      baseUrl,
      machineName,
      capabilities: existing?.config.capabilities,
    }),
    ...(existing?.config.localModels ? { localModels: existing.config.localModels } : {}),
    ...(existing?.config.agentSync ? { agentSync: existing.config.agentSync } : {}),
    ...(existing?.config.storage ? { storage: existing.config.storage } : {}),
    ...(existing?.config.cadRelay ? { cadRelay: existing.config.cadRelay } : {}),
  };
  await saveConnectorConfig(host.fs, host.home, config);
  host.io.out(`Paired. Config saved to ${connectorConfigPath(host.home)} (owner-only, mode 0600).`);
  const enabled = enabledCapabilities(config);
  if (enabled.length === 0) {
    host.io.out("Nothing is enabled yet — choose what this machine should do:");
    for (const capability of host.createCapabilities()) {
      host.io.out(`  vantage-connector --enable ${pad(capability.id, 14)}${capability.label}`);
    }
  } else {
    host.io.out(`Enabled capabilities kept: ${enabled.join(", ")}.`);
  }
  host.io.out("Then start it with: vantage-connector");
  return 0;
}

async function runToggle(host: CliHost, id: CapabilityId, enabled: boolean): Promise<number> {
  const loaded = await loadConfigOrExplain(host);
  if (!loaded) return 1;
  const capability = host.createCapabilities().find((candidate) => candidate.id === id);
  const label = capability?.label ?? id;

  if (isCapabilityEnabled(loaded.config, id) === enabled) {
    host.io.out(`${id} (${label}) is already ${enabled ? "enabled" : "disabled"}.`);
    return 0;
  }
  const next = setCapabilityEnabled(loaded.config, id, enabled);
  await saveConnectorConfig(host.fs, host.home, next);
  host.io.out(`${enabled ? "Enabled" : "Disabled"} ${id} (${label}). Saved to ${connectorConfigPath(host.home)}.`);

  if (enabled && capability) {
    // Tell the mentor immediately whether this machine can actually do the thing, rather
    // than letting them discover it in the log an hour later.
    const detection = await detectOnce(host, next, capability);
    host.io.out(`  ${detection.available ? "ready" : "setup required"} — ${detection.detail}`);
  }
  host.io.out("A running connector picks this up when it next starts — restart it if it is running.");
  return 0;
}

async function runMcp(host: CliHost): Promise<number> {
  const stdio = host.stdio;
  if (!stdio) {
    host.io.err("This host did not provide stdio streams, so the MCP server cannot run here.");
    return 1;
  }
  // Editors launch this on demand; there is no supervisor in this process, so the status
  // tool answers from the same snapshot `--status --json` prints, refreshed per call.
  const registry = connectorStatusToolRegistry(() => buildStatusSnapshot(host));
  runConnectorMcp(registry, stdio);
  await new Promise<void>((resolve) => {
    const unregister = host.onShutdown(() => {
      unregister();
      resolve();
    });
  });
  return 0;
}

async function runSupervisor(host: CliHost): Promise<number> {
  const loaded = await loadConfigOrExplain(host);
  if (!loaded) return 1;
  const { config, adopted } = loaded;
  if (adopted) {
    host.io.out(
      `Adopted the AI bridge pairing on this machine — ai-bridge is enabled and ${connectorConfigPath(host.home)} now owns the pairing.`,
    );
  }

  const enabled = enabledCapabilities(config);
  if (enabled.length === 0) {
    // Still worth running: the heartbeat is how the team sees this machine is alive. But
    // say plainly that it will do no work.
    host.io.out("No capabilities are enabled — this connector will only heartbeat.");
    host.io.out(`Enable one with \`vantage-connector --enable <capability>\` (${CAPABILITY_IDS.join(", ")}).`);
  }

  const supervisor = new ConnectorSupervisor({
    config,
    capabilities: host.createCapabilities(),
    transport: host.transport,
    clock: host.clock,
    spawner: host.spawner,
    fs: host.fs,
    log: (message) => host.io.out(message),
    ...(host.supervisor?.heartbeatIntervalMs !== undefined
      ? { heartbeatIntervalMs: host.supervisor.heartbeatIntervalMs }
      : {}),
    ...(host.supervisor?.detectRetryMs !== undefined ? { detectRetryMs: host.supervisor.detectRetryMs } : {}),
    ...(host.supervisor?.restartBackoffMs !== undefined
      ? { restartBackoffMs: host.supervisor.restartBackoffMs }
      : {}),
    onEvent: (event) => onEvent(event),
  });

  const state: ConnectorRuntimeState = {
    version: 1,
    pid: host.pid ?? null,
    startedAt: nowIso(host),
    lastHeartbeatAt: null,
    lastHeartbeatOk: null,
    lastHeartbeatDetail: null,
    stoppedAt: null,
    capabilities: [],
  };

  // Serialize state writes so overlapping events cannot interleave partial files.
  let writeChain: Promise<void> = Promise.resolve();
  const persist = (): Promise<void> => {
    state.capabilities = snapshotFromStatus(supervisor.status());
    writeChain = writeChain.then(() => writeRuntimeState(host.fs, host.home, { ...state }).catch(() => {}));
    return writeChain;
  };

  let settle: ((code: number) => void) | null = null;
  const finished = new Promise<number>((resolve) => {
    settle = resolve;
  });
  const stop = (code: number, reason: string) => {
    if (settle === null) return;
    const resolve = settle;
    settle = null;
    host.io.out(reason);
    resolve(code);
  };

  function onEvent(event: SupervisorEvent): void {
    switch (event.type) {
      case "capability-state":
        host.io.out(`${event.id}: ${event.state} — ${event.detail}`);
        void persist();
        break;
      case "heartbeat-ok":
        state.lastHeartbeatAt = nowIso(host);
        state.lastHeartbeatOk = true;
        state.lastHeartbeatDetail = null;
        void persist();
        break;
      case "heartbeat-failed":
        state.lastHeartbeatAt = nowIso(host);
        state.lastHeartbeatOk = false;
        state.lastHeartbeatDetail = event.detail;
        host.io.err(`Heartbeat failed (will retry): ${event.detail}`);
        void persist();
        break;
      case "auth-revoked":
        host.io.err(event.detail);
        // Not a crash to retry: only a human re-pairing can fix a revoked token.
        stop(1, "Stopping: this device must be paired again (`vantage-connector --setup --force`).");
        break;
      case "stopped":
        break;
    }
  }

  const unregister = host.onShutdown((reason) => stop(0, `${reason} — stopping capabilities…`));
  supervisor.start();
  await persist();
  host.io.out(`Vantage connector running as "${config.machineName}". Ctrl+C to stop.`);

  const code = await finished;
  await supervisor.stop();
  unregister();
  state.stoppedAt = nowIso(host);
  await persist();
  host.io.out("Connector stopped.");
  return code;
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

/** Runs one CLI invocation and resolves with the process exit code. Never throws. */
export async function runCli(host: CliHost): Promise<number> {
  const command = parseCliArgs(host.argv);
  try {
    switch (command.kind) {
      case "help":
        host.io.out(helpText(connectorConfigPath(host.home)));
        return 0;
      case "version":
        host.io.out(CONNECTOR_VERSION);
        return 0;
      case "usage-error":
        host.io.err(command.message);
        return 1;
      case "status":
        return await runStatus(host, command.json);
      case "setup":
        return await runSetup(host, command.baseUrl, command.force);
      case "toggle":
        return await runToggle(host, command.id, command.enabled);
      case "mcp":
        return await runMcp(host);
      case "run":
        return await runSupervisor(host);
    }
  } catch (error) {
    host.io.err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
