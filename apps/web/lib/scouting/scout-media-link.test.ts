import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  appendMediaClientIdToPayload,
  backfillScoutMediaFromPayload,
  countLinkedScoutMediaByEntry,
  groupMediaClientIdsByEntry,
  linkScoutMediaFromSyncAcks,
  linkScoutMediaToEntry,
  mediaClientIdsFromEntryPayload,
  mediaClientIdsFromField,
} from "./scout-media-link";

function mockClient(
  handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number },
): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("mediaClientIdsFromField / payload", () => {
  it("reads robot_image refs and ignores free-text notes", () => {
    expect(mediaClientIdsFromField(["img-1", "img-1", "img-2"])).toEqual(["img-1", "img-2"]);
    expect(
      mediaClientIdsFromEntryPayload({
        notes: "looks like img-9",
        drivetrain_type: "swerve",
        robot_images: ["img-1", "img-2"],
        extra_images: [{ clientId: "img-3" }],
      }),
    ).toEqual(["img-1", "img-2", "img-3"]);
  });

  it("returns nothing for an empty or missing payload — never a DEMO id", () => {
    expect(mediaClientIdsFromEntryPayload(null)).toEqual([]);
    expect(mediaClientIdsFromEntryPayload({ notes: "no photos" })).toEqual([]);
  });

  it("appends a captured clientId onto the field the form actually uses", () => {
    const next = appendMediaClientIdToPayload({ robot_images: ["img-1"] }, "robot_images", "img-2");
    expect(next.robot_images).toEqual(["img-1", "img-2"]);
    expect(appendMediaClientIdToPayload({}, "robot_images", "  ")).toEqual({ robot_images: [] });
  });
});

describe("groupMediaClientIdsByEntry", () => {
  it("pairs queued media to the minted entryId via entryClientId", () => {
    expect(
      groupMediaClientIdsByEntry({
        acknowledgements: [
          { clientId: "entry-local-1", entryId: "uuid-1" },
          { clientId: "entry-local-2", entryId: "uuid-2" },
        ],
        media: [
          { clientId: "img-a", entryClientId: "entry-local-1" },
          { clientId: "img-b", entryClientId: "entry-local-1" },
          { clientId: "img-c", entryClientId: "entry-local-2" },
          { clientId: "orphan", entryClientId: null },
        ],
      }),
    ).toEqual([
      {
        entryId: "uuid-1",
        entryClientId: "entry-local-1",
        mediaClientIds: ["img-a", "img-b"],
      },
      {
        entryId: "uuid-2",
        entryClientId: "entry-local-2",
        mediaClientIds: ["img-c"],
      },
    ]);
  });

  it("drops media whose entry has not synced yet", () => {
    expect(
      groupMediaClientIdsByEntry({
        acknowledgements: [{ clientId: "entry-local-1" }],
        media: [{ clientId: "img-a", entryClientId: "entry-local-1" }],
      }),
    ).toEqual([]);
  });
});

describe("linkScoutMediaToEntry", () => {
  it("writes a parameterized UPDATE and only counts real row updates", async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const client = mockClient((sql, params) => {
      calls.push({ sql, params });
      return { rows: [{ id: "m1" }, { id: "m2" }], rowCount: 2 };
    });
    const linked = await linkScoutMediaToEntry(client, {
      orgId: "org-1",
      entryId: "entry-1",
      mediaClientIds: ["img-1", "img-1", " img-2 ", ""],
    });
    expect(linked).toBe(2);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toMatch(/UPDATE scout_media/i);
    expect(calls[0]?.sql).toMatch(/entry_id IS NULL/);
    expect(calls[0]?.params).toEqual(["entry-1", "org-1", ["img-1", "img-2"]]);
  });

  it("does not touch the database when there is nothing honest to link", async () => {
    const client = mockClient(() => ({ rows: [], rowCount: 0 }));
    expect(await linkScoutMediaToEntry(client, { orgId: "org-1", entryId: "entry-1", mediaClientIds: [] })).toBe(
      0,
    );
    expect(client.query).not.toHaveBeenCalled();
  });

  it("back-fills from robot_image payload refs only", async () => {
    const client = mockClient(() => ({ rows: [{ id: "m1" }], rowCount: 1 }));
    const linked = await backfillScoutMediaFromPayload(client, {
      orgId: "org-1",
      entryId: "entry-1",
      payload: { notes: "img-fake", robot_images: ["img-1"] },
    });
    expect(linked).toBe(1);
    expect(client.query).toHaveBeenCalledWith(
      expect.stringMatching(/client_id = ANY\(\$3::text\[\]\)/),
      ["entry-1", "org-1", ["img-1"]],
    );
  });

  it("links every sync-ack pair without inventing missing entry ids", async () => {
    const client = mockClient(() => ({ rows: [{ id: "m1" }], rowCount: 1 }));
    const linked = await linkScoutMediaFromSyncAcks(client, {
      orgId: "org-1",
      acknowledgements: [{ clientId: "entry-local-1", entryId: "uuid-1" }],
      media: [
        { clientId: "img-a", entryClientId: "entry-local-1" },
        { clientId: "orphan" },
      ],
    });
    expect(linked).toBe(1);
    expect(client.query).toHaveBeenCalledTimes(1);
  });
});

describe("countLinkedScoutMediaByEntry", () => {
  it("only counts rows that already have an entry_id", async () => {
    const client = mockClient((sql) => {
      expect(sql).toMatch(/entry_id IS NOT NULL/);
      return { rows: [{ entryId: "e1", n: 3 }], rowCount: 1 };
    });
    const counts = await countLinkedScoutMediaByEntry(client, {
      orgId: "org-1",
      eventKey: "2026mndu",
    });
    expect(counts.get("e1")).toBe(3);
    expect(counts.size).toBe(1);
  });

  it("stays empty when scout_media is missing — never a DEMO count", async () => {
    const client = mockClient(() => {
      throw new Error("relation scout_media does not exist");
    });
    const counts = await countLinkedScoutMediaByEntry(client, {
      orgId: "org-1",
      eventKey: "2026mndu",
    });
    expect(counts.size).toBe(0);
  });
});
