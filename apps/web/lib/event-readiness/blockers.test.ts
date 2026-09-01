import { describe, expect, it } from "vitest";
import { summarizeConsent } from "../consent";
import { inspectionProgress } from "../inspection";
import { countLodgingGaps } from "../logistics";
import { packProgress } from "../packing";
import {
  projectConsentBlockers,
  projectEventBlockers,
  projectInspectionBlockers,
  projectLogisticsBlockers,
  projectPackingBlockers,
  type ConsentSnapshot,
  type EventSourceSnapshots,
  type InspectionSnapshot,
  type LogisticsSnapshot,
  type PackingSnapshot,
} from "./blockers";

const EMPTY: EventSourceSnapshots = {
  consent: { forms: [], records: [] },
  packing: { lists: 0, items: [] },
  inspection: { items: [] },
  logistics: { trips: 0, travelLegs: 0, rooms: [] },
};

const CLEAR: EventSourceSnapshots = {
  consent: {
    forms: [
      { id: "med", required: true },
      { id: "photo", required: true },
    ],
    records: [
      { formId: "med", personName: "Sam", status: "verified" },
      { formId: "photo", personName: "Sam", status: "submitted" },
    ],
  },
  packing: { lists: 1, items: [{ packed: true }, { packed: true }] },
  inspection: {
    items: [{ status: "pass" }, { status: "na" }],
    weights: [{ totalLbs: 110, weighedAt: "2026-03-01T00:00:00.000Z" }],
    weightLimitLbs: 115,
  },
  logistics: {
    trips: 1,
    travelLegs: 2,
    rooms: [
      { occupantUserId: "u1", occupantName: "Sam" },
      { occupantUserId: null, occupantName: "Alex" },
    ],
  },
};

describe("projectConsentBlockers", () => {
  it("is not set up — remaining null, never 0 — when no required forms exist", () => {
    const result = projectConsentBlockers({ forms: [], records: [] });
    expect(result.state).toBe("not_set_up");
    expect(result.remaining).toBeNull();
  });

  it("is not set up when forms exist but nobody is tracked", () => {
    const result = projectConsentBlockers({
      forms: [{ id: "med", required: true }],
      records: [],
    });
    expect(result.state).toBe("not_set_up");
    expect(result.remaining).toBeNull();
    expect(result.detail).toContain("no submissions tracked yet");
  });

  it("projects outstanding people from summarizeConsent", () => {
    const snapshot: ConsentSnapshot = {
      forms: [
        { id: "med", required: true },
        { id: "photo", required: true },
        { id: "extra", required: false },
      ],
      records: [
        { formId: "med", personName: "Sam", status: "verified" },
        { formId: "photo", personName: "Sam", status: "submitted" },
        { formId: "med", personName: "Alex", status: "submitted" },
        { formId: "photo", personName: "Alex", status: "pending" },
      ],
    };
    const summary = summarizeConsent(snapshot);
    const result = projectConsentBlockers(snapshot);
    expect(result.state).toBe("live");
    expect(result.remaining).toBe(summary.outstanding);
    expect(result.remaining).toBe(1);
  });
});

describe("projectPackingBlockers", () => {
  it("is not set up — remaining null — when no list is linked to the event", () => {
    const result = projectPackingBlockers({ lists: 0, items: [] });
    expect(result.state).toBe("not_set_up");
    expect(result.remaining).toBeNull();
  });

  it("does not invent remaining=0 for a list with no items", () => {
    const result = projectPackingBlockers({ lists: 1, items: [] });
    expect(packProgress([]).done).toBe(false);
    expect(result.state).toBe("live");
    expect(result.remaining).toBeNull();
  });

  it("projects unpacked items from packProgress", () => {
    const snapshot: PackingSnapshot = { lists: 2, items: [{ packed: true }, { packed: false }, { packed: false }] };
    const progress = packProgress(snapshot.items as Parameters<typeof packProgress>[0]);
    const result = projectPackingBlockers(snapshot);
    expect(result.remaining).toBe(progress.total - progress.packed);
    expect(result.remaining).toBe(2);
  });
});

describe("projectInspectionBlockers", () => {
  it("is not set up — remaining null — when there is no checklist and no overweight weigh-in", () => {
    const result = projectInspectionBlockers({ items: [] });
    expect(inspectionProgress([]).ready).toBe(false);
    expect(result.state).toBe("not_set_up");
    expect(result.remaining).toBeNull();
  });

  it("counts fail + pending from inspectionProgress and treats n/a as resolved", () => {
    const snapshot: InspectionSnapshot = {
      items: [{ status: "pass" }, { status: "na" }, { status: "pending" }, { status: "fail" }],
    };
    const progress = inspectionProgress(snapshot.items as Parameters<typeof inspectionProgress>[0]);
    const result = projectInspectionBlockers(snapshot);
    expect(result.remaining).toBe(progress.fail + progress.pending);
    expect(result.remaining).toBe(2);
  });

  it("adds an overweight weigh-in as one extra blocker", () => {
    const result = projectInspectionBlockers({
      items: [{ status: "pass" }],
      weights: [{ totalLbs: 120, weighedAt: "2026-03-01T00:00:00.000Z" }],
      weightLimitLbs: 115,
    });
    expect(result.remaining).toBe(1);
    expect(result.detail).toMatch(/over/);
  });

  it("does not invent remaining=0 from a weigh-in that is under the limit with no checklist", () => {
    const result = projectInspectionBlockers({
      items: [],
      weights: [{ totalLbs: 110, weighedAt: "2026-03-01T00:00:00.000Z" }],
      weightLimitLbs: 115,
    });
    expect(result.state).toBe("not_set_up");
    expect(result.remaining).toBeNull();
  });
});

describe("projectLogisticsBlockers", () => {
  it("is not set up — remaining null — when no trip exists", () => {
    const result = projectLogisticsBlockers({ trips: 0, travelLegs: 0, rooms: [] });
    expect(result.state).toBe("not_set_up");
    expect(result.remaining).toBeNull();
  });

  it("is not set up when the trip has neither rooms nor travel legs", () => {
    const result = projectLogisticsBlockers({ trips: 1, travelLegs: 0, rooms: [] });
    expect(result.state).toBe("not_set_up");
    expect(result.remaining).toBeNull();
  });

  it("does not invent remaining=0 when legs exist but lodging was never assigned", () => {
    const result = projectLogisticsBlockers({ trips: 1, travelLegs: 3, rooms: [] });
    expect(result.state).toBe("live");
    expect(result.remaining).toBeNull();
  });

  it("projects lodging gaps from countLodgingGaps and counts missing travel legs", () => {
    const snapshot: LogisticsSnapshot = {
      trips: 1,
      travelLegs: 0,
      rooms: [
        { occupantUserId: null, occupantName: "" },
        { occupantUserId: "u1", occupantName: "Sam" },
      ],
    };
    expect(countLodgingGaps(snapshot.rooms)).toBe(1);
    const result = projectLogisticsBlockers(snapshot);
    expect(result.state).toBe("live");
    expect(result.remaining).toBe(2);
  });
});

describe("projectEventBlockers", () => {
  it("returns remaining=null for one event date when any source is unknown — never 0", () => {
    const result = projectEventBlockers({ eventStartDate: "2026-03-12", ...EMPTY });
    expect(result.eventStartDate).toBe("2026-03-12");
    expect(result.remaining).toBeNull();
    expect(result.ready).toBe(false);
    expect(result.unknownSources).toEqual(["inspection", "consent", "packing", "logistics"]);
    expect(result.sources).toHaveLength(4);
    for (const source of result.sources) {
      expect(source.remaining).toBeNull();
      expect(source.href.startsWith("/")).toBe(true);
    }
  });

  it("does not invent a combined 0 when three sources are clear and one is unknown", () => {
    const result = projectEventBlockers({
      eventStartDate: "2026-03-12",
      ...CLEAR,
      packing: { lists: 1, items: [] },
    });
    expect(result.sources.find((s) => s.source === "packing")?.remaining).toBeNull();
    expect(result.remaining).toBeNull();
    expect(result.ready).toBe(false);
    expect(result.unknownSources).toEqual(["packing"]);
  });

  it("totals remaining blockers for one event date from the four real statuses", () => {
    const result = projectEventBlockers({
      eventStartDate: "2026-03-12",
      consent: {
        forms: [
          { id: "med", required: true },
          { id: "photo", required: true },
        ],
        records: [
          { formId: "med", personName: "Sam", status: "verified" },
          { formId: "photo", personName: "Sam", status: "submitted" },
          { formId: "med", personName: "Alex", status: "pending" },
        ],
      },
      packing: { lists: 1, items: [{ packed: true }, { packed: false }, { packed: false }] },
      inspection: {
        items: [{ status: "pass" }, { status: "fail" }, { status: "pending" }, { status: "na" }],
      },
      logistics: {
        trips: 1,
        travelLegs: 2,
        rooms: [
          { occupantUserId: null, occupantName: "" },
          { occupantUserId: "u1", occupantName: "Sam" },
        ],
      },
    });
    expect(result.remaining).toBe(1 + 2 + 2 + 1);
    expect(result.ready).toBe(false);
    expect(result.unknownSources).toEqual([]);
    const bySource = new Map(result.sources.map((s) => [s.source, s.remaining]));
    expect(bySource.get("consent")).toBe(1);
    expect(bySource.get("packing")).toBe(2);
    expect(bySource.get("inspection")).toBe(2);
    expect(bySource.get("logistics")).toBe(1);
  });

  it("reports remaining=0 only when every source is live and clear", () => {
    const result = projectEventBlockers({ eventStartDate: "2026-03-12", ...CLEAR });
    expect(result.remaining).toBe(0);
    expect(result.ready).toBe(true);
    expect(result.unknownSources).toEqual([]);
    for (const source of result.sources) {
      expect(source.state).toBe("live");
      expect(source.remaining).toBe(0);
    }
  });
});
