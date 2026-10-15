import { describe, expect, it } from "vitest";
import type { StrategyView } from "../strategy/types";
import { composeLocalMatchBrief } from "./local";
import { parseMatchBrief } from "./parse";
import { buildMatchBriefPrompt, matchBriefFacts } from "./prompt";
import { briefIsStale, STALE_AFTER_NEW_REPORTS } from "./store";
import { MATCH_BRIEF_KIND, type MatchBrief } from "./types";

type LiveView = Extract<StrategyView, { status: "live" }>;

const view = {
  status: "live",
  orgId: "org-1",
  eventKey: "2026casj",
  eventName: "Silicon Valley Regional",
  teamNumber: 3091,
  matchKey: "2026casj_qm50",
  compLevel: "qm",
  matchNumber: 50,
  ourAlliance: "blue",
  red: ["frc254", "frc1678", "frc604"],
  blue: ["frc3091", "frc8", "frc649"],
  prediction: { pRed: 0.62, pBlue: 0.38, confidenceLow: 0.5, confidenceHigh: 0.74, keyFactors: [], caveats: [] },
  allianceBreakdown: {
    red: [{ teamKey: "frc254", rating: 60 }, { teamKey: "frc1678", rating: 52 }, { teamKey: "frc604", rating: 30 }],
    blue: [{ teamKey: "frc3091", rating: 40 }, { teamKey: "frc8", rating: 35 }, { teamKey: "frc649", rating: 33 }],
  },
  levers: [
    { id: "defense", title: "Put a defender on 254", detail: "254 scores 60 of red's 142; slowing them is worth the most.", gain: 6.4, ratingGain: 9, probabilityAfter: 0.444, isCeiling: false },
  ],
  playbook: {
    title: "",
    winProbability: 0.38,
    priorities: ["Score fast in auto", "Hold the far stage in endgame"],
    strengthsToProtect: [],
    risksToMitigate: ["604 draws fouls near the reef"],
    checkpoints: ["Leave and score one in auto", "Climb by 0:20"],
    debriefPrompts: [],
    provenance: [],
  },
  matchup: {
    red: [{ teamKey: "frc254", epa: 60, autoEpa: 12, endgameEpa: 10, source: "statbotics", record: "9-1-0", rank: 1, scoutSample: 8, reliability: 98, foulRate: 0.1 }],
    blue: [],
    redTotalEpa: 142,
    blueTotalEpa: 108,
    considerations: ["Red is stronger on paper"],
  },
  tendencies: [{ teamKey: "frc254", labels: ["Fast cycler", "Scores high"], evidence: ["9 of 10 matches scored over 40 in teleop"] }],
  operations: [
    { teamKey: "frc604", scoutSample: 6, foulRate: 0.6 },
    { teamKey: "frc8", scoutSample: 5, autoCapability: 0.7, teleopCapability: 0.4, endgameCapability: 0.2 },
  ],
  teamTrends: { frc254: { direction: "steady", lines: ["Team 254 has been in the top 10% of teams in 5 of its last 5 seasons (2022–2026)."] } },
  gameRules: { seasonYear: 2026 },
} as unknown as LiveView;

describe("match brief prompt", () => {
  it("gives the model only this match's facts, our odds included, and the output shape", () => {
    const facts = matchBriefFacts(view);
    expect(facts.ourWinChancePct).toBe(38);
    expect(facts.us.map((team) => team.team)).toEqual(["3091", "8", "649"]);
    expect(facts.them[0]).toMatchObject({ team: "254", rating: 60, record: "9-1-0", scoutedTendencies: ["Fast cycler", "Scores high"] });
    expect(facts.them[0]?.history[0]).toMatch(/top 10%/);
    const prompt = buildMatchBriefPrompt(view);
    expect(prompt).toMatch(/Use only the facts/);
    expect(prompt).toMatch(/"raiseOdds"/);
    expect(prompt).toContain('"ourWinChancePct":38');
  });
});

describe("parseMatchBrief", () => {
  const facts = { winChance: 38, teams: ["254", "1678", "604", "3091", "8", "649"] };

  it("keeps a good answer, with the win chance from the prediction, not the model", () => {
    const parsed = parseMatchBrief(
      "```json\n" +
        JSON.stringify({
          headline: "Slow 254 down and win the endgame.",
          winChance: 90,
          raiseOdds: [{ action: "Defend 254", why: "They score most of red's points.", gain: 6.4 }],
          opponents: [{ team: "frc254", likely: "Cycle fast", how: "Near the reef all match", counter: "649 plays defense" }, { team: "9999", likely: "x", how: "y", counter: "z" }],
          partners: [{ team: "8", role: "Score in auto" }],
          phases: { auto: "Leave and score", teleop: "Cycle", endgame: "Climb" },
          watchFor: ["604 fouls"],
        }) +
        "\n```",
      facts,
    );
    expect(parsed?.winChance).toBe(38);
    expect(parsed?.opponents.map((row) => row.team)).toEqual(["254"]);
    expect(parsed?.raiseOdds[0]).toEqual({ action: "Defend 254", why: "They score most of red's points.", gain: 6.4 });
  });

  it("rejects an answer that isn't JSON or has no moves", () => {
    expect(parseMatchBrief("I think you should defend.", facts)).toBeNull();
    expect(parseMatchBrief(JSON.stringify({ headline: "x", raiseOdds: [] }), facts)).toBeNull();
  });
});

describe("composeLocalMatchBrief", () => {
  it("writes every section from the measured numbers when no AI is connected", () => {
    const brief = composeLocalMatchBrief(view);
    expect(brief.winChance).toBe(38);
    expect(brief.raiseOdds[0]).toEqual({ action: "Put a defender on 254", why: "254 scores 60 of red's 142; slowing them is worth the most.", gain: 6.4 });
    expect(brief.opponents.find((row) => row.team === "254")?.likely).toMatch(/fast cycler/);
    expect(brief.opponents.find((row) => row.team === "604")?.counter).toMatch(/fouls/);
    expect(brief.partners.find((row) => row.team === "8")?.role).toMatch(/auto/);
    expect(brief.phases).toEqual({ auto: "Leave and score one in auto", teleop: "Score fast in auto", endgame: "Climb by 0:20" });
  });
});

describe("briefIsStale", () => {
  const brief = {
    kind: MATCH_BRIEF_KIND,
    source: { lastPlayedMatch: "2026casj_qm50", scoutReports: 100 },
  } as unknown as MatchBrief;

  it("is stale once a newer match is played or a match's worth of scouting arrives", () => {
    expect(briefIsStale(null, { lastPlayedMatch: null, scoutReports: 0 })).toBe(true);
    expect(briefIsStale(brief, { lastPlayedMatch: "2026casj_qm50", scoutReports: 100 })).toBe(false);
    expect(briefIsStale(brief, { lastPlayedMatch: "2026casj_qm51", scoutReports: 100 })).toBe(true);
    expect(briefIsStale(brief, { lastPlayedMatch: "2026casj_qm50", scoutReports: 100 + STALE_AFTER_NEW_REPORTS })).toBe(true);
    expect(briefIsStale(brief, { lastPlayedMatch: "2026casj_qm50", scoutReports: 103 })).toBe(false);
  });
});
