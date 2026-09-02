import { describe, expect, it } from "vitest";
import {
  assembleBugbotContext,
  BUGBOT_CONTEXT_MAX_CHARS,
  bugbotContextChars,
  type BugbotContextInput,
  type BugbotFmeaFailure,
} from "./bugbot-context";

const DRIVE = "src/main/java/frc/robot/subsystems/Drive.java";
const CLIMB = "src/main/java/frc/robot/subsystems/Climber.java";

function fmea(overrides: Partial<BugbotFmeaFailure> = {}): BugbotFmeaFailure {
  return {
    subsystemName: "Climber",
    title: "Brownout during climb",
    failureMode: "RIO reboots when the winch stalls",
    status: "open",
    context: "match",
    occurrence: 4,
    severity: 9,
    detection: 3,
    rootCause: null,
    fix: null,
    ...overrides,
  };
}

function base(overrides: Partial<BugbotContextInput> = {}): BugbotContextInput {
  return {
    reviewedFiles: [DRIVE],
    priorFindings: [],
    dismissed: [],
    fmeaFailures: [],
    tuningConstants: [],
    subsystems: [],
    seasonYear: 2026,
    ...overrides,
  };
}

describe("Bugbot context assembly", () => {
  it("attaches nothing when the team has nothing on record", () => {
    expect(assembleBugbotContext(base())).toEqual([]);
  });

  it("ranks open FMEA failures by RPN and tells the model to prioritise them", () => {
    const items = assembleBugbotContext(
      base({
        fmeaFailures: [
          fmea({ title: "Intake jams", subsystemName: "Intake", occurrence: 2, severity: 3, detection: 2 }),
          fmea(),
        ],
      }),
    );
    expect(items).toHaveLength(1);
    const [item] = items;
    expect(item?.id).toBe("bugbot:fmea-open-failures");
    expect(item?.type).toBe("module_data");
    expect(item?.content).toContain("HIGH priority");
    expect(item?.content).toContain("season 2026");
    // RPN 108 (climb) comes before RPN 12 (intake).
    expect(item!.content.indexOf("[RPN 108] Climber")).toBeLessThan(item!.content.indexOf("[RPN 12] Intake"));
    expect(item?.content).toContain("Brownout during climb");
    expect(item?.content).toContain("mode: RIO reboots when the winch stalls");
  });

  it("attaches prior open findings only for the files in this pass", () => {
    const items = assembleBugbotContext(
      base({
        priorFindings: [
          { filePath: DRIVE, rule: "hardcoded-can-id", severity: "high", finding: "Hard-coded CAN id", line: 12, seenCount: 3 },
          { filePath: CLIMB, rule: "motor-safety-disabled", severity: "high", finding: "Safety off", line: 4 },
        ],
      }),
    );
    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("bugbot:prior-open-findings");
    expect(items[0]?.content).toContain(`${DRIVE}:12 hardcoded-can-id (high, seen 3×)`);
    expect(items[0]?.content).not.toContain("Climber.java");
    expect(items[0]?.content).not.toContain("Safety off");
  });

  it("lists dismissed findings as do-not-report and the spec sheet / tuning logbook as data", () => {
    const items = assembleBugbotContext(
      base({
        dismissed: [{ fingerprint: "abcd1234", filePath: DRIVE, rule: "hardcoded-can-id", reason: "deliberate — set in Constants" }],
        subsystems: [
          { name: "Drivetrain", category: "drivetrain", motorType: "Kraken X60", motorCount: 8, gearReduction: "6.750", wheelDiameterIn: "4.00" },
        ],
        tuningConstants: [{ subsystem: "drive", name: "kP", value: "0.12", unit: "", category: "pid" }],
      }),
    );
    expect(items.map((item) => item.id)).toEqual([
      "bugbot:dismissed-findings",
      "bugbot:robot-subsystems",
      "bugbot:tuning-constants",
    ]);
    expect(items[0]?.content).toContain("do NOT re-report");
    expect(items[0]?.content).toContain("deliberate — set in Constants");
    expect(items[1]?.content).toContain("Drivetrain (drivetrain) · 8× Kraken X60 · 6.750:1 · 4.00 in wheels");
    expect(items[2]?.content).toContain("drive/kP = 0.12 (pid)");
    // Importance decreases from what the team dismissed to the tuning log.
    expect(items[0]!.importance).toBeGreaterThan(items[2]!.importance);
  });

  it("stays inside the character budget and says what it dropped", () => {
    const tuningConstants = Array.from({ length: 200 }, (_, index) => ({
      subsystem: "shooter",
      name: `constant_${index}`,
      value: String(index * 1.5),
      unit: "rpm",
      category: "feedforward",
    }));
    const items = assembleBugbotContext(base({ tuningConstants, fmeaFailures: [fmea()] }), { maxChars: 1500 });
    expect(bugbotContextChars(items)).toBeLessThanOrEqual(1500);
    const tuning = items.find((item) => item.id === "bugbot:tuning-constants");
    expect(tuning?.content).toMatch(/\(and \d+ more not shown\)/);
    // The FMEA section is the priority and survives the tight budget.
    expect(items[0]?.id).toBe("bugbot:fmea-open-failures");
    // The default budget is the documented ~6k.
    expect(BUGBOT_CONTEXT_MAX_CHARS).toBe(6000);
    const full = assembleBugbotContext(base({ tuningConstants }));
    expect(bugbotContextChars(full)).toBeLessThanOrEqual(BUGBOT_CONTEXT_MAX_CHARS);
  });

  it("drops a section that cannot fit even one line rather than attaching a bare header", () => {
    const items = assembleBugbotContext(
      base({
        fmeaFailures: Array.from({ length: 12 }, (_, index) => fmea({ title: `Failure ${index} ${"long ".repeat(20)}` })),
        subsystems: [{ name: "Arm", category: "arm", motorType: "NEO", motorCount: 2, gearReduction: null, wheelDiameterIn: null }],
      }),
      { maxChars: 700 },
    );
    for (const item of items) expect(item.content.split("\n").length).toBeGreaterThan(1);
    expect(bugbotContextChars(items)).toBeLessThanOrEqual(700);
  });
});
