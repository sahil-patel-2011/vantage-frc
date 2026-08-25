import { describe, expect, it } from "vitest";
import { parseCadCliSyncPayload, summarizeCadToolParams } from "./cli-sync";

describe("parseCadCliSyncPayload", () => {
  it("accepts a full terminal mutation report", () => {
    const parsed = parseCadCliSyncPayload({
      sessionId: "abc123-DEF456",
      status: "running",
      platform: "onshape",
      documentRef: { documentId: "d1", workspaceId: "w1", elementId: "e1", documentName: "Drivetrain scratch" },
      event: {
        tool: "onshape_extrude",
        params: { depthMm: 10, sketchFeatureId: "F1" },
        at: "2026-08-23T10:00:00.000Z",
        ok: true,
      },
    });
    expect(parsed.sessionId).toBe("abc123-DEF456");
    expect(parsed.platform).toBe("onshape");
    expect(parsed.documentRef).toEqual({
      documentId: "d1",
      workspaceId: "w1",
      elementId: "e1",
      documentName: "Drivetrain scratch",
    });
    expect(parsed.event).toEqual({
      tool: "onshape_extrude",
      params: { depthMm: 10, sketchFeatureId: "F1" },
      at: "2026-08-23T10:00:00.000Z",
      ok: true,
    });
  });

  it("accepts start/end reports without an event", () => {
    const parsed = parseCadCliSyncPayload({ sessionId: "session_12345", status: "completed" });
    expect(parsed.event).toBeNull();
    expect(parsed.documentRef).toBeNull();
    expect(parsed.platform).toBeNull();
    expect(parsed.status).toBe("completed");
  });

  it("rejects bad session ids, statuses, and tool names", () => {
    expect(() => parseCadCliSyncPayload({ sessionId: "short", status: "running" })).toThrow("sessionId");
    expect(() => parseCadCliSyncPayload({ sessionId: "abcdefgh1", status: "paused" })).toThrow("status");
    expect(() =>
      parseCadCliSyncPayload({
        sessionId: "abcdefgh1",
        status: "running",
        event: { tool: "DROP TABLE", params: {} },
      }),
    ).toThrow("event.tool");
  });

  it("clips oversized fields and normalizes bad timestamps", () => {
    const parsed = parseCadCliSyncPayload({
      sessionId: "abcdefgh1",
      status: "failed",
      documentRef: { documentId: "x".repeat(500), ignored: "y" },
      event: { tool: "onshape_sketch_rectangle", params: {}, at: "not-a-date", ok: false, error: "e".repeat(500) },
    });
    expect(parsed.documentRef?.documentId?.length).toBe(200);
    expect(parsed.documentRef).not.toHaveProperty("ignored");
    expect(parsed.event?.error?.length).toBe(300);
    expect(Number.isFinite(Date.parse(parsed.event!.at))).toBe(true);
    expect(parsed.event?.ok).toBe(false);
  });
});

describe("summarizeCadToolParams", () => {
  it("keeps primitives, drops nested values and secret-shaped keys", () => {
    expect(
      summarizeCadToolParams({
        widthMm: 40,
        plane: "Top",
        deep: { nested: true },
        list: [1, 2],
        accessKey: "SHOULD-NOT-SYNC",
        secretKey: "SHOULD-NOT-SYNC",
        authToken: "SHOULD-NOT-SYNC",
        dryRun: false,
      }),
    ).toEqual({ widthMm: 40, plane: "Top", dryRun: false });
  });

  it("clips long strings and bounds the key count", () => {
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, index) => [`k${index}`, "v"]));
    expect(Object.keys(summarizeCadToolParams(many)).length).toBe(12);
    const clipped = summarizeCadToolParams({ name: "n".repeat(200) });
    expect(String(clipped.name).length).toBe(80);
  });
});
