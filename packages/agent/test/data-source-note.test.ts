import { describe, expect, it } from "vitest";
import { attachDataSourceNote, formatGroundedReply, annotateToolOutput } from "../src/auto-tools";
import { classifyToolDataSourceNote } from "../src/data-source-note";

const now = new Date("2026-07-17T21:00:00.000Z");

describe("classifyToolDataSourceNote", () => {
  it("is ok when TBA is healthy", () => {
    const note = classifyToolDataSourceNote({
      now,
      healthStatus: "healthy",
      consecutiveFailures: 0,
      lastSuccessAt: "2026-07-17T20:55:00.000Z",
      lastError: null,
      cacheHasRows: true,
    });
    expect(note.mode).toBe("ok");
    expect(note.usingLastGoodCache).toBe(false);
  });

  it("flags degraded and keeps last-good cache", () => {
    const note = classifyToolDataSourceNote({
      now,
      healthStatus: "degraded",
      consecutiveFailures: 2,
      lastSuccessAt: "2026-07-17T18:00:00.000Z",
      lastError: "503 upstream",
      cacheHasRows: true,
    });
    expect(note.mode).toBe("degraded");
    expect(note.usingLastGoodCache).toBe(true);
    expect(note.message).toContain("last-good");
  });
});

describe("assistant tool data-source annotation", () => {
  it("stamps reference tools and surfaces cache mode in grounded replies", () => {
    const empty = annotateToolOutput("reference.team", [], { teamKey: "frc254" });
    const stamped = attachDataSourceNote([empty], {
      mode: "degraded",
      usingLastGoodCache: true,
      message: "TBA ingest is degraded. Serving last-good Neon reference cache.",
    });
    expect(stamped[0]?.dataSource?.mode).toBe("degraded");
    const reply = formatGroundedReply("epa for 254", stamped);
    expect(reply).toContain("last-good Neon cache");
    expect(reply).toContain("data source degraded");
  });
});
