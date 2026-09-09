import { describe, expect, it } from "vitest";
import { normalizeParticipantInput, summarizePeople } from "./participants";
import type { ImpactActivity } from "./types";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

function activity(over: Partial<ImpactActivity> & { id: string }): ImpactActivity {
  return {
    title: "Library demo",
    category: "stem_demo",
    occurredOn: "2026-02-01",
    durationMinutes: 240,
    participantCount: 6,
    peopleReached: 80,
    audience: "public",
    location: null,
    seasonYear: 2026,
    description: null,
    evidenceAwards: [],
    participants: [],
    ...over,
  };
}

describe("summarizePeople", () => {
  it("sums only recorded minutes and never credits the activity's duration", () => {
    const people = summarizePeople([
      activity({
        id: "1",
        durationMinutes: 240,
        participants: [
          { userId: A, name: "Ada", minutes: 90, role: null },
          { userId: B, name: "Ben", minutes: null, role: "setup" },
        ],
      }),
    ]);
    expect(people).toEqual([
      { userId: A, name: "Ada", events: 1, minutes: 90, hours: 1.5, unrecorded: 0 },
      { userId: B, name: "Ben", events: 1, minutes: 0, hours: 0, unrecorded: 1 },
    ]);
  });

  it("accumulates across activities and orders by hours then name", () => {
    const people = summarizePeople([
      activity({ id: "1", participants: [{ userId: A, name: "Ada", minutes: 60, role: null }] }),
      activity({
        id: "2",
        participants: [
          { userId: A, name: "Ada", minutes: 30, role: null },
          { userId: B, name: "Ben", minutes: 120, role: null },
        ],
      }),
    ]);
    expect(people.map((p) => [p.name, p.events, p.hours])).toEqual([
      ["Ben", 1, 2],
      ["Ada", 2, 1.5],
    ]);
  });

  it("is empty when nobody has been named — no placeholder people", () => {
    expect(summarizePeople([activity({ id: "1" })])).toEqual([]);
  });
});

describe("normalizeParticipantInput", () => {
  it("keeps valid rows, clamps minutes, and drops junk", () => {
    expect(
      normalizeParticipantInput([
        { userId: A, minutes: "45", role: " driver " },
        { userId: B, minutes: 99999 },
        { userId: "not-a-uuid", minutes: 5 },
        "garbage",
        { userId: A, minutes: 10 },
      ]),
    ).toEqual([
      { userId: A, minutes: 45, role: "driver" },
      { userId: B, minutes: 1440, role: null },
    ]);
  });

  it("treats blank minutes as unrecorded, not zero", () => {
    expect(normalizeParticipantInput([{ userId: A, minutes: "" }])).toEqual([
      { userId: A, minutes: null, role: null },
    ]);
  });

  it("returns nothing for a non-array", () => {
    expect(normalizeParticipantInput({ userId: A })).toEqual([]);
  });
});
