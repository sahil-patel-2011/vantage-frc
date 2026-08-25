import { describe, expect, it } from "vitest";
import { cadActivityDetailFrom, cadActivityFilters } from "./cad-activity";

describe("cadActivityFilters", () => {
  it("defaults to the whole team and both sources", () => {
    const filters = cadActivityFilters({});
    expect(filters).toMatchObject({ scope: "all", source: "all", mineOnly: false, sourceParam: null });
  });

  it("narrows to the caller's own sessions", () => {
    expect(cadActivityFilters({ scope: "mine" })).toMatchObject({ scope: "mine", mineOnly: true });
  });

  it("narrows by source", () => {
    expect(cadActivityFilters({ source: "terminal" }).sourceParam).toBe("terminal");
    expect(cadActivityFilters({ source: "web" }).sourceParam).toBe("web");
  });

  /** A filter must never be able to widen the query or reach the SQL as raw text. */
  it("falls back to the safe reading for unknown or injected values", () => {
    for (const hostile of ["everyone", "' OR 1=1 --", "MINE", "", null, undefined]) {
      const filters = cadActivityFilters({ scope: hostile as string, source: hostile as string });
      expect(filters.scope === "mine" || filters.scope === "all").toBe(true);
      expect(filters.sourceParam === null || ["web", "terminal"].includes(filters.sourceParam)).toBe(true);
    }
    expect(cadActivityFilters({ source: "'; DROP TABLE cad_jobs; --" }).sourceParam).toBeNull();
  });
});

describe("cadActivityDetailFrom", () => {
  it("renders a terminal session from its recorded tool calls", () => {
    const detail = cadActivityDetailFrom({
      id: "job-1",
      kind: "cad_cli",
      status: "completed",
      brief: {
        kind: "cad_cli",
        toolCalls: [
          { tool: "onshape_bind", params: { documentId: "d1" }, at: "2026-08-01T10:00:00.000Z", ok: true },
          { tool: "onshape_extrude", params: { depthMm: 6 }, at: "2026-08-01T10:01:00.000Z", ok: true },
          { tool: "onshape_hole", params: {}, at: "2026-08-01T10:02:00.000Z", ok: false, error: "No solid body" },
        ],
      },
      document_ref: { documentName: "Test Plate", url: "https://cad.onshape.com/documents/d1" },
    });
    expect(detail.source).toBe("terminal");
    expect(detail.steps).toHaveLength(3);
    expect(detail.steps[1]).toMatchObject({ index: 2, tool: "onshape_extrude", detail: "depthMm=6" });
    expect(detail.steps[2]).toMatchObject({ status: "failed", detail: "No solid body" });
    expect(detail.documentName).toBe("Test Plate");
    expect(detail.emptyReason).toBeNull();
  });

  it("renders a web session from its narrated steps", () => {
    const detail = cadActivityDetailFrom({
      id: "job-2",
      kind: "cad_agent",
      status: "running",
      brief: {
        kind: "cad_agent",
        steps: [
          {
            index: 1,
            tool: "onshape_sketch_rectangle",
            label: "Sketch rectangle",
            title: "Sketched a 80×50 mm rectangle on Top",
            detail: "feature abc",
            status: "done",
            at: "2026-08-01T10:00:00.000Z",
          },
        ],
      },
      document_ref: { documentId: "d2" },
    });
    expect(detail.source).toBe("web");
    expect(detail.steps[0]?.title).toBe("Sketched a 80×50 mm rectangle on Top");
    expect(detail.documentName).toBe("d2");
  });

  /** No step data must read as "nothing recorded", never as a fabricated build log. */
  it("explains an empty session instead of inventing steps", () => {
    const terminal = cadActivityDetailFrom({
      id: "job-3",
      kind: "cad_cli",
      status: "running",
      brief: { kind: "cad_cli" },
      document_ref: null,
    });
    expect(terminal.steps).toEqual([]);
    expect(terminal.emptyReason).toContain("never ran a CAD operation");

    const web = cadActivityDetailFrom({
      id: "job-4",
      kind: "cad_agent",
      status: "running",
      brief: null,
      document_ref: null,
    });
    expect(web.steps).toEqual([]);
    expect(web.emptyReason).toContain("no recorded build steps");
  });

  it("survives malformed brief JSON without throwing", () => {
    const detail = cadActivityDetailFrom({
      id: "job-5",
      kind: "cad_cli",
      status: "failed",
      brief: { toolCalls: ["not-an-object", { noTool: true }, null] },
      document_ref: "not-an-object",
    });
    expect(detail.steps).toEqual([]);
    expect(detail.documentName).toBeNull();
  });
});
