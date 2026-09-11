import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");

function read(relative: string): string {
  return readFileSync(join(WEB_ROOT, relative), "utf8");
}

/**
 * CAD agent page contract: the hosted client mounts CadViewport (official
 * Onshape embed + Edit in Onshape, or a real picture), the native-op
 * composer, the live feature tree, entity listing, and feature-id memory.
 * The agent session still keeps iframeUrl null — the viewport builds the
 * official cad.onshape.com embed from the document URL itself.
 */
describe("cad-client mounts CadViewport and CadOperationComposer", () => {
  const client = [
    read("app/cad/cad-client.tsx"),
    read("app/cad/cad-session.ts"),
    read("app/cad/cad-ready-view.tsx"),
  ].join("\n");
  const viewport = [
    read("app/cad/cad-viewport.tsx"),
    read("app/cad/onshape-edit-board.tsx"),
  ].join("\n");
  const composer = read("app/cad/cad-operation-composer.tsx");
  const elements = read("lib/cad/list-document-elements.ts");

  it("imports and mounts CadViewport with a PNG, not an embed URL", () => {
    expect(client).toContain('import { CadViewport } from "./cad-viewport"');
    expect(client).toContain("<CadViewport");
    expect(client).toContain("pngBase64={state?.shadedPngBase64}");
    expect(client).toContain("openUrl={state?.openUrl || url}");
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
    expect(client).toContain("listOnshapeVariables({");
    expect(client).toContain("variableStudioElementId: lastVariableStudioElementId.current");
    expect(client).toContain("variableStudioElementId");
  });

  it("imports and calls rememberComposerFeature after composer runs", () => {
    expect(client).toContain(
      'import { rememberComposerFeature } from "../../lib/cad/remember-feature"',
    );
    expect(client).toContain("rememberComposerFeature(");
    expect(client).toContain("rememberComposerFeature(step, executed)");
  });

  it("mounts CadCheckpointNote with a real execute checkpointId", () => {
    expect(client).toContain('import { CadCheckpointNote } from "./cad-checkpoint-note"');
    expect(client).toContain("<CadCheckpointNote");
    expect(client).toContain("checkpointId={lastCheckpointId}");
    expect(client).toContain("checkpointIdFromExecute");
    expect(client).toContain("result.checkpointId");
    expect(client).toContain("result.checkpointRef");
    expect(client).not.toMatch(/checkpointId=\{["']DEMO/i);
    expect(client).not.toMatch(/lastCheckpointId.*=.*["']DEMO/i);
  });

  it("chains lastSketchFeatureId via parametersForExecute and rememberLastSketchFeatureId", () => {
    expect(client).toContain("parametersForExecute");
    expect(client).toContain("rememberLastSketchFeatureId");
    expect(client).toContain('from "../../lib/cad/run-composer-plan"');
    expect(client).toContain("lastSketchFeatureId");
    expect(client).toMatch(/parametersForExecute\(\s*\{[\s\S]*operation[\s\S]*parameters/);
    expect(client).toContain("parametersForExecute(step, lastSketchFeatureId.current)");
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

  it("persists lastAssemblyElementId in sessionStorage across refresh", () => {
    expect(client).toContain("sessionStorage");
    expect(client).toContain("vantage-cad-assembly:");
    expect(client).toContain("`vantage-cad-assembly:${orgId}:${documentId}`");
    expect(client).toContain("readStoredAssemblyElementId");
    expect(client).toContain("writeStoredAssemblyElementId");
    expect(client).toContain("lastAssemblyElementId.current = stored");
    expect(client).not.toMatch(/sessionStorage\.(setItem|getItem)\([^)]*DEMO/i);
    expect(client).not.toMatch(/vantage-cad-assembly:[^`]*DEMO/i);
  });

  it("lists Onshape document tabs via list-onshape-elements after bind", () => {
    expect(client).toContain("listDocumentElements");
    expect(client).toContain('from "../../lib/cad/list-document-elements"');
    expect(client).toContain("list-onshape-elements");
    expect(client).toContain("switchBoundElement");
    expect(client).toContain("documentTabKind");
    expect(client).toContain('kind === "assembly"');
    expect(client).toContain('kind === "variablestudio"');
    expect(client).toContain("lastVariableStudioElementId");
    expect(client).toContain('action: "set-document"');
    expect(client).toContain('action: "bind"');
    expect(elements).toContain('action: "list-onshape-elements"');
    expect(elements).toContain("Part Studio");
    expect(elements).toContain("Assembly");
    expect(elements).toContain("Variable Studio");
    expect(elements).not.toMatch(/id:\s*["']DEMO/i);
    expect(client).not.toMatch(/elementId:\s*["']DEMO/i);
  });

  it("lists assembly instances and passes them to the composer", () => {
    expect(client).toContain("listOnshapeAssemblyInstances");
    expect(client).toContain('from "../../lib/cad/list-assembly"');
    expect(client).toContain("instances={listedAssembly.instances}");
    expect(client).toContain("lastInstanceIds");
    expect(client).toContain("firstInstanceId");
    expect(client).toContain("secondInstanceId");
    expect(client).not.toMatch(/firstInstanceId:\s*["']DEMO/i);
    expect(client).not.toMatch(/secondInstanceId:\s*["']DEMO/i);
    expect(client).not.toMatch(/<iframe\b/);
  });

  it("keeps the agent iframeUrl null and lets CadViewport embed the official document", () => {
    expect(client).not.toMatch(/<iframe\b/);
    expect(client).not.toMatch(/src=\{[^}]*iframeUrl/);
    expect(client).toContain("iframeUrl: null");
    expect(client).not.toMatch(/<iframe[\s\S]{0,200}cad\.onshape\.com/i);
    expect(client).not.toMatch(/src=["']https?:\/\/cad\.onshape\.com/i);
    expect(viewport).toContain("<iframe");
    expect(viewport).toContain("OnshapeDocumentEmbed");
    expect(viewport).toContain("Edit in Onshape");
    expect(viewport).toContain("Needs setup");
    expect(viewport).not.toMatch(/src=\{[^}]*iframeUrl/);
  });
});
