import { describe, expect, it } from "vitest";
import { scoutingQualityHref } from "./quality-navigation";

describe("scouting quality aliases", () => {
  it("preserves team, event and repeated report filters without collection or hub tabs", () => {
    const url = new URL(scoutingQualityHref({ orgId: "team", eventKey: "2026txho", report: ["a", "b"], tab: "scouting", scoutTab: "trust", section: "impact" }), "https://vantage.example");
    expect(url.pathname).toBe("/scouting/quality");
    expect(url.searchParams.getAll("report")).toEqual(["a", "b"]);
    expect(url.searchParams.get("orgId")).toBe("team");
    expect(url.searchParams.get("eventKey")).toBe("2026txho");
    expect(url.searchParams.get("section")).toBe("impact");
    expect(url.searchParams.has("tab")).toBe(false);
    expect(url.searchParams.has("scoutTab")).toBe(false);
  });
  it("maps old accuracy links to scouts and replaces an old section", () => {
    expect(scoutingQualityHref({ section: ["checks", "rules"] }, "scouts")).toBe("/scouting/quality?section=scouts");
    expect(scoutingQualityHref()).toBe("/scouting/quality");
  });
});
