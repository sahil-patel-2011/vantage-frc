import { describe, expect, it } from "vitest";
import { aiConnectionHref } from "./connection";
import { hubById } from "../nav/hubs";

describe("AI connection discovery", () => {
  it("preserves and encodes team context", () => {
    expect(aiConnectionHref(null)).toBe("/ai/connect");
    expect(aiConnectionHref("team & 1")).toBe("/ai/connect?orgId=team%20%26%201");
  });
  it("keeps the entry in the AI workspace registry", () => {
    expect(hubById("ai").tabs.find(tab => tab.id === "connections")?.legacyHref).toBe("/ai/connect");
  });
});
