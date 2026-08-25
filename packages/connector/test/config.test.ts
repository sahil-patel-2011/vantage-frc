import { describe, expect, it } from "vitest";
import {
  adoptLegacyBridgeConfig,
  connectorConfigPath,
  enabledCapabilities,
  isCapabilityEnabled,
  legacyBridgeConfigPath,
  loadConnectorConfig,
  loadOrAdoptConnectorConfig,
  parseConnectorConfig,
  saveConnectorConfig,
  setCapabilityEnabled,
  type ConnectorConfig,
} from "../src/config.js";
import { MemoryFileSystem } from "./helpers.js";

const HOME = "/home/frc";

const paired: ConnectorConfig = {
  version: 1,
  baseUrl: "https://vantage-frc-web.vercel.app",
  machineName: "shop-pc",
  deviceToken: "tok_plaintext",
  deviceId: "dev-1",
  orgId: "org-1",
  capabilities: { "ai-bridge": true, "local-models": true },
};

describe("connector config save/load", () => {
  it("round-trips through the filesystem with mode 0600", async () => {
    const fs = new MemoryFileSystem();
    await saveConnectorConfig(fs, HOME, paired);
    expect(fs.modes.get(connectorConfigPath(HOME))).toBe(0o600);
    const loaded = await loadConnectorConfig(fs, HOME);
    expect(loaded).toEqual(paired);
  });

  it("returns null when the file is absent, invalid JSON, or missing the device token", async () => {
    const fs = new MemoryFileSystem();
    expect(await loadConnectorConfig(fs, HOME)).toBeNull();
    await fs.writeFile(connectorConfigPath(HOME), "{not json");
    expect(await loadConnectorConfig(fs, HOME)).toBeNull();
    await fs.writeFile(connectorConfigPath(HOME), JSON.stringify({ baseUrl: "https://x" }));
    expect(await loadConnectorConfig(fs, HOME)).toBeNull();
  });

  it("drops unknown capability ids and non-boolean toggles instead of trusting them", () => {
    const parsed = parseConnectorConfig({
      baseUrl: "https://x",
      deviceToken: "t",
      capabilities: { "ai-bridge": true, mystery: true, mcp: "yes" },
    });
    expect(parsed?.capabilities).toEqual({ "ai-bridge": true });
  });

  it("preserves optional capability settings sections", () => {
    const parsed = parseConnectorConfig({
      baseUrl: "https://x",
      deviceToken: "t",
      localModels: { extraBaseUrls: ["http://192.168.1.20:8000/v1", 42] },
      agentSync: { dirs: ["C:/robot-code"], agent: "all" },
      storage: { dir: "/data", port: 8788, quotaBytes: 5_000_000, accessKeyHash: "ab".repeat(32) },
      cadRelay: { pluginEndpoint: "http://127.0.0.1:32145" },
    });
    expect(parsed?.localModels?.extraBaseUrls).toEqual(["http://192.168.1.20:8000/v1"]);
    expect(parsed?.agentSync).toEqual({ dirs: ["C:/robot-code"], agent: "all" });
    expect(parsed?.storage?.port).toBe(8788);
    expect(parsed?.cadRelay?.pluginEndpoint).toBe("http://127.0.0.1:32145");
  });
});

describe("capability toggles", () => {
  it("treats absent ids as disabled and toggles immutably", () => {
    expect(isCapabilityEnabled(paired, "mcp")).toBe(false);
    expect(enabledCapabilities(paired)).toEqual(["ai-bridge", "local-models"]);
    const next = setCapabilityEnabled(paired, "mcp", true);
    expect(isCapabilityEnabled(next, "mcp")).toBe(true);
    expect(isCapabilityEnabled(paired, "mcp")).toBe(false); // original untouched
    const off = setCapabilityEnabled(next, "ai-bridge", false);
    expect(enabledCapabilities(off)).toEqual(["local-models", "mcp"]);
  });
});

describe("legacy ai-bridge.json adoption", () => {
  /** Exact shape bridge.mjs saveConfig writes: {...{baseUrl,machineName}, deviceToken, deviceId, orgId}. */
  const legacy = {
    baseUrl: "https://vantage-frc-web.vercel.app",
    machineName: "mentor-desktop",
    deviceToken: "bridge_token_123",
    deviceId: "bridge-dev-9",
    orgId: "org-77",
  };

  it("adopts the bridge pairing verbatim with only ai-bridge enabled", () => {
    const adopted = adoptLegacyBridgeConfig(legacy, "2026-08-24T00:00:00.000Z");
    expect(adopted).not.toBeNull();
    expect(adopted?.baseUrl).toBe(legacy.baseUrl);
    expect(adopted?.machineName).toBe(legacy.machineName);
    expect(adopted?.deviceToken).toBe(legacy.deviceToken);
    expect(adopted?.deviceId).toBe(legacy.deviceId);
    expect(adopted?.orgId).toBe(legacy.orgId);
    expect(adopted?.capabilities).toEqual({ "ai-bridge": true });
    expect(adopted?.adopted).toEqual({ from: "ai-bridge", at: "2026-08-24T00:00:00.000Z" });
  });

  it("refuses to adopt a bridge config without a device token (never a phantom pairing)", () => {
    expect(adoptLegacyBridgeConfig({ baseUrl: "https://x", machineName: "m" }, "now")).toBeNull();
    expect(adoptLegacyBridgeConfig("nonsense", "now")).toBeNull();
    expect(adoptLegacyBridgeConfig(null, "now")).toBeNull();
  });

  it("loadOrAdopt migrates once, persists connector.json, and leaves ai-bridge.json untouched", async () => {
    const fs = new MemoryFileSystem();
    const legacyJson = JSON.stringify(legacy, null, 2);
    await fs.writeFile(legacyBridgeConfigPath(HOME), legacyJson);

    const first = await loadOrAdoptConnectorConfig(fs, HOME, () => 1_756_000_000_000);
    expect(first?.adopted).toBe(true);
    expect(first?.config.deviceToken).toBe("bridge_token_123");
    // The migration wrote connector.json with restrictive mode…
    expect(fs.files.has(connectorConfigPath(HOME))).toBe(true);
    expect(fs.modes.get(connectorConfigPath(HOME))).toBe(0o600);
    // …and the legacy file byte-for-byte intact (the standalone bridge keeps working).
    expect(fs.files.get(legacyBridgeConfigPath(HOME))).toBe(legacyJson);

    // Second load: connector.json wins; no re-adoption.
    const second = await loadOrAdoptConnectorConfig(fs, HOME);
    expect(second?.adopted).toBe(false);
    expect(second?.config).toEqual(first?.config);
  });

  it("prefers an existing connector.json over the legacy file", async () => {
    const fs = new MemoryFileSystem();
    await saveConnectorConfig(fs, HOME, paired);
    await fs.writeFile(legacyBridgeConfigPath(HOME), JSON.stringify(legacy));
    const result = await loadOrAdoptConnectorConfig(fs, HOME);
    expect(result?.adopted).toBe(false);
    expect(result?.config.deviceToken).toBe("tok_plaintext");
  });

  it("returns null when neither file exists (not paired — an honest state, not an error)", async () => {
    expect(await loadOrAdoptConnectorConfig(new MemoryFileSystem(), HOME)).toBeNull();
  });
});
