import { describe, expect, it } from "vitest";
import {
  capabilityReads,
  daysUntil,
  type NextSeasonSignal,
} from "./next-season";

let counter = 0;
function signal(partial: Partial<NextSeasonSignal>): NextSeasonSignal {
  counter += 1;
  return {
    id: `s${counter}`,
    kind: "teaser",
    observedOn: "2026-09-01",
    source: `https://example.test/${counter}`,
    note: "Something was shown",
    pointsAt: ["climb"],
    ...partial,
  };
}

describe("capabilityReads", () => {
  it("says nothing at all when nothing was recorded", () => {
    expect(capabilityReads([])).toEqual([]);
  });

  it("leaves out capabilities nobody pointed at", () => {
    // A row at zero reads as evidence of absence. Silence here means nobody
    // looked, which is a different thing.
    const reads = capabilityReads([signal({ pointsAt: ["climb"] })]);
    expect(reads.map((r) => r.capability)).toEqual(["climb"]);
  });

  it("treats one source as thin however excited the note is", () => {
    const reads = capabilityReads([signal({ kind: "teaser", pointsAt: ["scoring-height"] })]);
    expect(reads[0]?.confidence).toBe("thin");
    expect(reads[0]?.because).toMatch(/one source/i);
  });

  it("does not let a rumour corroborate anything", () => {
    // Two people repeating the same thing they heard is still one thing heard.
    const reads = capabilityReads([
      signal({ kind: "rumour", source: "a friend", pointsAt: ["climb"] }),
      signal({ kind: "rumour", source: "another friend", pointsAt: ["climb"] }),
    ]);
    expect(reads[0]?.confidence).toBe("thin");
    expect(reads[0]?.independentSources).toBe(0);
    expect(reads[0]?.because).toMatch(/secondhand/i);
  });

  it("counts two different sources as worth planning for", () => {
    const reads = capabilityReads([
      signal({ kind: "teaser", source: "https://a.test", pointsAt: ["climb"] }),
      signal({ kind: "teaser", source: "https://b.test", pointsAt: ["climb"] }),
    ]);
    expect(reads[0]?.confidence).toBe("worth-planning-for");
    expect(reads[0]?.independentSources).toBe(2);
  });

  it("does not count the same source twice", () => {
    const reads = capabilityReads([
      signal({ kind: "teaser", source: "https://a.test", pointsAt: ["climb"] }),
      signal({ kind: "teaser", source: "HTTPS://A.TEST ", pointsAt: ["climb"] }),
    ]);
    expect(reads[0]?.independentSources).toBe(1);
    expect(reads[0]?.confidence).toBe("thin");
  });

  it("promotes a single FIRST announcement to worth planning for, and no higher", () => {
    const reads = capabilityReads([
      signal({ kind: "announcement", source: "https://firstinspires.test", pointsAt: ["climb"] }),
    ]);
    expect(reads[0]?.confidence).toBe("worth-planning-for");
  });

  it("reaches well-supported only with corroboration and a strong signal", () => {
    const reads = capabilityReads([
      signal({ kind: "announcement", source: "https://firstinspires.test", pointsAt: ["climb"] }),
      signal({ kind: "teaser", source: "https://youtube.test/x", pointsAt: ["climb"] }),
    ]);
    expect(reads[0]?.confidence).toBe("well-supported");
    expect(reads[0]?.because).toMatch(/announcement/i);
  });

  it("will not reach well-supported on two teasers alone", () => {
    // A wrong "well supported" in October costs a team its whole offseason.
    const reads = capabilityReads([
      signal({ kind: "teaser", source: "https://a.test", pointsAt: ["climb"] }),
      signal({ kind: "teaser", source: "https://b.test", pointsAt: ["climb"] }),
      signal({ kind: "teaser", source: "https://c.test", pointsAt: ["climb"] }),
    ]);
    expect(reads[0]?.confidence).toBe("worth-planning-for");
  });

  it("accepts the FTC game as a strong signal alongside a second source", () => {
    const reads = capabilityReads([
      signal({ kind: "ftc-game", source: "https://ftc.test/manual", pointsAt: ["ground-pickup"] }),
      signal({ kind: "teaser", source: "https://b.test", pointsAt: ["ground-pickup"] }),
    ]);
    expect(reads[0]?.confidence).toBe("well-supported");
    expect(reads[0]?.because).toMatch(/FTC/);
  });

  it("ranks the best-supported read first", () => {
    const reads = capabilityReads([
      signal({ kind: "teaser", source: "https://a.test", pointsAt: ["defense"] }),
      signal({ kind: "announcement", source: "https://first.test", pointsAt: ["climb"] }),
      signal({ kind: "teaser", source: "https://b.test", pointsAt: ["climb"] }),
    ]);
    expect(reads[0]?.capability).toBe("climb");
    expect(reads[0]?.confidence).toBe("well-supported");
    expect(reads[1]?.capability).toBe("defense");
  });

  it("carries one signal into every capability it was tagged with", () => {
    const reads = capabilityReads([
      signal({ kind: "teaser", source: "https://a.test", pointsAt: ["climb", "traversal"] }),
    ]);
    expect(reads.map((r) => r.capability).sort()).toEqual(["climb", "traversal"]);
  });

  it("ignores a blank source rather than counting it as a distinct one", () => {
    const reads = capabilityReads([
      signal({ kind: "teaser", source: "   ", pointsAt: ["climb"] }),
      signal({ kind: "teaser", source: "", pointsAt: ["climb"] }),
    ]);
    expect(reads[0]?.independentSources).toBe(0);
    expect(reads[0]?.confidence).toBe("thin");
  });
});

describe("daysUntil", () => {
  it("counts whole days to kickoff", () => {
    expect(daysUntil("2027-01-09", "2026-09-17")).toBe(114);
  });

  it("is zero on the day", () => {
    expect(daysUntil("2027-01-09", "2027-01-09")).toBe(0);
  });

  it("goes negative afterwards, so nobody counts down into the past", () => {
    expect(daysUntil("2026-01-03", "2026-09-17")).toBeLessThan(0);
  });

  it("returns null rather than a number for an unusable date", () => {
    expect(daysUntil("not a date", "2026-09-17")).toBeNull();
    expect(daysUntil("2027-01-09", "")).toBeNull();
  });
});
