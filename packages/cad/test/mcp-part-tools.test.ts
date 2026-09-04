/**
 * The MCP part pipeline: local check -> preview -> push ONE feature -> verify.
 *
 * These tests assert the two things the pipeline exists for. First, the ORDER is
 * enforced rather than suggested: a push that skipped the preview or the local
 * check spends nothing and says why. Second, the CALL COUNT is real — the whole
 * worked example is driven through a scripted Onshape and every request is
 * counted, so "an 80x60x6 plate costs 7 calls" is a measurement in this file and
 * not a claim in a document.
 *
 * The Onshape ids below are 24-hex tokens because that is what Onshape issues and
 * what `customFeatureNamespace` / `parseOnshapeDocumentUrl` validate; a short
 * fake id would pass the test while failing against the real API.
 */

import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import {
  CAD_PART_TOOL_CATALOG,
  cadPartToolListEntries,
  cadPartToolSpec,
  CAD_TOOL_CATALOG,
} from "../src/cad-tool-catalog";
import { callCadPartTool, cadMcpToolList, isCadPartTool, resetCadPartPipeline, type CadPartRuntime } from "../src/mcp-stdio";
import type { CallBudget } from "../src/call-budget";
import type { ClaudeCadSession } from "../src/claude-session";
import {
  OnshapeAuthUnavailableError,
  OnshapeSessionExpiredError,
  type ResolveOnshapeAuthOptions,
} from "../src/onshape-session";

const DOC = "1a2b3c4d5e6f708192a3b4c5";
const WS = "2b3c4d5e6f708192a3b4c5d6";
const PART_STUDIO = "3c4d5e6f708192a3b4c5d6e7";
const FEATURE_STUDIO = "4d5e6f708192a3b4c5d6e7f8";
const MICROVERSION = "5e6f708192a3b4c5d6e7f809";
const FEATURE_ID = "FhoLPlAtE0001";
const PART_STUDIO_URL = `https://cad.onshape.com/documents/${DOC}/w/${WS}/e/${PART_STUDIO}`;

/** A 1x1 PNG, so the shaded-view path writes real bytes rather than a placeholder. */
const TINY_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

type Call = { method: string; path: string; body: unknown };

function makeOnshape() {
  const calls: Call[] = [];
  const handler = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const method = String(init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? (JSON.parse(init.body) as unknown) : null;
    calls.push({ method, path, body });
    const json = (value: unknown, status = 200) =>
      new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });

    if (path === "/users/current") return json({ id: "u-1", name: "Test Student" });
    if (path === `/documents/d/${DOC}/w/${WS}/elements`) {
      return json([
        { id: PART_STUDIO, name: "Part Studio 1", elementType: "PARTSTUDIO" },
        { id: FEATURE_STUDIO, name: "Vantage", elementType: "FEATURESTUDIO" },
      ]);
    }
    if (path === `/featurestudios/d/${DOC}/w/${WS}/e/${FEATURE_STUDIO}`) {
      return json({ microversionId: MICROVERSION });
    }
    if (path.endsWith("/features") && method === "GET") return json({ features: [] });
    if (path.endsWith("/features") && method === "POST") {
      return json({ feature: { message: { featureId: FEATURE_ID } } });
    }
    if (path.includes("/features/featureid/")) return json({ feature: { message: { featureId: FEATURE_ID } } });
    if (path.endsWith("/featurescript")) {
      // Six strings, in the order boundingBoxScript returns them.
      return json({ result: ["-40", "-30", "0", "40", "30", "6"] });
    }
    if (path.includes("/shadedviews")) return json({ images: [TINY_PNG] });
    return json({ message: `unrouted ${method} ${path}` }, 404);
  };
  return { calls, handler };
}

function makeRuntime(overrides: Partial<CadPartRuntime> = {}) {
  const onshape = makeOnshape();
  let session: ClaudeCadSession = {};
  const resolveAuth = async (options: ResolveOnshapeAuthOptions) => {
    const budget = options.budget as CallBudget;
    return {
      authPath: "session" as const,
      countsAgainstAnnualCap: false,
      baseUrl: "https://cad.onshape.com",
      http: budget.attribute(onshape.handler, "session"),
      label: "Onshape browser session (test)",
      budget,
    };
  };
  const runtime: CadPartRuntime = {
    resolveAuth,
    loadSession: async () => session,
    saveSession: async (next) => {
      session = next;
    },
    // These tests cover the FeatureScript pipeline itself, which ships disabled because a
    // generated custom feature is not human-editable. Opt in so the pipeline is still tested.
    env: {
      VANTAGE_CAD_HOME: join(tmpdir(), "vantage-cad-test-home"),
      VANTAGE_CAD_ALLOW_FEATURESCRIPT: "1",
    },
    ...overrides,
  };
  return { runtime, onshape, session: () => session };
}

/** 80 x 60 x 6 plate, four M3 clearance holes 10 mm in from each corner. */
function plateBrief() {
  return {
    name: "Corner plate",
    base: { kind: "plate", widthMm: 80, depthMm: 60, thicknessMm: 6 },
    holes: [
      {
        id: "m3Corner",
        thread: "M3",
        holeType: "clearance",
        pattern: { kind: "corners", insetXMm: 10, insetYMm: 10 },
      },
    ],
  };
}

beforeEach(() => {
  resetCadPartPipeline();
});

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

describe("tool surface", () => {
  it("advertises the pipeline alongside the per-operation tools, with no name collisions", () => {
    const listed = cadMcpToolList().map((tool) => tool.name);
    expect(new Set(listed).size).toBe(listed.length);
    for (const tool of CAD_PART_TOOL_CATALOG) expect(listed).toContain(tool.name);
    for (const tool of CAD_TOOL_CATALOG) expect(listed).toContain(tool.name);
  });

  it("keeps the pipeline out of CAD_TOOL_CATALOG, which feeds the hosted agent's allowlist", () => {
    const legacy = new Set(CAD_TOOL_CATALOG.map((tool) => tool.name));
    for (const tool of CAD_PART_TOOL_CATALOG) expect(legacy.has(tool.name)).toBe(false);
  });

  it("gives every tool an object schema whose required fields it actually declares", () => {
    for (const tool of CAD_PART_TOOL_CATALOG) {
      const schema = tool.inputSchema as {
        type: string;
        additionalProperties?: boolean;
        properties: Record<string, unknown>;
        required?: string[];
      };
      expect(schema.type, tool.name).toBe("object");
      expect(schema.additionalProperties, tool.name).toBe(false);
      for (const name of schema.required ?? []) {
        expect(Object.keys(schema.properties), `${tool.name}.${name}`).toContain(name);
      }
    }
  });

  it("states the Onshape call cost in every description, because that is what decides the next call", () => {
    for (const entry of cadPartToolListEntries()) {
      expect(entry.description, entry.name).toMatch(/Onshape calls?: \d/);
      expect(entry.description.length, entry.name).toBeGreaterThan(120);
    }
  });

  it("declares the canonical order: nothing spends a call before the free local checks", () => {
    expect(cadPartToolSpec("cad_part_check")?.onshapeCalls).toEqual({ min: 0, max: 0 });
    expect(cadPartToolSpec("cad_part_preview")?.onshapeCalls).toEqual({ min: 0, max: 0 });
    expect(cadPartToolSpec("cad_part_push")?.needs).toEqual(["auth", "binding", "check", "preview"]);
    // Editing an existing feature is the cheap path and never costs more than
    // one call; a no-op edit costs none.
    expect(cadPartToolSpec("cad_part_edit")?.onshapeCalls).toEqual({ min: 0, max: 1 });
    expect(cadPartToolSpec("cad_part_edit")?.onshapeCalls.max).toBeLessThan(
      cadPartToolSpec("cad_part_push")!.onshapeCalls.min,
    );
    expect(isCadPartTool("cad_part_push")).toBe(true);
    expect(isCadPartTool("onshape_extrude")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Asking instead of guessing
// ---------------------------------------------------------------------------

describe("needs clarification", () => {
  it("will not pick a printer or a material", async () => {
    const { runtime, onshape } = makeRuntime();
    const result = (await callCadPartTool("cad_part_check", { part: plateBrief() }, runtime)) as {
      status: string;
      missing: Array<{ field: string; options?: string[] }>;
    };
    expect(result.status).toBe("needs_clarification");
    expect(result.missing.map((item) => item.field)).toEqual(["printerId", "materialId"]);
    expect(result.missing[0]!.options!.join(" ")).toContain("bambu-x1c");
    expect(result.missing[1]!.options!.join(" ")).toContain("pla");
    expect(onshape.calls).toHaveLength(0);
  });

  it("asks which kind of M3 hole, and shows what each one measures", async () => {
    const { runtime } = makeRuntime();
    const part = plateBrief();
    delete (part.holes[0] as Record<string, unknown>).holeType;
    const result = (await callCadPartTool(
      "cad_part_check",
      { part, printerId: "bambu-x1c", materialId: "pla" },
      runtime,
    )) as { status: string; missing: Array<{ field: string; options?: string[]; question: string }> };

    expect(result.status).toBe("needs_clarification");
    const question = result.missing.find((item) => item.field === "holes[0].holeType");
    expect(question).toBeDefined();
    const options = question!.options!.join(" | ");
    // The three real diameters for the same M3.
    expect(options).toContain("3.4");
    expect(options).toContain("2.5");
    expect(options).toContain("4");
    expect(options).toContain("M3x5.7");
  });

  it("applies the ISO 273 normal fit but says that it did", async () => {
    const { runtime } = makeRuntime();
    const result = (await callCadPartTool(
      "cad_part_check",
      { part: plateBrief(), printerId: "bambu-x1c", materialId: "pla" },
      runtime,
    )) as { status: string; defaultsApplied: Array<{ field: string; value: string; source: string }> };

    expect(result.status).toBe("ok");
    const applied = result.defaultsApplied.find((item) => item.field === "holes[0].fit");
    expect(applied?.value).toBe("normal");
    expect(applied?.source).toContain("ISO 273");
    expect(applied?.source).toContain("3.4");
  });

  it("refuses an unknown printer id instead of falling back to a default machine", async () => {
    const { runtime } = makeRuntime();
    const result = (await callCadPartTool(
      "cad_part_check",
      { part: plateBrief(), printerId: "ender-3", materialId: "pla" },
      runtime,
    )) as { status: string; missing: Array<{ field: string; options?: string[] }> };
    expect(result.status).toBe("needs_clarification");
    expect(result.missing[0]!.field).toBe("printerId");
    expect(result.missing[0]!.options!.join(" ")).toContain("snapmaker-u1");
  });

  it("asks for the Part Studio tab link rather than spending a call to find the workspace", async () => {
    const { runtime, onshape } = makeRuntime();
    const result = (await callCadPartTool(
      "cad_open_document",
      { url: `https://cad.onshape.com/documents/${DOC}` },
      runtime,
    )) as { status: string; missing: Array<{ field: string }> };
    expect(result.status).toBe("needs_clarification");
    expect(result.missing[0]!.field).toBe("workspaceId");
    expect(onshape.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// The local check is the part that carries the printer knowledge
// ---------------------------------------------------------------------------

describe("local check", () => {
  it("models the M3 clearance hole at 3.62 mm on an X1C in PLA", async () => {
    const { runtime, onshape } = makeRuntime();
    const result = (await callCadPartTool(
      "cad_part_check",
      { part: plateBrief(), printerId: "bambu-x1c", materialId: "pla" },
      runtime,
    )) as {
      status: string;
      checkToken: string;
      dfm: { status: string; modelledDimensions: Array<{ path: string; nominalMm: number; modelMm: number }> };
      compensatedPart: { holes: Array<{ diameterMm: number }> };
      onshapeCallsMade: number;
    };

    expect(result.status).toBe("ok");
    expect(result.onshapeCallsMade).toBe(0);
    expect(onshape.calls).toHaveLength(0);
    expect(result.checkToken).toMatch(/^check_[0-9a-f]{16}$/);
    const dimension = result.dfm.modelledDimensions[0]!;
    expect(dimension.path).toBe("holes.0.diameterMm");
    expect(dimension.nominalMm).toBe(3.4);
    expect(dimension.modelMm).toBe(3.62);
    // The compensated part is what gets built, so the 3.62 has to be in it.
    expect(result.compensatedPart.holes[0]!.diameterMm).toBe(3.62);
  });

  it("carries the compensated diameter into the generated feature's parameters", async () => {
    const { runtime } = makeRuntime();
    const checked = (await callCadPartTool(
      "cad_part_check",
      { part: plateBrief(), printerId: "bambu-x1c", materialId: "pla" },
      runtime,
    )) as { checkToken: string };
    const preview = (await callCadPartTool("cad_part_preview", { checkToken: checked.checkToken }, runtime)) as {
      status: string;
      checked: boolean;
      parameters: Array<{ parameterId: string; value: number; expression: string }>;
      geometry: { holes: unknown[]; sizeMm: { xMm: number; yMm: number; zMm: number } };
      onshapeCallsMade: number;
    };

    expect(preview.status).toBe("ok");
    expect(preview.checked).toBe(true);
    expect(preview.onshapeCallsMade).toBe(0);
    expect(preview.geometry.sizeMm).toEqual({ xMm: 80, yMm: 60, zMm: 6 });
    expect(preview.geometry.holes).toHaveLength(4);
    const diameter = preview.parameters.find((parameter) => parameter.parameterId === "m3CornerDiameter");
    expect(diameter?.value).toBe(3.62);
    expect(diameter?.expression).toBe("3.62 mm");
  });
});

// ---------------------------------------------------------------------------
// Order enforcement
// ---------------------------------------------------------------------------

describe("out-of-order calls are refused before anything is spent", () => {
  it("rejects a push with no preview", async () => {
    const { runtime, onshape } = makeRuntime();
    const result = (await callCadPartTool("cad_part_push", {}, runtime)) as {
      status: string;
      missing: string;
      fix: string;
      canonicalFlow: string[];
    };
    expect(result.status).toBe("out_of_order");
    expect(result.missing).toBe("preview");
    expect(result.fix).toContain("cad_part_preview");
    expect(result.canonicalFlow).toContain("cad_part_check");
    expect(onshape.calls).toHaveLength(0);
  });

  it("rejects a previewToken it never issued", async () => {
    const { runtime, onshape } = makeRuntime();
    const result = (await callCadPartTool("cad_part_push", { previewToken: "preview_deadbeefdeadbeef" }, runtime)) as {
      status: string;
      missing: string;
    };
    expect(result.status).toBe("out_of_order");
    expect(result.missing).toBe("preview");
    expect(onshape.calls).toHaveLength(0);
  });

  it("rejects a preview that never went through the local check", async () => {
    const { runtime, onshape } = makeRuntime();
    await callCadPartTool("cad_open_document", { url: PART_STUDIO_URL }, runtime);
    const preview = (await callCadPartTool("cad_part_preview", { part: plateBrief() }, runtime)) as {
      previewToken: string;
      checked: boolean;
      warning: string;
    };
    expect(preview.checked).toBe(false);
    expect(preview.warning).toContain("refuses an unchecked preview");

    const before = onshape.calls.length;
    const push = (await callCadPartTool("cad_part_push", { previewToken: preview.previewToken }, runtime)) as {
      status: string;
      missing: string;
    };
    expect(push.status).toBe("out_of_order");
    expect(push.missing).toBe("check");
    expect(onshape.calls.length).toBe(before);
  });

  it("rejects a push into nothing when no Part Studio is bound", async () => {
    const { runtime, onshape } = makeRuntime();
    const checked = (await callCadPartTool(
      "cad_part_check",
      { part: plateBrief(), printerId: "bambu-x1c", materialId: "pla" },
      runtime,
    )) as { checkToken: string };
    const preview = (await callCadPartTool("cad_part_preview", { checkToken: checked.checkToken }, runtime)) as {
      previewToken: string;
    };
    const push = (await callCadPartTool("cad_part_push", { previewToken: preview.previewToken }, runtime)) as {
      status: string;
      missing: string;
    };
    expect(push.status).toBe("out_of_order");
    expect(push.missing).toBe("binding");
    expect(onshape.calls).toHaveLength(0);
  });

  it("blocks a part that failed a local rule until every failing rule is named", async () => {
    const { runtime, onshape } = makeRuntime();
    await callCadPartTool("cad_open_document", { url: PART_STUDIO_URL }, runtime);
    const before = onshape.calls.length;

    // 400 x 400 mm does not fit a 256 x 256 mm X1C bed at any rotation.
    const oversized = {
      name: "Oversized plate",
      base: { kind: "plate", widthMm: 400, depthMm: 400, thicknessMm: 6 },
    };
    const checked = (await callCadPartTool(
      "cad_part_check",
      { part: oversized, printerId: "bambu-x1c", materialId: "pla" },
      runtime,
    )) as { checkToken: string; dfm: { status: string } };
    expect(checked.dfm.status).toBe("fail");

    const preview = (await callCadPartTool("cad_part_preview", { checkToken: checked.checkToken }, runtime)) as {
      previewToken: string;
    };
    const blocked = (await callCadPartTool("cad_part_push", { previewToken: preview.previewToken }, runtime)) as {
      status: string;
      reason: string;
      failing: Array<{ check: string }>;
    };
    expect(blocked.status).toBe("blocked");
    expect(blocked.reason).toBe("dfm_fail");
    expect(blocked.failing.map((finding) => finding.check)).toContain("bed-fit");
    expect(onshape.calls.length).toBe(before);

    // Acknowledging the wrong rule is still a refusal.
    const halfAcknowledged = (await callCadPartTool(
      "cad_part_push",
      { previewToken: preview.previewToken, acknowledgeDfmFail: true, acknowledgedChecks: ["min-wall"] },
      runtime,
    )) as { status: string };
    expect(halfAcknowledged.status).toBe("blocked");
    expect(onshape.calls.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The worked example, measured
// ---------------------------------------------------------------------------

describe("the worked example", () => {
  it("builds and verifies an 80x60x6 M3 plate in 7 Onshape calls, all session calls", async () => {
    const viewDir = await mkdtemp(join(tmpdir(), "vantage-cad-view-"));
    const { runtime, onshape, session } = makeRuntime({ viewDir });

    // 1. Prove the credential works (1 call).
    const auth = (await callCadPartTool("cad_auth_status", { verify: true }, runtime)) as {
      status: string;
      authPath: string;
      countsAgainstAnnualCap: boolean;
      verified: boolean;
      callBudget: { callsThisTool: number; chargedToAnnualCapThisTool: number };
    };
    expect(auth.status).toBe("ok");
    expect(auth.authPath).toBe("session");
    expect(auth.countsAgainstAnnualCap).toBe(false);
    expect(auth.verified).toBe(true);
    expect(auth.callBudget.callsThisTool).toBe(1);

    // 2. Bind the Part Studio (1 call: the element list).
    const opened = (await callCadPartTool("cad_open_document", { url: PART_STUDIO_URL }, runtime)) as {
      status: string;
      featureStudio: { elementId: string } | null;
      callBudget: { callsThisTool: number };
    };
    expect(opened.status).toBe("ok");
    expect(opened.featureStudio?.elementId).toBe(FEATURE_STUDIO);
    expect(opened.callBudget.callsThisTool).toBe(1);

    // 3. See what is already there (1 call).
    const contents = (await callCadPartTool("cad_part_studio_contents", {}, runtime)) as {
      status: string;
      features: unknown[];
      callBudget: { callsThisTool: number };
    };
    expect(contents.status).toBe("ok");
    expect(contents.features).toHaveLength(0);
    expect(contents.callBudget.callsThisTool).toBe(1);

    // 4 + 5. Local check and preview (0 calls).
    const checked = (await callCadPartTool(
      "cad_part_check",
      { part: plateBrief(), printerId: "bambu-x1c", materialId: "pla" },
      runtime,
    )) as { status: string; checkToken: string; dfm: { status: string } };
    expect(checked.status).toBe("ok");
    expect(checked.dfm.status).not.toBe("fail");

    const preview = (await callCadPartTool("cad_part_preview", { checkToken: checked.checkToken }, runtime)) as {
      previewToken: string;
      callPlan: { total: number };
      callPlanNote: string;
      parameters: Array<{ parameterId: string }>;
    };
    // Six editable dimensions: the plate's three, plus the hole diameter and its
    // two corner insets. docs/CLAUDE_CODE_CAD.md quotes this number.
    expect(preview.parameters.map((parameter) => parameter.parameterId).sort()).toEqual([
      "baseDepth",
      "baseThickness",
      "baseWidth",
      "m3CornerDiameter",
      "m3CornerInsetX",
      "m3CornerInsetY",
    ]);

    // 6. One feature (2 calls: write the Feature Studio, insert the feature).
    const push = (await callCadPartTool("cad_part_push", { previewToken: preview.previewToken }, runtime)) as {
      status: string;
      featureId: string;
      holesBuilt: number;
      microversionSource: string;
      onshapeCallsMade: number;
      callBudget: { chargedToAnnualCapThisTool: number };
    };
    expect(push.status).toBe("ok");
    expect(push.featureId).toBe(FEATURE_ID);
    expect(push.holesBuilt).toBe(4);
    expect(push.microversionSource).toBe("write-response");
    expect(push.onshapeCallsMade).toBe(2);
    expect(push.callBudget.chargedToAnnualCapThisTool).toBe(0);

    // 7. One verification pull (2 calls).
    const verified = (await callCadPartTool("cad_part_verify", {}, runtime)) as {
      status: string;
      boundingBoxMm: { sizeMm: { xMm: number; yMm: number; zMm: number } };
      matchesPrediction: boolean;
      isoView: { available: boolean; path: string; bytes: number };
      onshapeCallsMade: number;
    };
    expect(verified.status).toBe("ok");
    expect(verified.boundingBoxMm.sizeMm).toEqual({ xMm: 80, yMm: 60, zMm: 6 });
    expect(verified.matchesPrediction).toBe(true);
    expect(verified.onshapeCallsMade).toBe(2);
    expect(verified.isoView.available).toBe(true);
    expect((await readFile(verified.isoView.path)).length).toBe(verified.isoView.bytes);

    // The measurement. Four holes, corner geometry and all.
    expect(onshape.calls).toHaveLength(7);
    expect(onshape.calls.filter((call) => call.method === "POST")).toHaveLength(3);
    expect(session().calls?.session).toBe(7);
    expect(session().calls?.annualCapCalls).toBe(0);

    // The preview publishes 5 for push+verify and 4 were spent: estimateOnshapeCalls
    // always budgets a separate microversion read, and this push did not need one
    // because Onshape's write response carried it. The plan is an upper bound and
    // the preview result says so.
    expect(preview.callPlan.total).toBe(5);
    expect(preview.callPlanNote).toContain("upper bound");
    expect(push.onshapeCallsMade + verified.onshapeCallsMade).toBe(4);
  });

  it("does not grow with the hole count — 24 holes cost the same 2 push calls", async () => {
    const { runtime, onshape } = makeRuntime();
    await callCadPartTool("cad_open_document", { url: PART_STUDIO_URL }, runtime);
    const before = onshape.calls.length;

    const checked = (await callCadPartTool(
      "cad_part_check",
      {
        part: {
          name: "Hole grid plate",
          base: { kind: "plate", widthMm: 200, depthMm: 120, thicknessMm: 6 },
          holes: [
            {
              id: "m3Grid",
              thread: "M3",
              holeType: "clearance",
              pattern: { kind: "grid", countX: 8, countY: 3, pitchXMm: 20, pitchYMm: 20 },
            },
          ],
        },
        printerId: "bambu-x1c",
        materialId: "pla",
      },
      runtime,
    )) as { checkToken: string };
    const preview = (await callCadPartTool("cad_part_preview", { checkToken: checked.checkToken }, runtime)) as {
      previewToken: string;
      geometry: { holes: unknown[] };
    };
    expect(preview.geometry.holes).toHaveLength(24);

    const push = (await callCadPartTool("cad_part_push", { previewToken: preview.previewToken }, runtime)) as {
      status: string;
      onshapeCallsMade: number;
    };
    expect(push.status).toBe("ok");
    expect(push.onshapeCallsMade).toBe(2);
    expect(onshape.calls.length - before).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Editing is what makes iteration cheap
// ---------------------------------------------------------------------------

async function buildPlate(runtime: CadPartRuntime) {
  await callCadPartTool("cad_open_document", { url: PART_STUDIO_URL }, runtime);
  const checked = (await callCadPartTool(
    "cad_part_check",
    { part: plateBrief(), printerId: "bambu-x1c", materialId: "pla" },
    runtime,
  )) as { checkToken: string };
  const preview = (await callCadPartTool("cad_part_preview", { checkToken: checked.checkToken }, runtime)) as {
    previewToken: string;
  };
  return (await callCadPartTool("cad_part_push", { previewToken: preview.previewToken }, runtime)) as {
    status: string;
    featureId: string;
  };
}

describe("FeatureScript is off by default because it is not human-editable", () => {
  /** Same harness, minus the opt-in — i.e. what a real install does. */
  function defaultRuntime() {
    const { runtime, onshape } = makeRuntime();
    return {
      onshape,
      runtime: {
        ...runtime,
        env: { VANTAGE_CAD_HOME: join(tmpdir(), "vantage-cad-test-home") },
      } satisfies CadPartRuntime,
    };
  }

  it("refuses cad_part_push and spends no Onshape calls doing it", async () => {
    const { runtime, onshape } = defaultRuntime();
    await callCadPartTool("cad_open_document", { url: PART_STUDIO_URL }, runtime);
    const checked = (await callCadPartTool(
      "cad_part_check",
      { part: plateBrief(), printerId: "bambu-x1c", materialId: "pla" },
      runtime,
    )) as { checkToken: string };
    const preview = (await callCadPartTool("cad_part_preview", { checkToken: checked.checkToken }, runtime)) as {
      previewToken: string;
      nextStep: string;
    };
    const before = onshape.calls.length;

    const push = (await callCadPartTool("cad_part_push", { previewToken: preview.previewToken }, runtime)) as {
      status: string;
      reason: string;
      fix: string;
      why: string;
      onshapeCallsMade: number;
    };

    expect(push.status).toBe("blocked");
    expect(push.reason).toBe("featurescript_disabled");
    expect(push.onshapeCallsMade).toBe(0);
    expect(onshape.calls.length).toBe(before);
    // The refusal has to name the way forward, not just say no.
    expect(push.fix).toMatch(/onshape_extrude/);
    expect(push.fix).toMatch(/onshape_revolve/);
    expect(push.fix).toMatch(/onshape_variable_set/);
    expect(push.why).toMatch(/VANTAGE_CAD_ALLOW_FEATURESCRIPT/);
    // Preview must not send the agent to a tool that is going to refuse it.
    expect(preview.nextStep).toMatch(/disabled/i);
  });

  it("still lets the local DFM check run, since that costs nothing and is useful", async () => {
    const { runtime, onshape } = defaultRuntime();
    await callCadPartTool("cad_open_document", { url: PART_STUDIO_URL }, runtime);
    const before = onshape.calls.length;
    const checked = (await callCadPartTool(
      "cad_part_check",
      { part: plateBrief(), printerId: "bambu-x1c", materialId: "pla" },
      runtime,
    )) as { status: string; checkToken: string };
    expect(checked.status).toBe("ok");
    expect(checked.checkToken).toBeTruthy();
    expect(onshape.calls.length).toBe(before);
  });

  it("builds the part when a deployment explicitly opts in", async () => {
    const { runtime } = makeRuntime();
    const push = await buildPlate(runtime);
    expect(push.status).toBe("ok");
    expect(push.featureId).toBeTruthy();
  });
});

describe("cad_part_edit", () => {
  it("makes the plate 8 mm instead of 6 in ONE call, with no rebuild", async () => {
    const { runtime, onshape, session } = makeRuntime();
    const push = await buildPlate(runtime);
    expect(push.status).toBe("ok");
    const before = onshape.calls.length;

    const edited = (await callCadPartTool(
      "cad_part_edit",
      { edits: [{ parameterId: "baseThickness", value: 8 }] },
      runtime,
    )) as {
      status: string;
      featureId: string;
      regenerated: boolean;
      featureStudioWrites: number;
      featuresInserted: number;
      onshapeCallsMade: number;
      changed: Array<{ parameterId: string; value: number; expression: string }>;
    };

    expect(edited.status).toBe("ok");
    expect(edited.onshapeCallsMade).toBe(1);
    expect(edited.regenerated).toBe(false);
    expect(edited.featureStudioWrites).toBe(0);
    expect(edited.featuresInserted).toBe(0);
    expect(edited.changed).toEqual([{ parameterId: "baseThickness", value: 8, expression: "8 mm" }]);

    // The one call updated the EXISTING feature by id. No Feature Studio was
    // rewritten and no second feature was inserted.
    const spent = onshape.calls.slice(before);
    expect(spent).toHaveLength(1);
    expect(spent[0]!.method).toBe("POST");
    expect(spent[0]!.path).toBe(`/partstudios/d/${DOC}/w/${WS}/e/${PART_STUDIO}/features/featureid/${FEATURE_ID}`);
    expect(spent.some((call) => call.path.includes("/featurestudios/"))).toBe(false);

    // The body updates the same feature id, not a new one.
    const body = spent[0]!.body as { feature: { featureId: string; parameters: Array<{ parameterId: string }> } };
    expect(body.feature.featureId).toBe(FEATURE_ID);
    expect(body.feature.parameters.length).toBeGreaterThan(3);

    // The session remembers the new value, so a later process starts from 8 mm.
    const stored = session().features?.[0]?.parameters ?? {};
    expect(stored.baseThickness).toBe(8);
  });

  it("spends nothing when the parameter already holds the requested value", async () => {
    const { runtime, onshape } = makeRuntime();
    await buildPlate(runtime);
    const before = onshape.calls.length;

    // The plate was pushed at 6 mm. Re-asserting 6 mm would otherwise write an
    // identical parameter for a full Onshape call.
    const noop = (await callCadPartTool(
      "cad_part_edit",
      { edits: [{ parameterId: "baseThickness", value: 6 }] },
      runtime,
    )) as {
      status: string;
      onshapeCallsMade: number;
      alreadyCorrect: Array<{ parameterId: string; value: number }>;
    };
    expect(noop.status).toBe("no_change");
    expect(noop.onshapeCallsMade).toBe(0);
    expect(noop.alreadyCorrect).toEqual([{ parameterId: "baseThickness", value: 6, expression: "6 mm" }]);
    expect(onshape.calls.length).toBe(before);

    // A real change still costs exactly one, and a mixed edit reports the half
    // that moved nothing rather than silently counting it as changed.
    const mixed = (await callCadPartTool(
      "cad_part_edit",
      {
        edits: [
          { parameterId: "baseThickness", value: 8 },
          { parameterId: "baseWidth", value: 80 },
        ],
      },
      runtime,
    )) as {
      status: string;
      onshapeCallsMade: number;
      changed: Array<{ parameterId: string }>;
      alreadyCorrect: Array<{ parameterId: string; value: number; expression: string }>;
    };
    expect(mixed.status).toBe("ok");
    expect(mixed.onshapeCallsMade).toBe(1);
    expect(mixed.changed.map((entry) => entry.parameterId)).toEqual(["baseThickness"]);
    // Same shape as the no_change branch reports, so one parser reads either.
    expect(mixed.alreadyCorrect).toEqual([{ parameterId: "baseWidth", value: 80, expression: "80 mm" }]);
    expect(onshape.calls.length - before).toBe(1);
  });

  it("reports a structural change as rebuild-required instead of spending a call on it", async () => {
    const { runtime, onshape } = makeRuntime();
    await buildPlate(runtime);
    const before = onshape.calls.length;

    const result = (await callCadPartTool(
      "cad_part_edit",
      { edits: [{ parameterId: "aParameterThatDoesNotExist", value: 3 }] },
      runtime,
    )) as { status: string; reason: string; editableParameters: Array<{ parameterId: string }> };

    expect(result.status).toBe("rebuild_required");
    expect(result.reason).toContain("not a parameter of this feature");
    expect(result.editableParameters.map((parameter) => parameter.parameterId)).toContain("baseThickness");
    expect(onshape.calls.length).toBe(before);
  });

  it("refuses a value outside the parameter's own bounds", async () => {
    const { runtime, onshape } = makeRuntime();
    await buildPlate(runtime);
    const before = onshape.calls.length;

    const result = (await callCadPartTool(
      "cad_part_edit",
      { edits: [{ parameterId: "baseThickness", value: -4 }] },
      runtime,
    )) as { status: string; reason: string };
    expect(result.status).toBe("rebuild_required");
    expect(result.reason).toContain("outside that range");
    expect(onshape.calls.length).toBe(before);
  });

  it("re-runs the local check before spending the call, and blocks an edit that now fails", async () => {
    const { runtime, onshape } = makeRuntime();
    await buildPlate(runtime);
    const before = onshape.calls.length;

    // 0.2 mm is below one 0.42 mm bead, so the minimum-wall rule fails.
    const result = (await callCadPartTool(
      "cad_part_edit",
      { edits: [{ parameterId: "baseThickness", value: 0.2 }] },
      runtime,
    )) as { status: string; reason: string; dfm: { status: string; findings: Array<{ check: string }> } };

    expect(result.status).toBe("blocked");
    expect(result.reason).toBe("dfm_fail");
    expect(result.dfm.findings.some((finding) => finding.check === "min-wall")).toBe(true);
    expect(onshape.calls.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// Verification, and not paying twice
// ---------------------------------------------------------------------------

describe("cad_part_verify", () => {
  it("returns the previous readback for free when nothing has changed", async () => {
    const { runtime, onshape } = makeRuntime();
    await buildPlate(runtime);

    const first = (await callCadPartTool("cad_part_verify", { image: "none" }, runtime)) as {
      onshapeCallsMade: number;
    };
    expect(first.onshapeCallsMade).toBe(1);
    const afterFirst = onshape.calls.length;

    const second = (await callCadPartTool("cad_part_verify", { image: "none" }, runtime)) as {
      cached: boolean;
      onshapeCallsMade: number;
      note: string;
    };
    expect(second.cached).toBe(true);
    expect(second.onshapeCallsMade).toBe(0);
    expect(second.note).toContain("instead of paying");
    expect(onshape.calls.length).toBe(afterFirst);
  });

  it("verifies again after an edit, because the part changed", async () => {
    const { runtime, onshape } = makeRuntime();
    await buildPlate(runtime);
    await callCadPartTool("cad_part_verify", { image: "none" }, runtime);
    await callCadPartTool("cad_part_edit", { edits: [{ parameterId: "baseThickness", value: 8 }] }, runtime);
    const before = onshape.calls.length;

    const again = (await callCadPartTool("cad_part_verify", { image: "none" }, runtime)) as {
      cached?: boolean;
      onshapeCallsMade: number;
      driftMm: { zMm: number; worstMm: number };
      matchesPrediction: boolean;
    };
    expect(again.cached).toBeUndefined();
    expect(again.onshapeCallsMade).toBe(1);
    expect(onshape.calls.length - before).toBe(1);
    // The scripted Onshape still reports a 6 mm plate, so the drift against the
    // now-8 mm prediction is reported rather than smoothed over.
    expect(again.driftMm.zMm).toBe(-2);
    expect(again.matchesPrediction).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Not spending calls twice on the same part
// ---------------------------------------------------------------------------

describe("duplicate work", () => {
  it("refuses to push the same part twice and points at the 1-call edit", async () => {
    const { runtime, onshape } = makeRuntime();
    await callCadPartTool("cad_open_document", { url: PART_STUDIO_URL }, runtime);
    const checked = (await callCadPartTool(
      "cad_part_check",
      { part: plateBrief(), printerId: "bambu-x1c", materialId: "pla" },
      runtime,
    )) as { checkToken: string };
    const preview = (await callCadPartTool("cad_part_preview", { checkToken: checked.checkToken }, runtime)) as {
      previewToken: string;
    };
    await callCadPartTool("cad_part_push", { previewToken: preview.previewToken }, runtime);
    const before = onshape.calls.length;

    const again = (await callCadPartTool("cad_part_push", { previewToken: preview.previewToken }, runtime)) as {
      status: string;
      reason: string;
      featureId: string;
      fix: string;
    };
    expect(again.status).toBe("blocked");
    expect(again.reason).toBe("already_built");
    expect(again.featureId).toBe(FEATURE_ID);
    expect(again.fix).toContain("cad_part_edit");
    expect(onshape.calls.length).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// The ledger is visible everywhere
// ---------------------------------------------------------------------------

describe("call budget", () => {
  it("reports the running ledger on every tool result, including the free ones", async () => {
    const { runtime } = makeRuntime();
    const local = (await callCadPartTool(
      "cad_part_check",
      { part: plateBrief(), printerId: "bambu-x1c", materialId: "pla" },
      runtime,
    )) as { callBudget: { callsThisTool: number; headline: string; note: string } };
    expect(local.callBudget.callsThisTool).toBe(0);
    expect(local.callBudget.headline).toContain("0 Onshape calls");
    expect(local.callBudget.note).toContain("onshape-public.github.io/docs/auth/limits");

    await callCadPartTool("cad_open_document", { url: PART_STUDIO_URL }, runtime);
    const contents = (await callCadPartTool("cad_part_studio_contents", {}, runtime)) as {
      callBudget: {
        authPath: string;
        countsAgainstAnnualCap: boolean;
        callsThisTool: number;
        chargedToAnnualCapThisTool: number;
        lifetimeFromThisMachine: { session: number; annualCapCalls: number };
        lifetimeSummary: string;
      };
    };
    expect(contents.callBudget.authPath).toBe("session");
    expect(contents.callBudget.countsAgainstAnnualCap).toBe(false);
    expect(contents.callBudget.callsThisTool).toBe(1);
    expect(contents.callBudget.chargedToAnnualCapThisTool).toBe(0);
    // Two calls so far this session: the element list and the feature list.
    expect(contents.callBudget.lifetimeFromThisMachine.session).toBe(2);
    expect(contents.callBudget.lifetimeFromThisMachine.annualCapCalls).toBe(0);
    expect(contents.callBudget.lifetimeSummary).toContain("Onshape pools the real allowance");
  });

  it("warns on an API-key path, which IS deducted from the annual allowance", async () => {
    const { runtime, onshape } = makeRuntime();
    const keyRuntime: CadPartRuntime = {
      ...runtime,
      resolveAuth: async (options) => {
        const budget = options.budget as CallBudget;
        return {
          authPath: "api-key" as const,
          countsAgainstAnnualCap: true,
          baseUrl: "https://cad.onshape.com",
          http: budget.attribute(onshape.handler, "api-key"),
          label: "Onshape API key (test)",
          warning: "API-key calls are deducted from your Onshape annual allowance.",
          budget,
        };
      },
    };
    const opened = (await callCadPartTool("cad_open_document", { url: PART_STUDIO_URL }, keyRuntime)) as {
      callBudget: { countsAgainstAnnualCap: boolean; chargedToAnnualCapThisTool: number; warnings: string[] };
    };
    expect(opened.callBudget.countsAgainstAnnualCap).toBe(true);
    expect(opened.callBudget.chargedToAnnualCapThisTool).toBe(1);
    expect(opened.callBudget.warnings.join(" ")).toContain("vantage-cad login");
  });
});

// ---------------------------------------------------------------------------
// Not being signed in is a setup state, not a crash
// ---------------------------------------------------------------------------

describe("Onshape not connected", () => {
  /**
   * A runtime whose auth resolution fails the way the real one does. `bound`
   * pre-seeds the binding, because the binding check runs before auth — without
   * it a tool would answer "no Part Studio is bound" and never reach the path
   * under test.
   */
  function unconnected(error: Error, bound = false) {
    const { runtime, onshape } = makeRuntime({
      resolveAuth: async () => {
        throw error;
      },
      ...(bound
        ? { loadSession: async (): Promise<ClaudeCadSession> => ({ documentId: DOC, workspaceId: WS, elementId: PART_STUDIO }) }
        : {}),
    });
    return { runtime, onshape };
  }

  it("answers setup_required with the ledger instead of throwing, and spends nothing", async () => {
    const { runtime, onshape } = unconnected(new OnshapeAuthUnavailableError("Onshape is not connected in this terminal."));

    const opened = (await callCadPartTool("cad_open_document", { url: PART_STUDIO_URL }, runtime)) as {
      tool: string;
      status: string;
      missing: string;
      reason: string;
      fix: string;
      onshapeCallsMade: number;
      callBudget: { headline: string; chargedToAnnualCapThisTool: number; note: string };
    };
    expect(opened.tool).toBe("cad_open_document");
    expect(opened.status).toBe("setup_required");
    expect(opened.missing).toBe("auth");
    expect(opened.reason).toBe("onshape_auth_required");
    expect(opened.fix).toContain("vantage-cad login");
    expect(opened.onshapeCallsMade).toBe(0);
    expect(opened.callBudget.chargedToAnnualCapThisTool).toBe(0);
    // Not the "runs entirely offline" line: this tool is not offline, it simply
    // never got a credential to spend.
    expect(opened.callBudget.headline).toContain("nothing left this machine");
    expect(opened.callBudget.note).toContain("onshape-public.github.io/docs/auth/limits");
    expect(onshape.calls).toHaveLength(0);
  });

  it("says a rejected session is not charged, because Onshape does not count 4xx", async () => {
    const { runtime } = unconnected(new OnshapeSessionExpiredError("stored cookies have lapsed"), true);

    const contents = (await callCadPartTool("cad_part_studio_contents", {}, runtime)) as {
      status: string;
      reason: string;
      error: string;
      callBudget: { headline: string; chargedToAnnualCapThisTool: number };
    };
    expect(contents.status).toBe("setup_required");
    expect(contents.reason).toBe("onshape_session_expired");
    expect(contents.error).toContain("vantage-cad login");
    expect(contents.callBudget.chargedToAnnualCapThisTool).toBe(0);
    expect(contents.callBudget.headline).toContain("4xx response is never counted");
  });

  it("still runs the whole local stage with no Onshape credential at all", async () => {
    const { runtime, onshape } = unconnected(new OnshapeAuthUnavailableError("not connected"), true);

    const checked = (await callCadPartTool(
      "cad_part_check",
      { part: plateBrief(), printerId: "bambu-x1c", materialId: "pla" },
      runtime,
    )) as { status: string; checkToken: string; dfm: { status: string } };
    expect(checked.status).toBe("ok");
    expect(checked.dfm.status).not.toBe("fail");

    const preview = (await callCadPartTool("cad_part_preview", { checkToken: checked.checkToken }, runtime)) as {
      status: string;
      previewToken: string;
    };
    expect(preview.status).toBe("ok");
    expect(preview.previewToken).toBeTruthy();

    // Only the push needed a credential, and it said so rather than crashing.
    const push = (await callCadPartTool("cad_part_push", { previewToken: preview.previewToken }, runtime)) as {
      status: string;
      missing: string;
    };
    expect(push.status).toBe("setup_required");
    expect(push.missing).toBe("auth");
    expect(onshape.calls).toHaveLength(0);
  });
});
