import { describe, expect, it } from "vitest";
import {
  LocalMediaStorage,
  assertExplicitOrgAccess,
  assertResourceInOrg,
  assertStorageKeyForOrg,
  filterMediaForOrg,
  filterSchemasForOrg,
  filterVoiceNotesForOrg,
  isWrongOrgDenied,
  orgIdFromUploadUrl,
  orgScopedStorageKey,
  OrgIsolationError,
  partitionByOrgId,
  storageKeyBelongsToOrg,
  wouldCrossOrgLeak,
  type ScoutSchema,
  type SyncEntry,
} from "../src";

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("SECURITY — wrong orgId denied", () => {
  it("treats zero membership rows as a hard deny", () => {
    expect(isWrongOrgDenied(0)).toBe(true);
    expect(isWrongOrgDenied(1)).toBe(false);
  });

  it("assertResourceInOrg throws 403 for foreign form/media ids", () => {
    expect(() => assertResourceInOrg(ORG_B, ORG_A, "Custom form")).toThrow(OrgIsolationError);
    try {
      assertResourceInOrg(ORG_B, ORG_A, "Custom form");
    } catch (error) {
      expect(error).toMatchObject({
        status: 403,
        message: "Custom form not found in this organization",
      });
    }
    expect(() => assertResourceInOrg(ORG_A, ORG_A, "Custom form")).not.toThrow();
  });

  it("assertExplicitOrgAccess throws 403 for a foreign orgId probe", () => {
    expect(() => assertExplicitOrgAccess(ORG_B, 0)).toThrow(OrgIsolationError);
    expect(() => assertExplicitOrgAccess(ORG_B, 0)).toThrow(/Organization access denied/);
    expect(() => assertExplicitOrgAccess(ORG_A, 1)).not.toThrow();
    expect(() => assertExplicitOrgAccess(null, 0)).not.toThrow();
  });
});

describe("SECURITY — custom forms cannot leak across orgs", () => {
  const forms: ScoutSchema[] = [
    {
      id: "schema-a",
      orgId: ORG_A,
      year: 2026,
      type: "match",
      version: 1,
      definition: { title: "A", fields: [{ key: "notes", label: "Notes", type: "text" }] },
    },
    {
      id: "schema-b",
      orgId: ORG_B,
      year: 2026,
      type: "pit",
      version: 2,
      definition: {
        title: "B",
        fields: [{ key: "robot_image", label: "Robot", type: "robot_image" }],
      },
    },
  ];

  it("filters schemas so Org A never sees Org B form definitions", () => {
    expect(filterSchemasForOrg(forms, ORG_A).map((s) => s.id)).toEqual(["schema-a"]);
    expect(filterSchemasForOrg(forms, ORG_B).map((s) => s.id)).toEqual(["schema-b"]);
  });

  it("blocks syncing a form entry stamped for another org", () => {
    const foreign: SyncEntry = {
      clientId: "c1",
      orgId: ORG_B,
      type: "match",
      eventKey: "2026test",
      teamKey: "frc254",
      schemaId: "schema-b",
      payload: { notes: "secret" },
      confidence: "normal",
      source: "manual",
      updatedAt: "2026-07-18T00:00:00Z",
    };
    expect(wouldCrossOrgLeak(foreign.orgId, ORG_A)).toBe(true);
    const { allowed, blocked } = partitionByOrgId([foreign, { ...foreign, orgId: ORG_A, clientId: "c2" }], ORG_A);
    expect(allowed.map((e) => e.clientId)).toEqual(["c2"]);
    expect(blocked.map((e) => e.clientId)).toEqual(["c1"]);
  });
});

describe("SECURITY — images cannot leak across orgs", () => {
  it("prefixes storage keys with orgId and rejects foreign keys", async () => {
    const storage = new LocalMediaStorage();
    const upload = await storage.createUpload({
      orgId: ORG_A,
      clientId: "img-1",
      contentType: "image/jpeg",
      byteSize: 1200,
    });
    expect(upload.storageKey).toBe(`${ORG_A}/local/img-1`);
    expect(storageKeyBelongsToOrg(upload.storageKey, ORG_A)).toBe(true);
    expect(storageKeyBelongsToOrg(upload.storageKey, ORG_B)).toBe(false);
    expect(orgIdFromUploadUrl(upload.uploadUrl)).toBe(ORG_A);
    expect(() => assertStorageKeyForOrg(`${ORG_B}/local/img-1`, ORG_A)).toThrow(/does not belong/i);
  });

  it("refuses empty orgId when building media keys", () => {
    expect(() => orgScopedStorageKey("", "c1")).toThrow(OrgIsolationError);
  });

  it("filters media rows by org so images never cross tenants", () => {
    const media = [
      { orgId: ORG_A, clientId: "a", kind: "photo", storageKey: `${ORG_A}/local/a` },
      { orgId: ORG_B, clientId: "b", kind: "photo", storageKey: `${ORG_B}/local/b` },
    ];
    expect(filterMediaForOrg(media, ORG_A).map((m) => m.clientId)).toEqual(["a"]);
  });
});

describe("SECURITY — voice notes cannot leak across orgs", () => {
  it("keeps voice-source entries and audio transcripts org-scoped", () => {
    const rows = [
      { orgId: ORG_A, source: "voice" as const, clientId: "v-a", payload: { notes: "ours" } },
      { orgId: ORG_B, source: "voice" as const, clientId: "v-b", payload: { notes: "theirs" } },
      { orgId: ORG_A, kind: "audio", transcript: "auto score 3", clientId: "audio-a" },
      { orgId: ORG_B, kind: "audio", transcript: "secret pit notes", clientId: "audio-b" },
      { orgId: null, source: "voice" as const, clientId: "orphan" },
    ];
    const visible = filterVoiceNotesForOrg(rows, ORG_A);
    expect(visible.map((r) => r.clientId).sort()).toEqual(["audio-a", "v-a"]);
    expect(visible.some((r) => r.clientId === "v-b" || r.clientId === "audio-b")).toBe(false);
    expect(visible.some((r) => r.clientId === "orphan")).toBe(false);
  });

  it("treats missing orgId on a voice outbox item as a cross-org leak risk", () => {
    expect(wouldCrossOrgLeak(undefined, ORG_A)).toBe(true);
    expect(wouldCrossOrgLeak(ORG_A, ORG_A)).toBe(false);
  });
});
