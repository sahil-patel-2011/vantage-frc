import { describe, expect, it } from "vitest";
import { computeGameBrief, gameAskHref, gameAskPrompt, gameBriefStatusBadge } from "./compute-game-brief";

describe("computeGameBrief", () => {
  it("uses the published REBUILT brief and scoring labels", () => {
    const view = computeGameBrief(2026);
    expect(view.status).toBe("published");
    expect(view.gameName).toBe("REBUILT");
    expect(view.scoringLabels).toContain("Auto fuel scored");
    expect(view.scoringLabels).toContain("Tower climb");
    expect(view.designQuestions.length).toBeGreaterThan(0);
    expect(view.priorSeason).toBeNull();
  });

  it("keeps 2027 BIOCORE empty and points at last season", () => {
    const view = computeGameBrief(2027);
    expect(view.status).toBe("awaiting_manual");
    expect(view.scoringLabels).toEqual([]);
    expect(view.strategyTemplates).toEqual([]);
    expect(view.priorSeason?.year).toBe(2026);
    expect(view.priorSeason?.gameName).toBe("REBUILT");
    expect(view.headline).toMatch(/not published yet/i);
  });

  it("opens Chat with the brief already in the box", () => {
    const prompt = gameAskPrompt(2027);
    expect(prompt).toMatch(/BIOCORE/);
    expect(prompt).toMatch(/REBUILT/);
    expect(prompt).not.toMatch(/node bridge/);
    const href = gameAskHref("org-1", 2026);
    expect(href.startsWith("/chat?")).toBe(true);
    expect(href).toContain("orgId=org-1");
    expect(href).toContain("source=kickoff");
    expect(href).toContain("prompt=");
  });

  it("labels an unpublished year Manual not out, not Needs setup", () => {
    expect(gameBriefStatusBadge("published")).toBe("From the manual");
    expect(gameBriefStatusBadge("awaiting_manual")).toBe("Manual not out");
  });
});
