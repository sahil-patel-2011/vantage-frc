import { describe, expect, it, vi } from "vitest";
import {
  DEEP_GAME_ANALYSIS_TEAM_NUMBER,
  emptyGuess,
  HISTORICAL_FRC_GAMES,
  isDeepGameAnalysisTeam,
  parseDeepGameGuess,
  seedSourcesForSeason,
  shouldContinueDeepAnalysis,
} from "../src/deep-game-analysis";
import { runDeepGameAnalysisJob, runDeepGameAnalysisLoop } from "../src/deep-game-analysis-job";

describe("deep game analysis gate and schedule", () => {
  it("allows only FRC team 6925", () => {
    expect(isDeepGameAnalysisTeam(6925)).toBe(true);
    expect(isDeepGameAnalysisTeam(DEEP_GAME_ANALYSIS_TEAM_NUMBER)).toBe(true);
    expect(isDeepGameAnalysisTeam(254)).toBe(false);
    expect(isDeepGameAnalysisTeam(null)).toBe(false);
  });

  it("keeps thinking until five wall-clock hours, not a loop count", () => {
    const startedAt = new Date("2026-09-02T12:00:00.000Z");
    expect(
      shouldContinueDeepAnalysis({ startedAt, loopCount: 1, now: new Date("2026-09-02T16:59:00.000Z") }),
    ).toBe(true);
    expect(
      shouldContinueDeepAnalysis({ startedAt, loopCount: 80, now: new Date("2026-09-02T16:59:00.000Z") }),
    ).toBe(true);
    expect(
      shouldContinueDeepAnalysis({ startedAt, loopCount: 1, now: new Date("2026-09-02T17:00:00.000Z") }),
    ).toBe(false);
    expect(
      shouldContinueDeepAnalysis({
        startedAt,
        loopCount: 8,
        now: new Date("2026-09-02T13:00:00.000Z"),
        cancelled: true,
      }),
    ).toBe(false);
  });

  it("seeds official FIRST and community URLs for the season", () => {
    const urls = seedSourcesForSeason(2027).map((source) => source.url);
    expect(urls.some((url) => url.includes("firstinspires.org/robotics/frc/kickoff"))).toBe(true);
    expect(urls.some((url) => url.includes("thebluealliance.com/events/2027"))).toBe(true);
    expect(urls.some((url) => url.includes("chiefdelphi.com"))).toBe(true);
    expect(HISTORICAL_FRC_GAMES.some((game) => game.year === 2025 && game.officialName === "REEFSCAPE")).toBe(
      true,
    );
  });
});

describe("deep game guess honesty", () => {
  it("drops a guess that cites no fetched evidence", () => {
    const guess = parseDeepGameGuess(
      JSON.stringify({
        themeGuess: "invented canopy maze",
        scoringGuess: ["12 points per leaf"],
        rulesGuess: ["G20"],
        evidenceUrls: [],
        confidence: "high",
      }),
      [],
    );
    expect(guess.themeGuess).toBeNull();
    expect(guess.scoringGuess).toEqual([]);
    expect(guess.confidence).toBe("none");
    expect(guess.disclaimer).toMatch(/not the official manual/i);
  });

  it("keeps a guess only when fetched URLs back it", () => {
    const url = "https://www.firstinspires.org/robotics/frc/blog";
    const guess = parseDeepGameGuess(
      JSON.stringify({
        themeGuess: "FIRST CANOPY",
        scoringGuess: [],
        rulesGuess: [],
        unknowns: ["Manual not published"],
        evidenceUrls: [url],
        speculation: ["Game pieces may be biological-themed"],
        confidence: "low",
      }),
      [url],
    );
    expect(guess.themeGuess).toBe("FIRST CANOPY");
    expect(guess.evidenceUrls).toContain(url);
    expect(guess.confidence).toBe("low");
    expect(guess.speculation[0]).toMatch(/biological/i);
  });
});

describe("deep game analysis loop", () => {
  it("runs every contemplation focus before returning", async () => {
    const focuses: string[] = [];
    const { guess, turns } = await runDeepGameAnalysisLoop(
      {
        provider: "test",
        model: "glm/glm-5.3-flash",
        complete: async ({ message }) => {
          const focus = /focus: ([a-z_]+)/.exec(message)?.[1] ?? "";
          focuses.push(focus);
          return {
            text: JSON.stringify({
              themeGuess: "FIRST CANOPY",
              fieldGuess: null,
              scoringGuess: [],
              rulesGuess: [],
              robotImplications: [],
              unknowns: ["Need official manual"],
              evidenceUrls: ["https://www.firstinspires.org/robotics/frc"],
              speculation: ["Theme is canopy / biocore"],
              confidence: "low",
            }),
            promptTokens: 10,
            completionTokens: 20,
            costUsd: 0,
          };
        },
      },
      {
        seasonYear: 2027,
        loopSequence: 1,
        sources: [
          {
            url: "https://www.firstinspires.org/robotics/frc",
            title: "FRC",
            kind: "official",
            excerpt: "FIRST Robotics Competition kickoff and season materials.",
            fetchOk: true,
          },
        ],
        previousGuess: null,
        turnPaceMs: 0,
        minLoopMs: 0,
      },
    );
    expect(turns).toHaveLength(8);
    expect(focuses).toContain("historical_game_comparison");
    expect(focuses).toContain("teaser_and_theme_decode");
    expect(guess.themeGuess).toBe("FIRST CANOPY");
  });
});

describe("deep game analysis job", () => {
  it("skips orgs that are not team 6925", async () => {
    const client = {
      query: vi.fn(async (sql: string) => {
        if (sql.includes("FROM organizations")) {
          return { rows: [{ teamNumber: 254 }] };
        }
        throw new Error(`unexpected ${sql}`);
      }),
    };
    const result = await runDeepGameAnalysisJob(client as never, {} as never, "org-1", {
      runId: "run-1",
    });
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/6925/);
    expect(result.guess).toEqual(emptyGuess());
  });
});
