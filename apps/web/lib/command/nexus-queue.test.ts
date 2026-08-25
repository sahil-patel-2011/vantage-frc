import { describe, expect, it } from "vitest";
import { parseNexusEvent } from "@vantage/reference";
import {
  buildNexusQueueSnapshot,
  emptyNexusQueueSnapshot,
  formatQueueCountdown,
  hasNexusQueueSignal,
  nexusQueueCountdown,
  pitRow,
  pitsAreNear,
} from "./nexus-queue";

const FETCHED_AT = "2026-03-01T15:00:00.000Z";
const FETCHED_MS = Date.parse(FETCHED_AT);

/** FIXTURE built from the documented frc.nexus payload shape — not real event data. */
function fixtureEvent(overrides: Record<string, unknown> = {}) {
  return parseNexusEvent(
    {
      // Nexus clock is 30s ahead of the device clock at fetch time.
      now: FETCHED_MS + 30_000,
      matches: [
        {
          label: "Qualification 40",
          status: "Queuing soon",
          redTeams: ["1", "2", "3"],
          blueTeams: ["4", "5", "6"],
          times: { estimatedQueueTime: FETCHED_MS + 600_000 },
        },
        {
          label: "Qualification 41",
          status: "Queuing soon",
          redTeams: ["9999", "7", "8"],
          blueTeams: ["9", "10", "11"],
          times: { estimatedQueueTime: FETCHED_MS + 900_000, estimatedStartTime: FETCHED_MS + 1_200_000 },
        },
      ],
      announcements: [
        { id: "a1", announcement: "Older", postedTime: 1_000 },
        { id: "a2", announcement: "Newer", postedTime: 9_000 },
        { id: "a3", announcement: "Middle", postedTime: 5_000 },
        { id: "a4", announcement: "Four", postedTime: 4_000 },
        { id: "a5", announcement: "Five", postedTime: 3_000 },
        { id: "a6", announcement: "Six", postedTime: 2_000 },
      ],
      partsRequests: [
        { id: "p1", parts: "Spare 775", requestedByTeam: "1234", postedTime: 5_000 },
        { id: "p2", parts: "Zip ties", requestedByTeam: "4321", postedTime: 6_000 },
        { id: "p3", parts: "Old resolved", requestedByTeam: "1234", status: "resolved", postedTime: 7_000 },
      ],
      ...overrides,
    },
    "2026week0",
    FETCHED_AT,
  );
}

const PITS = { "9999": "B-14", "1234": "B-02", "4321": "F-30" };

describe("buildNexusQueueSnapshot", () => {
  it("keeps only our matches, the newest five announcements, and open parts requests", () => {
    const snapshot = buildNexusQueueSnapshot({
      event: fixtureEvent(),
      pits: PITS,
      teamNumber: 9999,
    });
    expect(snapshot.ourPitAddress).toBe("B-14");
    expect(snapshot.ourMatches.map((match) => match.label)).toEqual(["Qualification 41"]);
    expect(snapshot.announcements.map((entry) => entry.message)).toEqual([
      "Newer",
      "Middle",
      "Four",
      "Five",
      "Six",
    ]);
    expect(snapshot.partsRequests.map((entry) => entry.id)).toEqual(["p2", "p1"]);
    // Same row B -> near us; row F -> not.
    expect(snapshot.partsRequests.find((entry) => entry.id === "p1")).toMatchObject({
      pitAddress: "B-02",
      nearby: true,
    });
    expect(snapshot.partsRequests.find((entry) => entry.id === "p2")).toMatchObject({
      pitAddress: "F-30",
      nearby: false,
    });
  });

  it("never claims a nearby pit when an address is missing", () => {
    const snapshot = buildNexusQueueSnapshot({ event: fixtureEvent(), pits: {}, teamNumber: 9999 });
    expect(snapshot.ourPitAddress).toBeNull();
    expect(snapshot.partsRequests.every((entry) => entry.nearby === false)).toBe(true);
    expect(snapshot.partsRequests.every((entry) => entry.pitAddress === null)).toBe(true);
  });

  it("returns an empty snapshot without a Nexus payload", () => {
    const snapshot = buildNexusQueueSnapshot({ event: null, pits: PITS, teamNumber: 9999 });
    expect(snapshot).toEqual(emptyNexusQueueSnapshot());
    expect(hasNexusQueueSignal(snapshot)).toBe(false);
    expect(hasNexusQueueSignal(null)).toBe(false);
  });

  it("still surfaces announcements when the org has no team number", () => {
    const snapshot = buildNexusQueueSnapshot({ event: fixtureEvent(), pits: PITS, teamNumber: null });
    expect(snapshot.ourMatches).toEqual([]);
    expect(snapshot.announcements).toHaveLength(5);
    expect(hasNexusQueueSignal(snapshot)).toBe(true);
  });
});

describe("pit adjacency", () => {
  it("parses the row letters", () => {
    expect(pitRow("B-14")).toBe("B");
    expect(pitRow("aa 7")).toBe("AA");
    expect(pitRow("14")).toBeNull();
    expect(pitRow(null)).toBeNull();
  });

  it("requires both addresses", () => {
    expect(pitsAreNear("B-1", "B-9")).toBe(true);
    expect(pitsAreNear("B-1", "C-9")).toBe(false);
    expect(pitsAreNear("B-1", null)).toBe(false);
    expect(pitsAreNear(null, null)).toBe(false);
  });
});

describe("nexusQueueCountdown", () => {
  const snapshot = () =>
    buildNexusQueueSnapshot({ event: fixtureEvent(), pits: PITS, teamNumber: 9999 });

  it("corrects for Nexus server clock drift", () => {
    // Queue time is fetch+900s on the Nexus clock, and Nexus is 30s ahead of us,
    // so on this device the wait is 870s (14:30), not 900s.
    const view = nexusQueueCountdown(snapshot(), FETCHED_MS);
    expect(view.countdownMs).toBe(870_000);
    expect(view.label).toBe("14:30");
    expect(view.urgent).toBe(false);
    expect(view.cue).toBe("STAND BY");
    expect(view.stage).toBe("queuing_soon");
    expect(view.stageLabel).toBe("Queuing soon");
  });

  it("turns urgent inside five minutes", () => {
    const view = nexusQueueCountdown(snapshot(), FETCHED_MS + 600_000);
    expect(view.countdownMs).toBe(270_000);
    expect(view.urgent).toBe(true);
    expect(view.overdue).toBe(false);
    expect(view.cue).toBe("QUEUE SOON");
  });

  it("goes to QUEUE NOW when the posted queue time has passed", () => {
    const view = nexusQueueCountdown(snapshot(), FETCHED_MS + 900_000);
    expect(view.overdue).toBe(true);
    expect(view.cue).toBe("QUEUE NOW");
    expect(view.label).toBe("0:00");
  });

  it("uses the Nexus stage over the clock once we are on deck or on field", () => {
    const onField = buildNexusQueueSnapshot({
      event: fixtureEvent({
        matches: [
          {
            label: "Qualification 41",
            status: "On field",
            redTeams: ["9999"],
            blueTeams: [],
            times: { estimatedQueueTime: FETCHED_MS - 900_000 },
          },
        ],
      }),
      pits: PITS,
      teamNumber: 9999,
    });
    expect(nexusQueueCountdown(onField, FETCHED_MS).cue).toBe("ON FIELD");
  });

  it("shows a dash and no cue when Nexus posted no queue time or match", () => {
    const noTime = buildNexusQueueSnapshot({
      event: fixtureEvent({
        matches: [{ label: "Qualification 41", redTeams: ["9999"], blueTeams: [] }],
      }),
      pits: PITS,
      teamNumber: 9999,
    });
    const view = nexusQueueCountdown(noTime, FETCHED_MS);
    expect(view.countdownMs).toBeNull();
    expect(view.label).toBe("—");
    expect(view.urgent).toBe(false);
    expect(view.cue).toBe("STAND BY");

    const none = nexusQueueCountdown(emptyNexusQueueSnapshot(), FETCHED_MS);
    expect(none.match).toBeNull();
    expect(none.cue).toBeNull();
    expect(none.label).toBe("—");
  });

  it("formats countdowns", () => {
    expect(formatQueueCountdown(null)).toBe("—");
    expect(formatQueueCountdown(-5_000)).toBe("0:00");
    expect(formatQueueCountdown(65_000)).toBe("1:05");
  });
});
