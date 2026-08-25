import { describe, expect, it } from "vitest";
import {
  assembleDreamPrompt,
  clampExcerpt,
  deterministicDigest,
  emptyDreamDigest,
  formatHours,
  hasActivity,
  matchOutcome,
  predictionHitRate,
  renderDigestFacts,
  type DreamDigest,
} from "./compute-dream";

const DAY = "2026-08-22";

function fullDigest(): DreamDigest {
  return {
    orgName: "Robo Raiders 9999",
    day: DAY,
    messages: {
      count: 4,
      recent: [
        { author: "Ada", excerpt: "Swapped the intake belt before practice" },
        { author: "Grace", excerpt: "Scouting sheets for Saturday are ready" },
      ],
    },
    scouting: {
      total: 12,
      byEvent: [{ eventKey: "2026txho", matchEntries: 10, pitEntries: 2 }],
    },
    decisions: {
      count: 1,
      items: [{ title: "Switch to 4-wheel swerve", category: "design", status: "accepted" }],
    },
    tasksCompleted: {
      count: 2,
      items: [
        { title: "Wire the new radio mount", source: "build", subsystem: "electrical" },
        { title: "Order spare polycarb", source: "todo", subsystem: null },
      ],
    },
    calendarEvents: { count: 1, items: [{ title: "Drive practice", kind: "practice" }] },
    incidents: {
      openedCount: 1,
      resolvedCount: 1,
      items: [
        { title: "Frayed battery lead", kind: "safety_incident", action: "opened" },
        { title: "Bent intake plate", kind: "pit_repair", action: "resolved" },
      ],
    },
    cadJobs: { count: 1, items: [{ title: "Shooter hood rev B", platform: "onshape", status: "completed" }] },
    hours: {
      sessions: 3,
      totalHours: 7.25,
      members: [
        { name: "Ada", hours: 4 },
        { name: "Grace", hours: 3.25 },
      ],
    },
    predictions: { calls: 5, graded: 4, spotOn: 1, close: 2, off: 1, skipped: 1 },
    matchResults: {
      eventKey: "2026txho",
      wins: 1,
      losses: 1,
      ties: 0,
      items: [
        { matchLabel: "qm12", ourAlliance: "red", ourScore: 88, theirScore: 71, outcome: "win" },
        { matchLabel: "qm18", ourAlliance: "blue", ourScore: 54, theirScore: 62, outcome: "loss" },
      ],
    },
    bugs: {
      count: 1,
      items: [{ summary: "Pit checklist loses ticks offline", severity: "blocking", area: "pit" }],
    },
    grantDeadlines: {
      count: 1,
      items: [{ name: "Gene Haas Foundation", funder: "Haas", closesOn: "2026-09-05" }],
    },
  };
}

describe("clampExcerpt", () => {
  it("keeps short text unchanged after collapsing whitespace", () => {
    expect(clampExcerpt("hello   there\n friend")).toBe("hello there friend");
  });

  it("clamps long text to 120 characters with an ellipsis", () => {
    const clamped = clampExcerpt("x".repeat(500));
    expect(clamped.length).toBeLessThanOrEqual(120);
    expect(clamped.endsWith("…")).toBe(true);
  });

  it("respects a custom maximum", () => {
    expect(clampExcerpt("abcdefghij", 5)).toBe("abcd…");
  });
});

describe("hasActivity", () => {
  it("is false for an empty digest", () => {
    expect(hasActivity(emptyDreamDigest("Team", DAY))).toBe(false);
  });

  it("is true when any single activity counter is set", () => {
    const variants: Array<(digest: DreamDigest) => void> = [
      (d) => (d.messages.count = 1),
      (d) => (d.scouting.total = 1),
      (d) => (d.decisions.count = 1),
      (d) => (d.tasksCompleted.count = 1),
      (d) => (d.calendarEvents.count = 1),
      (d) => (d.incidents.openedCount = 1),
      (d) => (d.incidents.resolvedCount = 1),
      (d) => (d.cadJobs.count = 1),
      (d) => (d.hours.sessions = 1),
      (d) => (d.predictions.calls = 1),
      (d) =>
        d.matchResults.items.push({
          matchLabel: "qm1",
          ourAlliance: "red",
          ourScore: null,
          theirScore: null,
          outcome: "unknown",
        }),
      (d) => (d.bugs.count = 1),
      (d) => (d.grantDeadlines.count = 1),
    ];
    for (const mutate of variants) {
      const digest = emptyDreamDigest("Team", DAY);
      mutate(digest);
      expect(hasActivity(digest)).toBe(true);
    }
  });
});

describe("renderDigestFacts", () => {
  it("renders only recorded facts and omits empty sections", () => {
    const digest = emptyDreamDigest("Team", DAY);
    digest.messages = { count: 1, recent: [{ author: "Ada", excerpt: "hi" }] };
    const facts = renderDigestFacts(digest);
    expect(facts).toContain("Team chat: 1 message posted.");
    expect(facts).toContain("- Ada: hi");
    expect(facts).not.toContain("Scouting");
    expect(facts).not.toContain("Decisions");
    expect(facts).not.toContain("CAD");
    expect(facts).not.toContain("undefined");
  });

  it("renders every populated section with its real numbers", () => {
    const facts = renderDigestFacts(fullDigest());
    expect(facts).toContain("Team chat: 4 messages posted.");
    expect(facts).toContain("- 2026txho: 10 match entries, 2 pit entries");
    expect(facts).toContain("Switch to 4-wheel swerve (design, accepted)");
    expect(facts).toContain("- Wire the new radio mount [electrical]");
    expect(facts).toContain("Drive practice (practice)");
    expect(facts).toContain("Incidents & pit repairs: 1 opened, 1 resolved.");
    expect(facts).toContain("- resolved: Bent intake plate (pit repair)");
    expect(facts).toContain("Shooter hood rev B (onshape, completed)");
  });

  it("renders shop hours with per-member totals", () => {
    const facts = renderDigestFacts(fullDigest());
    expect(facts).toContain("Shop hours logged: 7.3 h across 3 closed sessions.");
    expect(facts).toContain("- Ada: 4 h");
    expect(facts).toContain("- Grace: 3.3 h");
  });

  it("renders call-your-shot counts with a hit rate over graded calls only", () => {
    const facts = renderDigestFacts(fullDigest());
    expect(facts).toContain("Call-your-shot: 5 calls recorded");
    expect(facts).toContain("1 spot-on, 2 close, 1 off");
    expect(facts).toContain("1 skipped");
    // 3 of 4 graded landed spot-on or close.
    expect(facts).toContain("Hit rate (spot-on or close): 75%.");
  });

  it("states there is no hit rate when every call was skipped", () => {
    const digest = emptyDreamDigest("Team", DAY);
    digest.predictions = { calls: 2, graded: 0, spotOn: 0, close: 0, off: 0, skipped: 2 };
    const facts = renderDigestFacts(digest);
    expect(facts).toContain("No graded calls, so no hit rate.");
    expect(facts).not.toContain("Hit rate (spot-on");
  });

  it("renders match results as a W-L-T record with each match", () => {
    const facts = renderDigestFacts(fullDigest());
    expect(facts).toContain("Match results at 2026txho: 1-1-0 (W-L-T) over 2 matches.");
    expect(facts).toContain("- qm12 (red): win, 88-71");
    expect(facts).toContain("- qm18 (blue): loss, 54-62");
  });

  it("says the score is not posted rather than inventing one", () => {
    const digest = emptyDreamDigest("Team", DAY);
    digest.matchResults = {
      eventKey: "2026txho",
      wins: 0,
      losses: 0,
      ties: 0,
      items: [
        { matchLabel: "qm3", ourAlliance: "red", ourScore: null, theirScore: null, outcome: "unknown" },
      ],
    };
    const facts = renderDigestFacts(digest);
    expect(facts).toContain("- qm3 (red): unknown, score not posted");
    expect(facts).not.toContain("null");
  });

  it("renders bug reports and newly-near funding deadlines", () => {
    const facts = renderDigestFacts(fullDigest());
    expect(facts).toContain("Bug reports filed: 1.");
    expect(facts).toContain("- Pit checklist loses ticks offline (blocking, pit)");
    expect(facts).toContain("Funding deadlines now inside 14 days: 1.");
    expect(facts).toContain("- Gene Haas Foundation — Haas: closes 2026-09-05");
  });

  it("omits every new section when nothing was recorded for it", () => {
    const digest = emptyDreamDigest("Team", DAY);
    digest.messages = { count: 1, recent: [{ author: "Ada", excerpt: "hi" }] };
    const facts = renderDigestFacts(digest);
    for (const heading of [
      "Shop hours",
      "Call-your-shot",
      "Match results",
      "Bug reports",
      "Funding deadlines",
    ]) {
      expect(facts).not.toContain(heading);
    }
  });
});

describe("predictionHitRate", () => {
  it("is null when nothing was graded — never a rate from zero calls", () => {
    expect(predictionHitRate({ calls: 3, graded: 0, spotOn: 0, close: 0, off: 0, skipped: 3 })).toBeNull();
  });

  it("counts spot-on and close as hits over graded calls", () => {
    expect(predictionHitRate({ calls: 4, graded: 4, spotOn: 1, close: 1, off: 2, skipped: 0 })).toBe(0.5);
  });
});

describe("formatHours", () => {
  it("drops a trailing .0 and keeps one decimal otherwise", () => {
    expect(formatHours(4)).toBe("4");
    expect(formatHours(3.25)).toBe("3.3");
    expect(formatHours(0.04)).toBe("0");
  });
});

describe("matchOutcome", () => {
  it("trusts an explicit winning alliance", () => {
    expect(
      matchOutcome({ ourAlliance: "red", winningAlliance: "red", ourScore: 1, theirScore: 99 }),
    ).toBe("win");
    expect(
      matchOutcome({ ourAlliance: "blue", winningAlliance: "red", ourScore: null, theirScore: null }),
    ).toBe("loss");
  });

  it("falls back to posted scores when the winner is blank (a tie)", () => {
    expect(matchOutcome({ ourAlliance: "red", winningAlliance: "", ourScore: 50, theirScore: 50 })).toBe(
      "tie",
    );
    expect(matchOutcome({ ourAlliance: "red", winningAlliance: "", ourScore: 51, theirScore: 50 })).toBe(
      "win",
    );
  });

  it("stays unknown rather than guessing when no scores are posted", () => {
    expect(
      matchOutcome({ ourAlliance: "red", winningAlliance: null, ourScore: null, theirScore: 40 }),
    ).toBe("unknown");
  });
});

describe("assembleDreamPrompt", () => {
  it("carries the never-invent grounding contract and the four sections", () => {
    const prompt = assembleDreamPrompt(fullDigest());
    expect(prompt).toContain("Never invent");
    expect(prompt).toContain("it did not happen");
    expect(prompt).toContain("What happened");
    expect(prompt).toContain("What changed");
    expect(prompt).toContain("Open threads");
    expect(prompt).toContain("What tomorrow-you should know");
    expect(prompt).toContain('write exactly "Nothing recorded."');
  });

  it("embeds the day, org name, and the exact rendered facts", () => {
    const digest = fullDigest();
    const prompt = assembleDreamPrompt(digest);
    expect(prompt).toContain(DAY);
    expect(prompt).toContain("Robo Raiders 9999");
    expect(prompt).toContain(renderDigestFacts(digest));
  });
});

describe("deterministicDigest", () => {
  it("is deterministic for the same digest", () => {
    expect(deterministicDigest(fullDigest())).toBe(deterministicDigest(fullDigest()));
  });

  it("states it is auto-generated and repeats only recorded facts", () => {
    const text = deterministicDigest(fullDigest());
    expect(text).toContain(`Team recap for ${DAY}`);
    expect(text).toContain("no AI summary available");
    expect(text).toContain(renderDigestFacts(fullDigest()));
    expect(text).not.toContain("undefined");
  });
});
