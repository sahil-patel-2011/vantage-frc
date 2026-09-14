import { describe, expect, it } from "vitest";
import {
  analyticsSourceDetail,
  analyticsSourceIssue,
  analyticsSourceLabel,
  filterRowsBySource,
  parseAnalyticsSource,
  parseTeamKeyList,
  sourceAllowsTeam,
} from "./lovat-data-source";

describe("parseAnalyticsSource", () => {
  it("defaults to the whole event when the row is missing", () => {
    expect(parseAnalyticsSource(null)).toEqual({ mode: "all", teamKeys: [], eventKeys: [] });
    expect(parseTeamKeyList("254, frc1678 118")).toEqual(["frc254", "frc1678", "frc118"]);
  });

  it("keeps selected keys and drops junk", () => {
    const parsed = parseAnalyticsSource({
      mode: "selected",
      team_keys: ["frc254", "nope", "1678"],
      eventKeys: ["2026casj", "bad"],
    });
    expect(parsed.mode).toBe("selected");
    expect(parsed.teamKeys).toEqual(["frc254", "frc1678"]);
    expect(parsed.eventKeys).toEqual(["2026casj"]);
  });
});

describe("sourceAllowsTeam", () => {
  it("own mode only keeps this team's rows", () => {
    const own = parseAnalyticsSource({ mode: "own" });
    expect(sourceAllowsTeam(own, "frc254", "frc254")).toBe(true);
    expect(sourceAllowsTeam(own, "frc1678", "frc254")).toBe(false);
    expect(sourceAllowsTeam(own, "frc254", null)).toBe(false);
  });

  it("selected mode never invents a field from unpicked teams", () => {
    const selected = parseAnalyticsSource({ mode: "selected", teamKeys: ["frc254"] });
    const rows = filterRowsBySource(
      [
        { teamKey: "frc254", eventKey: "2026casj" },
        { teamKey: "frc1678", eventKey: "2026casj" },
      ],
      selected,
      "frc9999",
    );
    expect(rows.map((row) => row.teamKey)).toEqual(["frc254"]);
  });
});

describe("copy", () => {
  it("uses student chrome and a setup hint when nothing is picked", () => {
    expect(analyticsSourceLabel("own")).toBe("Our scouting");
    expect(analyticsSourceDetail({ mode: "selected", teamKeys: [], eventKeys: [] })).toContain("Needs setup");
    expect(analyticsSourceIssue({ mode: "selected", teamKeys: [], eventKeys: [] }, "frc1").kind).toBe("needs_selected");
    expect(analyticsSourceIssue({ mode: "own", teamKeys: [], eventKeys: [] }, null).kind).toBe("needs_own_team");
    expect(analyticsSourceIssue({ mode: "all", teamKeys: [], eventKeys: [] }, null).kind).toBe("ok");
  });
});
