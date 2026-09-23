import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import { computeMigrateView, previewCsvHeaders, previewIcs, previewNotionJson } from "./compute-migrate";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function makeClient(handler: (sql: string) => { rows: unknown[] }): PoolClient {
  return {
    query: vi.fn(async (sql: string) => handler(sql)),
  } as unknown as PoolClient;
}

describe("migrate previews", () => {
  it("parses ICS paste into calendar drafts", () => {
    const drafts = previewIcs(`BEGIN:VEVENT
UID:a1
DTSTART:20270109T170000Z
SUMMARY:Kickoff
END:VEVENT`);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.kind).toBe("calendar");
  });

  it("guesses scout CSV headers without inventing identity", () => {
    const preview = previewCsvHeaders("Event Key,Team Number,Hours");
    expect(preview.columnMap["Event Key"]).toBe("event_key");
    expect(preview.columnMap["Hours"]).toBe("hours");
  });

  it("maps Notion JSON pages and skips untitled ones", () => {
    const drafts = previewNotionJson(
      JSON.stringify([
        {
          id: "p1",
          properties: {
            Name: { type: "title", title: [{ plain_text: "Wiki home" }] },
          },
        },
        { id: "p2", properties: {} },
      ]),
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.kind).toBe("knowledge");
  });
});

describe("computeMigrateView", () => {
  it("returns setup_required when the user has no org membership", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [] };
      return { rows: [] };
    });
    const view = await computeMigrateView(client, { userId: USER, requestedOrg: null });
    expect(view.status).toBe("setup_required");
    if (view.status === "setup_required") expect(view.orgId).toBeNull();
  });

  it("names the active event on a live import view", async () => {
    const client = makeClient((sql) => {
      if (sql.includes("FROM memberships")) return { rows: [{ orgId: ORG, teamNumber: 254, role: "scout" }] };
      if (sql.includes("FROM org_active_context")) {
        return { rows: [{ eventKey: "2026custom-org-pacific", eventName: "Pacific Practice" }] };
      }
      return { rows: [] };
    });
    const view = await computeMigrateView(client, { userId: USER, requestedOrg: ORG });
    expect(view.status).toBe("live");
    if (view.status !== "live") throw new Error("expected live view");
    expect(view.eventName).toBe("Pacific Practice");
    expect(view.eventKey).toBe("2026custom-org-pacific");
    expect(view.connections).toEqual([]);
    expect(view.inboundFeeds).toEqual([]);
  });
});
