import { describe, expect, it } from "vitest";
import { buildParentDigest, digestPeriod, type DigestEvent } from "./digest";

const base = {
  orgName: "Robo Raiders",
  teamNumber: 1234,
  periodStart: "2026-08-24",
  periodEnd: "2026-08-30",
};

function event(overrides: Partial<DigestEvent> = {}): DigestEvent {
  return {
    title: "Build session",
    startsAt: "2026-08-25T23:00:00.000Z",
    endsAt: "2026-08-26T02:00:00.000Z",
    location: "Room 204",
    ...overrides,
  };
}

describe("buildParentDigest", () => {
  it("returns null for an empty week — nothing is ever fabricated", () => {
    expect(buildParentDigest({ ...base, events: [] })).toBeNull();
    expect(buildParentDigest({ ...base, events: [], logisticsNotes: "   " })).toBeNull();
  });

  it("returns null when every event is unusable", () => {
    expect(
      buildParentDigest({
        ...base,
        events: [event({ title: "  " }), event({ startsAt: "not-a-date" })],
      }),
    ).toBeNull();
  });

  it("builds subject/text/html from real events", () => {
    const digest = buildParentDigest({ ...base, events: [event()] });
    expect(digest).not.toBeNull();
    expect(digest?.subject).toBe("Robo Raiders (Team 1234): 1 upcoming event this week");
    expect(digest?.text).toContain("Build session");
    expect(digest?.text).toContain("@ Room 204");
    expect(digest?.text).toContain("2026-08-24 to 2026-08-30");
    expect(digest?.text).toContain("one-way update");
    expect(digest?.html).toContain("<li>");
  });

  it("sends a note-only update when mentors wrote one", () => {
    const digest = buildParentDigest({ ...base, events: [], logisticsNotes: "Bring safety glasses." });
    expect(digest?.subject).toBe("Robo Raiders (Team 1234): team update");
    expect(digest?.text).toContain("Bring safety glasses.");
  });

  it("sorts events and groups them by day", () => {
    const digest = buildParentDigest({
      ...base,
      events: [
        event({ title: "Later", startsAt: "2026-08-27T22:00:00.000Z", endsAt: null }),
        event({ title: "Earlier", startsAt: "2026-08-25T22:00:00.000Z", endsAt: null }),
      ],
    });
    const text = digest?.text ?? "";
    expect(text.indexOf("Earlier")).toBeLessThan(text.indexOf("Later"));
    expect(digest?.subject).toContain("2 upcoming events");
  });

  it("escapes html but not text", () => {
    const digest = buildParentDigest({
      ...base,
      events: [event({ title: "Kickoff <live>", location: "" })],
    });
    expect(digest?.text).toContain("Kickoff <live>");
    expect(digest?.html).toContain("Kickoff &lt;live&gt;");
    expect(digest?.html).not.toContain("<live>");
  });

  it("formats times in the requested zone and survives a bogus zone", () => {
    const inZone = buildParentDigest({
      ...base,
      timeZone: "America/New_York",
      events: [event({ startsAt: "2026-08-25T23:00:00.000Z", endsAt: null })],
    });
    expect(inZone?.text).toContain("7:00");
    const bogus = buildParentDigest({ ...base, timeZone: "Not/AZone", events: [event()] });
    expect(bogus).not.toBeNull();
  });

  it("omits the team number when the org has none", () => {
    const digest = buildParentDigest({ ...base, teamNumber: null, events: [event()] });
    expect(digest?.subject).toBe("Robo Raiders: 1 upcoming event this week");
  });
});

describe("digestPeriod", () => {
  it("covers exactly seven days inclusive of the start date", () => {
    const period = digestPeriod(new Date("2026-08-24T12:00:00.000Z"));
    expect(period).toEqual({ periodStart: "2026-08-24", periodEnd: "2026-08-30" });
  });

  it("crosses month and year boundaries", () => {
    expect(digestPeriod(new Date("2026-12-29T00:00:00.000Z"))).toEqual({
      periodStart: "2026-12-29",
      periodEnd: "2027-01-04",
    });
  });
});
