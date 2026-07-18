import { describe, expect, it } from "vitest";
import {
  DISPLAY_RELATED_INCLUDE,
  displayRelatedLinks,
  displaySetupNextActions,
  displaySetupStep,
} from "./display-related";

describe("display Soft-UI helpers", () => {
  it("builds Event Day / Strategy cross-links", () => {
    const links = displayRelatedLinks("org-1");
    expect(links.find((l) => l.id === "command")?.href).toBe("/competition?tab=command&orgId=org-1");
    expect(links.find((l) => l.id === "strategy")?.href).toBe("/competition?tab=strategy&orgId=org-1");
    expect(links.find((l) => l.id === "scouting")?.href).toBe("/competition?tab=scouting&orgId=org-1");
    expect(links.find((l) => l.id === "team-data")?.href).toContain("/team/data");
    expect(links.find((l) => l.id === "team-data")?.href).toContain("orgId=org-1");
  });

  it("respects include and never uses DEMO labels", () => {
    const links = displayRelatedLinks("org-1", { include: [...DISPLAY_RELATED_INCLUDE] });
    expect(links.map((l) => l.id)).toEqual(["command", "strategy", "scouting", "match-checklist"]);
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
  });

  it("requires workspace before next actions", () => {
    expect(displaySetupNextActions({ boardCount: 0 }).map((a) => a.id)).toEqual(["workspace"]);
  });

  it("asks for first board when empty — never DEMO metrics", () => {
    const actions = displaySetupNextActions({ orgId: "org-1", boardCount: 0, activeTokenCount: 0 });
    expect(actions[0]?.id).toBe("create-board");
    expect(actions[0]?.primary).toBe(true);
    expect(actions.map((a) => a.id)).toContain("command");
    expect(actions.map((a) => a.id)).toContain("strategy");
    expect(actions.every((a) => !/demo/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("prioritizes TV pairing after a board exists", () => {
    const actions = displaySetupNextActions({ orgId: "org-1", boardCount: 1, activeTokenCount: 0 });
    expect(actions[0]?.id).toBe("mint-token");
    expect(actions[0]?.primary).toBe(true);
  });

  it("nudges Event Day when no active event is set", () => {
    const actions = displaySetupNextActions({
      orgId: "org-1",
      boardCount: 1,
      activeTokenCount: 1,
      hasActiveEvent: false,
    });
    expect(actions.map((a) => a.id)).toContain("event");
    expect(actions.find((a) => a.id === "event")?.href).toContain("tab=command");
  });

  it("maps setup wizard steps from real counts only", () => {
    expect(displaySetupStep(0, 0)).toBe(1);
    expect(displaySetupStep(2, 0)).toBe(2);
    expect(displaySetupStep(1, 1)).toBe(3);
  });
});
