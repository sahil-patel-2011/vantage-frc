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
      events: 1,
      teams: 1,
      matches: 1,
      teamEventMetrics: 2,
      teamYearMetrics: 1,
      notModified: 0,
    });
    expect(store.teams.get("frc2337")?.nickname).toBe("EngiNERDs");
    expect(store.events.get("2026miket")?.districtKey).toBe("2026fim");
    expect(
      store.eventMetrics.get("frc2337:2026miket:statbotics")?.epaTotal,
    ).toBe(42.5);
    expect(store.windows.get(2026)?.isActive).toBe(true);

    tbaRound = 1;
    const second = await syncGlobalReferenceSeason(options, 2026);
    expect(second.notModified).toBe(5);
    expect(store.teams).toHaveLength(1);
    expect(store.events).toHaveLength(1);
    expect(store.matches).toHaveLength(1);
    expect(store.eventMetrics).toHaveLength(2);
    expect(store.yearMetrics).toHaveLength(1);
  });
});
