import { describe, expect, it } from "vitest";
import { logisticsRelatedLinks } from "./logistics-related";

describe("logistics-related Soft-UI helpers", () => {
  it("builds Event Day / My Day / calendar cross-links", () => {
    const links = logisticsRelatedLinks("org-1");
    expect(links.find((l) => l.id === "command")?.href).toBe("/competition?tab=command&orgId=org-1");
    expect(links.find((l) => l.id === "my-day")?.href).toBe("/competition?tab=my-day&orgId=org-1");
    expect(links.find((l) => l.id === "calendar")?.href).toContain("/team/calendar");
    expect(links.find((l) => l.id === "calendar")?.href).toContain("tab=trip");
    expect(links.find((l) => l.id === "calendar")?.href).toContain("orgId=org-1");
  });

  it("excludes the active surface and respects include", () => {
    const links = logisticsRelatedLinks("org-1", { active: "command", include: ["my-day", "calendar"] });
    expect(links.map((l) => l.id)).toEqual(["my-day", "calendar"]);
  });

  it("never uses DEMO labels", () => {
    const links = logisticsRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });
});
