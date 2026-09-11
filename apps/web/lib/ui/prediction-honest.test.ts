import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FIXTURE_ERROR_BAND,
  errorBandFromMae,
  fixtureSeasonRows,
  scorePredictionMetrics,
  typicalScoreErrorCopy,
} from "@vantage/prediction-strategy";
import { describe, expect, it } from "vitest";
import { nextMatchScoreLine } from "../dashboard/next-match-copy";
import {
  EMPTY_PREDICTION_COPY,
  EMPTY_PREDICTION_NO_RATINGS_COPY,
  EMPTY_PREDICTION_NO_SCHEDULE_COPY,
  EMPTY_PREDICTION_NO_SCHEDULE_SETUP_COPY,
  EMPTY_PREDICTION_SETUP_COPY,
} from "../strategy/prediction-empty-copy";
import { expectPlainCopy } from "./copy-assertions";

const WEB = join(__dirname, "..", "..");
const ROOT = join(__dirname, "..", "..", "..");

/**
 * Student-visible match-prediction chrome. Not Strategy boards already owned by
 * Home + Competition polish, not Match Simulator leftover chrome.
 */
const FILES = [
  "app/dashboard/widgets/next-match.tsx",
  "lib/dashboard/next-match-copy.ts",
  "lib/strategy/prediction-empty-copy.ts",
] as const;

const COPY = [
  EMPTY_PREDICTION_COPY,
  EMPTY_PREDICTION_NO_RATINGS_COPY,
  EMPTY_PREDICTION_NO_SCHEDULE_COPY,
  EMPTY_PREDICTION_NO_SCHEDULE_SETUP_COPY,
  EMPTY_PREDICTION_SETUP_COPY,
] as const;

describe("match prediction stays honest", () => {
  it("locks fixture MAE 89.7 to UI band ±90 — not a season ±3 claim", () => {
    const metrics = scorePredictionMetrics(fixtureSeasonRows());
    expect(metrics.n).toBe(4);
    expect(metrics.mae).toBe(89.7);
    expect(metrics.rmse).toBe(89.88);
    expect(metrics.within3).toBe(0);
    expect(metrics.within5).toBe(0);
    expect(errorBandFromMae(metrics.mae)).toBe(FIXTURE_ERROR_BAND);
    expect(FIXTURE_ERROR_BAND).toBe(90);
    expect(typicalScoreErrorCopy(FIXTURE_ERROR_BAND)).toBe("typical error ±90 (last measured set)");
    expect(nextMatchScoreLine({ redPredicted: 94.4, bluePredicted: 81.2, errorBand: FIXTURE_ERROR_BAND })).toBe(
      "Red 94 · Blue 81 · typical error ±90 (last measured set)",
    );
  });

  it("student empty copy is Needs-setup language without EPA or a ±3 claim", () => {
    for (const line of COPY) {
      expectPlainCopy(line);
      expect(line).not.toMatch(/\bEPA\b/);
      expect(line).not.toMatch(/\bTBA\b/);
      expect(line).not.toMatch(/Statbotics/);
      expect(line).not.toMatch(/±3/);
      expect(line).not.toMatch(/Setup required/);
    }
    expect(EMPTY_PREDICTION_SETUP_COPY).toMatch(/Choose your team/);
  });

  it("student prediction chrome does not claim ±3, Setup required, or EPA", () => {
    for (const rel of FILES) {
      const src = readFileSync(join(WEB, rel), "utf8");
      expect(src, rel).not.toMatch(/Setup required/);
      expect(src, rel).not.toMatch(/typical error ±3/);
      expect(src, rel).not.toMatch(/±3 points/);
      expect(src, rel).not.toMatch(/\bEPA\b/);
    }
    expect(readFileSync(join(WEB, "app/dashboard/widgets/next-match.tsx"), "utf8")).toMatch(
      /nextMatchScoreLine/,
    );
    expect(readFileSync(join(WEB, "lib/dashboard/next-match-copy.ts"), "utf8")).toMatch(
      /typicalScoreErrorCopy/,
    );
    expect(readFileSync(join(WEB, "app/briefing/briefing-client.tsx"), "utf8")).toMatch(/Needs setup/);
    expect(readFileSync(join(WEB, "app/briefing/briefing-client.tsx"), "utf8")).not.toMatch(/Setup required/);
    expect(readFileSync(join(WEB, "lib/strategy/recompute.ts"), "utf8")).toMatch(/EMPTY_PREDICTION_COPY/);
    expect(readFileSync(join(WEB, "lib/strategy/compute-strategy.ts"), "utf8")).toMatch(/EMPTY_PREDICTION_COPY/);
    expect(readFileSync(join(WEB, "lib/strategy/compute-strategy.ts"), "utf8")).not.toMatch(/event\/year EPA/);
  });

  it("PREDICTION_RESULTS.md prints 89.7 / ±90 and refuses a season ±3 claim", () => {
    const doc = readFileSync(join(ROOT, "docs/PREDICTION_RESULTS.md"), "utf8");
    expect(doc).toMatch(/\*\*89\.7\*\*/);
    expect(doc).toMatch(/FIXTURE_ERROR_BAND.*\*\*90\*\*/);
    expect(doc).toMatch(/typical error ±90 \(last measured set\)/);
    expect(doc).toMatch(/This is not a ±3 claim/);
    expect(doc).not.toMatch(/season ±3/);
  });
});
