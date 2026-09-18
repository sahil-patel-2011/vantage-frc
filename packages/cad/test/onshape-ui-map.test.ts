import { describe, expect, it } from "vitest";
import {
  ONSHAPE_TOOLBAR,
  ONSHAPE_TOOLBAR_SELECTORS,
  ONSHAPE_UI_MAP_GUIDANCE,
  findOnshapeTool,
  onshapeToolbarLabels,
} from "../src/onshape-ui-map";

/**
 * The map is hand-transcribed from a live capture, so these check the shape of
 * it rather than re-deriving it: ordering left to right, no duplicate group
 * heads, and lookups that answer the question a student actually asks — "where
 * is that button?"
 */
describe("the Onshape toolbar map", () => {
  it("runs left to right, so position means ordering", () => {
    const xs = ONSHAPE_TOOLBAR.map((group) => group.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("names every group exactly once", () => {
    const heads = ONSHAPE_TOOLBAR.map((group) => group.label);
    expect(new Set(heads).size, `duplicate group head in ${heads.join(", ")}`).toBe(heads.length);
  });

  it("carries the deep menus the toolbar hides", () => {
    // The surfaces/curves dropdown is the one nobody finds by accident.
    const plane = ONSHAPE_TOOLBAR.find((group) => group.label === "Plane");
    expect(plane?.dropdown?.length).toBeGreaterThan(20);
    expect(plane?.dropdown?.map((e) => e.label)).toContain("Helix");
    expect(plane?.dropdown?.map((e) => e.label)).toContain("Mate connector");

    const sheet = ONSHAPE_TOOLBAR.find((group) => group.label === "Sheet metal model");
    expect(sheet?.dropdown?.map((e) => e.label)).toContain("Flange");
  });

  it("keeps the shortcuts it saw", () => {
    expect(findOnshapeTool("Fillet")?.shortcut ?? findOnshapeTool("Face blend")).toBeTruthy();
    expect(findOnshapeTool("Mate connector")?.shortcut).toBe("ctrl+m");
  });

  it("answers where a tool is", () => {
    expect(findOnshapeTool("Extrude")).toEqual({ label: "Extrude", under: "the toolbar" });
    expect(findOnshapeTool("Circular pattern")?.under).toBe("Linear pattern's dropdown");
    expect(findOnshapeTool("Flange")?.under).toBe("Sheet metal model's dropdown");
  });

  it("does not send someone hunting for a submenu that is really the default", () => {
    // "Frame" heads its own dropdown and also appears inside it.
    expect(findOnshapeTool("Frame")?.under).toBe("the toolbar");
  });

  it("is case- and whitespace-forgiving, because people type", () => {
    expect(findOnshapeTool("  cIRcular PATTERN ")?.label).toBe("Circular pattern");
  });

  it("returns null rather than guessing at a tool it never saw", () => {
    expect(findOnshapeTool("Teleport")).toBeNull();
    expect(findOnshapeTool("")).toBeNull();
    expect(findOnshapeTool("   ")).toBeNull();
  });

  it("lists every label once, row and dropdowns together", () => {
    const labels = onshapeToolbarLabels();
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.length).toBeGreaterThan(55);
    for (const expected of ["Sketch", "Loft", "Helix", "Flange", "Decal", "Query variable"]) {
      expect(labels, `${expected} missing`).toContain(expected);
    }
  });

  it("points the agent at the API rather than at clicking", () => {
    // The whole reason the map is safe to ship: it says what it is not for.
    expect(ONSHAPE_UI_MAP_GUIDANCE).toMatch(/do not drive the ui/i);
    expect(ONSHAPE_UI_MAP_GUIDANCE).toContain("onshape_feature_specs");
  });

  it("records the selectors the capture actually used", () => {
    expect(ONSHAPE_TOOLBAR_SELECTORS.tool).toContain(".tool.is-activatable");
    expect(ONSHAPE_TOOLBAR_SELECTORS.dropdownContent).toBe(".os-tool-dropdown-content");
  });
});
