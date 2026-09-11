import { describe, expect, it } from "vitest";
import { buildRelatedLinks } from "./build-related";

describe("build-related Soft-UI helpers", () => {
  it("builds hub cross-links and excludes the active surface", () => {
    const links = buildRelatedLinks("org-1", { active: "cad" });
    expect(links.every((l) => l.id !== "cad")).toBe(true);
    expect(links.find((l) => l.id === "kickoff")?.href).toBe("/build?tab=kickoff&orgId=org-1");
    expect(links.find((l) => l.id === "prototype")?.href).toContain("tab=prototype");
    expect(links.find((l) => l.id === "competition")?.href).toBe("/competition?orgId=org-1");
    expect(links.find((l) => l.id === "ai")?.href).toBe("/ai?orgId=org-1");
  });

  it("limits related links when include is set", () => {
    const links = buildRelatedLinks("org-1", { include: ["fmea", "competition"] });
    expect(links.map((l) => l.id)).toEqual(["fmea", "competition"]);
  });

  it("never uses DEMO labels", () => {
    const links = buildRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });

  it("calls the Robot workbench Robot, not FMEA", () => {
    expect(buildRelatedLinks("org-1").find((link) => link.id === "fmea")?.label).toBe("Robot");
  });
});
