import { describe, expect, it } from "vitest";
import {
  buildCadBriefFromIntelligence,
  buildStrategyFromIntelligence,
  hasIntelligenceSource,
  KICKOFF_ADVICE_LABEL,
  parseKickoffIntelligenceAction,
  sourceChecksum,
  structureGameIntelligence,
} from "./kickoff-intelligence";
import { expectPlainCopy } from "./ui/copy-assertions";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

/** Fixture shaped like a kickoff transcript + manual excerpt (no network). */
const FIXTURE_MANUAL = `
# 2027 FRC Game Manual — Reefscape Echo

## Game overview
Robots collect Coral and Algae around a central reef structure, then score in
reef branches during teleop. Matches reward reliable cycles over single high-risk plays.

## Game pieces
- Coral: rigid tube game piece scored in reef branches
- Algae: soft sphere processed through the processor or net

## Field elements
- Reef: hexagonal scoring structure in each alliance community
- Processor: wall station that accepts Algae

## Scoring
- Auto leave: 3 points
- Coral L1 teleop: 2 points
- Coral L4 teleop: 5 points
- Algae in processor: 6 points
- Endgame shallow climb: 6 points
- Endgame deep climb: 12 points

## How to play
1. Leave the starting zone in autonomous and preload Coral if available.
2. Cycle Coral into the highest reliable reef level your intake supports.
3. Opportunistically clear Algae when it unlocks a higher Coral level.
4. Finish with a climb that your drivetrain can repeat under battery sag.

## Constraints
- Robots may not extend beyond 48 inches outside the frame perimeter
- Starting weight must not exceed 125 lbs
- Robots must not contact the opposing reef during auto

## Open questions
- Can Coral be descored by opponents in teleop?
- Does a failed deep climb still award shallow climb points?
`;

const FIXTURE_TRANSCRIPT = `
Welcome to the 2027 FIRST Robotics Competition kickoff.
This year's game is called Reefscape Echo.
Teams will manipulate Coral and Algae.
Remember: robots may not extend beyond 48 inches.
Open question from the audience: Can Coral be descored by opponents in teleop?
Another question: Does a failed deep climb still award shallow climb points?
`;

describe("structureGameIntelligence", () => {
  it("builds a large structured summary from fixture manual + transcript", () => {
    const summary = structureGameIntelligence({
      seasonYear: 2027,
      manualText: FIXTURE_MANUAL,
      transcriptText: FIXTURE_TRANSCRIPT,
    });

    expect(summary.seasonYear).toBe(2027);
    expect(summary.gameName?.toLowerCase()).toContain("reefscape");
    expect(summary.overview.toLowerCase()).toMatch(/coral|algae|reef/);
    expect(summary.gamePieces.map((piece) => piece.name.toLowerCase())).toEqual(
      expect.arrayContaining(["coral", "algae"]),
    );
    expect(summary.scoring.length).toBeGreaterThanOrEqual(4);
    expect(summary.scoring.some((row) => row.action.toLowerCase().includes("deep climb") && row.points === 12)).toBe(
      true,
    );
    expect(summary.scoring.some((row) => row.phase === "auto" && row.points === 3)).toBe(true);
    expect(summary.howToPlay.length).toBeGreaterThan(0);
    expect(summary.constraints.some((item) => /48 inches/i.test(item))).toBe(true);
    expect(summary.openQuestions.length).toBeGreaterThanOrEqual(1);
    expect(summary.designDirections.length).toBeGreaterThanOrEqual(3);
    expect(summary.designDirections.every((direction) => direction.adviceLabel === KICKOFF_ADVICE_LABEL)).toBe(true);
    expect(summary.provenance.provider).toBe("local");
    expect(summary.provenance.sourceKinds).toEqual(expect.arrayContaining(["manual", "transcript"]));
    expectPlainCopy(summary.provenance.disclaimer);
  });

  it("does not invent point values when the source omits them", () => {
    const summary = structureGameIntelligence({
      seasonYear: 2027,
      transcriptText: "Robots score Coral in the reef. Cycle time will decide winners.",
    });
    expect(summary.scoring.every((row) => row.points == null || row.notes.length >= 0)).toBe(true);
    for (const row of summary.scoring) {
      if (/\b\d+\s*points?\b/i.test(row.action) === false && row.points != null) {
        // points only when parsePoints saw an explicit number in the line
        expect(row.points).toBeGreaterThanOrEqual(0);
      }
    }
    expect(summary.scoring.every((row) => row.points == null)).toBe(true);
  });
});

describe("buildStrategyFromIntelligence", () => {
  it("grounds advice in summary + prior capabilities without demo stats", () => {
    const summary = structureGameIntelligence({
      seasonYear: 2027,
      manualText: FIXTURE_MANUAL,
      transcriptText: FIXTURE_TRANSCRIPT,
    });
    const strategy = buildStrategyFromIntelligence({
      summary,
      priorCapabilities: ["Fast ground intake", "Stable endgame climb"],
    });

    expect(strategy.adviceLabel).toBe(KICKOFF_ADVICE_LABEL);
    expect(strategy.localText).toMatch(/MODEL/);
    expect(strategy.localText).not.toMatch(/DEMO|fabricated EPA|fake OPR/i);
    expect(strategy.historicalPatterns.some((line) => /Prior seasons/i.test(line))).toBe(true);
    expect(strategy.designPriorities.length).toBeGreaterThan(0);
  });
});

describe("buildCadBriefFromIntelligence", () => {
  it("produces a CAD brief seed labeled MODEL with provenance sources", () => {
    const summary = structureGameIntelligence({
      seasonYear: 2027,
      manualText: FIXTURE_MANUAL,
      transcriptText: FIXTURE_TRANSCRIPT,
    });
    const strategy = buildStrategyFromIntelligence({ summary });
    const brief = buildCadBriefFromIntelligence({
      summary,
      strategy,
      intelligenceId: ID,
    });

    expect(brief.title).toMatch(/2027/);
    expect(brief.request).toMatch(/\[MODEL\]/);
    expect(brief.request).toMatch(/Best design directions/i);
    expect(brief.sources[0]?.id).toBe(`kickoff-intel:${ID}`);
    expect(brief.sources.some((source) => source.classification === "researched_claim")).toBe(true);
  });
});

describe("parseKickoffIntelligenceAction", () => {
  it("requires at least one source for analyze", () => {
    expect(() =>
      parseKickoffIntelligenceAction({ action: "analyze", orgId: ORG, seasonYear: 2027 }),
    ).toThrow(/manual|transcript|URL/i);
  });

  it("parses analyze / apply / create_cad_brief", () => {
    expect(
      parseKickoffIntelligenceAction({
        action: "analyze",
        orgId: ORG,
        seasonYear: 2027,
        transcriptText: "Kickoff hello",
        createCadBrief: false,
        applyDrafts: true,
      }),
    ).toEqual({
      action: "analyze",
      orgId: ORG,
      seasonYear: 2027,
      manualText: null,
      transcriptText: "Kickoff hello",
      sourceUrl: null,
      createCadBrief: false,
      applyDrafts: true,
    });
    expect(parseKickoffIntelligenceAction({ action: "apply", orgId: ORG, id: ID })).toEqual({
      action: "apply",
      orgId: ORG,
      id: ID,
    });
  });
});

describe("source helpers", () => {
  it("detects sources and checksums stably", () => {
    expect(hasIntelligenceSource({ seasonYear: 2027 })).toBe(false);
    expect(hasIntelligenceSource({ seasonYear: 2027, transcriptText: "hi" })).toBe(true);
    const a = sourceChecksum({ seasonYear: 2027, transcriptText: "abc" });
    const b = sourceChecksum({ seasonYear: 2027, transcriptText: "abc" });
    const c = sourceChecksum({ seasonYear: 2027, transcriptText: "abcd" });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
