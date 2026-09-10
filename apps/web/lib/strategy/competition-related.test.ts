import { describe, expect, it } from "vitest";
import {
  competitionRelatedLinks,
  pickSurfaceSetupMessage,
  strategyCoverageLinks,
  strategySetupNextActions,
} from "./competition-related";

describe("competition-related Soft-UI helpers", () => {
  it("builds hub cross-links and excludes the active surface", () => {
    const links = competitionRelatedLinks("org-1", { active: "strategy" });
    expect(links.every((l) => l.id !== "strategy")).toBe(true);
    expect(links.find((l) => l.id === "command")?.href).toBe(
      "/competition?tab=command&orgId=org-1",
    );
    expect(links.find((l) => l.id === "my-day")?.href).toContain("tab=my-day");
    expect(links.find((l) => l.id === "scouting")?.href).toBe(
      "/competition?tab=scouting&orgId=org-1",
    );
    expect(links.find((l) => l.id === "forms")?.href).toContain("tab=forms");
    expect(links.find((l) => l.id === "match-checklist")?.href).toContain("tab=match-checklist");
    expect(links.find((l) => l.id === "draft")?.href).toBe("/strategy/draft?orgId=org-1");
    expect(links.find((l) => l.id === "coverage")?.href).toBe("/scout-coverage-live?orgId=org-1");
  });

  it("limits related links when include is set", () => {
    const links = competitionRelatedLinks("org-1", {
      include: ["scouting", "pick-clock"],
    });
    expect(links.map((l) => l.id)).toEqual(["scouting", "pick-clock"]);
  });

  it("returns workspace-only next actions without inventing metrics", () => {
    const actions = strategySetupNextActions({});
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("workspace");
    expect(actions.every((a) => !/demo/i.test(a.label + a.detail))).toBe(true);
  });

  it("prioritizes event + TBA when missing, then scout depth paths", () => {
    const actions = strategySetupNextActions({
      orgId: "org-1",
      eventKey: null,
      tbaConfigured: false,
      hasMetrics: false,
    });
    expect(actions[0]?.id).toBe("event");
    expect(actions.some((a) => a.id === "tba")).toBe(true);
    expect(actions.some((a) => a.id === "scouting")).toBe(true);
    expect(actions.some((a) => a.id === "forms")).toBe(true);
    expect(actions.some((a) => a.id === "checklist")).toBe(true);
    expect(actions.some((a) => a.id === "coverage")).toBe(true);
    expect(actions.every((a) => !/\bdemo\b|illustrative/i.test(a.label + a.detail))).toBe(true);
  });

  it("emphasizes metrics sync when event is set but cache is empty", () => {
    const actions = strategySetupNextActions({
      orgId: "org-1",
      eventKey: "2026casj",
      tbaConfigured: true,
      hasMetrics: false,
    });
    const metrics = actions.find((a) => a.id === "metrics");
    expect(metrics?.primary).toBe(true);
    expect(metrics?.href).toContain("/team/data");
    expect(actions.find((a) => a.id === "coverage")?.href).toContain("eventKey=2026casj");
  });

  it("builds coverage explainability links without DEMO copy", () => {
    const links = strategyCoverageLinks("org-1", { eventKey: "2026ny" });
    expect(links.map((l) => l.id)).toEqual([
      "scouting",
      "forms",
      "match-checklist",
      "pick-clock",
      "chemistry",
      "draft",
      "coverage",
    ]);
    expect(links.find((l) => l.id === "coverage")?.href).toContain("eventKey=2026ny");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });

  it("writes honest pick-surface setup messages", () => {
    expect(pickSurfaceSetupMessage({})).toMatch(/Select a team/);
    expect(pickSurfaceSetupMessage({ orgId: "o" })).toMatch(/active event/i);
    expect(
      pickSurfaceSetupMessage({ orgId: "o", eventKey: "2026a", tbaConfigured: false, hasMetrics: false }),
    ).toMatch(/Connect The Blue Alliance/i);
    expect(
      pickSurfaceSetupMessage({ orgId: "o", eventKey: "2026a", tbaConfigured: true, hasMetrics: false }),
    ).toMatch(/Team → Data/i);
  });
});
