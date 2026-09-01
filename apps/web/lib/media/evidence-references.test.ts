import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  entryIdsFromEvidence,
  loadMediaLibraryEvidenceReferences,
  loadScoutMediaEvidenceReferences,
  mediaAssetIdsFromEvidence,
  mediaLibraryItemUrl,
  scoutMediaRefsFromEvidence,
} from "./evidence-references";

function mockClient(
  handler: (sql: string, params: unknown[]) => { rows: unknown[]; rowCount: number },
): PoolClient {
  return {
    query: vi.fn(async (sql: string, params: unknown[] = []) => handler(sql, params)),
  } as unknown as PoolClient;
}

describe("media evidence references", () => {
  it("reuses media-library IDs from existing evidence JSON", () => {
    expect(
      mediaAssetIdsFromEvidence([
        { mediaAssetId: "asset-1" },
        { assetId: "asset-2" },
        { libraryItemId: "lib-1" },
        { mediaItemId: "lib-2" },
        { scoutMediaId: "scout-1" },
        { mediaAssetId: "asset-1" },
        null,
      ]),
    ).toEqual(["asset-1", "asset-2", "lib-1", "lib-2", "scout-1"]);
  });

  it("only keeps scout media refs that already name an entry_id", () => {
    expect(
      scoutMediaRefsFromEvidence([
        { clientId: "img-1", entryId: "entry-1" },
        { scoutMediaId: "img-2", entry_id: "entry-2" },
        { clientId: "orphan" },
        { entryId: "entry-3" },
        { clientId: "img-1", entryId: "entry-1" },
      ]),
    ).toEqual([
      { clientId: "img-1", entryId: "entry-1" },
      { clientId: "img-2", entryId: "entry-2" },
    ]);
  });

  it("collects entry ids without inventing blanks", () => {
    expect(
      entryIdsFromEvidence([{ entryId: "e1" }, { entry_id: "e1" }, { clientId: "img-1" }, "e2"]),
    ).toEqual(["e1", "e2"]);
  });
});

describe("loadScoutMediaEvidenceReferences", () => {
  it("returns only uploaded rows that already have entry_id, with no invented thumb", async () => {
    const client = mockClient((sql, params) => {
      expect(sql).toMatch(/entry_id IS NOT NULL/);
      expect(sql).toMatch(/status = 'uploaded'/);
      expect(params[0]).toBe("org-1");
      return {
        rowCount: 1,
        rows: [
          {
            assetId: "media-1",
            clientId: "img-1",
            entryId: "entry-1",
            kind: "photo",
            teamKey: "frc254",
            eventKey: "2026mndu",
            hasThumb: false,
          },
        ],
      };
    });
    const rows = await loadScoutMediaEvidenceReferences(client, { orgId: "org-1" });
    expect(rows).toEqual([
      {
        assetId: "media-1",
        title: "Pit photo · frc254",
        kind: "photo",
        url: "/api/scouting/media/img-1?orgId=org-1",
        description: null,
        entryId: "entry-1",
        clientId: "img-1",
        teamKey: "frc254",
        eventKey: "2026mndu",
        thumbUrl: null,
        source: "scout_media",
      },
    ]);
  });

  it("drops a row that came back without an entryId instead of fabricating one", async () => {
    const client = mockClient(() => ({
      rowCount: 1,
      rows: [
        {
          assetId: "media-1",
          clientId: "img-1",
          entryId: null,
          kind: "photo",
          teamKey: "frc254",
          eventKey: "2026mndu",
          hasThumb: false,
        },
      ],
    }));
    await expect(loadScoutMediaEvidenceReferences(client, { orgId: "org-1" })).resolves.toEqual([]);
  });

  it("exposes a thumb URL only when the row actually has a thumb", async () => {
    const client = mockClient(() => ({
      rowCount: 1,
      rows: [
        {
          assetId: "media-1",
          clientId: "img-1",
          entryId: "entry-1",
          kind: "photo",
          teamKey: "frc254",
          eventKey: "2026mndu",
          hasThumb: true,
        },
      ],
    }));
    const rows = await loadScoutMediaEvidenceReferences(client, { orgId: "org-1" });
    expect(rows[0]?.thumbUrl).toBe("/api/scouting/media/img-1?orgId=org-1&variant=thumb");
  });

  it("filters scout rows by asset id when a notebook cite names one", async () => {
    const client = mockClient((sql, params) => {
      expect(sql).toMatch(/id = ANY\(\$6::uuid\[\]\)/);
      expect(params[5]).toEqual(["media-1"]);
      return { rowCount: 0, rows: [] };
    });
    await loadScoutMediaEvidenceReferences(client, { orgId: "org-1", assetIds: ["media-1"] });
  });

  it("stays empty when scout_media is missing — never DEMO photos", async () => {
    const client = mockClient(() => {
      throw new Error("relation scout_media does not exist");
    });
    await expect(loadScoutMediaEvidenceReferences(client, { orgId: "org-1" })).resolves.toEqual([]);
  });
});

describe("loadMediaLibraryEvidenceReferences", () => {
  it("returns only ready photo/video rows with the authenticated item URL", async () => {
    const client = mockClient((sql, params) => {
      expect(sql).toMatch(/media_items/);
      expect(sql).toMatch(/status = 'ready'/);
      expect(sql).toMatch(/kind IN \('photo', 'video'\)/);
      expect(params[0]).toBe("org-1");
      return {
        rowCount: 1,
        rows: [{ assetId: "lib-1", title: "Intake CAD", kind: "photo", caption: "v2" }],
      };
    });
    await expect(loadMediaLibraryEvidenceReferences(client, { orgId: "org-1" })).resolves.toEqual([
      {
        assetId: "lib-1",
        title: "Intake CAD",
        kind: "photo",
        url: mediaLibraryItemUrl("org-1", "lib-1"),
        description: "v2",
        source: "media_library",
      },
    ]);
  });

  it("drops a row missing title or id instead of inventing a photo", async () => {
    const client = mockClient(() => ({
      rowCount: 1,
      rows: [{ assetId: "", title: "", kind: "photo", caption: null }],
    }));
    await expect(loadMediaLibraryEvidenceReferences(client, { orgId: "org-1" })).resolves.toEqual([]);
  });

  it("stays empty when media_items is missing — never DEMO photos", async () => {
    const client = mockClient(() => {
      throw new Error("relation media_items does not exist");
    });
    await expect(loadMediaLibraryEvidenceReferences(client, { orgId: "org-1" })).resolves.toEqual([]);
  });
});
