import { homedir, platform as osPlatform, release, arch } from "node:os";
import { join } from "node:path";
import { assertFusionRelayParity, FUSION_RELAY_PROTOCOL_VERSION } from "@vantage/cad";
import { credentialStorageStatus, loadDeviceCredential } from "./secure-store";
import {
  DEFAULT_FUSION_PLUGIN_ENDPOINT,
  detectFusionPrerequisites,
  probeFusionPluginHealth,
} from "./platform";
import { readCadSyncStatus } from "./sync";

/** A queued event older than this means the CLI has been unable to reach Vantage. */
export const SYNC_STALE_WARN_MS = 24 * 60 * 60 * 1000;

/**
 * Team-sync freshness for the doctor. Pure so it can be tested without touching
 * disk: `queued` is the CLI's unsent backlog, `lastSyncedAt` the last successful post.
 */
export function syncFreshnessCheck(
  input: { queued: number; lastSyncedAt: string | null },
  paired: boolean,
  now = Date.now(),
): DoctorCheck {
  if (!paired) {
    return {
      id: "sync-age",
      title: "Team sync freshness",
      status: "skip",
      detail: "Not paired, so nothing syncs to the team /cad page. Fix: `vantage-cad setup`.",
    };
  }
  if (!input.lastSyncedAt) {
    return {
      id: "sync-age",
      title: "Team sync freshness",
      status: input.queued > 0 ? "warn" : "skip",
      detail:
        input.queued > 0
          ? `${input.queued} CAD event${input.queued === 1 ? "" : "s"} queued and never delivered. Fix: run any CAD tool again (e.g. \`vantage-cad onshape docs\`) to flush the queue, or \`vantage-cad setup\` if pairing was revoked.`
          : "No CAD tools have run on this machine yet — nothing to sync. Run `vantage-cad claude` to start.",
    };
  }
  const ageMs = now - Date.parse(input.lastSyncedAt);
  if (!Number.isFinite(ageMs)) {
    return {
      id: "sync-age",
      title: "Team sync freshness",
      status: "warn",
      detail: `Sync state has an unreadable timestamp (${input.lastSyncedAt}). Fix: \`vantage-cad logout\` then \`vantage-cad setup\`.`,
    };
  }
  const hours = Math.max(0, Math.round(ageMs / 3_600_000));
  const stale = ageMs > SYNC_STALE_WARN_MS;
  return {
    id: "sync-age",
    title: "Team sync freshness",
    status: input.queued > 0 || stale ? "warn" : "pass",
    detail:
      input.queued > 0
        ? `${input.queued} event${input.queued === 1 ? "" : "s"} still queued; last delivered ${hours}h ago. Fix: run a CAD tool again to flush, or \`vantage-cad doctor\` after reconnecting.`
        : stale
          ? `Last synced ${hours}h ago — the team /cad page may be behind. Fix: run \`vantage-cad claude\` to refresh, or \`vantage-cad setup\` if pairing expired.`
          : `Last synced ${hours}h ago, queue empty.`,
  };
}

export type DoctorStatus = "pass" | "warn" | "fail" | "skip";

export type DoctorCheck = {
  id: string;
  title: string;
  status: DoctorStatus;
  detail: string;
};

export type DoctorReport = {
  ok: boolean;
  version: string;
  vantageUrl: string;
  host: {
    platform: string;
    release: string;
    arch: string;
    node: string;
  };
  osMatrix: {
    cli: true;
    fusionAddin: boolean;
    fusionAutodesk: boolean;
    onshapeHosted: true;
    note: string;
  };
  checks: DoctorCheck[];
  summary: { pass: number; warn: number; fail: number; skip: number };
};

const MIN_NODE_MAJOR = 22;

export function osCapabilityMatrix(platform: string = String(osPlatform())) {
  if (platform === "linux") {
    return {
      cli: true as const,
      fusionAddin: false,
      fusionAutodesk: false,
      onshapeHosted: true as const,
      note: "Autodesk Fusion 360 is not available on Linux. Use Onshape hosted or VANTAGE_CAD_MOCK=1.",
    };
  }
  return {
    cli: true as const,
    fusionAddin: true,
    fusionAutodesk: true,
    onshapeHosted: true as const,
    note: "Fusion local relay + Onshape hosted are supported on this OS.",
  };
}

async function probeUrl(
  url: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status?: number; error?: string; body?: unknown }> {
  try {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(8_000) });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      /* keep text */
    }
    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "request failed" };
  }
}

export function onshapeEnvChecks(env: NodeJS.ProcessEnv = process.env): DoctorCheck[] {
  const id = Boolean(env.ONSHAPE_OAUTH_CLIENT_ID?.trim());
  const secret = Boolean(env.ONSHAPE_OAUTH_CLIENT_SECRET?.trim());
  if (id && secret) {
    return [
      {
        id: "onshape-env",
        title: "Onshape OAuth env (local)",
        status: "pass",
        detail: "ONSHAPE_OAUTH_CLIENT_ID and ONSHAPE_OAUTH_CLIENT_SECRET are set in this process environment.",
      },
    ];
  }
  if (id || secret) {
    return [
      {
        id: "onshape-env",
        title: "Onshape OAuth env (local)",
        status: "fail",
        detail:
          "Only one of ONSHAPE_OAUTH_CLIENT_ID / ONSHAPE_OAUTH_CLIENT_SECRET is set — both are required for a local Vantage server. Fix: set both in the Vantage server's .env, then restart it.",
      },
    ];
  }
  return [
    {
      id: "onshape-env",
      title: "Onshape OAuth env (local)",
      status: "warn",
      detail:
        "Local ONSHAPE_OAUTH_* not set. Production Onshape is configured on the Vantage host (Vercel). Desktop users authorize via /cad/connections — expected on member machines.",
    },
  ];
}

export function onshapeCliKeyChecks(env: NodeJS.ProcessEnv = process.env): DoctorCheck[] {
  const access = (env.ONSHAPE_ACCESS_KEY ?? env.ONSHAPE_API_KEY ?? "").trim();
  const secret = (env.ONSHAPE_SECRET_KEY ?? env.ONSHAPE_API_SECRET ?? "").trim();
  if (access && secret) {
    return [
      {
        id: "onshape-api-keys",
        title: "Onshape API keys (Claude Code / CLI)",
        status: "pass",
        detail: "ONSHAPE_ACCESS_KEY and ONSHAPE_SECRET_KEY are set for terminal CAD.",
      },
    ];
  }
  if (access || secret) {
    return [
      {
        id: "onshape-api-keys",
        title: "Onshape API keys (Claude Code / CLI)",
        status: "fail",
        detail:
          "Only one of ONSHAPE_ACCESS_KEY / ONSHAPE_SECRET_KEY is set. Both are required. Fix (PowerShell): $env:ONSHAPE_ACCESS_KEY=\"…\"; $env:ONSHAPE_SECRET_KEY=\"…\" — get the pair at https://dev-portal.onshape.com/keys.",
      },
    ];
  }
  return [
    {
      id: "onshape-api-keys",
      title: "Onshape API keys (Claude Code / CLI)",
      status: "warn",
      detail:
        "No API keys in this terminal. Create a pair at https://dev-portal.onshape.com/keys then run `vantage-cad claude`. Web OAuth is separate.",
    },
  ];
}

export async function runDoctor(input: {
  version: string;
  vantageUrl: string;
  env?: NodeJS.ProcessEnv;
  platform?: string;
}): Promise<DoctorReport> {
  const env = input.env ?? process.env;
  const platform = String(input.platform ?? osPlatform());
  const base = input.vantageUrl.replace(/\/$/, "");
  const checks: DoctorCheck[] = [];
  const osMatrix = osCapabilityMatrix(platform);

  const nodeMajor = Number(process.versions.node.split(".")[0] ?? 0);
  checks.push({
    id: "node",
    title: "Node.js runtime",
    status: nodeMajor >= MIN_NODE_MAJOR ? "pass" : "fail",
    detail:
      nodeMajor >= MIN_NODE_MAJOR
        ? `Node ${process.versions.node} (requires >=${MIN_NODE_MAJOR})`
        : `Node ${process.versions.node} is below required >=${MIN_NODE_MAJOR}. Fix: install Node ${MIN_NODE_MAJOR} LTS from https://nodejs.org, then re-run \`vantage-cad doctor\`.`,
  });

  checks.push({
    id: "os-matrix",
    title: "OS capability matrix",
    status: osMatrix.fusionAutodesk ? "pass" : "warn",
    detail: `${platform}: CLI=${osMatrix.cli}, Fusion=${osMatrix.fusionAutodesk}, Onshape=${osMatrix.onshapeHosted}. ${osMatrix.note}`,
  });

  checks.push({
    id: "credential-storage",
    title: "Credential storage",
    status: "pass",
    detail: credentialStorageStatus(),
  });

  const credential = await loadDeviceCredential();
  checks.push({
    id: "paired",
    title: "Device pairing",
    status: credential ? "pass" : "warn",
    detail: credential
      ? `Paired device ${credential.deviceId} (platform=${credential.platform}, org=${credential.orgId})`
      : "Not paired. Run `vantage-cad setup`.",
  });

  // Lightweight GET — never call pair/start (that would mint pairing sessions).
  const vantageProbe = await probeUrl(`${base}/`);
  if (vantageProbe.ok || (vantageProbe.status !== undefined && vantageProbe.status < 500)) {
    checks.push({
      id: "vantage-url",
      title: "Vantage URL reachability",
      status: "pass",
      detail: `${base} responded HTTP ${vantageProbe.status ?? "ok"}`,
    });
  } else {
    checks.push({
      id: "vantage-url",
      title: "Vantage URL reachability",
      status: "fail",
      detail: vantageProbe.error
        ? `Cannot reach ${base}: ${vantageProbe.error}. Fix: set VANTAGE_URL to your Vantage host (PowerShell: $env:VANTAGE_URL="https://your-team.vantage.app"), then \`vantage-cad doctor\`.`
        : `${base} returned HTTP ${vantageProbe.status ?? "?"}. Fix: confirm VANTAGE_URL points at the Vantage web app, then \`vantage-cad doctor\`.`,
    });
  }

  const addinForCompat = (await detectFusionPrerequisites()).installed[0];
  const compatQs = new URLSearchParams({
    cliVersion: input.version,
    protocol: FUSION_RELAY_PROTOCOL_VERSION,
    platform,
  });
  if (addinForCompat?.version) compatQs.set("addinVersion", addinForCompat.version);
  const compatProbe = await probeUrl(`${base}/api/cad/compatibility?${compatQs.toString()}`);
  if (compatProbe.ok && compatProbe.body && typeof compatProbe.body === "object") {
    const body = compatProbe.body as {
      protocol?: { current?: string };
      check?: { compatible?: boolean; reasons?: string[] };
    };
    const compatible = body.check?.compatible === true;
    const reasons = Array.isArray(body.check?.reasons) ? body.check!.reasons! : [];
    checks.push({
      id: "relay-protocol",
      title: "Relay protocol compatibility",
      status: compatible ? "pass" : "fail",
      detail: compatible
        ? `Server protocol ${body.protocol?.current ?? "?"} matches CLI ${input.version}`
        : `Incompatible with server: ${reasons.join("; ") || "see /api/cad/compatibility"}. Fix: \`vantage-cad update\`.`,
    });
  } else {
    checks.push({
      id: "relay-protocol",
      title: "Relay protocol compatibility",
      status: vantageProbe.ok || (vantageProbe.status !== undefined && vantageProbe.status < 500) ? "warn" : "skip",
      detail: compatProbe.error
        ? `Compatibility API unreachable: ${compatProbe.error}. Fix: check VANTAGE_URL and your network, then \`vantage-cad doctor\`.`
        : `GET /api/cad/compatibility returned HTTP ${compatProbe.status ?? "?"}`,
    });
  }

  if (credential?.deviceToken) {
    const heartbeat = await probeUrl(`${base}/api/cad/relay/heartbeat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${credential.deviceToken}`,
      },
      body: JSON.stringify({ cliVersion: input.version }),
    });
    checks.push({
      id: "heartbeat",
      title: "Relay heartbeat",
      status: heartbeat.ok ? "pass" : "fail",
      detail: heartbeat.ok
        ? `Device heartbeat OK (serverTime=${String((heartbeat.body as Record<string, unknown>)?.serverTime ?? "ok")})`
        : `${heartbeat.error ?? `Heartbeat HTTP ${heartbeat.status ?? "?"}`}. Fix: this device’s pairing was revoked or expired — run \`vantage-cad logout\` then \`vantage-cad setup\`.`,
    });
  } else {
    checks.push({
      id: "heartbeat",
      title: "Relay heartbeat",
      status: "skip",
      detail: "Skipped until paired. Fix: `vantage-cad setup`.",
    });
  }

  checks.push(...onshapeEnvChecks(env));
  checks.push(...onshapeCliKeyChecks(env));

  const platformChoice = credential?.platform ?? "";
  if (platformChoice === "onshape") {
    checks.push({
      id: "onshape-path",
      title: "Onshape execution path",
      status: "pass",
      detail:
        "Paired for Onshape hosted jobs. Server executes CAD; keep Connections OAuth authorized in the browser.",
    });
  } else if (!platformChoice) {
    checks.push({
      id: "onshape-path",
      title: "Onshape execution path",
      status: "skip",
      detail: "Pair with platform=onshape to validate the hosted path from this CLI.",
    });
  }

  const fusion = await detectFusionPrerequisites();
  const endpoint =
    credential?.pluginEndpoint ?? env.VANTAGE_FUSION_PLUGIN_URL ?? DEFAULT_FUSION_PLUGIN_ENDPOINT;

  if (!fusion.supported) {
    checks.push({
      id: "fusion-prereq",
      title: "Fusion prerequisites",
      status: "skip",
      detail: fusion.linuxNote ?? "Fusion Autodesk app unsupported on this OS.",
    });
    const mockHealth =
      env.VANTAGE_CAD_MOCK === "1" ? await probeFusionPluginHealth(endpoint) : null;
    if (mockHealth?.reachable) {
      checks.push({
        id: "fusion-relay",
        title: "Fusion relay health (mock)",
        status: mockHealth.ok ? "pass" : "warn",
        detail: `${endpoint} — mock=${Boolean(mockHealth.mock)} protocol=${mockHealth.protocol ?? "?"}`,
      });
    } else {
      checks.push({
        id: "fusion-relay",
        title: "Fusion relay health",
        status: env.VANTAGE_CAD_MOCK === "1" ? "warn" : "skip",
        detail:
          env.VANTAGE_CAD_MOCK === "1"
            ? "VANTAGE_CAD_MOCK=1 set but mock plugin not reachable — run `vantage-cad start` then re-run doctor."
            : "Skipped on Linux. Optional: VANTAGE_CAD_MOCK=1 vantage-cad start for protocol tests.",
      });
    }
  } else {
    const addin = fusion.installed[0];
    checks.push({
      id: "fusion-prereq",
      title: "Fusion prerequisites",
      status: addin ? "pass" : fusion.existing.length ? "warn" : "warn",
      detail: addin
        ? `VantageCadRelay${addin.version ? ` v${addin.version}` : ""} at ${addin.path}`
        : fusion.existing.length
          ? `Fusion AddIns folder exists but VantageCadRelay is missing. Windows: scripts\\cad\\install-windows.ps1 (or install-fusion-addin.ps1); macOS: install-fusion-addin.sh`
          : `Fusion AddIns folder not found. Install Autodesk Fusion 360, then scripts/cad/install-windows.ps1 (Windows) or install-fusion-addin.sh (macOS). Expected: ${fusion.paths.join(", ") || "(none)"}`,
    });

    const health = await probeFusionPluginHealth(endpoint);
    const wantFusion = platformChoice === "fusion360" || !platformChoice;
    checks.push({
      id: "fusion-relay",
      title: "Fusion relay health",
      status: health.reachable && health.ok ? "pass" : wantFusion ? "fail" : "warn",
      detail: health.reachable
        ? `${endpoint} — ok=${health.ok} mock=${Boolean(health.mock)} protocol=${health.protocol ?? "?"} version=${health.addinVersion ?? "?"}`
        : `${endpoint} — unreachable (${health.error}). Fix: open Fusion → Utilities → Add-Ins → Scripts and Add-Ins → run VantageCadRelay, then re-run \`vantage-cad doctor\`. On Linux/CI: VANTAGE_CAD_MOCK=1 vantage-cad start.`,
    });

    // Version skew is the failure teams actually hit: the relay answers /health,
    // then refuses the fillet halfway through a build. Name it before that happens.
    if (health.reachable) {
      const parity = assertFusionRelayParity(health.operations);
      checks.push({
        id: "fusion-parity",
        title: "Fusion operation parity",
        status: parity.inSync ? "pass" : "warn",
        detail: parity.inSync
          ? `Add-in runs every operation this CLI expects (${health.operations?.length ?? 0} operations).`
          : `${parity.note} Fix: \`vantage-cad update\`, then restart VantageCadRelay in Fusion.`,
      });
    } else {
      checks.push({
        id: "fusion-parity",
        title: "Fusion operation parity",
        status: "skip",
        detail: "Skipped — the relay must be reachable first. Fix: run VantageCadRelay in Fusion.",
      });
    }
  }

  checks.push({
    id: "mock-mode",
    title: "Mock Fusion mode",
    status: env.VANTAGE_CAD_MOCK === "1" ? "pass" : "skip",
    detail:
      env.VANTAGE_CAD_MOCK === "1"
        ? "VANTAGE_CAD_MOCK=1 — in-process mock plugin starts with `vantage-cad start`."
        : "Optional for CI/Linux: export VANTAGE_CAD_MOCK=1",
  });

  checks.push(
    syncFreshnessCheck(await readCadSyncStatus().catch(() => ({ queued: 0, lastSyncedAt: null })), Boolean(credential)),
  );

  checks.push({
    id: "home-dir",
    title: "CLI state directory",
    status: "pass",
    detail: `Credentials/state path root: ${join(homedir(), ".vantage-cad")}`,
  });

  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 };
  for (const check of checks) summary[check.status] += 1;

  return {
    ok: summary.fail === 0,
    version: input.version,
    vantageUrl: base,
    host: {
      platform,
      release: release(),
      arch: arch(),
      node: process.versions.node,
    },
    osMatrix,
    checks,
    summary,
  };
}

export function formatDoctorReport(report: DoctorReport, json: boolean): string {
  if (json) return JSON.stringify(report, null, 2);
  const lines = [
    `vantage-cad doctor ${report.version}`,
    `Vantage URL: ${report.vantageUrl}`,
    `Host: ${report.host.platform}/${report.host.arch} · Node ${report.host.node}`,
    `OS matrix: Fusion=${report.osMatrix.fusionAutodesk ? "yes" : "no"} · Onshape=yes`,
    "",
  ];
  for (const check of report.checks) {
    const tag = check.status.toUpperCase().padEnd(4);
    lines.push(`[${tag}] ${check.title}: ${check.detail}`);
  }
  lines.push(
    "",
    `Summary: ${report.summary.pass} pass · ${report.summary.warn} warn · ${report.summary.fail} fail · ${report.summary.skip} skip`,
    report.ok ? "Doctor: OK" : "Doctor: FAILED — fix fail items above",
  );
  return lines.join("\n");
}

export function doctorExitCode(report: DoctorReport): number {
  return report.ok ? 0 : 1;
}
