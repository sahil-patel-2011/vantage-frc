import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  CompleteOutreachError,
  completeOutreachEventToImpact,
  findLatestOutreachEventId,
  impactActivityFromOutreachEvent,
  impactDescriptionFromOutreach,
  mapOutreachAudienceToImpact,
  mapOutreachCategoryToImpact,
  outreachImpactSourceMarker,
  peopleReachedFromOutreach,
  projectedHoursToDurationMinutes,
  shouldWriteImpactForStatus,
  type OutreachEventForImpact,
} from "./complete-to-impact";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const EVENT_ID = "22222222-2222-4222-8222-222222222222";

function event(overrides: Partial<OutreachEventForImpact> = {}): OutreachEventForImpact {
  return {
    id: EVENT_ID,
    title: "Elementary STEM night",
    category: "stem_demo",
    scheduledOn: "2026-09-10",
    status: "planned",
    audience: "k12",
    projectedHours: 8,
    projectedPeopleReached: 150,
    location: "Lincoln Elementary",
    notes: "Bring the practice robot.",
    seasonYear: 2026,
    ...overrides,
  };
}

type Call = { sql: string; params: unknown[] };

function mockClient(options: {
  event?: OutreachEventForImpact | null;
  /** Hit on source_event_id (preferred 0513 key). */
  existingActivityId?: string | null;
  /** Hit on description marker only — column miss, pre-0513 fallback. */
  existingMarkerActivityId?: string | null;
  latestEventId?: string | null;
  insertedActivityId?: string;
}) {
  const calls: Call[] = [];
  const client = {
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      calls.push({ sql, params });
      if (sql.includes("FROM outreach_calendar_events") && sql.includes("WHERE id = $1")) {
        return options.event
          ? { rows: [options.event], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM outreach_calendar_events") && sql.includes("ORDER BY created_at")) {
        return options.latestEventId
          ? { rows: [{ id: options.latestEventId }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM impact_activities") && sql.includes("source_event_id")) {
        return options.existingActivityId
          ? { rows: [{ id: options.existingActivityId }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("FROM impact_activities") && sql.includes("description LIKE")) {
        return options.existingMarkerActivityId
          ? { rows: [{ id: options.existingMarkerActivityId }], rowCount: 1 }
          : { rows: [], rowCount: 0 };
      }
      if (sql.includes("INSERT INTO impact_activities")) {
        return { rows: [{ id: options.insertedActivityId ?? "act-new" }], rowCount: 1 };
      }
      if (sql.includes("UPDATE outreach_calendar_events")) {
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    }),
  } as unknown as PoolClient;
  return { client, calls };
}

describe("shouldWriteImpactForStatus", () => {
  it("stays empty until the event is completed", () => {
    expect(shouldWriteImpactForStatus("planned")).toBe(false);
    expect(shouldWriteImpactForStatus("confirmed")).toBe(false);
    expect(shouldWriteImpactForStatus("canceled")).toBe(false);
    expect(shouldWriteImpactForStatus("completed")).toBe(true);
  });
});

describe("projectedHoursToDurationMinutes", () => {
  it("converts real projected hours and refuses DEMO / invented hours", () => {
    expect(projectedHoursToDurationMinutes(8)).toBe(480);
    expect(projectedHoursToDurationMinutes("1.5")).toBe(90);
    expect(projectedHoursToDurationMinutes(0)).toBe(0);
    expect(projectedHoursToDurationMinutes("")).toBe(0);
    expect(projectedHoursToDurationMinutes(null)).toBe(0);
    expect(projectedHoursToDurationMinutes(-4)).toBe(0);
    expect(projectedHoursToDurationMinutes("demo")).toBe(0);
  });
});

describe("peopleReachedFromOutreach", () => {
  it("rounds real reach and stays zero when the event has none", () => {
    expect(peopleReachedFromOutreach(150)).toBe(150);
    expect(peopleReachedFromOutreach("12.4")).toBe(12);
    expect(peopleReachedFromOutreach(0)).toBe(0);
    expect(peopleReachedFromOutreach(null)).toBe(0);
  });
});

describe("mapOutreachCategoryToImpact", () => {
  it("keeps shared categories and maps fundraising onto other (no parallel island type)", () => {
    expect(mapOutreachCategoryToImpact("stem_demo")).toBe("stem_demo");
    expect(mapOutreachCategoryToImpact("mentoring")).toBe("mentoring");
    expect(mapOutreachCategoryToImpact("community_event")).toBe("community_event");
    expect(mapOutreachCategoryToImpact("media")).toBe("media");
    expect(mapOutreachCategoryToImpact("fundraising")).toBe("other");
    expect(mapOutreachCategoryToImpact("other")).toBe("other");
  });
});

describe("mapOutreachAudienceToImpact", () => {
  it("keeps shared audiences and falls back without inventing one", () => {
    expect(mapOutreachAudienceToImpact("k12")).toBe("k12");
    expect(mapOutreachAudienceToImpact("industry")).toBe("industry");
    expect(mapOutreachAudienceToImpact("unknown")).toBe("other");
  });
});

describe("impactActivityFromOutreachEvent", () => {
  it("copies the event onto an impact_activities row using only scheduled numbers", () => {
    const row = impactActivityFromOutreachEvent(event(), { orgId: ORG, userId: USER });
    expect(row).toEqual({
      orgId: ORG,
      title: "Elementary STEM night",
      category: "stem_demo",
      occurredOn: "2026-09-10",
      durationMinutes: 480,
      participantCount: 0,
      peopleReached: 150,
      audience: "k12",
      location: "Lincoln Elementary",
      description: `Bring the practice robot.\n\n${outreachImpactSourceMarker(EVENT_ID)}`,
      seasonYear: 2026,
      evidenceAwards: [],
      loggedBy: USER,
      sourceEventId: EVENT_ID,
    });
  });

  it("writes zero minutes when the event has no projected hours — never DEMO hours", () => {
    const row = impactActivityFromOutreachEvent(event({ projectedHours: 0, notes: null }), {
      orgId: ORG,
      userId: USER,
    });
    expect(row.durationMinutes).toBe(0);
    expect(row.participantCount).toBe(0);
    expect(row.evidenceAwards).toEqual([]);
    expect(row.description).toBe(outreachImpactSourceMarker(EVENT_ID));
  });
});

describe("impactDescriptionFromOutreach", () => {
  it("stamps a source marker so a second complete can find the same row", () => {
    expect(impactDescriptionFromOutreach("  notes  ", EVENT_ID)).toContain(
      outreachImpactSourceMarker(EVENT_ID),
    );
    expect(impactDescriptionFromOutreach(null, EVENT_ID)).toBe(outreachImpactSourceMarker(EVENT_ID));
  });
});

describe("completeOutreachEventToImpact", () => {
  it("inserts a real impact_activities row and marks the event completed", async () => {
    const { client, calls } = mockClient({ event: event() });
    const result = await completeOutreachEventToImpact(client, {
      orgId: ORG,
      userId: USER,
      eventId: EVENT_ID,
    });

    expect(result).toEqual({ eventId: EVENT_ID, activityId: "act-new", created: true });
    const insert = calls.find((call) => call.sql.includes("INSERT INTO impact_activities"));
    expect(insert).toBeDefined();
    expect(insert!.sql).toContain("INSERT INTO impact_activities");
    expect(insert!.params[0]).toBe(ORG);
    expect(insert!.params[1]).toBe("Elementary STEM night");
    expect(insert!.params[2]).toBe("stem_demo");
    expect(insert!.params[3]).toBe("2026-09-10");
    expect(insert!.params[4]).toBe(480);
    expect(insert!.params[5]).toBe(0);
    expect(insert!.params[6]).toBe(150);
    expect(insert!.params[12]).toBe(USER);
    expect(String(insert!.params[9])).toContain(outreachImpactSourceMarker(EVENT_ID));
    expect(insert!.sql).toContain("source_event_id");
    expect(insert!.params[13]).toBe(EVENT_ID);
    expect(calls.some((call) => call.sql.includes("UPDATE outreach_calendar_events"))).toBe(true);
  });

  it("does not insert a second row when source_event_id already matches", async () => {
    const { client, calls } = mockClient({
      event: event({ status: "completed" }),
      existingActivityId: "act-existing",
    });
    const result = await completeOutreachEventToImpact(client, {
      orgId: ORG,
      userId: USER,
      eventId: EVENT_ID,
    });

    expect(result).toEqual({ eventId: EVENT_ID, activityId: "act-existing", created: false });
    expect(calls.some((call) => call.sql.includes("INSERT INTO impact_activities"))).toBe(false);
    expect(calls.some((call) => call.sql.includes("UPDATE outreach_calendar_events"))).toBe(false);
    expect(calls.some((call) => call.sql.includes("source_event_id"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("description LIKE"))).toBe(false);
  });

  it("falls back to the description marker when source_event_id is empty", async () => {
    const { client, calls } = mockClient({
      event: event({ status: "completed" }),
      existingMarkerActivityId: "act-from-marker",
    });
    const result = await completeOutreachEventToImpact(client, {
      orgId: ORG,
      userId: USER,
      eventId: EVENT_ID,
    });

    expect(result).toEqual({ eventId: EVENT_ID, activityId: "act-from-marker", created: false });
    expect(calls.some((call) => call.sql.includes("source_event_id"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("description LIKE"))).toBe(true);
    expect(calls.some((call) => call.sql.includes("INSERT INTO impact_activities"))).toBe(false);
  });

  it("writes zero-hour completed events instead of inventing DEMO hours", async () => {
    const { client, calls } = mockClient({ event: event({ projectedHours: 0, projectedPeopleReached: 0 }) });
    await completeOutreachEventToImpact(client, { orgId: ORG, userId: USER, eventId: EVENT_ID });
    const insert = calls.find((call) => call.sql.includes("INSERT INTO impact_activities"));
    expect(insert!.params[4]).toBe(0);
    expect(insert!.params[6]).toBe(0);
  });

  it("throws when the calendar event is missing", async () => {
    const { client } = mockClient({ event: null });
    await expect(
      completeOutreachEventToImpact(client, { orgId: ORG, userId: USER, eventId: EVENT_ID }),
    ).rejects.toMatchObject({ name: "CompleteOutreachError", status: 404 });
    expect(CompleteOutreachError).toBeDefined();
  });
});

describe("findLatestOutreachEventId", () => {
  it("returns the newest matching calendar event after a create", async () => {
    const { client } = mockClient({ latestEventId: EVENT_ID });
    await expect(
      findLatestOutreachEventId(client, {
        orgId: ORG,
        title: "Elementary STEM night",
        scheduledOn: "2026-09-10",
      }),
    ).resolves.toBe(EVENT_ID);
  });
});
