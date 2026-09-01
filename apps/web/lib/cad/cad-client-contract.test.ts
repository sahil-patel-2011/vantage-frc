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
  const composer = read("app/cad/cad-operation-composer.tsx");

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
    expect(client).toContain("disabled={!onshapeOk || !boundOk || busy !== null}");
    expect(client).toContain("entities={listedEntities}");
    expect(client).toContain("features={explainedFeatures}");
    expect(composer).toContain("features={features}");
  });

  it("disables composer, feature tree, and variables until Onshape is bound", () => {
    expect(client).toContain("const boundOk = Boolean(state?.bound?.documentId)");
    expect(client).toContain("disabled={!onshapeOk || !boundOk || busy !== null}");
    expect(client.match(/disabled=\{!onshapeOk \|\| !boundOk \|\| busy !== null\}/g)?.length).toBeGreaterThanOrEqual(3);
  });

  it("imports and mounts CadFeatureTree for bound Onshape features", () => {
    expect(client).toContain('import { CadFeatureTree } from "./cad-feature-tree"');
    expect(client).toContain("<CadFeatureTree");
    expect(client).toContain("features={explainedFeatures}");
    expect(client).toContain("disabled={!onshapeOk || !boundOk || busy !== null}");
    expect(client).toContain("onDelete=");
    expect(client).toContain('operation: "delete_feature"');
    expect(client).toContain("Delete native feature");
  });

  it("surfaces listOnshapeEntities failures and a Refresh geometry control", () => {
    expect(client).toContain("geometryError");
    expect(client).toContain("Could not list Onshape entities. Bind a Part Studio and retry.");
    expect(client).toContain("Refresh geometry");
    expect(client).toContain('type="button"');
    expect(client).toContain("void refreshBoundGeometry()");
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

  it("mounts CadCheckpointNote instead of inventing a rollback", () => {
    expect(client).toContain('import { CadCheckpointNote } from "./cad-checkpoint-note"');
    expect(client).toContain("<CadCheckpointNote");
  });

  it("chains lastSketchFeatureId via parametersForExecute and rememberLastSketchFeatureId", () => {
    expect(client).toContain("parametersForExecute");
    expect(client).toContain("rememberLastSketchFeatureId");
    expect(client).toContain('from "../../lib/cad/run-composer-plan"');
    expect(client).toContain("lastSketchFeatureId");
    expect(client).toMatch(/parametersForExecute\(\s*\{[\s\S]*operation[\s\S]*parameters/);
    expect(client).toMatch(
      /lastSketchFeatureId\.current = rememberLastSketchFeatureId\(\s*operation,\s*executed\.featureId/,
    );
    expect(client).not.toMatch(/sketchFeatureId:\s*["']DEMO/i);
  });

  it("fills assemblyElementId from lastAssemblyElementId after create_assembly", () => {
    expect(client).toContain("lastAssemblyElementId");
    expect(client).toContain("assemblyElementId");
    expect(client).toContain("create_assembly");
    expect(client).toContain("add_assembly_instance");
    expect(client).toContain("create_mate");
    expect(client).toContain("withLastAssemblyElementId");
    expect(client).toContain("rememberLastAssemblyElementId");
    expect(client).toMatch(/executed\.featureId[\s\S]{0,80}result\?\.elementId/);
    expect(client).not.toMatch(/assemblyElementId:\s*["']DEMO/i);
  });

  it("never mounts an Onshape iframe in the client or the viewport", () => {
    expect(client).not.toMatch(/<iframe\b/);
    expect(client).not.toMatch(/src=\{[^}]*iframeUrl/);
    expect(client).toContain("iframeUrl: null");
    expect(viewport).not.toMatch(/<iframe\b/);
    expect(viewport).toContain("Never an Onshape iframe");
    expect(`${client}\n${viewport}`).not.toMatch(/<iframe[^>]*cad\.onshape\.com/i);
    expect(client).not.toMatch(/<iframe[\s\S]{0,200}cad\.onshape\.com/i);
    expect(client).not.toMatch(/src=["']https?:\/\/cad\.onshape\.com/i);
  });
});
