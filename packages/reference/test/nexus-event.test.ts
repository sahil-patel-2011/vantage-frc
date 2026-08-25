import { describe, expect, it } from "vitest";
import {
  NEXUS_QUEUE_STAGES,
  hasNexusMapGeometry,
  nexusAdjustedNow,
  nexusClockOffsetMs,
  nexusCountdownMs,
  nexusQueueStage,
  nexusStageIndex,
  nexusStageLabel,
  parseNexusEvent,
  parseNexusMap,
} from "../src/nexus-client";

/**
 * FIXTURE — hand-built from the documented frc.nexus API v1 shape
 * (GET /event/{key}). This is NOT a captured production response and no field
 * here should be treated as real event data.
 */
const EVENT_FIXTURE = {
  eventKey: "2026week0",
  dataAsOfTime: 1_772_000_000_000,
  now: 1_772_000_005_000,
  nowQueuing: "Qualification 18",
  matches: [
    {
      label: "Qualification 18",
      status: "On field",
      redTeams: ["254", "1678", "118"],
      blueTeams: ["2056", "1114", "27"],
      times: {
        estimatedQueueTime: 1_771_999_000_000,
        estimatedStartTime: 1_772_000_000_000,
        scheduledStartTime: 1_772_000_000_000,
        actualQueueTime: 1_771_999_100_000,
      },
    },
    {
      label: "Qualification 19",
      status: "Now queuing",
      redTeams: ["9999", "1", "2"],
      blueTeams: ["3", "4", "5"],
      times: { estimatedQueueTime: 1_772_000_300_000, estimatedStartTime: 1_772_000_500_000 },
    },
    {
      label: "Qualification 20",
      status: "Queuing soon",
      redTeams: [],
      blueTeams: [],
      times: {},
    },
    "not an object",
  ],
  announcements: [
    { id: "a1", announcement: "Field reset — matches resume in 10 minutes.", postedTime: 1_771_999_500_000 },
    { id: "a2", announcement: "Pit closes at 8pm." },
    { id: "a3" },
  ],
  partsRequests: [
    {
      id: "p1",
      parts: "775 motor, 12T pinion",
      requestedByTeam: 9999,
      postedTime: 1_771_999_900_000,
      status: "open",
    },
    { id: "p2", parts: "Anderson connectors", requestedByTeam: "1234", pitAddress: "B-14" },
    { id: "p3" },
  ],
};

/** FIXTURE — documented GET /event/{key}/map shape. Not real venue geometry. */
const MAP_FIXTURE = {
  width: 800,
  height: 600,
  pits: [
    { id: "pit-9999", team: "9999", x: 10, y: 20, width: 40, height: 30, rotation: 90 },
    { id: "pit-1234", team: 1234, x: 60, y: 20, width: 40, height: 30 },
    { id: "broken", team: "5", x: 10 },
  ],
  areas: [{ id: "field", label: "Field entrance", x: 0, y: 400, width: 800, height: 100 }],
};

describe("parseNexusEvent", () => {
  it("reads matches, announcements, parts requests, and the server clock", () => {
    const snapshot = parseNexusEvent(EVENT_FIXTURE, "2026week0", "2026-03-01T00:00:00.000Z");
    expect(snapshot.serverNowMs).toBe(1_772_000_005_000);
    expect(snapshot.dataAsOfMs).toBe(1_772_000_000_000);
    expect(snapshot.nowQueuing).toBe("Qualification 18");

    expect(snapshot.matches).toHaveLength(3);
    const [onField, nowQueuing, soon] = snapshot.matches;
    expect(onField).toBeDefined();
    expect(nowQueuing).toBeDefined();
    expect(soon).toBeDefined();
    expect(onField?.stage).toBe("on_field");
    expect(onField?.redTeams).toEqual(["254", "1678", "118"]);
    expect(onField?.actualQueueTime).toBe(1_771_999_100_000);
    expect(nowQueuing?.stage).toBe("now_queuing");
    expect(nowQueuing?.estimatedQueueTime).toBe(1_772_000_300_000);
    expect(soon?.stage).toBe("queuing_soon");
    // A match with no posted times keeps nulls — never a guessed queue time.
    expect(soon?.estimatedQueueTime).toBeNull();
    expect(soon?.estimatedStartTime).toBeNull();

    expect(snapshot.announcements.map((entry) => entry.message)).toEqual([
      "Field reset — matches resume in 10 minutes.",
      "Pit closes at 8pm.",
    ]);
    expect(snapshot.announcements[1]?.postedAtMs).toBeNull();

    expect(snapshot.partsRequests).toHaveLength(2);
    expect(snapshot.partsRequests[0]?.requestedByTeam).toBe("9999");
    expect(snapshot.partsRequests[0]?.pitAddress).toBeNull();
    expect(snapshot.partsRequests[1]?.pitAddress).toBe("B-14");
  });

  it("returns empty lists and null clocks for an unreadable payload", () => {
    for (const body of [null, undefined, "nope", 42, []]) {
      const snapshot = parseNexusEvent(body, "2026week0", "t");
      expect(snapshot.matches).toEqual([]);
      expect(snapshot.announcements).toEqual([]);
      expect(snapshot.partsRequests).toEqual([]);
      expect(snapshot.serverNowMs).toBeNull();
      expect(snapshot.nowQueuing).toBeNull();
    }
  });

  it("keeps every optional field null when the payload omits it", () => {
    const snapshot = parseNexusEvent({ matches: [{}] }, "2026week0", "t");
    expect(snapshot.matches[0]).toMatchObject({
      label: null,
      status: null,
      stage: "unknown",
      redTeams: [],
      blueTeams: [],
      estimatedQueueTime: null,
      estimatedStartTime: null,
    });
  });
});

describe("nexusQueueStage", () => {
  it("covers the documented state machine and tolerates casing", () => {
    expect(nexusQueueStage("Queuing soon")).toBe("queuing_soon");
    expect(nexusQueueStage("NOW QUEUING")).toBe("now_queuing");
    expect(nexusQueueStage("on_deck")).toBe("on_deck");
    expect(nexusQueueStage("On field")).toBe("on_field");
    expect(nexusQueueStage("something else")).toBe("unknown");
    expect(nexusQueueStage(null)).toBe("unknown");
  });

  it("orders the stages and labels them", () => {
    expect(NEXUS_QUEUE_STAGES.map((entry) => entry.stage)).toEqual([
      "queuing_soon",
      "now_queuing",
      "on_deck",
      "on_field",
    ]);
    expect(nexusStageIndex("on_deck")).toBe(2);
    expect(nexusStageIndex("unknown")).toBe(-1);
    expect(nexusStageLabel("now_queuing")).toBe("Now queuing");
    expect(nexusStageLabel("unknown")).toBeNull();
  });
});

describe("parseNexusMap", () => {
  it("keeps drawable geometry and drops shapes missing position or size", () => {
    const map = parseNexusMap(MAP_FIXTURE);
    expect(map.width).toBe(800);
    expect(map.pits).toHaveLength(2);
    expect(map.pits[0]?.teamNumber).toBe("9999");
    expect(map.pits[1]?.teamNumber).toBe("1234");
    expect(map.pits[1]?.rotation).toBe(0);
    expect(map.areas[0]?.label).toBe("Field entrance");
    expect(hasNexusMapGeometry(map)).toBe(true);
  });

  it("returns empty geometry rather than a stub map", () => {
    const map = parseNexusMap(null);
    expect(map).toEqual({ width: null, height: null, pits: [], areas: [] });
    expect(hasNexusMapGeometry(map)).toBe(false);
    expect(hasNexusMapGeometry(null)).toBe(false);
  });
});

describe("nexus server clock drift", () => {
  it("computes the offset from the Nexus 'now' field", () => {
    expect(nexusClockOffsetMs(1_000_000, 940_000)).toBe(60_000);
    expect(nexusClockOffsetMs(940_000, 1_000_000)).toBe(-60_000);
  });

  it("ignores a missing or absurd server clock", () => {
    expect(nexusClockOffsetMs(null, 1_000)).toBe(0);
    expect(nexusClockOffsetMs(undefined, 1_000)).toBe(0);
    expect(nexusClockOffsetMs(Number.NaN, 1_000)).toBe(0);
    expect(nexusClockOffsetMs(0, 1_772_000_000_000)).toBe(0);
  });

  it("drift-corrects countdowns", () => {
    // Device clock is 60s behind Nexus, so a target 5 min out on the Nexus
    // clock must read 4 min, not 5, on this device.
    const offset = nexusClockOffsetMs(1_000_000, 940_000);
    expect(nexusAdjustedNow(940_000, offset)).toBe(1_000_000);
    expect(nexusCountdownMs(1_300_000, 940_000, offset)).toBe(300_000);
    expect(nexusCountdownMs(null, 940_000, offset)).toBeNull();
  });
});
