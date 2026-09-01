import { describe, expect, it } from "vitest";
import { scoutMediaUnlinkedMessage } from "./prepare-scout-media";
import {
  buildAttachMediaWire,
  canQueueAttachedMedia,
  entryClientIdFromMediaTag,
  entryClientMediaTag,
  mediaLinkJobsAfterMint,
  pickMintedEntryId,
  readScoutMediaLinkFromPost,
  withEntryClientTag,
} from "./attach-media-wire";

const ENTRY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("buildAttachMediaWire", () => {
  it("refuses to queue when entryClientId is missing", () => {
    const result = buildAttachMediaWire({
      eventKey: "2026mndu",
      teamKey: "frc254",
      kind: "photo",
      contentType: "image/jpeg",
      byteSize: 128,
      tags: ["pit"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected refuse");
    expect(result.reason).toBe(scoutMediaUnlinkedMessage());
    expect(result.permanent).toBe(true);
    expect(canQueueAttachedMedia(result)).toBe(false);
  });

  it("refuses a blank or whitespace entryClientId", () => {
    expect(
      canQueueAttachedMedia(
        buildAttachMediaWire({
          eventKey: "2026mndu",
          teamKey: "frc254",
          entryClientId: "   ",
          kind: "photo",
          contentType: "image/jpeg",
          byteSize: 128,
        }),
      ),
    ).toBe(false);
  });

  it("refuses when event or team is missing — does not invent either", () => {
    const noEvent = buildAttachMediaWire({
      teamKey: "frc254",
      entryClientId: "entry-local-1",
      kind: "photo",
      contentType: "image/jpeg",
      byteSize: 128,
    });
    expect(noEvent.ok).toBe(false);
    const noTeam = buildAttachMediaWire({
      eventKey: "2026mndu",
      entryClientId: "entry-local-1",
      kind: "photo",
      contentType: "image/jpeg",
      byteSize: 128,
    });
    expect(noTeam.ok).toBe(false);
  });

  it("builds metadata that always carries the entry link and entry_client tag", () => {
    const result = buildAttachMediaWire({
      eventKey: "2026mndu",
      teamKey: "frc254",
      entryClientId: " entry-local-1 ",
      entryId: ENTRY,
      kind: "photo",
      contentType: "image/jpeg",
      byteSize: 128,
      tags: ["pit"],
      fieldKey: "robot_images",
    });
    expect(canQueueAttachedMedia(result)).toBe(true);
    if (!result.ok) throw new Error("expected queue");
    expect(result.metadata.entryClientId).toBe("entry-local-1");
    expect(result.metadata.entryId).toBe(ENTRY);
    expect(result.metadata.tags).toEqual([
      "pit",
      "field:robot_images",
      "robot_image",
      "entry_client:entry-local-1",
    ]);
    expect(result.metadata.hasThumb).toBe(false);
    expect(result.metadata.thumbContentType).toBeNull();
    expect(result.metadata.thumbByteSize).toBeNull();
  });

  it("does not invent a thumb when hasThumb is omitted", () => {
    const result = buildAttachMediaWire({
      eventKey: "2026mndu",
      teamKey: "frc254",
      entryClientId: "entry-local-1",
      kind: "photo",
      contentType: "image/jpeg",
      byteSize: 64,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected queue");
    expect(result.metadata.hasThumb).toBe(false);
    expect(result.metadata.thumbContentType).toBeNull();
  });

  it("keeps a known thumb only when the caller says one exists", () => {
    const result = buildAttachMediaWire({
      eventKey: "2026mndu",
      teamKey: "frc254",
      entryClientId: "entry-local-1",
      kind: "photo",
      contentType: "image/jpeg",
      byteSize: 64,
      hasThumb: true,
      thumbContentType: "image/jpeg",
      thumbByteSize: 40,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected queue");
    expect(result.metadata.hasThumb).toBe(true);
    expect(result.metadata.thumbByteSize).toBe(40);
  });
});

describe("entryClientMediaTag", () => {
  it("encodes a stable tag from the entry client id", () => {
    expect(entryClientMediaTag("entry-local-1")).toBe("entry_client:entry-local-1");
    expect(entryClientIdFromMediaTag("entry_client:entry-local-1")).toBe("entry-local-1");
  });

  it("returns empty for a blank id — never a DEMO tag", () => {
    expect(entryClientMediaTag("  ")).toBe("");
    expect(entryClientIdFromMediaTag("entry_client:")).toBeNull();
    expect(entryClientIdFromMediaTag("robot_image")).toBeNull();
  });

  it("does not duplicate the tag when it is already present", () => {
    expect(withEntryClientTag(["entry_client:entry-local-1", "pit"], "entry-local-1")).toEqual([
      "entry_client:entry-local-1",
      "pit",
    ]);
  });
});

describe("readScoutMediaLinkFromPost / pickMintedEntryId", () => {
  it("reads a uuid entryId and a non-empty entryClientId", () => {
    expect(
      readScoutMediaLinkFromPost({ entryId: ` ${ENTRY} `, entryClientId: " entry-local-1 " }),
    ).toEqual({ entryClientId: "entry-local-1", entryId: ENTRY });
  });

  it("drops a non-uuid entryId instead of passing it to scout_media", () => {
    expect(readScoutMediaLinkFromPost({ entryId: "entry-local-1", entryClientId: "e1" })).toEqual({
      entryClientId: "e1",
      entryId: null,
    });
  });

  it("prefers an explicit uuid and falls back to a looked-up uuid", () => {
    expect(pickMintedEntryId({ entryId: ENTRY, lookedUpEntryId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" })).toBe(
      ENTRY,
    );
    expect(pickMintedEntryId({ entryId: "entry-local-1", lookedUpEntryId: ENTRY })).toBe(ENTRY);
  });

  it("returns null rather than inventing when neither is a uuid", () => {
    expect(pickMintedEntryId({ entryId: "entry-local-1", lookedUpEntryId: "also-local" })).toBeNull();
    expect(pickMintedEntryId({})).toBeNull();
  });
});

describe("mediaLinkJobsAfterMint", () => {
  it("pairs minted acks with the entry payload and the entry_client tag", () => {
    expect(
      mediaLinkJobsAfterMint({
        acknowledgements: [
          { clientId: "entry-local-1", entryId: ENTRY },
          { clientId: "entry-local-2" },
          { clientId: "orphan", entryId: "not-a-uuid" },
        ],
        entries: [{ clientId: "entry-local-1", payload: { robot_images: ["img-a"] } }],
      }),
    ).toEqual([
      {
        entryId: ENTRY,
        entryClientId: "entry-local-1",
        payload: { robot_images: ["img-a"] },
        entryClientTag: "entry_client:entry-local-1",
      },
    ]);
  });

  it("uses an empty payload when the entry body is missing — never DEMO refs", () => {
    const jobs = mediaLinkJobsAfterMint({
      acknowledgements: [{ clientId: "entry-local-1", entryId: ENTRY }],
      entries: [],
    });
    expect(jobs).toEqual([
      {
        entryId: ENTRY,
        entryClientId: "entry-local-1",
        payload: {},
        entryClientTag: "entry_client:entry-local-1",
      },
    ]);
  });
});
