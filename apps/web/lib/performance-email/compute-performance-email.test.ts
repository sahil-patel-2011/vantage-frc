import { describe, expect, it } from "vitest";
import {
  buildPerformanceDigestPrompt,
  computePerformanceDigest,
  derivePointers,
  matchLabel,
  renderPerformanceEmailHtml,
  renderPerformanceEmailText,
  toMatchResultLine,
  type PerformanceEmailInput,
  type PerformanceMatchRow,
} from "./compute-performance-email";

const TEAM = 254;
const KEY = "frc254";

function match(overrides: Partial<PerformanceMatchRow> = {}): PerformanceMatchRow {
  return {
    matchKey: "2026casj_qm12",
    compLevel: "qm",
    setNumber: 1,
    matchNumber: 12,
    red: { teamKeys: [KEY, "frc111", "frc222"], score: 80 },
    blue: { teamKeys: ["frc333", "frc444", "frc555"], score: 70 },
    scoreBreakdown: null,
    scheduledAt: null,
    ...overrides,
  };
}

function baseInput(overrides: Partial<PerformanceEmailInput> = {}): PerformanceEmailInput {
  return {
    orgName: "The Cheesy Poofs",
    teamNumber: TEAM,
    day: "2026-03-14",
    eventKey: "2026casj",
    eventName: "Silicon Valley Regional",
    matchesToday: [],
    upcomingMatches: [],
    metrics: null,
    scouting: null,
    ...overrides,
  };
}

describe("computePerformanceDigest — no-data honesty", () => {
  it("returns null when there are no scored matches and no scouting activity", () => {
    expect(computePerformanceDigest(baseInput())).toBeNull();
    expect(
      computePerformanceDigest(
        baseInput({ scouting: { entries: 0, matchesScouted: 0, matchesPlayedAtEvent: 0, scouts: 0 } }),
      ),
    ).toBeNull();
  });

  it("ignores unscored matches (TBA -1 scores) — they are not performance data", () => {
    const unscored = match({ red: { teamKeys: [KEY], score: -1 }, blue: { teamKeys: ["frc9"], score: -1 } });
    expect(computePerformanceDigest(baseInput({ matchesToday: [unscored] }))).toBeNull();
  });

  it("ignores matches the team is not actually in", () => {
    const other = match({ red: { teamKeys: ["frc1", "frc2"], score: 50 }, blue: { teamKeys: ["frc3"], score: 40 } });
    expect(computePerformanceDigest(baseInput({ matchesToday: [other] }))).toBeNull();
  });
});

describe("computePerformanceDigest — match days", () => {
  it("aggregates the day's record and builds an honest subject", () => {
    const digest = computePerformanceDigest(
      baseInput({
        matchesToday: [
          match(),
          match({
            matchKey: "2026casj_qm20",
            matchNumber: 20,
            red: { teamKeys: ["frc9", "frc8", "frc7"], score: 95 },
            blue: { teamKeys: [KEY, "frc6", "frc5"], score: 60 },
          }),
        ],
      }),
    );
    expect(digest).not.toBeNull();
    expect(digest!.record).toEqual({ wins: 1, losses: 1, ties: 0 });
    expect(digest!.subject).toBe("Team 254 today: 1-1 at Silicon Valley Regional");
    expect(digest!.results.map((r) => r.result)).toEqual(["W", "L"]);
    expect(digest!.results[1]).toMatchObject({ us: 60, opp: 95, margin: -35 });
  });

  it("reports rank only from a provided metrics row and never claims movement", () => {
    const digest = computePerformanceDigest(
      baseInput({
        matchesToday: [match()],
        metrics: { rank: 5, wins: 7, losses: 2, ties: 0, source: "tba" },
      }),
    );
    expect(digest!.rankLine).toBe("Current event rank: 5 (event record 7-2) — source: tba cache.");
    const noMetrics = computePerformanceDigest(baseInput({ matchesToday: [match()] }));
    expect(noMetrics!.rankLine).toBeNull();
  });

  it("builds an off-season scouting recap when there are entries but no matches", () => {
    const digest = computePerformanceDigest(
      baseInput({
        eventKey: null,
        eventName: null,
        scouting: { entries: 12, matchesScouted: 0, matchesPlayedAtEvent: 0, scouts: 3 },
      }),
    );
    expect(digest).not.toBeNull();
    expect(digest!.subject).toBe("Team 254 scouting recap — 2026-03-14");
    expect(digest!.scoutingLine).toContain("12 entries from 3 scouts");
  });
});

describe("derivePointers — deterministic, never invented", () => {
  function loss(matchKey: string, us: number, opp: number, breakdown?: unknown): PerformanceMatchRow {
    return match({
      matchKey,
      red: { teamKeys: [KEY], score: us },
      blue: { teamKeys: ["frc9"], score: opp },
      scoreBreakdown: breakdown ?? null,
    });
  }

  it("emits no pointers when breakdowns are missing and no losses are close", () => {
    const results = [toMatchResultLine(loss("a", 40, 90), KEY)!];
    expect(derivePointers(results, null)).toEqual([]);
  });

  it("flags losses decided by endgame only when the breakdown literally supports it", () => {
    const endgameLoss = (key: string) =>
      loss(key, 60, 66, {
        red: { autoPoints: 20, endGameBargePoints: 2 },
        blue: { autoPoints: 20, endGameBargePoints: 12 },
      });
    const results = [toMatchResultLine(endgameLoss("a"), KEY)!, toMatchResultLine(endgameLoss("b"), KEY)!];
    const pointers = derivePointers(results, null);
    expect(pointers[0]).toContain("2 losses were decided by endgame points");
    expect(pointers[0]).toContain("10 points on average");
  });

  it("does not claim endgame decided a loss when the deficit is smaller than the margin", () => {
    const results = [
      toMatchResultLine(
        loss("a", 40, 90, {
          red: { endGameBargePoints: 6 },
          blue: { endGameBargePoints: 12 },
        }),
        KEY,
      )!,
    ];
    const pointers = derivePointers(results, null);
    expect(pointers.some((p) => p.includes("endgame"))).toBe(false);
  });

  it("flags a repeated auto gap and a penalty-decided loss from breakdown facts", () => {
    const autoLoss = (key: string) =>
      loss(key, 50, 70, { red: { autoPoints: 5 }, blue: { autoPoints: 20 } });
    const results = [toMatchResultLine(autoLoss("a"), KEY)!, toMatchResultLine(autoLoss("b"), KEY)!];
    const pointers = derivePointers(results, null);
    expect(pointers[0]).toContain("Auto trailed opponents in 2 of 2 matches");

    const penalty = toMatchResultLine(
      loss("c", 60, 64, { red: {}, blue: { foulPoints: 8 } }),
      KEY,
    )!;
    const penaltyPointers = derivePointers([penalty], null);
    expect(penaltyPointers.some((p) => p.includes("Penalties decided"))).toBe(true);
  });

  it("caps at three pointers and includes the scouting coverage gap when real", () => {
    const pointers = derivePointers([], {
      entries: 4,
      matchesScouted: 4,
      matchesPlayedAtEvent: 10,
      scouts: 2,
    });
    expect(pointers).toEqual([
      "Scouting covered 4 of 10 matches played today — assign scouts so every match is covered tomorrow.",
    ]);
    expect(
      derivePointers([], { entries: 4, matchesScouted: 10, matchesPlayedAtEvent: 10, scouts: 2 }),
    ).toEqual([]);
  });
});

describe("rendering", () => {
  const digest = computePerformanceDigest(
    baseInput({
      matchesToday: [match()],
      upcomingMatches: [
        match({
          matchKey: "2026casj_qm30",
          matchNumber: 30,
          red: { teamKeys: [KEY, "frc111", "frc222"], score: null },
          blue: { teamKeys: ["frc333", "frc444", "frc555"], score: null },
          scheduledAt: "2026-03-15T16:30:00Z",
        }),
      ],
      scouting: { entries: 6, matchesScouted: 6, matchesPlayedAtEvent: 6, scouts: 2 },
    }),
  )!;

  it("renders text with matches, schedule, and the AI paragraph only when provided", () => {
    const text = renderPerformanceEmailText(digest);
    expect(text).toContain("W  Qual 12: 80-70");
    expect(text).toContain("Tomorrow's schedule:");
    expect(text).toContain("Qual 30 — 16:30 UTC: with 111, 222 vs 333, 444, 555");
    const withAi = renderPerformanceEmailText(digest, "Strong day overall.");
    expect(withAi).toContain("Strong day overall.");
    expect(text).not.toContain("Strong day overall.");
  });

  it("renders escaped HTML mirroring the text body", () => {
    const html = renderPerformanceEmailHtml(digest, 'Watch the "barge" endgame.');
    expect(html).toContain("<strong>W</strong> Qual 12: 80-70");
    expect(html).toContain("Watch the &quot;barge&quot; endgame.");
    expect(html).not.toContain('"barge"');
  });

  it("grounds the AI prompt in the deterministic facts", () => {
    const prompt = buildPerformanceDigestPrompt(digest);
    expect(prompt).toContain("Use ONLY the facts below");
    expect(prompt).toContain("W  Qual 12: 80-70");
  });
});

describe("matchLabel", () => {
  it("labels comp levels", () => {
    expect(matchLabel({ compLevel: "qm", setNumber: 1, matchNumber: 4 })).toBe("Qual 4");
    expect(matchLabel({ compLevel: "sf", setNumber: 2, matchNumber: 1 })).toBe("Semifinal 2-1");
    expect(matchLabel({ compLevel: "f", setNumber: 1, matchNumber: 2 })).toBe("Final 2");
  });
});
