import { describe, expect, it, vi } from "vitest";
import type { PoolClient } from "@neondatabase/serverless";
import {
  MAX_NOTEBOOK_ATTACHMENTS,
  assertNotebookImageAttachments,
  attachmentIdsFromTags,
  isNotebookAssetTag,
  listNotebookImageLibrary,
  mergeNotebookTags,
  notebookAssetTag,
  notebookEntryHasImageEvidence,
  parseNotebookAttachmentIds,
  resolveNotebookAttachments,
  splitNotebookTags,
  summarizeNotebookEvidence,
  type NotebookImageAttachment,
} from "./attachments";

const PHOTO: NotebookImageAttachment = {
  assetId: "aaaaaaaa-1111-4111-8111-111111111111",
  title: "Intake CAD screenshot",
  kind: "photo",
  url: "https://cdn.example.test/intake.png",
  description: "v2 roller",
};

function attachment(overrides: Partial<NotebookImageAttachment> = {}): NotebookImageAttachment {
  return { ...PHOTO, ...overrides };
}

function queryForTables(tables: {
  kit?: unknown[];
  library?: unknown[];
  scout?: unknown[];
}): { query: ReturnType<typeof vi.fn> } {
  return {
    query: vi.fn(async (sql: string) => {
      if (sql.includes("media_kit_assets")) return { rows: tables.kit ?? [] };
      if (sql.includes("media_items")) return { rows: tables.library ?? [] };
      if (sql.includes("scout_media")) return { rows: tables.scout ?? [] };
      return { rows: [] };
    }),
  };
}

describe("parseNotebookAttachmentIds", () => {
  it("reads mediaAssetId, assetId, libraryItemId, and bare UUID strings", () => {
    expect(
      parseNotebookAttachmentIds([
        { mediaAssetId: "AAAAAAAA-1111-4111-8111-111111111111" },
        { assetId: "bbbbbbbb-2222-4222-8222-222222222222" },
        { libraryItemId: "cccccccc-3333-4333-8333-333333333333" },
        "dddddddd-4444-4444-8444-444444444444",
      ]),
    ).toEqual([
      "aaaaaaaa-1111-4111-8111-111111111111",
      "bbbbbbbb-2222-4222-8222-222222222222",
      "cccccccc-3333-4333-8333-333333333333",
      "dddddddd-4444-4444-8444-444444444444",
    ]);
  });

  it("drops junk, duplicates, and non-UUIDs instead of inventing photos", () => {
    expect(
      parseNotebookAttachmentIds([
        { mediaAssetId: "not-a-uuid" },
        { title: "whiteboard" },
        "https://cdn.example.test/fake.png",
        PHOTO.assetId,
        PHOTO.assetId,
        null,
        12,
      ]),
    ).toEqual([PHOTO.assetId]);
  });

  it("caps how many images one entry can cite", () => {
    const ids = Array.from(
      { length: 12 },
      (_, i) => `aaaaaaaa-1111-4111-8111-1111111111${String(i).padStart(2, "0")}`,
    );
    expect(parseNotebookAttachmentIds(ids)).toHaveLength(MAX_NOTEBOOK_ATTACHMENTS);
  });

  it("returns empty when nothing was attached", () => {
    expect(parseNotebookAttachmentIds(undefined)).toEqual([]);
    expect(parseNotebookAttachmentIds([])).toEqual([]);
  });
});

describe("attachment tag metadata", () => {
  it("round-trips a media-kit id through the reserved tag", () => {
    const tag = notebookAssetTag(PHOTO.assetId);
    expect(isNotebookAssetTag(tag)).toBe(true);
    expect(attachmentIdsFromTags(["cad", tag, "prototype"])).toEqual([PHOTO.assetId]);
  });

  it("ignores a user tag that merely looks similar", () => {
    expect(attachmentIdsFromTags(["asset:whiteboard", "asset:not-a-uuid"])).toEqual([]);
  });

  it("splits stored tags so the UI never shows asset: ids as hashtags", () => {
    const stored = mergeNotebookTags(
      { tags: [], attachmentIds: [] },
      { tags: ["cad", "Intake"], attachmentIds: [PHOTO.assetId] },
    );
    expect(splitNotebookTags(stored)).toEqual({
      tags: ["cad", "intake"],
      attachmentIds: [PHOTO.assetId],
    });
  });

  it("keeps photos when only the write-up tags change", () => {
    const next = mergeNotebookTags(
      { tags: ["cad"], attachmentIds: [PHOTO.assetId] },
      { tags: ["iterate"] },
    );
    expect(splitNotebookTags(next).attachmentIds).toEqual([PHOTO.assetId]);
    expect(splitNotebookTags(next).tags).toEqual(["iterate"]);
  });

  it("keeps user tags when only the photo list changes", () => {
    const next = mergeNotebookTags(
      { tags: ["cad"], attachmentIds: [PHOTO.assetId] },
      { attachmentIds: [] },
    );
    expect(splitNotebookTags(next)).toEqual({ tags: ["cad"], attachmentIds: [] });
  });
});

describe("notebookEntryHasImageEvidence", () => {
  it("treats a text-only body — including markdown images — as not enough", () => {
    expect(notebookEntryHasImageEvidence([])).toBe(false);
    expect(notebookEntryHasImageEvidence(undefined)).toBe(false);
    // Body text is not passed in on purpose: markdown in the write-up is not metadata.
    expect(
      notebookEntryHasImageEvidence([
        { kind: "photo", url: "" },
        { kind: "other", url: "https://cdn.example.test/notes.pdf" },
      ]),
    ).toBe(false);
  });

  it("counts only a resolved kit / library image with a real URL", () => {
    expect(notebookEntryHasImageEvidence([attachment()])).toBe(true);
    expect(notebookEntryHasImageEvidence([attachment({ kind: "graphic" })])).toBe(true);
    expect(notebookEntryHasImageEvidence([attachment({ kind: "logo" })])).toBe(true);
    expect(notebookEntryHasImageEvidence([attachment({ kind: "video" })])).toBe(true);
  });
});

describe("summarizeNotebookEvidence", () => {
  it("reports how many entries actually have photos, not how many have a body", () => {
    expect(
      summarizeNotebookEvidence([
        { attachments: [attachment()] },
        { attachments: [] },
        {},
      ]),
    ).toEqual({ withPhotos: 1, missingPhotos: 2 });
  });
});

describe("resolveNotebookAttachments", () => {
  it("returns an honest empty list when no ids were stored", async () => {
    const { query } = queryForTables({});
    const resolved = await resolveNotebookAttachments(
      { query } as unknown as PoolClient,
      { orgId: "org-1", assetIds: [] },
    );
    expect(resolved).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it("omits ids that are gone, empty-URL, or not an image — never invents a photo", async () => {
    const { query } = queryForTables({
      kit: [
        attachment(),
        attachment({
          assetId: "bbbbbbbb-2222-4222-8222-222222222222",
          kind: "other",
          url: "https://cdn.example.test/notes.pdf",
        }),
        attachment({
          assetId: "cccccccc-3333-4333-8333-333333333333",
          kind: "photo",
          url: "   ",
        }),
      ],
    });
    const resolved = await resolveNotebookAttachments({ query } as unknown as PoolClient, {
      orgId: "11111111-1111-4111-8111-111111111111",
      assetIds: [
        PHOTO.assetId,
        "bbbbbbbb-2222-4222-8222-222222222222",
        "cccccccc-3333-4333-8333-333333333333",
        "dddddddd-4444-4444-8444-444444444444",
      ],
    });
    expect(resolved).toEqual([attachment({ source: "media_kit" })]);
    expect(resolved.some((row) => row.url === "")).toBe(false);
  });

  it("resolves a media-library photo that is not in the media kit", async () => {
    const libraryId = "bbbbbbbb-2222-4222-8222-222222222222";
    const orgId = "11111111-1111-4111-8111-111111111111";
    const { query } = queryForTables({
      library: [{ assetId: libraryId, title: "Whiteboard", kind: "photo", caption: null }],
    });
    const resolved = await resolveNotebookAttachments({ query } as unknown as PoolClient, {
      orgId,
      assetIds: [libraryId],
    });
    expect(resolved).toEqual([
      {
        assetId: libraryId,
        title: "Whiteboard",
        kind: "photo",
        url: `/api/media-library/items/${libraryId}?orgId=${orgId}`,
        description: null,
        source: "media_library",
      },
    ]);
  });
});

describe("assertNotebookImageAttachments", () => {
  it("refuses ids that do not resolve to a team photo", async () => {
    const { query } = queryForTables({});
    await expect(
      assertNotebookImageAttachments({ query } as unknown as PoolClient, {
        orgId: "org-1",
        assetIds: [PHOTO.assetId],
      }),
    ).rejects.toThrow(/media library/);
  });

  it("returns the resolved rows when every id is a real image", async () => {
    const { query } = queryForTables({ kit: [attachment()] });
    await expect(
      assertNotebookImageAttachments({ query } as unknown as PoolClient, {
        orgId: "org-1",
        assetIds: [PHOTO.assetId],
      }),
    ).resolves.toEqual([attachment({ source: "media_kit" })]);
  });
});

describe("listNotebookImageLibrary", () => {
  it("hides non-image kit files from the picker", async () => {
    const { query } = queryForTables({
      kit: [
        attachment(),
        attachment({
          assetId: "bbbbbbbb-2222-4222-8222-222222222222",
          kind: "other",
          title: "Budget PDF",
          url: "https://cdn.example.test/budget.pdf",
        }),
      ],
    });
    const library = await listNotebookImageLibrary({ query } as unknown as PoolClient, {
      orgId: "org-1",
    });
    expect(library).toEqual([attachment({ source: "media_kit" })]);
  });

  it("includes ready library photos and linked scout photos in the picker", async () => {
    const libraryId = "bbbbbbbb-2222-4222-8222-222222222222";
    const scoutId = "cccccccc-3333-4333-8333-333333333333";
    const orgId = "org-1";
    const { query } = queryForTables({
      library: [{ assetId: libraryId, title: "Shop photo", kind: "photo", caption: null }],
      scout: [
        {
          assetId: scoutId,
          clientId: "img-1",
          entryId: "dddddddd-4444-4444-8444-444444444444",
          kind: "photo",
          teamKey: "frc254",
          eventKey: "2026mndu",
          hasThumb: false,
        },
      ],
    });
    const library = await listNotebookImageLibrary({ query } as unknown as PoolClient, { orgId });
    expect(library.map((row) => row.source)).toEqual(["media_library", "scout_media"]);
    expect(library.every((row) => row.url.trim())).toBe(true);
  });
});
