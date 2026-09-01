import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  citesFromMarkdownBody,
  isLibraryCiteKind,
  isResolvedLibraryCiteEvidence,
  libraryCiteIds,
  parseLibraryCites,
  resolveLibraryCites,
} from "./library-cite";

const KIT_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const LIBRARY_ID = "bbbbbbbb-2222-4222-8222-222222222222";
const SCOUT_ID = "cccccccc-3333-4333-8333-333333333333";
const ORG_ID = "11111111-1111-4111-8111-111111111111";

function queryForTables(tables: {
  kit?: unknown[];
  library?: unknown[];
  scout?: unknown[];
}): PoolClient {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("media_kit_assets")) return { rows: tables.kit ?? [] };
      if (sql.includes("media_items")) return { rows: tables.library ?? [] };
      if (sql.includes("scout_media")) return { rows: tables.scout ?? [] };
      return { rows: [] };
    }),
  } as unknown as PoolClient;
}

describe("parseLibraryCites", () => {
  it("reads kit, library, and scout ids without turning URLs into photos", () => {
    expect(
      parseLibraryCites([
        { mediaAssetId: KIT_ID.toUpperCase() },
        { libraryItemId: LIBRARY_ID },
        { scoutMediaId: SCOUT_ID, source: "scout_media" },
        { mediaItemId: LIBRARY_ID },
        "https://cdn.example.test/fake.png",
        "![photo](https://cdn.example.test/embed.png)",
        null,
        12,
      ]),
    ).toEqual([
      { source: "media_kit", id: KIT_ID },
      { source: "media_library", id: LIBRARY_ID },
      { source: "scout_media", id: SCOUT_ID },
    ]);
  });

  it("treats a bare UUID as unknown until a real row resolves it", () => {
    expect(parseLibraryCites([KIT_ID])).toEqual([{ source: "unknown", id: KIT_ID }]);
  });

  it("returns empty when nothing citable was sent", () => {
    expect(parseLibraryCites(undefined)).toEqual([]);
    expect(parseLibraryCites([])).toEqual([]);
  });
});

describe("citesFromMarkdownBody", () => {
  it("never treats markdown images as evidence cites", () => {
    expect(citesFromMarkdownBody("![intake](https://cdn.example.test/intake.png)")).toEqual([]);
    expect(libraryCiteIds(citesFromMarkdownBody("see ![cad](/api/media-library/items/x)"))).toEqual([]);
  });
});

describe("isResolvedLibraryCiteEvidence", () => {
  it("allows photo and video when a real URL is present", () => {
    expect(isLibraryCiteKind("video")).toBe(true);
    expect(isResolvedLibraryCiteEvidence({ kind: "photo", url: "https://cdn.example.test/a.png" })).toBe(true);
    expect(isResolvedLibraryCiteEvidence({ kind: "video", url: "/api/media-library/items/x?orgId=o" })).toBe(true);
  });

  it("rejects empty URLs, audio, and generic files", () => {
    expect(isResolvedLibraryCiteEvidence({ kind: "photo", url: "   " })).toBe(false);
    expect(isResolvedLibraryCiteEvidence({ kind: "audio", url: "/api/scouting/media/x" })).toBe(false);
    expect(isResolvedLibraryCiteEvidence({ kind: "other", url: "https://cdn.example.test/notes.pdf" })).toBe(false);
  });
});

describe("resolveLibraryCites", () => {
  it("returns an honest empty list when no ids were stored", async () => {
    const client = queryForTables({});
    await expect(resolveLibraryCites(client, { orgId: ORG_ID, ids: [] })).resolves.toEqual([]);
    expect(client.query).not.toHaveBeenCalled();
  });

  it("resolves a media-library photo and a linked scout photo, not markdown", async () => {
    const client = queryForTables({
      library: [
        {
          assetId: LIBRARY_ID,
          title: "Intake CAD",
          kind: "photo",
          caption: "v2 roller",
        },
      ],
      scout: [
        {
          assetId: SCOUT_ID,
          clientId: "img-1",
          entryId: "dddddddd-4444-4444-8444-444444444444",
          kind: "photo",
          teamKey: "frc254",
          eventKey: "2026mndu",
          hasThumb: false,
        },
      ],
    });
    const resolved = await resolveLibraryCites(client, {
      orgId: ORG_ID,
      ids: [LIBRARY_ID, SCOUT_ID],
    });
    expect(resolved).toEqual([
      {
        assetId: LIBRARY_ID,
        title: "Intake CAD",
        kind: "photo",
        url: `/api/media-library/items/${LIBRARY_ID}?orgId=${ORG_ID}`,
        description: "v2 roller",
        source: "media_library",
      },
      {
        assetId: SCOUT_ID,
        title: "Pit photo · frc254",
        kind: "photo",
        url: `/api/scouting/media/img-1?orgId=${ORG_ID}`,
        description: null,
        entryId: "dddddddd-4444-4444-8444-444444444444",
        clientId: "img-1",
        teamKey: "frc254",
        eventKey: "2026mndu",
        thumbUrl: null,
        source: "scout_media",
      },
    ]);
  });

  it("includes a library video and omits rows that are not real evidence", async () => {
    const videoId = "eeeeeeee-5555-4555-8555-555555555555";
    const client = queryForTables({
      library: [
        {
          assetId: videoId,
          title: "Intake bench video",
          kind: "video",
          caption: null,
        },
      ],
      scout: [
        {
          assetId: SCOUT_ID,
          clientId: "clip-1",
          entryId: null,
          kind: "video",
          teamKey: "frc254",
          eventKey: "2026mndu",
          hasThumb: false,
        },
      ],
    });
    const resolved = await resolveLibraryCites(client, {
      orgId: ORG_ID,
      ids: [videoId, SCOUT_ID, "ffffffff-6666-4666-8666-666666666666"],
    });
    expect(resolved.map((row) => row.assetId)).toEqual([videoId]);
    expect(resolved[0]?.kind).toBe("video");
    expect(resolved.some((row) => !row.url.trim())).toBe(false);
  });

  it("prefers the media-kit URL when the same id exists in more than one table", async () => {
    const client = queryForTables({
      kit: [
        {
          assetId: KIT_ID,
          title: "Kit shot",
          kind: "photo",
          url: "https://cdn.example.test/kit.png",
          description: null,
        },
      ],
      library: [
        {
          assetId: KIT_ID,
          title: "Library copy",
          kind: "photo",
          caption: null,
        },
      ],
    });
    const resolved = await resolveLibraryCites(client, { orgId: ORG_ID, ids: [KIT_ID] });
    expect(resolved).toEqual([
      {
        assetId: KIT_ID,
        title: "Kit shot",
        kind: "photo",
        url: "https://cdn.example.test/kit.png",
        description: null,
        source: "media_kit",
      },
    ]);
  });
});
