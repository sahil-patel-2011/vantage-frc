import { describe, expect, it } from "vitest";
import { StatboticsClient } from "../src/statbotics-client";
import { TbaClient } from "../src/tba-client";
import type {
  EventRecord,
  GlobalReferenceStore,
  MatchRecord,
  SeasonWindowRecord,
  SyncCursor,
  SyncSource,
  TeamEventMetricRecord,
  TeamRecord,
  TeamYearMetricRecord,
} from "../src/types";
import { syncGlobalReferenceSeason } from "../src/worker";
import statboticsFixture from "./fixtures/statbotics.json";
import tbaFixture from "./fixtures/tba.json";

class MemoryStore implements GlobalReferenceStore {
  cursors = new Map<string, SyncCursor>();
  teams = new Map<string, TeamRecord>();
  events = new Map<string, EventRecord>();
  matches = new Map<string, MatchRecord>();
  eventMetrics = new Map<string, TeamEventMetricRecord>();
  yearMetrics = new Map<string, TeamYearMetricRecord>();
  windows = new Map<number, SeasonWindowRecord>();

  async getCursor(source: SyncSource, resource: string) {
    return this.cursors.get(`${source}:${resource}`) ?? null;
  }
  async saveCursor(cursor: SyncCursor) {
    this.cursors.set(`${cursor.source}:${cursor.resource}`, cursor);
  }
  async listEventKeys(year: number) {
    return [...this.events.values()]
      .filter((event) => event.year === year)
      .map((event) => event.eventKey);
  }
  async listActiveEventKeys(input: {
    at: Date;
    withinDays: number;
    year?: number;
  }) {
    const dayMs = 24 * 60 * 60 * 1000;
    const start = new Date(input.at.getTime() - input.withinDays * dayMs)
      .toISOString()
      .slice(0, 10);
    const end = new Date(input.at.getTime() + input.withinDays * dayMs)
      .toISOString()
      .slice(0, 10);
    return [...this.events.values()]
      .filter((event) => {
        if (input.year !== undefined && event.year !== input.year) return false;
        if (!event.startDate || !event.endDate) return false;
        return event.startDate <= end && event.endDate >= start;
      })
      .map((event) => event.eventKey);
  }
  async upsertTeams(records: TeamRecord[]) {
    records.forEach((record) => this.teams.set(record.teamKey, record));
  }
  async upsertEvents(records: EventRecord[]) {
    records.forEach((record) => this.events.set(record.eventKey, record));
  }
  async upsertMatches(records: MatchRecord[]) {
    records.forEach((record) => this.matches.set(record.matchKey, record));
  }
  async upsertTeamEventMetrics(records: TeamEventMetricRecord[]) {
    records.forEach((record) =>
      this.eventMetrics.set(
        `${record.teamKey}:${record.eventKey}:${record.source}`,
        record,
      ),
    );
  }
  async upsertTeamYearMetrics(records: TeamYearMetricRecord[]) {
    records.forEach((record) =>
      this.yearMetrics.set(
        `${record.teamKey}:${record.year}:${record.source}`,
        record,
      ),
    );
  }
  async upsertSeasonWindows(records: SeasonWindowRecord[]) {
    records.forEach((record) => this.windows.set(record.year, record));
  }
}

describe("global reference worker", () => {
  it("ingests fixtures and remains idempotent with TBA ETags", async () => {
    const store = new MemoryStore();
    let tbaRound = 0;
    const tbaFetch: typeof fetch = async (request, init) => {
      const path = new URL(String(request)).pathname.replace("/api/v3/", "");
      const headers = new Headers(init?.headers);
      if (tbaRound > 0) {
        expect(headers.get("If-None-Match")).toBe(`"${path}"`);
        return new Response(null, {
          status: 304,
          headers: { etag: `"${path}"` },
        });
      }
      const payloads: Record<string, unknown> = {
        "events/2026": tbaFixture.events,
        "event/2026miket/teams": tbaFixture.teams,
        "event/2026miket/matches": tbaFixture.matches,
        "event/2026miket/oprs": tbaFixture.oprs,
        "event/2026miket/rankings": tbaFixture.rankings,
      };
      return new Response(JSON.stringify(payloads[path]), {
        status: 200,
        headers: { "content-type": "application/json", etag: `"${path}"` },
      });
    };
    const statFetch: typeof fetch = async (request) => {
      const url = new URL(String(request));
      const body = url.pathname.endsWith("/team_events")
        ? statboticsFixture.teamEvents
        : statboticsFixture.teamYears;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const options = {
      store,
      tba: new TbaClient({ authKey: "fixture", fetch: tbaFetch }),
      statbotics: new StatboticsClient({
        fetch: statFetch,
        minimumIntervalMs: 0,
      }),
      now: () => new Date("2026-03-06T12:00:00.000Z"),
    };

    const first = await syncGlobalReferenceSeason(options, 2026);
    expect(first).toMatchObject({
      mode: "season",
      events: 1,
      teams: 1,
      matches: 1,
      teamEventMetrics: 2,
      teamYearMetrics: 1,
      notModified: 0,
    });
    expect(first.eventKeys).toEqual(["2026miket"]);
    expect(store.teams.get("frc2337")?.nickname).toBe("EngiNERDs");
    expect(store.events.get("2026miket")?.districtKey).toBe("2026fim");
    expect(
      store.eventMetrics.get("frc2337:2026miket:statbotics")?.epaTotal,
    ).toBe(42.5);
    expect(store.windows.get(2026)?.isActive).toBe(true);

    tbaRound = 1;
    const second = await syncGlobalReferenceSeason(options, 2026);
    expect(second.notModified).toBe(7);
    expect(store.teams).toHaveLength(1);
    expect(store.events).toHaveLength(1);
    expect(store.matches).toHaveLength(1);
    expect(store.eventMetrics).toHaveLength(2);
    expect(store.yearMetrics).toHaveLength(1);
  });

  it("runs incremental event-day sync for active windows only", async () => {
    const store = new MemoryStore();
    await store.upsertEvents([
      {
        eventKey: "2026miket",
        year: 2026,
        name: "Kettering",
        shortName: "Kettering",
        startDate: "2026-03-05",
        endDate: "2026-03-07",
        eventType: 1,
        week: 1,
        districtKey: "2026fim",
        city: null,
        stateProv: null,
        country: null,
        address: null,
        postalCode: null,
        timezone: null,
        website: null,
        parentEventKey: null,
        webcasts: [],
        syncedAt: new Date("2026-03-01T00:00:00.000Z"),
      },
      {
        eventKey: "2026faraway",
        year: 2026,
        name: "Far Away",
        shortName: null,
        startDate: "2026-04-01",
        endDate: "2026-04-03",
        eventType: 1,
        week: 5,
        districtKey: null,
        city: null,
        stateProv: null,
        country: null,
        address: null,
        postalCode: null,
        timezone: null,
        website: null,
        parentEventKey: null,
        webcasts: [],
        syncedAt: new Date("2026-03-01T00:00:00.000Z"),
      },
    ]);

    const tbaFetch: typeof fetch = async (request) => {
      const path = new URL(String(request)).pathname.replace("/api/v3/", "");
      const payloads: Record<string, unknown> = {
        "event/2026miket/teams": tbaFixture.teams,
        "event/2026miket/matches": tbaFixture.matches,
        "event/2026miket/oprs": tbaFixture.oprs,
        "event/2026miket/rankings": tbaFixture.rankings,
      };
      if (!(path in payloads)) {
        throw new Error(`unexpected TBA path ${path}`);
      }
      return new Response(JSON.stringify(payloads[path]), {
        status: 200,
        headers: { "content-type": "application/json", etag: `"${path}"` },
      });
    };
    const statFetch: typeof fetch = async () =>
      new Response(JSON.stringify(statboticsFixture.teamEvents), {
        status: 200,
        headers: { "content-type": "application/json" },
      });

    const { syncActiveEventDay } = await import("../src/worker");
    const summary = await syncActiveEventDay(
      {
        store,
        tba: new TbaClient({ authKey: "fixture", fetch: tbaFetch }),
        statbotics: new StatboticsClient({
          fetch: statFetch,
          minimumIntervalMs: 0,
        }),
        now: () => new Date("2026-03-06T12:00:00.000Z"),
      },
      { year: 2026, withinDays: 1 },
    );

    expect(summary.mode).toBe("event-day");
    expect(summary.eventKeys).toEqual(["2026miket"]);
    expect(summary.matches).toBe(1);
    expect(store.matches.has("2026miket_qm1")).toBe(true);
  });

  it("skips Statbotics HTTP when the Neon cursor is still fresh", async () => {
    const store = new MemoryStore();
    await store.upsertEvents([
      {
        eventKey: "2026miket",
        year: 2026,
        name: "Kettering",
        shortName: "Kettering",
        startDate: "2026-03-05",
        endDate: "2026-03-07",
        eventType: 1,
        week: 1,
        districtKey: "2026fim",
        city: null,
        stateProv: null,
        country: null,
        address: null,
        postalCode: null,
        timezone: null,
        website: null,
        parentEventKey: null,
        webcasts: [],
        syncedAt: new Date("2026-03-01T00:00:00.000Z"),
      },
    ]);
    const tbaFetch: typeof fetch = async (request) => {
      const path = new URL(String(request)).pathname.replace("/api/v3/", "");
      const payloads: Record<string, unknown> = {
        "event/2026miket/teams": tbaFixture.teams,
        "event/2026miket/matches": tbaFixture.matches,
        "event/2026miket/oprs": tbaFixture.oprs,
        "event/2026miket/rankings": tbaFixture.rankings,
      };
      return new Response(JSON.stringify(payloads[path] ?? null), {
        status: 200,
        headers: { "content-type": "application/json", etag: `"${path}"` },
      });
    };
    let statCalls = 0;
    const statFetch: typeof fetch = async () => {
      statCalls += 1;
      return new Response(JSON.stringify(statboticsFixture.teamEvents), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };
    const { syncActiveEventDay } = await import("../src/worker");
    const options = {
      store,
      tba: new TbaClient({ authKey: "fixture", fetch: tbaFetch }),
      statbotics: new StatboticsClient({
        fetch: statFetch,
        minimumIntervalMs: 0,
      }),
      now: () => new Date("2026-03-06T12:00:00.000Z"),
    };
    await syncActiveEventDay(options, { year: 2026, withinDays: 1 });
    await syncActiveEventDay(options, { year: 2026, withinDays: 1 });
    expect(statCalls).toBe(1);
    expect(store.eventMetrics.get("frc2337:2026miket:statbotics")?.epaTotal).toBe(42.5);
  });
});
