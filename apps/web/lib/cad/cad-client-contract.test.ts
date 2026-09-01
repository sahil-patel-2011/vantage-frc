import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");

function read(relative: string): string {
  return readFileSync(join(WEB_ROOT, relative), "utf8");
}

/**
 * CAD agent page contract: the hosted client mounts a shaded-view PNG pane
 * (CadViewport), the native-op composer, the live feature tree, entity
 * listing, and feature-id memory. An Onshape iframe embed is not a
 * viewport — a future <iframe src="https://cad.onshape.com/…"> has to
 * break this test first.
 */
describe("cad-client mounts CadViewport and CadOperationComposer", () => {
  const client = read("app/cad/cad-client.tsx");
  const viewport = read("app/cad/cad-viewport.tsx");

  it("imports and mounts CadViewport with a PNG, not an embed URL", () => {
    expect(client).toContain('import { CadViewport } from "./cad-viewport"');
    expect(client).toContain("<CadViewport");
    expect(client).toContain("pngBase64={state?.shadedPngBase64}");
    expect(client).toContain("openUrl={state?.openUrl}");
    expect(client).toContain("setupRequired={!onshapeOk}");
    expect(client).not.toMatch(/<CadViewport[\s\S]{0,400}iframeUrl/);
  });

  it("imports and mounts CadOperationComposer for Onshape native ops", () => {
    expect(client).toContain('import { CadOperationComposer } from "./cad-operation-composer"');
    expect(client).toContain("<CadOperationComposer");
    expect(client).toContain('platform="onshape"');
    expect(client).toContain("disabled={!onshapeOk || busy !== null}");
    expect(client).toContain("entities={listedEntities}");
  });

  it("imports and mounts CadFeatureTree for bound Onshape features", () => {
    expect(client).toContain('import { CadFeatureTree } from "./cad-feature-tree"');
    expect(client).toContain("<CadFeatureTree");
    expect(client).toContain("features={explainedFeatures}");
    expect(client).toContain("disabled={!onshapeOk || busy !== null}");
  });

  it("imports and calls listOnshapeEntities to refresh bound geometry", () => {
    expect(client).toContain("listOnshapeEntities,");
    expect(client).toContain('from "../../lib/cad/list-entities"');
    expect(client).toContain("await listOnshapeEntities({ orgId, documentRef })");
  });

  it("imports and mounts CadVariableTable and lists Onshape variables", () => {
    expect(client).toContain('import { CadVariableTable } from "./cad-variable-table"');
    expect(client).toContain("<CadVariableTable");
    expect(client).toContain("listOnshapeVariables");
    expect(client).toContain('from "../../lib/cad/list-variables"');
    expect(client).toContain("await listOnshapeVariables({ orgId, documentRef })");
    expect(client).toContain("variableStudioElementId");
  });

  it("imports and calls rememberComposerFeature after composer runs", () => {
    expect(client).toContain(
      'import { rememberComposerFeature } from "../../lib/cad/remember-feature"',
    );
    expect(client).toContain("rememberComposerFeature(");
    expect(client).toContain("rememberComposerFeature(step, executed)");
  });

  it("never mounts an Onshape iframe in the client or the viewport", () => {
    expect(client).not.toMatch(/<iframe\b/);
    expect(client).not.toMatch(/src=\{[^}]*iframeUrl/);
    expect(client).toContain("iframeUrl: null");
    expect(viewport).not.toMatch(/<iframe\b/);
    expect(viewport).toContain("Never an Onshape iframe");
    expect(`${client}\n${viewport}`).not.toMatch(/<iframe[^>]*cad\.onshape\.com/i);
  });
});
