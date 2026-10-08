import { describe, expect, it } from "vitest";
import { cadSenderIsTrusted, parseCadDesktopStart, parseCadDesktopTool } from "../src/cad-contract";

const orgId = "11111111-1111-4111-8111-111111111111";
const origin = "https://vantagefrc.vercel.app";

describe("desktop CAD renderer boundary", () => {
  it("admits only the top-level CAD pilot page on the configured app origin", () => {
    expect(cadSenderIsTrusted({ frameUrl: `${origin}/cad/browser-agent?orgId=${orgId}`, mainFrame: true, appOrigin: origin })).toBe(true);
    for (const [frameUrl, mainFrame] of [[`${origin}/cad/browser-agent`, false], [`${origin}/dashboard`, true], ["https://attacker.test/cad/browser-agent", true], ["https://cad.onshape.com/documents", true], ["file:///cad/browser-agent", true], [`${origin}/cad/browser-agent/anything`, true]] as const) {
      expect(cadSenderIsTrusted({ frameUrl, mainFrame, appOrigin: origin })).toBe(false);
    }
  });

  it("rejects executable, environment, profile and offsite navigation input", () => {
    expect(parseCadDesktopStart({ orgId })).toEqual({ orgId, url: "https://cad.onshape.com/documents" });
    for (const input of [{ orgId, command: "anything" }, { orgId, executable: "/bin/sh" }, { orgId, env: { NODE_OPTIONS: "bad" } }, { orgId, profile: "personal" }, { orgId, url: "https://attacker.test/documents" }, { orgId, url: "https://cad.onshape.com/api/v6/users/current" }]) {
      expect(() => parseCadDesktopStart(input)).toThrow();
    }
  });

  it("only admits the narrow UI tool envelope", () => {
    expect(parseCadDesktopTool({ name: "observe" })).toEqual({ name: "observe" });
    expect(() => parseCadDesktopTool({ name: "shell", arguments: {} })).toThrow();
    expect(() => parseCadDesktopTool({ name: "action", arguments: [], executable: "bad" })).toThrow();
    expect(() => parseCadDesktopTool({ name: "action", arguments: { text: "a".repeat(65_537) } })).toThrow();
  });
});
