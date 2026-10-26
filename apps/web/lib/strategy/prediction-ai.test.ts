import type { PoolClient } from "@neondatabase/serverless";
import { describe, expect, it } from "vitest";
import type { MatchForecast } from "@vantage/prediction-strategy";
import { maybeAdjustMatchForecast, predictionAiRequested } from "./prediction-ai";

const forecast: MatchForecast = {
  modelId: "test",
  red: { auto: 40, teleop: 180, endgame: 10, foul: 4, total: 234 },
  blue: { auto: 30, teleop: 160, endgame: 0, foul: 4, total: 194 },
  redWinProbability: 0.62,
  errorBand: 40,
  redBand: 40,
  blueBand: 40,
  confidence: "Red by 40 points.",
  categoriesKnown: true,
};

describe("prediction AI stays off", () => {
  it("is not requested unless a held-out measurement turns the code flag on", () => {
    expect(predictionAiRequested()).toBe(false);
  });

  it("returns the statistical forecast and does not touch a database", async () => {
    const client = {
      query() {
        throw new Error("database must not be used while the adjustment is off");
      },
    } as unknown as PoolClient;
    const result = await maybeAdjustMatchForecast({
      client,
      orgId: "org",
      userId: "user",
      forecast,
      notes: "Their climber broke in the last match.",
    });
    expect(result.aiUsed).toBe(false);
    expect(result.forecast).toBe(forecast);
    expect(result.note).toBeNull();
  });
});
