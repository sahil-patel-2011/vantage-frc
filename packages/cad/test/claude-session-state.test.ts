import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCallBudget } from "../src/call-budget";
import {
  bindClaudeCadSession,
  cacheSessionGeometry,
  findEditableFeature,
  forgetSessionFeature,
  formatClaudeCadSession,
  invalidateSessionGeometry,
  isBoundToSameElement,
  loadClaudeCadSession,
  noteSessionCalls,
  readSessionGeometry,
  reconcileSessionMicroversion,
  recordSessionFeature,
  requireBoundDocument,
  saveClaudeCadSession,
  sessionOwnsFeature,
  summarizeClaudeCadSession,
  updateSessionFeatureParameters,
  type ClaudeCadSession,
} from "../src/claude-session";

const PLATE = {
  documentId: "doc-1",
  workspaceId: "ws-1",
  elementId: "el-1",
  documentName: "Disposable plate",
  url: "https://cad.onshape.com/documents/doc-1/w/ws-1/e/el-1",
};

function plateSession(): ClaudeCadSession {
  let session = bindClaudeCadSession({}, PLATE, "2026-08-24T12:00:00.000Z");
  session = recordSessionFeature(session, {
    featureId: "F-sketch",
    kind: "sketch",
    tool: "onshape_sketch_rectangle",
    name: "Plate outline",
    plane: "Top",
    at: "2026-08-24T12:00:01.000Z",
    parameters: { widthMm: 80, heightMm: 60 },
  });
  session = recordSessionFeature(session, {
    featureId: "F-extrude",
    kind: "solid",
    tool: "onshape_extrude",
    name: "Plate",
    at: "2026-08-24T12:00:02.000Z",
    parameters: { depthMm: 6 },
  });
  return session;
}

describe("binding and resume", () => {
  it("keeps feature state when re-binding the same Part Studio", () => {
    const session = plateSession();
    const rebound = bindClaudeCadSession(session, PLATE);
    expect(rebound.features).toHaveLength(2);
    expect(rebound.lastSketchFeatureId).toBe("F-sketch");
    expect(isBoundToSameElement(rebound, PLATE)).toBe(true);
    expect(requireBoundDocument(rebound).elementId).toBe("el-1");
  });

  it("discards feature ids from another Part Studio, because they address nothing there", () => {
    const session = noteSessionCalls(plateSession(), createCallBudget().summary());
    const elsewhere = bindClaudeCadSession(session, { ...PLATE, elementId: "el-2" });
    expect(elsewhere.features).toEqual([]);
    expect(elsewhere.geometry).toEqual([]);
    expect(elsewhere.lastSketchFeatureId).toBeUndefined();
    expect(elsewhere.rebuild).toBe(0);
    // The lifetime call tally belongs to the machine, not the document.
    expect(elsewhere.calls).toBeDefined();
  });

  it("refuses to work unbound with an instruction instead of a crash", () => {
    expect(() => requireBoundDocument({})).toThrow(/onshape_bind/);
    expect(formatClaudeCadSession({})[0]).toMatch(/nothing bound/i);
    expect(formatClaudeCadSession(plateSession()).join("\n")).toContain("Disposable plate");
  });
});

describe("editing an existing feature instead of rebuilding", () => {
  it("finds the extrude that owns depthMm and rewrites it in place", () => {
    const session = plateSession();
    const target = findEditableFeature(session, { parameter: "depthMm" });
    expect(target?.featureId).toBe("F-extrude");

    const edited = updateSessionFeatureParameters(session, target!.featureId, { depthMm: 8 });
    expect(edited.features).toHaveLength(2);
    const extrude = edited.features?.find((feature) => feature.featureId === "F-extrude");
    expect(extrude?.parameters).toEqual({ depthMm: 8 });
    expect(extrude?.updatedAt).toBeTruthy();
    expect(sessionOwnsFeature(edited, "F-extrude")).toBe(true);
  });

  it("refuses to edit a feature this session did not create", () => {
    expect(() => updateSessionFeatureParameters(plateSession(), "F-unknown", { depthMm: 8 })).toThrow(
      /not created in this session/i,
    );
    expect(findEditableFeature(plateSession(), { parameter: "boreMm" })).toBeUndefined();
  });

  it("scopes the search by feature kind", () => {
    const session = plateSession();
    expect(findEditableFeature(session, { kinds: ["sketch"] })?.featureId).toBe("F-sketch");
    expect(findEditableFeature(session, { featureId: "F-sketch" })?.tool).toBe("onshape_sketch_rectangle");
  });
});

describe("geometry id invalidation", () => {
  it("returns cached ids only while the rebuild counter still matches", () => {
    let session = plateSession();
    session = cacheSessionGeometry(session, {
      featureId: "F-extrude",
      selection: "edges:corners",
      ids: ["JHD", "JHE", "JHF", "JHG"],
    });
    expect(readSessionGeometry(session, "F-extrude", "edges:corners")).toHaveLength(4);

    // Editing the extrude regenerates the Part Studio: those edge ids may now
    // address different geometry, so they must not be handed back.
    session = updateSessionFeatureParameters(session, "F-extrude", { depthMm: 8 });
    expect(readSessionGeometry(session, "F-extrude", "edges:corners")).toBeUndefined();
    expect(session.geometry).toEqual([]);
  });

  it("invalidates on a new feature, on delete, and on an outside microversion change", () => {
    let session = cacheSessionGeometry(plateSession(), { featureId: "F-extrude", selection: "bodies", ids: ["JBD"] });
    const beforeRebuild = session.rebuild ?? 0;

    const afterAdd = recordSessionFeature(session, {
      featureId: "F-fillet",
      kind: "modify",
      tool: "onshape_fillet",
      name: "Corner fillets",
      at: "2026-08-24T12:00:03.000Z",
    });
    expect(afterAdd.rebuild).toBe(beforeRebuild + 1);
    expect(readSessionGeometry(afterAdd, "F-extrude", "bodies")).toBeUndefined();

    const afterDelete = forgetSessionFeature(session, "F-extrude");
    expect(afterDelete.rebuild).toBe(beforeRebuild + 1);
    expect(afterDelete.features?.map((feature) => feature.featureId)).toEqual(["F-sketch"]);
    expect(afterDelete.lastSketchFeatureId).toBe("F-sketch");

    session = { ...session, microversionId: "mv-1" };
    const unchanged = reconcileSessionMicroversion(session, "mv-1");
    expect(unchanged.changed).toBe(false);
    expect(readSessionGeometry(unchanged.session, "F-extrude", "bodies")).toEqual(["JBD"]);

    const moved = reconcileSessionMicroversion(session, "mv-2");
    expect(moved.changed).toBe(true);
    expect(moved.session.microversionId).toBe("mv-2");
    expect(readSessionGeometry(moved.session, "F-extrude", "bodies")).toBeUndefined();

    expect(invalidateSessionGeometry(session).geometry).toEqual([]);
  });

  it("keeps one cache entry per feature+selection pair", () => {
    let session = plateSession();
    session = cacheSessionGeometry(session, { featureId: "F-extrude", selection: "edges:all", ids: ["A"] });
    session = cacheSessionGeometry(session, { featureId: "F-extrude", selection: "edges:corners", ids: ["B"] });
    session = cacheSessionGeometry(session, { featureId: "F-extrude", selection: "edges:all", ids: ["C"] });
    expect(session.geometry).toHaveLength(2);
    expect(readSessionGeometry(session, "F-extrude", "edges:all")).toEqual(["C"]);
  });
});

describe("persistence across a process restart", () => {
  let home: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "vantage-cad-state-"));
    env = { VANTAGE_CAD_HOME: home } as NodeJS.ProcessEnv;
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("resumes the bound document, features, parameters, and cached ids from disk", async () => {
    const budget = createCallBudget();
    const attributed = budget.attribute(async () => ({ status: 200, ok: true }) as Response, "session");
    await attributed("/documents");

    let session = cacheSessionGeometry(plateSession(), {
      featureId: "F-extrude",
      selection: "edges:corners",
      ids: ["JHD", "JHE"],
    });
    session = noteSessionCalls(session, budget.summary());
    await saveClaudeCadSession(session, env);

    // Simulated restart: nothing in memory, everything read back from the file.
    const resumed = await loadClaudeCadSession(env);
    const summary = summarizeClaudeCadSession(resumed);
    expect(summary.bound).toBe(true);
    expect(summary.documentId).toBe("doc-1");
    expect(summary.featureCount).toBe(2);
    expect(summary.url).toBe(PLATE.url);
    expect(resumed.features?.find((f) => f.featureId === "F-extrude")?.parameters).toEqual({ depthMm: 6 });
    expect(readSessionGeometry(resumed, "F-extrude", "edges:corners")).toEqual(["JHD", "JHE"]);
    expect(resumed.calls?.session).toBe(1);
    expect(resumed.calls?.annualCapCalls).toBe(0);
    expect(resumed.updatedAt).toBeTruthy();

    // And the resumed state supports the in-place edit without rebuilding.
    const edited = updateSessionFeatureParameters(resumed, "F-extrude", { depthMm: 8 });
    await saveClaudeCadSession(edited, env);
    const reloaded = await loadClaudeCadSession(env);
    expect(reloaded.features?.find((f) => f.featureId === "F-extrude")?.parameters).toEqual({ depthMm: 8 });
    expect(readSessionGeometry(reloaded, "F-extrude", "edges:corners")).toBeUndefined();
  });

  it("returns an empty session rather than throwing when nothing is stored", async () => {
    expect(await loadClaudeCadSession(env)).toEqual({});
    expect(summarizeClaudeCadSession(await loadClaudeCadSession(env)).bound).toBe(false);
  });
});
