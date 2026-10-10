import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatDraftSavedAgo,
  payloadHasDraftContent,
  scoutDraftStorageKey,
  clearScoutDraft,
  readScoutDraft,
  writeScoutDraft,
} from "./draft-autosave";

afterEach(() => vi.unstubAllGlobals());

describe("original report recovery", () => {
  const orgId = "11111111-1111-4111-8111-111111111111";
  const schemaId = "22222222-2222-4222-8222-222222222222";
  const snapshot = { payload: { fuel: 0 }, confidence: "normal" as const, matchKey: "2026test_qm1", teamKey: "frc6925",
    clientId: "33333333-3333-4333-8333-333333333333", schemaId, source: "manual" as const,
    schema: { id: schemaId, orgId, year: 2026, type: "match" as const, version: 1,
      definition: { title: "Original questions", fields: [{ key: "fuel", label: "Fuel", type: "counter" as const, required: true }] } } };
  const memory = () => {
    const entries = new Map<string, string>();
    const localStorage = { getItem: (key: string) => entries.get(key) ?? null,
      setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
    vi.stubGlobal("window", { localStorage });
    return localStorage;
  };
  it("keeps the form, identity and explicit zero after a reload", () => {
    memory();
    expect(writeScoutDraft("personal-draft", snapshot)).toBeTruthy();
    expect(readScoutDraft("personal-draft")).toMatchObject(snapshot);
  });
  it("keeps the answers and original form ID when its saved renderer snapshot is unusable", () => {
    const store = memory();
    store.setItem("personal-draft", JSON.stringify({ ...snapshot, savedAt: new Date().toISOString(), schema: { ...snapshot.schema, definition: { fields: null } } }));
    expect(readScoutDraft("personal-draft")).toMatchObject({ payload: { fuel: 0 }, schemaId, clientId: snapshot.clientId });
    expect(readScoutDraft("personal-draft")?.schema).toBeUndefined();
  });
  it("reports failed cleanup so the caller can retain open answers", () => {
    const store = memory();
    writeScoutDraft("personal-draft", snapshot);
    vi.stubGlobal("window", { localStorage: { ...store, removeItem: () => { throw new Error("Blocked"); } } });
    expect(clearScoutDraft("personal-draft")).toBe(false);
    expect(readScoutDraft("personal-draft")?.payload).toEqual({ fuel: 0 });
  });
});

describe("scoutDraftStorageKey", () => {
  it("builds a personal org-scoped key and refuses empty team context", () => {
    expect(
      scoutDraftStorageKey({
        userId: "person-a",
        orgId: "org-1",
        eventKey: "2026nysu",
        entryType: "match",
        matchKey: "qm12",
        teamKey: "frc254",
      }),
    ).toBe("vantage-scout-draft-person:person-a:org-1:2026nysu:match:qm12:frc254");
    expect(
      scoutDraftStorageKey({
        userId: "person-a",
        orgId: "org-1",
        eventKey: "2026nysu",
        entryType: "pit",
        teamKey: "",
      }),
    ).toBeNull();
  });
  it("separates two scouts on the same robot and never adopts unidentified older drafts", () => {
    const context = { orgId: "org-1", eventKey: "2026nysu", entryType: "match" as const, matchKey: "qm12", teamKey: "frc254" };
    expect(scoutDraftStorageKey(context)).toBeNull();
    expect(scoutDraftStorageKey({ ...context, userId: "a" })).not.toBe(scoutDraftStorageKey({ ...context, userId: "b" }));
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
