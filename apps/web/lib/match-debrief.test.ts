import { describe, expect, it } from "vitest";
import {
  buildDebriefCoachPrompt,
  debriefTakeaways,
  parseMatchDebriefAction,
  summarizeDebriefs,
  validateDebrief,
} from "./match-debrief";

describe("validateDebrief", () => {
  it("requires a match label", () => {
    expect(validateDebrief({ result: "win" }).ok).toBe(false);
  });
  it("rejects an invalid result", () => {
    expect(validateDebrief({ matchLabel: "Qual 5", result: "forfeit" }).ok).toBe(false);
  });
  it("rejects negative or fractional points", () => {
    expect(validateDebrief({ matchLabel: "Qual 5", pointsScored: -3 }).ok).toBe(false);
    expect(validateDebrief({ matchLabel: "Qual 5", pointsScored: 12.5 }).ok).toBe(false);
  });
  it("defaults the health flags to true and result to unknown", () => {
    const result = validateDebrief({ matchLabel: "Qual 5" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.result).toBe("unknown");
      expect(result.value.drivetrainOk).toBe(true);
    }
  });
  it("respects a false health flag", () => {
    const result = validateDebrief({ matchLabel: "Qual 5", mechanismsOk: false });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.mechanismsOk).toBe(false);
  });
});

describe("summarizeDebriefs", () => {
  it("computes W-L-T record, average points, and open action items", () => {
    const summary = summarizeDebriefs([
      { result: "win", pointsScored: 80, actionItems: "Fix intake" },
      { result: "loss", pointsScored: 40, actionItems: "" },
      { result: "win", pointsScored: 90, actionItems: "Tune auto" },
      { result: "tie", pointsScored: null, actionItems: "" },
    ]);
    expect(summary.record).toBe("2-1-1");
    expect(summary.avgPoints).toBe(70);
    expect(summary.openActionItems).toBe(2);
    expect(summary.total).toBe(4);
  });
  it("handles no scored matches", () => {
    expect(summarizeDebriefs([{ result: "unknown", pointsScored: null, actionItems: "" }]).avgPoints).toBeNull();
  });
});

describe("parseMatchDebriefAction", () => {
  it("parses create_debrief with a season year", () => {
    const action = parseMatchDebriefAction({ action: "create_debrief", orgId: "o1", seasonYear: 2026, matchLabel: "Qual 12", result: "win" });
    expect(action).toMatchObject({ action: "create_debrief", matchLabel: "Qual 12", result: "win" });
  });
  it("rejects create_debrief without a season year", () => {
    expect(() => parseMatchDebriefAction({ action: "create_debrief", orgId: "o1", matchLabel: "Qual 12" })).toThrow(/seasonYear/);
  });
  it("rejects an unsupported action", () => {
    expect(() => parseMatchDebriefAction({ action: "cheat", orgId: "o1" })).toThrow(/Unsupported/);
  });
});

describe("debriefTakeaways (deterministic — always renders, AI is optional on top)", () => {
  const base = {
    pointsScored: 20 as number | null,
    cycleCount: 4 as number | null,
    drivetrainOk: true,
    mechanismsOk: true,
    autoOk: true,
    whatWorked: "",
    whatBroke: "",
    actionItems: "",
  };

  it("shows an honest empty state with no logged matches", () => {
    expect(debriefTakeaways([])).toContain("No matches logged yet");
  });

  it("surfaces record, recurring system issues, breakages, and open action items", () => {
    const text = debriefTakeaways([
      { ...base, matchLabel: "Qual 1", result: "win" },
      { ...base, matchLabel: "Qual 2", result: "loss", drivetrainOk: false, whatBroke: "chain jumped", actionItems: "tension chain" },
      { ...base, matchLabel: "Qual 3", result: "loss", drivetrainOk: false },
    ]);
    expect(text).toContain("3 matches logged (1-2-0");
    expect(text).toContain("drivetrain in 2");
    expect(text).toContain("Qual 2: chain jumped");
    expect(text).toContain("open action items");
  });

  it("says so when no system issues were flagged", () => {
    const text = debriefTakeaways([{ ...base, matchLabel: "Qual 1", result: "win" }]);
    expect(text).toContain("No robot-system issues flagged");
  });
});

describe("buildDebriefCoachPrompt", () => {
  const debrief = {
    matchLabel: "Qual 5",
    result: "loss" as const,
    pointsScored: 12,
    cycleCount: 3,
    drivetrainOk: false,
    mechanismsOk: true,
    autoOk: true,
    whatWorked: "intake",
    whatBroke: "chain",
    actionItems: "tension chain",
  };

  it("returns null with no logged matches — never invents a performance history", () => {
    expect(buildDebriefCoachPrompt({ seasonYear: 2026, debriefs: [], takeaways: "" })).toBeNull();
  });

  it("grounds the prompt in the logged debriefs and computed takeaways", () => {
    const prompt = buildDebriefCoachPrompt({
      seasonYear: 2026,
      debriefs: [debrief],
      takeaways: "1 match logged (0-1-0).",
    });
    expect(prompt).not.toBeNull();
    expect(prompt).toContain("ONLY source of truth");
    expect(prompt).toContain("Qual 5");
    expect(prompt).toContain("1 match logged (0-1-0).");
    expect(prompt).toContain("do not invent matches");
  });
});
