import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { RETRO_SOURCE_PREFIX, retroSourceMarker } from "../retro/learned-items";
import { buildSeasonReportNarrative, summarizeSeasonReportEntries } from ".";
import { computeSeasonReportView, generateSnapshot } from "./compute-season-report";
import type { SeasonReportEntry } from "./types";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

function liveClient(entries: unknown[]): PoolClient {
  return makeClient((sql) => {
    if (sql.includes("FROM memberships")) {
      return { rows: [{ orgId: ORG, teamNumber: 254 }] };
    }
    if (sql.includes("FROM season_report_entries") && sql.includes("ORDER BY created_at DESC") && !sql.includes("DISTINCT")) {
      return { rows: entries };
    }
    if (sql.includes("DISTINCT season_year")) {
      return { rows: [{ seasonYear: 2026 }] };
    }
    if (sql.includes("FROM season_report_snapshots")) {
      return { rows: [] };
    }
    return { rows: [] };
  });
}

const RETRO_LESSON = {
  id: "lesson-retro-1",
  seasonYear: 2026,
  category: "lessons",
  title: "Start: Start doing standups",
  detail: `Start doing standups\nSession: Week 3 retro\nAuthor: Ada\n${retroSourceMarker("i1")}`,
  metricLabel: null,
  metricValue: null,
  sentiment: "positive",
  createdAt: "2026-01-18T12:00:00.000Z",
};

const CANNED_LESSON = /always communicate|document everything|DEMO lesson|canned lesson|invented lesson/i;

describe("computeSeasonReportView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });

    const view = await computeSeasonReportView(client, { userId: USER, requestedOrg: null });

    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") {
      expect(view.orgId).toBeNull();
      expect(view.steps.length).toBeGreaterThan(0);
    }
  });

  it("returns a live view with per-category summary from logged entries", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) {
        return { rows: [{ orgId: ORG, teamNumber: 254 }] };
      }
      if (sql.includes("FROM season_report_entries") && sql.includes("ORDER BY created_at DESC") && !sql.includes("DISTINCT")) {
        return {
          rows: [
            {
              id: "entry-1",
              seasonYear: 2026,
              category: "build_reliability",
              title: "Drivetrain held up all season",
              detail: null,
              metricLabel: "Match failures",
              metricValue: "0",
              sentiment: "positive",
              createdAt: "2026-04-01T00:00:00.000Z",
            },
            {
              id: "entry-2",
              seasonYear: 2026,
              category: "budget",
              title: "Overspent on drivetrain motors",
              detail: null,
              metricLabel: null,
              metricValue: null,
              sentiment: "negative",
              createdAt: "2026-03-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("DISTINCT season_year")) {
        return { rows: [{ seasonYear: 2026 }] };
      }
      if (sql.includes("FROM season_report_snapshots")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const view = await computeSeasonReportView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.entries).toHaveLength(2);
    expect(view.summary.totalEntries).toBe(2);
    expect(view.summary.completeness).toBeCloseTo(2 / 5, 5);
    const build = view.summary.byCategory.find((row) => row.category === "build_reliability");
    expect(build?.positive).toBe(1);
    const budget = view.summary.byCategory.find((row) => row.category === "budget");
    expect(budget?.negative).toBe(1);
  });

  it("includes retro-handoff lessons rows tagged [source:retro:…] — never drops them", async () => {
    const client = liveClient([
      {
        id: "entry-budget",
        seasonYear: 2026,
        category: "budget",
        title: "Overspent on drivetrain motors",
        detail: null,
        metricLabel: null,
        metricValue: null,
        sentiment: "negative",
        createdAt: "2026-03-01T00:00:00.000Z",
      },
      RETRO_LESSON,
    ]);

    const view = await computeSeasonReportView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    const retroRows = view.entries.filter(
      (entry) => entry.category === "lessons" && (entry.detail ?? "").includes(RETRO_SOURCE_PREFIX),
    );
    expect(retroRows).toHaveLength(1);
    expect(retroRows[0]?.id).toBe("lesson-retro-1");
    expect(retroRows[0]?.title).toBe("Start: Start doing standups");
    expect(retroRows[0]?.detail).toContain(retroSourceMarker("i1"));
    expect(view.summary.byCategory.find((row) => row.category === "lessons")?.entries).toBe(1);
    expect(view.summary.byCategory.find((row) => row.category === "lessons")?.positive).toBe(1);

    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => String(sql).includes("FROM retro_items"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("AND category"))).toBe(false);
  });

  it("empty retro (no lessons rows) → zero lessons and no canned lesson text", async () => {
    const client = liveClient([]);

    const view = await computeSeasonReportView(client, { userId: USER, requestedOrg: ORG, seasonYear: 2026 });

    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.entries).toHaveLength(0);
    expect(view.entries.filter((entry) => entry.category === "lessons")).toHaveLength(0);
    expect(view.summary.totalEntries).toBe(0);
    expect(view.summary.byCategory.find((row) => row.category === "lessons")?.entries).toBe(0);
    const narrative = buildSeasonReportNarrative(view.entries);
    expect(narrative.lessons).toMatch(/No lessons learned notes logged yet/i);
    expect(narrative.lessons).not.toMatch(CANNED_LESSON);
    expect(JSON.stringify(view.entries)).not.toMatch(CANNED_LESSON);

    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => String(sql).includes("FROM retro_items"))).toBe(false);
  });
});

describe("season-report lessons synthesis", () => {
  it("summarizes and narrates only written [source:retro:…] lessons", () => {
    const entries: SeasonReportEntry[] = [
      {
        id: RETRO_LESSON.id,
        seasonYear: RETRO_LESSON.seasonYear,
        category: "lessons",
        title: RETRO_LESSON.title,
        detail: RETRO_LESSON.detail,
        metricLabel: null,
        metricValue: null,
        sentiment: "positive",
        createdAt: RETRO_LESSON.createdAt,
      },
    ];
    const summary = summarizeSeasonReportEntries(entries);
    const narrative = buildSeasonReportNarrative(entries);
    expect(summary.byCategory.find((row) => row.category === "lessons")?.entries).toBe(1);
    expect(narrative.lessons).toContain("Start: Start doing standups");
    expect(narrative.lessons).not.toMatch(CANNED_LESSON);
  });

  it("empty entries → lessons stay at zero and narrative refuses canned advice", () => {
    const summary = summarizeSeasonReportEntries([]);
    const narrative = buildSeasonReportNarrative([]);
    expect(summary.byCategory.find((row) => row.category === "lessons")?.entries).toBe(0);
    expect(narrative.lessons).toMatch(/No lessons learned notes logged yet/i);
    expect(narrative.lessons).not.toMatch(CANNED_LESSON);
  });
});

describe("generateSnapshot", () => {
  it("synthesizes and persists a deterministic narrative snapshot from logged entries", async () => {
    const inserted: { sql: string; params: unknown[] }[] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM season_report_entries") && !sql.includes("DISTINCT")) {
        return {
          rows: [
            {
              id: "entry-1",
              seasonYear: 2026,
              category: "outreach",
              title: "STEM night at elementary school",
              detail: null,
              metricLabel: "People reached",
              metricValue: "120",
              sentiment: "positive",
              createdAt: "2026-04-01T00:00:00.000Z",
            },
          ],
        };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        inserted.push({ sql, params });
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO season_report_snapshots")) {
        inserted.push({ sql, params });
        return { rows: [{ id: "snapshot-1", createdAt: "2026-04-02T00:00:00.000Z" }] };
      }
      return { rows: [] };
    });

    const snapshot = await generateSnapshot(client, { orgId: ORG, userId: USER, seasonYear: 2026 });

    expect(snapshot.entryCount).toBe(1);
    expect(snapshot.completeness).toBeCloseTo(1 / 5, 5);
    expect(snapshot.highlights.length).toBeGreaterThan(0);
    expect(snapshot.narrative.outreach).toContain("outreach");
    expect(snapshot.narrative.budget).toContain("No budget");

    const snapshotInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO season_report_snapshots"));
    expect(snapshotInsert).toBeDefined();

    const usageInsert = inserted.find((entry) => entry.sql.includes("INSERT INTO ai_usage_events"));
    expect(usageInsert).toBeDefined();
  });

  it("empty retro → snapshot lessons stay empty-state, never canned advice", async () => {
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM season_report_entries") && !sql.includes("DISTINCT")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO season_report_snapshots")) {
        return { rows: [{ id: "snapshot-empty", createdAt: "2026-04-02T00:00:00.000Z" }] };
      }
      void params;
      return { rows: [] };
    });

    const snapshot = await generateSnapshot(client, { orgId: ORG, userId: USER, seasonYear: 2026 });

    expect(snapshot.entryCount).toBe(0);
    expect(snapshot.highlights).toEqual([]);
    expect(snapshot.watchouts).toEqual([]);
    expect(snapshot.narrative.lessons).toMatch(/No lessons learned notes logged yet/i);
    expect(JSON.stringify(snapshot)).not.toMatch(CANNED_LESSON);
    expect(JSON.stringify(snapshot.highlights)).not.toContain(RETRO_SOURCE_PREFIX);
  });

  it("snapshot narrative includes written [source:retro:…] lesson titles", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM season_report_entries") && !sql.includes("DISTINCT")) {
        return { rows: [RETRO_LESSON] };
      }
      if (sql.includes("INSERT INTO ai_usage_events")) return { rows: [] };
      if (sql.includes("INSERT INTO season_report_snapshots")) {
        return { rows: [{ id: "snapshot-retro", createdAt: "2026-04-02T00:00:00.000Z" }] };
      }
      return { rows: [] };
    });

    const snapshot = await generateSnapshot(client, { orgId: ORG, userId: USER, seasonYear: 2026 });

    expect(snapshot.entryCount).toBe(1);
    expect(snapshot.narrative.lessons).toContain("Start: Start doing standups");
    expect(snapshot.highlights.some((line) => line.includes("Start doing standups"))).toBe(true);
    expect(snapshot.narrative.lessons).not.toMatch(CANNED_LESSON);
  });
});
