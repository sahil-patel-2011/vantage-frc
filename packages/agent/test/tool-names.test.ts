import { describe, expect, it } from "vitest";
import { knownAiTools } from "@vantage/billing";
import { toolNames } from "../src/tools";

describe("governance tool allowlist", () => {
  it("is generated from the live tool registry (packages/billing/src/tool-names.ts)", () => {
    const registry = toolNames();
    const governance = [...knownAiTools()].sort();
    expect(governance).toEqual(registry);
    expect(registry.length).toBeGreaterThan(50);
    for (const name of [
      "strategy.private_edge",
      "fmea.open_risks",
      "cad.design_context",
      "cad.create_brief",
      "inventory.availability",
      "web.search",
    ]) {
      expect(registry).toContain(name);
    }
  });
});
