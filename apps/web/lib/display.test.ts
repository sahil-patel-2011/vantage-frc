import { describe, expect, it } from "vitest";
import {
  bumperBanner,
  countdownState,
  displayKioskHref,
  formatAlliance,
  hasEventCommandSignal,
  hasReadinessSignal,
  hasScoutingCoverageSignal,
  isDisplayPreset,
  isDisplayWidgetType,
  matchLabel,
  ourBumperColor,
  pitChromiumKioskCommand,
  queueCue,
  rankLabel,
  recordLabel,
  stripFrc,
  formatDisplayPrediction,
  widgetValue,
} from "./display";

describe("display helpers", () => {
  it("strips frc prefixes and formats alliances", () => {
    expect(stripFrc("frc1678")).toBe("1678");
    expect(formatAlliance(["frc254", "frc1678"])).toBe("254 · 1678");
    expect(formatAlliance([])).toBe("-");
  });

  it("builds pit / Pi kiosk URLs without inventing board data", () => {
    expect(displayKioskHref("https://app.example", "tok_1", "pit")).toBe(
      "https://app.example/display/pit?token=tok_1",
    );
    expect(displayKioskHref("https://app.example/", "tok_1", "kiosk")).toContain("/display/kiosk?token=");
    expect(pitChromiumKioskCommand("https://app.example/display/pit?token=tok_1")).toMatch(/chromium-browser --kiosk/);
  });

  it("labels matches and validates presets/widgets", () => {
    expect(matchLabel("qm", 42)).toBe("Qual 42");
    expect(matchLabel("f", 1)).toBe("Final 1");
    expect(isDisplayPreset("next_match")).toBe(true);
    expect(isDisplayPreset("demo")).toBe(false);
    expect(isDisplayWidgetType("prediction")).toBe(true);
    expect(isDisplayWidgetType("secret_chat")).toBe(false);
  });

  it("builds honest countdowns without inventing schedule times", () => {
    expect(countdownState(null, Date.now()).label).toBe("-");
    expect(countdownState("not-a-date", Date.now()).label).toBe("-");

    const now = Date.parse("2026-03-15T12:00:00.000Z");
    const soon = countdownState("2026-03-15T12:10:00.000Z", now);
    expect(soon.label).toBe("10:00");
    expect(soon.leavePit).toBe(true);
    expect(soon.queueSoon).toBe(false);
    expect(soon.queueNow).toBe(false);
    expect(queueCue(soon)).toBe("LEAVE PIT NOW");

    const later = countdownState("2026-03-15T12:30:00.000Z", now);
    expect(later.leavePit).toBe(false);
    expect(later.queueSoon).toBe(false);

    const five = countdownState("2026-03-15T12:04:00.000Z", now);
    expect(five.queueSoon).toBe(true);
    expect(five.queueNow).toBe(false);
    expect(queueCue(five)).toBe("QUEUE SOON");

    const past = countdownState("2026-03-15T11:59:00.000Z", now);
    expect(past.label).toBe("QUEUE NOW");
    expect(past.queueNow).toBe(true);
    expect(queueCue(past)).toBe("QUEUE NOW");
  });

  it("reads bumper color only from the real alliance lists", () => {
    const match = {
      redAlliance: { teamKeys: ["frc111", "frc1678"] },
      blueAlliance: { teamKeys: ["frc254", "frc1323"] },
    };
    expect(ourBumperColor(match, 1678)).toBe("red");
    expect(ourBumperColor(match, 254)).toBe("blue");
    expect(ourBumperColor(match, 9999)).toBeNull();
    expect(bumperBanner("red")).toBe("RED bumpers");
    expect(bumperBanner(null)).toBe("Bumper color unknown");
  });

  it("formats rank/record only from real metrics", () => {
    expect(rankLabel(null)).toBe("-");
    expect(recordLabel(null)).toBe("-");
    expect(rankLabel({ rank: 7, wins: 4, losses: 2, ties: 0, source: "tba" })).toBe("#7");
    expect(recordLabel({ rank: 7, wins: 4, losses: 2, ties: 1, source: "tba" })).toBe("4-2-1");
  });

  it("treats zero readiness counts as no signal (not green)", () => {
    expect(hasReadinessSignal(null)).toBe(false);
    expect(
      hasReadinessSignal({
        batteriesActive: 0,
        batteriesService: 0,
        openFailures: 0,
        openMaintenance: 0,
      }),
    ).toBe(false);
    expect(
      hasReadinessSignal({
        batteriesActive: 2,
        batteriesService: 0,
        openFailures: 0,
        openMaintenance: 0,
      }),
    ).toBe(true);
  });

  it("widgetValue stays empty-honest when modules have no data", () => {
    const empty = {
      nextMatch: null,
      prediction: null,
      scouting: { assignments: 0, reports: 0, openDisagreements: 0 },
      eventStatus: null,
      readiness: null,
      strategyHeadline: null,
    };
    expect(widgetValue("next_match", empty)).toMatch(/No upcoming/i);
    expect(widgetValue("prediction", empty)).toMatch(/No stored prediction/i);
    expect(
      formatDisplayPrediction({
        matchKey: "2026test_qm1",
        pRed: 0.62,
        pBlue: 0.38,
        confidenceLow: 0.5,
        confidenceHigh: 0.7,
        modelVersion: "DEMO",
        keyFactors: [],
        caveats: [],
        scoredAt: null,
      }),
    ).toBe("No grounded prediction");
    expect(
      formatDisplayPrediction({
        matchKey: "2026test_qm1",
        pRed: 0.62,
        pBlue: 0.38,
        confidenceLow: 0.5,
        confidenceHigh: 0.7,
        modelVersion: "strategy-engine-v2",
        keyFactors: [],
        caveats: [],
        scoredAt: null,
      }),
    ).toBe("62% red · 38% blue");
    expect(widgetValue("strategy", empty)).toMatch(/No strategy headline/i);
    expect(widgetValue("robot_readiness", empty)).toMatch(/No readiness data/i);
    expect(widgetValue("event_status", empty)).toMatch(/Rank not synced/i);
    expect(widgetValue("alerts", empty)).toMatch(/No open scout/i);
  });

  it("hides scouting and event-command tiles until real rows exist", () => {
    expect(hasScoutingCoverageSignal(null)).toBe(false);
    expect(hasScoutingCoverageSignal({ assignments: 0, reports: 0, openDisagreements: 0 })).toBe(false);
    expect(hasScoutingCoverageSignal({ assignments: 2, reports: 0, openDisagreements: 0 })).toBe(true);

    expect(
      hasEventCommandSignal({
        nextMatch: null,
        eventStatus: null,
        scouting: { assignments: 0, reports: 0, openDisagreements: 0 },
      }),
    ).toBe(false);
    expect(
      hasEventCommandSignal({
        nextMatch: null,
        eventStatus: { rank: 4, wins: 2, losses: 1, ties: 0, source: "tba" },
        scouting: { assignments: 0, reports: 0, openDisagreements: 0 },
      }),
    ).toBe(true);
  });
});
