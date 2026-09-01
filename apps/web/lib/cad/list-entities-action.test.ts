import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");

function read(relative: string): string {
  return readFileSync(join(WEB_ROOT, relative), "utf8");
}

/**
 * POST /api/cad action list-onshape-entities is a thin bind + call of
 * listOnshapeNativeEntities. This file only reads route source — no live
 * Onshape, no HTTP, no fabricated body/face/edge ids.
 */
describe("POST /api/cad list-onshape-entities", () => {
  const cad = read("app/api/cad/route.ts");

  it("imports listOnshapeNativeEntities from @vantage/cad", () => {
    expect(cad).toContain("listOnshapeNativeEntities");
    expect(cad).toMatch(/from "@vantage\/cad"/);
  });

  it("dispatches list-onshape-entities to listOnshapeNativeEntities", () => {
    expect(cad).toContain('if (action === "list-onshape-entities")');
    expect(cad).toContain("const entities = await listOnshapeNativeEntities(onshape.http, ref)");
    expect(cad).toContain("return { entities, documentRef: ref, authPath: onshape.via }");
  });

  it("requires a bound document/workspace/element and uses agent OAuth, not keys", () => {
    const start = cad.indexOf('if (action === "list-onshape-entities")');
    expect(start).toBeGreaterThan(-1);
    const next = cad.indexOf("if (action ===", start + 1);
    const block = cad.slice(start, next === -1 ? cad.length : next);
    expect(block).toContain("Bind an Onshape document/workspace/element first");
    expect(block).toContain("loadCadAgentOnshape(client, orgId, session.user.id)");
    expect(block).not.toContain("readOnshapeApiKeys");
    expect(block).not.toMatch(/cad\.onshape\.com/);
  });
});
