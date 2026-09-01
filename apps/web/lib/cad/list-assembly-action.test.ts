import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");

function read(relative: string): string {
  return readFileSync(join(WEB_ROOT, relative), "utf8");
}

/**
 * POST /api/cad action list-onshape-assembly is a thin bind + getOnshapeAssembly
 * parse. This file only reads route source — no live Onshape, no HTTP, no
 * fabricated instance ids.
 */
describe("POST /api/cad list-onshape-assembly", () => {
  const cad = read("app/api/cad/route.ts");

  it("imports listOnshapeAssemblyInstances from @vantage/cad", () => {
    expect(cad).toContain("listOnshapeAssemblyInstances");
    expect(cad).toMatch(/from "@vantage\/cad"/);
  });

  it("dispatches list-onshape-assembly to listOnshapeAssemblyInstances", () => {
    expect(cad).toContain('if (action === "list-onshape-assembly")');
    expect(cad).toContain("const assemblyElementId = String(body.assemblyElementId ?? \"\").trim() || ref.elementId");
    expect(cad).toContain("const instances = await listOnshapeAssemblyInstances(onshape.http, {");
    expect(cad).toContain("return { instances, documentRef: ref, assemblyElementId, authPath: onshape.via }");
  });

  it("requires a bound document/workspace/element and uses agent OAuth, not keys", () => {
    const start = cad.indexOf('if (action === "list-onshape-assembly")');
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
