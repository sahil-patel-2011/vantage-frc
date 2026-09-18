import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const WEB_ROOT = join(__dirname, "..", "..");

function read(relative: string): string {
  return readFileSync(join(WEB_ROOT, relative), "utf8");
}

/**
 * CAD page contract.
 *
 * This file used to pin the manipulation studio in place — a 21-button native
 * operation palette, a feature tree that deleted features, and a variable
 * table that edited them, all driving Onshape from inside Vantage. That is
 * gone on purpose. Modelling belongs in Onshape, where the person already has
 * the real tools, undo, and version history; Vantage's job is to show what is
 * there, let the agent work, and get out of the way.
 *
 * So the assertions run the other way now: the viewport and the agent stay,
 * and the studio must not come back by accident.
 */
describe("the CAD page shows the model and hosts the agent", () => {
  const client = [
    read("app/cad/cad-client.tsx"),
    read("app/cad/cad-session.ts"),
    read("app/cad/cad-ready-view.tsx"),
  ].join("\n");

  it("mounts CadViewport with a real picture, not an embed URL", () => {
    expect(client).toContain('import { CadViewport } from "./cad-viewport"');
    expect(client).toContain("<CadViewport");
    expect(client).toContain("pngBase64={state?.shadedPngBase64}");
    expect(client).toContain("openUrl={state?.openUrl || url}");
    expect(client).toContain("setupRequired={!onshapeOk}");
    expect(client).not.toMatch(/<CadViewport[\s\S]{0,400}iframeUrl/);
  });

  it("keeps the way out to Onshape itself", () => {
    // Removing in-app editing only works if opening the real thing is easy.
    expect(client).toContain("openUrl");
  });

  it("still runs the agent — removing the studio did not touch it", () => {
    expect(client).toContain("/api/cad/agent");
    expect(client).toContain("applyChatResponse");
  });
});

describe("the manipulation studio stays removed", () => {
  const surface = [
    read("app/cad/cad-client.tsx"),
    read("app/cad/cad-ready-view.tsx"),
  ].join("\n");

  it("has no component files for it", () => {
    for (const gone of [
      "app/cad/cad-operation-composer.tsx",
      "app/cad/cad-composer-fields.tsx",
      "app/cad/cad-feature-tree.tsx",
      "app/cad/cad-variable-table.tsx",
    ]) {
      expect(existsSync(join(WEB_ROOT, gone)), `${gone} came back`).toBe(false);
    }
  });

  it("mounts none of them", () => {
    for (const mount of [
      "<CadOperationComposer",
      "<CadFeatureTree",
      "<CadVariableTable",
      "<CadCheckpointNote",
    ]) {
      expect(surface, `${mount} came back`).not.toContain(mount);
    }
  });

  it("does not sweep Onshape geometry on every bind", () => {
    // refreshBoundGeometry made four round trips — entities, variables,
    // assembly instances and an explain-features call — purely to fill those
    // panels. With them gone the calls fetched data nothing rendered.
    expect(surface).not.toContain("refreshBoundGeometry");
    expect(surface).not.toContain("listOnshapeEntities");
    expect(surface).not.toContain("explain-onshape-features");
  });
});
