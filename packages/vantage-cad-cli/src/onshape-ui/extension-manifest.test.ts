import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("browser-only extension release metadata", () => {
  it("launches the isolated entry without legacy commands, downloads or credential fields", () => {
    const manifest = JSON.parse(readFileSync(new URL("../../mcpb/manifest.json", import.meta.url), "utf8"));
    expect(manifest.manifest_version).toBe("0.3");
    expect(manifest.server).toEqual({
      type: "node", entry_point: "server/index.mjs",
      mcp_config: { command: "node", args: ["${__dirname}/server/index.mjs"] },
    });
    expect(manifest.user_config).toBeUndefined();
    expect(manifest.compatibility.runtimes.node).toBe(">=22");
    expect(manifest.privacy_policies.length).toBeGreaterThan(0);
  });
});
