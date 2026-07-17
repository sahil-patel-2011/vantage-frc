/**
 * Versioned Fusion relay protocol + cross-platform compatibility matrix.
 * Consumed by GET /api/cad/compatibility (public) and vantage-cad diagnose.
 */
import {
  FUSION_RELAY_PROTOCOL_VERSION,
  FUSION_RELAY_SUPPORTED_PROTOCOLS,
  type FusionRelayProtocolVersion,
} from "./fusion-relay";
import { cadOsSupportMatrix, type CadOsSupport } from "./onshape";

export const VANTAGE_CAD_CLI_MIN_VERSION = "0.1.0";
export const VANTAGE_CAD_ADDIN_MIN_VERSION = "0.1.0";
export const VANTAGE_CAD_ADDIN_PROTOCOL = FUSION_RELAY_PROTOCOL_VERSION;

export type CadPlatformId = "windows" | "macos" | "linux" | "unknown";

export type RelayCompatibilityQuery = {
  /** Envelope / plugin protocol id (e.g. 2026-07-1). */
  protocol?: string | null;
  /** vantage-cad CLI semver. */
  cliVersion?: string | null;
  /** VantageCadRelay add-in semver. */
  addinVersion?: string | null;
  /** Host OS reported by CLI or browser. */
  platform?: string | null;
};

export type RelayCompatibilityResult = {
  compatible: boolean;
  currentProtocol: string;
  supportedProtocols: readonly string[];
  protocolOk: boolean;
  cliOk: boolean;
  addinOk: boolean;
  platformOk: boolean;
  platform: CadPlatformId;
  osSupport: CadOsSupport | null;
  reasons: string[];
  recommendations: string[];
};

function parseSemver(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** True when `version` >= `minimum` (semver major.minor.patch prefix). */
export function semverGte(version: string, minimum: string): boolean {
  const a = parseSemver(version);
  const b = parseSemver(minimum);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return true;
}

export function normalizeCadPlatform(platform?: string | null): CadPlatformId {
  const value = (platform ?? "").toLowerCase();
  if (value === "win32" || value === "windows" || value.startsWith("win")) return "windows";
  if (value === "darwin" || value === "macos" || value === "mac") return "macos";
  if (value === "linux") return "linux";
  return "unknown";
}

export function isSupportedRelayProtocol(protocol: string): protocol is FusionRelayProtocolVersion {
  return (FUSION_RELAY_SUPPORTED_PROTOCOLS as readonly string[]).includes(protocol);
}

export function checkRelayCompatibility(query: RelayCompatibilityQuery = {}): RelayCompatibilityResult {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  const platform = normalizeCadPlatform(query.platform);
  const osSupport = cadOsSupportMatrix().find((row) => row.os === platform) ?? null;

  const protocol = query.protocol?.trim() || FUSION_RELAY_PROTOCOL_VERSION;
  const protocolOk = isSupportedRelayProtocol(protocol);
  if (!protocolOk) {
    reasons.push(
      `Relay protocol '${protocol}' is not supported (current: ${FUSION_RELAY_PROTOCOL_VERSION}).`,
    );
    recommendations.push("Update vantage-cad CLI and VantageCadRelay add-in from the repository release artifacts.");
  }

  let cliOk = true;
  if (query.cliVersion?.trim()) {
    cliOk = semverGte(query.cliVersion, VANTAGE_CAD_CLI_MIN_VERSION);
    if (!cliOk) {
      reasons.push(
        `CLI version ${query.cliVersion} is below minimum ${VANTAGE_CAD_CLI_MIN_VERSION}.`,
      );
      recommendations.push("Run scripts/cad/install-cli.sh (or .ps1) and rebuild @vantage/cad-cli.");
    }
  }

  let addinOk = true;
  if (query.addinVersion?.trim()) {
    addinOk = semverGte(query.addinVersion, VANTAGE_CAD_ADDIN_MIN_VERSION);
    if (!addinOk) {
      reasons.push(
        `Fusion add-in version ${query.addinVersion} is below minimum ${VANTAGE_CAD_ADDIN_MIN_VERSION}.`,
      );
      recommendations.push("Reinstall VantageCadRelay via scripts/cad/install-fusion-addin.*");
    }
  }

  let platformOk = true;
  if (platform === "linux" && query.addinVersion) {
    platformOk = false;
    reasons.push("Fusion 360 add-in is not available on Linux.");
    recommendations.push("Use Onshape hosted CAD, or VANTAGE_CAD_MOCK=1 for relay protocol tests.");
  } else if (platform === "unknown" && query.platform) {
    platformOk = false;
    reasons.push(`Unrecognized platform '${query.platform}'.`);
  }

  const compatible = protocolOk && cliOk && addinOk && platformOk;
  return {
    compatible,
    currentProtocol: FUSION_RELAY_PROTOCOL_VERSION,
    supportedProtocols: FUSION_RELAY_SUPPORTED_PROTOCOLS,
    protocolOk,
    cliOk,
    addinOk,
    platformOk,
    platform,
    osSupport,
    reasons,
    recommendations,
  };
}

export type CadCompatibilityMatrix = {
  generatedAt: string;
  protocol: {
    current: string;
    supported: readonly string[];
    addinProtocol: string;
    minCliVersion: string;
    minAddinVersion: string;
  };
  osSupport: CadOsSupport[];
  artifacts: {
    packageCommand: string;
    outputDir: string;
    installScripts: {
      windowsOneShot: string;
      windowsCli: string;
      unixCli: string;
      windowsFusion: string;
      macosFusion: string;
    };
  };
  endpoints: {
    compatibility: string;
    pairStart: string;
    pairPoll: string;
    relayHeartbeat: string;
    relayJobs: string;
  };
};

/** Full matrix payload for the public compatibility API and release MANIFEST. */
export function buildCadCompatibilityMatrix(now = new Date()): CadCompatibilityMatrix {
  return {
    generatedAt: now.toISOString(),
    protocol: {
      current: FUSION_RELAY_PROTOCOL_VERSION,
      supported: FUSION_RELAY_SUPPORTED_PROTOCOLS,
      addinProtocol: VANTAGE_CAD_ADDIN_PROTOCOL,
      minCliVersion: VANTAGE_CAD_CLI_MIN_VERSION,
      minAddinVersion: VANTAGE_CAD_ADDIN_MIN_VERSION,
    },
    osSupport: cadOsSupportMatrix(),
    artifacts: {
      packageCommand: "npm run cad:package",
      outputDir: "dist/cad-relay/",
      installScripts: {
        windowsOneShot: "scripts/cad/install-windows.ps1",
        windowsCli: "scripts/cad/install-cli.ps1",
        unixCli: "scripts/cad/install-cli.sh",
        windowsFusion: "scripts/cad/install-fusion-addin.ps1",
        macosFusion: "scripts/cad/install-fusion-addin.sh",
      },
    },
    endpoints: {
      compatibility: "/api/cad/compatibility",
      pairStart: "/api/cad/pair/start",
      pairPoll: "/api/cad/pair/poll",
      relayHeartbeat: "/api/cad/relay/heartbeat",
      relayJobs: "/api/cad/relay/jobs",
    },
  };
}
