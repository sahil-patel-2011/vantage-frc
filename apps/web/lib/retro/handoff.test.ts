import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { handoffLearnedItems, loadHandoffStatus, loadSeasonLearnedItems, NO_ITEMS_MESSAGE } from "./handoff";
import { playbookSlugForSeason, retroSourceMarker } from "./learned-items";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";
const SEASON = 2026;

function makeClient(handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount?: number }): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

const LEARNED_ROWS = [
  {
    id: "i1",
    sessionId: "s1",
    sessionTitle: "Week 3 retro",
    kind: "start",
    content: "Start doing standups",
    authorName: "Ada",
    createdAt: "2026-01-18T12:00:00.000Z",
    voteCount: 2,
  },
  {
    id: "i2",
    sessionId: "s1",
    sessionTitle: "Week 3 retro",
    kind: "stop",
    content: "Stop skipping CAD review",
    authorName: "Grace",
    createdAt: "2026-01-18T13:00:00.000Z",
    voteCount: 1,
  },
];

describe("loadSeasonLearnedItems", () => {
  it("projects real retro rows and drops blank content", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM retro_items li")) {
        return {
          rows: [...LEARNED_ROWS, { ...LEARNED_ROWS[0], id: "blank", content: "  " }],
        };
      }
      return { rows: [] };
    });

    const items = await loadSeasonLearnedItems(client, ORG, SEASON);
    expect(items.map((row) => row.id)).toEqual(["i1", "i2"]);
    expect(items[0]?.content).toBe("Start doing standups");
  });
});

describe("loadHandoffStatus", () => {
  it("reports zeros and nulls when nothing has been handed off", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM season_report_entries")) return { rows: [{ count: "0" }] };
      if (sql.includes("FROM knowledge_pages")) return { rows: [] };
      return { rows: [] };
    });
    const status = await loadHandoffStatus(client, { orgId: ORG, seasonYear: SEASON });
    expect(status.seasonReportCount).toBe(0);
    expect(status.playbookPageId).toBeNull();
    expect(status.playbookHref).toBeNull();
  });

  it("surfaces an existing playbook page href", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM season_report_entries")) return { rows: [{ count: "2" }] };
      if (sql.includes("FROM knowledge_pages")) {
        return { rows: [{ id: "page-1", slug: playbookSlugForSeason(SEASON) }] };
      }
      return { rows: [] };
    });
    const status = await loadHandoffStatus(client, { orgId: ORG, seasonYear: SEASON });
    expect(status.seasonReportCount).toBe(2);
    expect(status.playbookPageId).toBe("page-1");
    expect(status.playbookHref).toContain("tab=knowledge");
    expect(status.playbookHref).toContain(playbookSlugForSeason(SEASON));
  });
});

describe("handoffLearnedItems", () => {
  it("refuses to invent lessons when the season has no retro items", async () => {
    const client = makeClient(() => ({ rows: [] }));
    await expect(handoffLearnedItems(client, { orgId: ORG, userId: USER, seasonYear: SEASON })).rejects.toThrow(
      NO_ITEMS_MESSAGE,
    );
    const query = client.query as ReturnType<typeof vi.fn>;
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO season_report_entries"))).toBe(false);
    expect(query.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO knowledge_pages"))).toBe(false);
  });

  it("writes one season-report lessons entry per new item and skips already handed-off rows", async () => {
    const inserts: unknown[][] = [];
    const client = makeClient((sql, params) => {
      if (sql.includes("FROM retro_items li")) return { rows: LEARNED_ROWS };
      if (sql.includes("SELECT detail FROM season_report_entries")) {
        return { rows: [{ detail: `already\n${retroSourceMarker("i1")}` }] };
      }
      if (sql.includes("INSERT INTO season_report_entries")) {
        inserts.push(params);
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await handoffLearnedItems(client, {
      orgId: ORG,
      userId: USER,
      seasonYear: SEASON,
      target: "season-report",
    });

    expect(result.playbook).toBeNull();
    expect(result.seasonReport).toEqual({ written: 1, skipped: 1 });
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.[2]).toBe("lessons");
    expect(String(inserts[0]?.[4])).toContain("Stop skipping CAD review");
    expect(String(inserts[0]?.[4])).toContain(retroSourceMarker("i2"));
    expect(inserts[0]?.[5]).toBe("negative");
  });

  it("creates a playbook page from real item text, or updates the existing slug", async () => {
    const created = makeClient((sql) => {
      if (sql.includes("FROM retro_items li")) return { rows: LEARNED_ROWS };
      if (sql.includes("SELECT id FROM knowledge_pages")) return { rows: [] };
      if (sql.includes("INSERT INTO knowledge_pages")) return { rows: [{ id: "page-new" }] };
      return { rows: [] };
    });
    const createdResult = await handoffLearnedItems(created, {
      orgId: ORG,
      userId: USER,
      seasonYear: SEASON,
      target: "playbook",
    });
    expect(createdResult.seasonReport).toBeNull();
    expect(createdResult.playbook?.alreadyExisted).toBe(false);
    expect(createdResult.playbook?.slug).toBe(playbookSlugForSeason(SEASON));
    const createQuery = created.query as ReturnType<typeof vi.fn>;
    const insert = createQuery.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO knowledge_pages"));
    expect(String(insert?.[0])).toContain("season_playbook");
    expect(insert?.[1]?.[3]).toContain("Start doing standups");
    expect(insert?.[1]?.[3]).not.toMatch(/DEMO/i);

    const updated = makeClient((sql) => {
      if (sql.includes("FROM retro_items li")) return { rows: LEARNED_ROWS };
      if (sql.includes("SELECT id FROM knowledge_pages")) return { rows: [{ id: "page-old" }], rowCount: 1 };
      if (sql.includes("UPDATE knowledge_pages")) return { rows: [] };
      return { rows: [] };
    });
    const updatedResult = await handoffLearnedItems(updated, {
      orgId: ORG,
      userId: USER,
      seasonYear: SEASON,
      target: "playbook",
    });
    expect(updatedResult.playbook?.alreadyExisted).toBe(true);
    expect(updatedResult.playbook?.pageId).toBe("page-old");
    const updateQuery = updated.query as ReturnType<typeof vi.fn>;
    expect(updateQuery.mock.calls.some(([sql]) => String(sql).includes("UPDATE knowledge_pages"))).toBe(true);
    expect(updateQuery.mock.calls.some(([sql]) => String(sql).includes("INSERT INTO knowledge_pages"))).toBe(false);
  });

  it("does not invent a lesson when the requested ids are not on the board", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM retro_items li")) return { rows: LEARNED_ROWS };
      return { rows: [] };
    });
    await expect(
      handoffLearnedItems(client, {
        orgId: ORG,
        userId: USER,
        seasonYear: SEASON,
        itemIds: ["missing"],
      }),
    ).rejects.toThrow(NO_ITEMS_MESSAGE);
  });
});
