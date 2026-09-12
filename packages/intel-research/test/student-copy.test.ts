import { describe, expect, it } from "vitest";
import { scoreAllianceChemistry } from "../src/analytics";
import { LocalSummaryProvider } from "../src/providers";
import { studentCacheSourceLabel } from "../src/student-copy";
import type { Metric } from "../src/types";

const JARGON = /\b(EPA|TBA|Statbotics|MODEL)\b/;

function metric(partial: Partial<Metric> & Pick<Metric, "year" | "source">): Metric {
  return {
    epaTotal: null,
    epaAuto: null,
    epaTeleop: null,
    epaEndgame: null,
    ...partial,
  };
}

describe("student cache source labels", () => {
  it("maps stored identifiers without leaking them", () => {
    expect(studentCacheSourceLabel("tba")).toBe("official matches");
    expect(studentCacheSourceLabel("statbotics")).toBe("season ratings");
    expect(studentCacheSourceLabel("fixture")).toBe("official matches");
  });
});

describe("generated student-facing chemistry copy", () => {
  it("asks for season ratings when no event numbers exist", () => {
    const empty = scoreAllianceChemistry([{ teamKey: "frc1", metric: metric({ year: 2026, source: "tba" }) }]);
    const painted = [
      empty.caveat,
      ...empty.caveats,
      ...empty.provenance,
      ...empty.risks,
      ...empty.roles.map((role) => role.evidence),
    ];
    for (const line of painted) {
      expect(line, line).not.toMatch(JARGON);
    }
    expect(empty.caveat).toMatch(/season ratings/);
    expect(empty.risks.join(" ")).toMatch(/season ratings/);
  });

  it("cites season ratings on a live alliance", () => {
    const live = scoreAllianceChemistry([
      {
        teamKey: "frc1",
        metric: metric({
          year: 2026,
          epaTotal: 40,
          epaAuto: 16,
          epaTeleop: 16,
          epaEndgame: 8,
          source: "statbotics",
        }),
      },
      {
        teamKey: "frc2",
        metric: metric({ year: 2026, source: "tba" }),
      },
    ]);
    const painted = [
      live.caveat,
      ...live.caveats,
      ...live.provenance,
      ...live.risks,
      ...live.roles.map((role) => role.evidence),
    ];
    for (const line of painted) {
      expect(line, line).not.toMatch(JARGON);
    }
    expect(live.roles[0]?.evidence).toMatch(/rating 40/);
    expect(live.risks.join(" ")).toMatch(/season rating/);
    expect(live.provenance.join(" ")).toMatch(/official matches|season ratings/);
  });
});

describe("generated student-facing research brief copy", () => {
  it("summarizes missing and present ratings without leftover jargon", async () => {
    const missing = await new LocalSummaryProvider().summarize({
      teamNumber: 1,
      nickname: "Test",
      metrics: [],
      findings: [],
      scoutObservations: [],
    });
    expect(missing.text).toMatch(/season-rating/);
    expect(missing.text).not.toMatch(JARGON);
    expect(missing.text).toMatch(/team scouting/);

    const present = await new LocalSummaryProvider().summarize({
      teamNumber: 254,
      nickname: "Cheesy Poofs",
      metrics: [metric({ year: 2026, epaTotal: 62.5, source: "statbotics" })],
      findings: [],
      scoutObservations: [{ payload: { cycles: 8 }, confidence: "high" }],
    });
    expect(present.text).toMatch(/62\.5 season rating from season ratings/);
    expect(present.text).not.toMatch(JARGON);
  });
});
