import { describe, expect, it } from "vitest";
import {
  formatDraftSavedAgo,
  payloadHasDraftContent,
  scoutDraftStorageKey,
} from "./draft-autosave";

describe("scoutDraftStorageKey", () => {
  it("builds an org-scoped key and refuses empty team context", () => {
    expect(
      scoutDraftStorageKey({
        orgId: "org-1",
        eventKey: "2026nysu",
        entryType: "match",
        matchKey: "qm12",
        teamKey: "frc254",
      }),
    ).toBe("vantage-scout-draft:org-1:2026nysu:match:qm12:frc254");
    expect(
      scoutDraftStorageKey({
        orgId: "org-1",
        eventKey: "2026nysu",
        entryType: "pit",
        teamKey: "",
      }),
    ).toBeNull();
  });
});

describe("formatDraftSavedAgo", () => {
  it("labels unsaved vs recent drafts without DEMO copy", () => {
    expect(formatDraftSavedAgo(null)).toBe("Unsaved changes");
    const now = Date.parse("2026-07-20T12:00:00.000Z");
    expect(formatDraftSavedAgo("2026-07-20T11:59:50.000Z", now)).toBe("Draft saved 10s ago");
  });
});

describe("payloadHasDraftContent", () => {
  it("ignores empty payloads", () => {
    expect(payloadHasDraftContent({})).toBe(false);
    expect(payloadHasDraftContent({ notes: "  " })).toBe(false);
    expect(payloadHasDraftContent({ auto: 3 })).toBe(true);
  });
});
