import { describe, expect, it } from "vitest";
import {
  DISPLAY_FONT_SCALES,
  DISPLAY_PHASE_SCREENS,
  bracketRounds,
  displayKioskHref,
  displayPhase,
  fontScaleLabel,
  nextFontScale,
  sponsorScrollText,
  stageRotation,
  stageScreenAt,
  stageScreenHasContent,
  type DisplayPlayoffRow,
} from "./display";

const progress = (over: Partial<Record<string, number>> = {}) => ({
  qualsTotal: 0,
  qualsPlayed: 0,
  playoffTotal: 0,
  playoffPlayed: 0,
  ...over,
}) as { qualsTotal: number; qualsPlayed: number; playoffTotal: number; playoffPlayed: number };

describe("displayPhase", () => {
  it("stays pre-event until synced quals actually start", () => {
    expect(displayPhase({ progress: null })).toBe("pre_event");
    expect(displayPhase({ progress: progress() })).toBe("pre_event");
    expect(displayPhase({ progress: progress({ qualsTotal: 60 }) })).toBe("pre_event");
  });

  it("moves through quals, alliance selection, playoffs, and post-event", () => {
    expect(displayPhase({ progress: progress({ qualsTotal: 60, qualsPlayed: 12 }) })).toBe("quals");
    // Every qual played and no bracket posted yet is the alliance-selection gap.
    expect(displayPhase({ progress: progress({ qualsTotal: 60, qualsPlayed: 60 }) })).toBe(
      "alliance_selection",
    );
    expect(
      displayPhase({ progress: progress({ qualsTotal: 60, qualsPlayed: 60, playoffTotal: 14 }) }),
    ).toBe("playoffs");
    expect(
      displayPhase({
        progress: progress({ qualsTotal: 60, qualsPlayed: 60, playoffTotal: 14, playoffPlayed: 14 }),
      }),
    ).toBe("post_event");
  });

  it("handles a playoff-only (offseason) bracket without quals", () => {
    expect(displayPhase({ progress: progress({ playoffTotal: 8 }) })).toBe("playoffs");
    expect(displayPhase({ progress: progress({ playoffTotal: 8, playoffPlayed: 8 }) })).toBe(
      "post_event",
    );
  });
});

describe("stage rotation", () => {
  const full = {
    schedule: [{ matchKey: "m1" }] as never,
    rankings: [{ teamKey: "frc1" }] as never,
    playoffMatches: [{ matchKey: "sf1" }] as never,
    sponsors: [{ name: "Acme", tier: "gold" }],
    nexus: { live: {}, pits: {}, map: {}, syncedAt: null },
    eventStatus: null,
  };

  it("cycles the screens for a phase and wraps", () => {
    expect(stageScreenAt("quals", 0)).toBe(DISPLAY_PHASE_SCREENS.quals[0]);
    expect(stageScreenAt("quals", 3)).toBe(DISPLAY_PHASE_SCREENS.quals[0]);
    expect(stageScreenAt("quals", -1)).toBe(DISPLAY_PHASE_SCREENS.quals[2]);
  });

  it("drops screens with no rows behind them", () => {
    expect(stageRotation("quals", full)).toEqual(DISPLAY_PHASE_SCREENS.quals);
    const noNexus = { ...full, nexus: null };
    expect(stageRotation("quals", noNexus)).toEqual(["next_match", "rankings"]);
    const nothing = {
      schedule: [],
      rankings: [],
      playoffMatches: [],
      sponsors: [],
      nexus: null,
      eventStatus: null,
    };
    expect(stageRotation("quals", nothing)).toEqual([]);
    expect(stageRotation("post_event", nothing)).toEqual([]);
  });

  it("only claims content for screens whose rows exist", () => {
    expect(stageScreenHasContent("thanks", { ...full, sponsors: [] })).toBe(false);
    expect(
      stageScreenHasContent("thanks", {
        ...full,
        sponsors: [],
        eventStatus: { rank: 3, wins: 8, losses: 2, ties: 0, source: "tba" },
      }),
    ).toBe(true);
    expect(stageScreenHasContent("pit_map", { ...full, nexus: null })).toBe(false);
  });
});

describe("10-foot controls", () => {
  it("cycles font scales", () => {
    expect(nextFontScale(1)).toBe(1.25);
    expect(nextFontScale(DISPLAY_FONT_SCALES[DISPLAY_FONT_SCALES.length - 1])).toBe(
      DISPLAY_FONT_SCALES[0],
    );
    expect(nextFontScale(99)).toBe(DISPLAY_FONT_SCALES[0]);
    expect(fontScaleLabel(1.25)).toBe("125%");
  });

  it("routes the stage token URL", () => {
    expect(displayKioskHref("https://app.example", "tok_1", "stage")).toBe(
      "https://app.example/display/stage?token=tok_1",
    );
  });
});

describe("sponsor scroll", () => {
  it("is empty when the team has no sponsor rows — never filler", () => {
    expect(sponsorScrollText([])).toBe("");
    expect(sponsorScrollText(null)).toBe("");
    expect(sponsorScrollText([{ name: "  ", tier: null }])).toBe("");
  });

  it("thanks the real rows", () => {
    expect(sponsorScrollText([{ name: "Acme", tier: "gold" }, { name: "Widgets", tier: null }])).toBe(
      "THANK YOU TO OUR SPONSORS · Acme · Widgets",
    );
  });
});

describe("bracketRounds", () => {
  const row = (compLevel: string, setNumber: number): DisplayPlayoffRow => ({
    matchKey: `${compLevel}${setNumber}`,
    compLevel,
    setNumber,
    matchNumber: 1,
    scheduledTime: null,
    redAlliance: { teamKeys: [] },
    blueAlliance: { teamKeys: [] },
    winningAlliance: null,
  });

  it("groups consecutive rounds and tolerates an empty bracket", () => {
    expect(bracketRounds([row("sf", 1), row("sf", 2), row("f", 1)])).toEqual([
      { compLevel: "sf", matches: [row("sf", 1), row("sf", 2)] },
      { compLevel: "f", matches: [row("f", 1)] },
    ]);
    expect(bracketRounds([])).toEqual([]);
    expect(bracketRounds(null)).toEqual([]);
  });
});
