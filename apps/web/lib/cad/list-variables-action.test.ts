import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");

function read(relative: string): string {
  return readFileSync(join(WEB_ROOT, relative), "utf8");
}

/**
 * POST /api/cad action list-onshape-variables is a thin bind + Variables REST
 * GET. This file only reads route source — no live Onshape, no HTTP, no
 * fabricated variable names.
 */
describe("POST /api/cad list-onshape-variables", () => {
  const cad = read("app/api/cad/route.ts");

  it("imports listOnshapeNativeVariables and pickVariableStudioElementId", () => {
    expect(cad).toContain("listOnshapeNativeVariables");
    expect(cad).toContain("pickVariableStudioElementId");
    expect(cad).toMatch(/from "@vantage\/cad"/);
  });

  it("dispatches list-onshape-variables to the Variables REST helpers", () => {
    expect(cad).toContain('if (action === "list-onshape-variables")');
    expect(cad).toContain("const elements = await listOnshapeElements(onshape.http, ref.documentId, ref.workspaceId)");
    expect(cad).toContain("const variableStudioElementId = pickVariableStudioElementId(");
    expect(cad).toContain("const variables = await listOnshapeNativeVariables(onshape.http, target)");
    expect(cad).toContain("variableStudioElementId: variableStudioElementId || null");
  });

  it("requires a bound document/workspace/element and uses agent OAuth, not keys", () => {
    const start = cad.indexOf('if (action === "list-onshape-variables")');
    expect(start).toBeGreaterThan(-1);
    const next = cad.indexOf("if (action ===", start + 1);
    const block = cad.slice(start, next === -1 ? cad.length : next);
    expect(block).toContain("Bind an Onshape document/workspace/element first");
    expect(block).toContain("loadCadAgentOnshape(client, orgId, session.user.id)");
    expect(block).not.toContain("readOnshapeApiKeys");
    expect(block).not.toMatch(/cad\.onshape\.com/);
    expect(block).not.toMatch(/featurescript/i);
  });
});
