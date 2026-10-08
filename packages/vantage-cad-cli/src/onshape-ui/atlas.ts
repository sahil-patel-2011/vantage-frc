import type { UiControl } from "./types";

/** Observed in the hosted Onshape UI, 2026-10-07, build 1.221.89963.
 * Observed controls are not a claim of end-to-end modeling support. See docs/cad.
 * No model-supplied selectors, scripts, requests, cookies or hidden state.
 */
const css = (selector: string, impact: UiControl["impact"] = "inspect", actions: UiControl["allowedActions"] = ["click"]): UiControl => ({
  locator: { kind: "css", selector }, scope: "document", impact, allowedActions: actions,
});
const button = (name: string, scope: UiControl["scope"] = "document", impact: UiControl["impact"] = "inspect"): UiControl => ({
  locator: { kind: "role", role: "button", name }, scope, impact, allowedActions: ["click"],
});
const featureCommands = [
  "UNDO_A_CHANGE", "REDO_A_CHANGE",
  "newSketch", "extrude", "revolve", "sweep", "loft", "thicken", "fillet", "chamfer",
  "draft", "rib", "shell", "hole", "externalThread", "linearPattern", "mirror",
  "booleanBodies", "splitPart", "transform", "modifyFillet", "cPlane", "frame", "sheetMetalStart",
  "LINESEGMENT", "RECTANGLE_TWO_CORNERS", "CIRCLE_CENTER_RADIUS", "ARC_START_END_RADIUS",
  "INSCRIBED_POLYGON", "SPLINE", "POINT", "TEXT_RECTANGLE_TWO_CORNERS", "USE",
  "TOGGLE_CONSTRUCTION", "FILLET", "TRIM", "OFFSET", "SKETCHMIRROR", "SKETCHLPATTERN",
  "DIMENSION", "COINCIDENT",
  "insertPartOrAssembly", "mateConnector", "geometryMate", "widthMate", "mateGroup", "replicate",
  "assemblyLinearPattern", "assemblyCircularPattern", "assemblyMirror", "assemblyDisplayStates",
] as const;
const menuCommands = [
  "LINESEGMENT", "MIDPOINTLINE", "RECTANGLE_TWO_CORNERS", "RECTANGLE_CENTER", "RECTANGLE_ALIGNED",
  "CIRCLE_CENTER_RADIUS", "CIRCLE_PERIMETER", "ELLIPSE", "ARC_START_END_RADIUS", "ARC_TANGENT",
  "CENTER_ARC", "ELLIPTICAL_ARC", "CONIC", "INSCRIBED_POLYGON", "CIRCUMSCRIBED_POLYGON",
  "SPLINE", "BEZIER", "ADD_SPLINE_POINT", "USE", "INTERSECTION", "FILLET", "CHAMFER",
  "TRIM", "EXTEND", "SPLIT", "OFFSET", "SLOT", "SKETCHLPATTERN", "SKETCHCPATTERN", "TRANSFORM",
  "COINCIDENT", "CONCENTRIC", "PARALLEL", "TANGENT", "HORIZONTAL", "VERTICAL", "PERPENDICULAR",
  "EQUAL", "MIDPOINT", "NORMAL", "PIERCE", "MIRROR", "FIX", "EQUAL_CURVATURE",
  "cPlane", "offsetSurface", "boundarySurface", "fill", "extendSurface", "ruledSurface", "mutualTrim",
  "constrainedSurface", "helix", "fitSpline", "projectCurves", "bridgingCurve", "compositeCurve",
  "intersectionCurve", "trimCurve", "isocline", "offsetCurveOnFace", "isoparametricCurve", "editCurve",
  "routingCurve", "mateConnector", "importDerived", "assignVariable", "queryVariable", "compositePart", "tag",
  "thicken", "enclose", "linearPattern", "circularPattern", "curvePattern", "transform", "wrap", "decal",
  "modifyFillet", "deleteFace", "moveFace", "replaceFace", "frame", "frameTrim", "gusset", "endcap", "cutlist",
  "sheetMetalStart", "sheetMetalFlange", "sheetMetalHem", "sheetMetalTab", "sheetMetalBend", "sheetMetalJog",
  "sheetMetalFormed", "sheetMetalLoft", "sheetMetalMakeJoint", "sheetMetalCorner", "sheetMetalBendRelief",
  "sheetMetalCornerBreak", "sheetMetalEnd", "pcbStart", "pcbEnd", "fillet", "faceBlend", "draft", "bodyDraft",
] as const;

export const ONSHAPE_UI_CONTROLS: Readonly<Record<string, UiControl>> = {
  ...Object.fromEntries(featureCommands.map(command => [
    `tool.${command}`, css(`#osToolbar [command-id="${command}"]`, "edit"),
  ])),
  ...Object.fromEntries(menuCommands.map(command => [
    `menuitem.${command}`, css(`.os-tool-dropdown-content [command-id="${command}"]`, "edit"),
  ])),
  ...Object.fromEntries(["extrude", "linearPattern", "booleanBodies", "modifyFillet", "cPlane", "frame", "sheetMetalStart"].map(command => [
    `menu.${command}`, css(`#osToolbar .toolset:has([command-id="${command}"]) .dropdown-arrow`),
  ])),
  ...Object.fromEntries(["fillet", "draft", "LINESEGMENT", "RECTANGLE_TWO_CORNERS", "CIRCLE_CENTER_RADIUS",
    "ARC_START_END_RADIUS", "INSCRIBED_POLYGON", "SPLINE", "USE", "FILLET", "TRIM", "OFFSET",
    "SKETCHLPATTERN", "COINCIDENT"].map(command => [
    `menu.${command}`, css(`#osToolbar .toolgroup:has([command-id="${command}"]) .dropdown-arrow`),
  ])),
  "documents.create": button("Create", "documents", "edit"),
  "documents.newDocument": button("Document…", "documents", "edit"),
  "documents.newFolder": button("Folder…", "documents", "edit"),
  "documents.open": { locator: { kind: "named-item", scope: '[role="grid"]', itemSelector: 'a[href^="/documents/"][href*="/w/"]' }, scope: "documents", impact: "inspect", allowedActions: ["click"] },
  "documents.folder": { locator: { kind: "named-item", scope: "body", itemSelector: 'a.document-display-link[href^="/documents?"][href*="resourceType=folder"]' }, scope: "documents", impact: "inspect", allowedActions: ["click"] },
  "documents.ancestors": { ...css("button.hidden-node-toggler"), scope: "documents" },
  "documents.ancestor": { locator: { kind: "named-item", scope: "body", itemSelector: ".hidden-node-dropdown-item" }, scope: "documents", impact: "inspect", allowedActions: ["click"] },
  "documents.search": { ...css("input#search-box", "inspect", ["fill", "press"]), scope: "documents", allowedKeys: ["Enter", "Escape"] },
  "documents.name": { locator: { kind: "role", role: "textbox", name: "", scope: '[role="dialog"]' }, scope: "documents", impact: "edit", allowedActions: ["fill"] },
  "documents.confirmCreate": { locator: { kind: "role", role: "button", name: "Create", scope: '[role="dialog"]' }, scope: "documents", impact: "edit", allowedActions: ["click"] },
  "documents.cancelCreate": { locator: { kind: "role", role: "button", name: "Cancel", scope: '[role="dialog"]' }, scope: "documents", impact: "inspect", allowedActions: ["click"] },
  "feature.accept": css(".ns-dialog-button-ok", "edit"),
  "feature.cancel": css(".ns-dialog-button-cancel", "edit"),
  "feature.dialog": { ...css(".ns-dialog-header"), allowedActions: [] },
  "feature.depth": { ...css('input[data-bs-original-title^="Depth:"]', "edit", ["fill", "press"]), allowedKeys: ["Tab", "Enter"], read: "value" },
  "sketch.dimension": { ...css('input.os-canvas-text-edit', "edit", ["fill", "press"]), allowedKeys: ["Enter", "Escape", "Tab"], read: "value" },
  "feature.filter": { locator: { kind: "role", role: "textbox", name: "Filter by name or type" }, scope: "document", impact: "inspect", allowedActions: ["fill", "press"], allowedKeys: ["Escape"] },
  "plane.top": css('.os-list-item-label[data-bs-original-title="Top"]', "edit"),
  "plane.front": css('.os-list-item-label[data-bs-original-title="Front"]', "edit"),
  "plane.right": css('.os-list-item-label[data-bs-original-title="Right"]', "edit"),
  "measure.open": css('[data-bs-original-title="Show measure details ([)"]'),
  "mass.open": css('[data-bs-original-title="Display mass and section properties"]'),
  "camera.options": css('[data-bs-original-title="Camera and render options"]'),
  "tabs.insert": css("#add-element-button", "edit"),
  "history.open": css('[data-bs-original-title="Versions and history"]'),
  "tree.item": { locator: { kind: "named-item", scope: "body", itemSelector: ".os-list-item-label .os-list-item-name" }, scope: "document", impact: "edit", allowedActions: ["click", "double-click", "right-click"] },
  "tabs.select": { locator: { kind: "named-item", scope: "body", itemSelector: "element-name .os-tab-name" }, scope: "document", impact: "inspect", allowedActions: ["click"] },
  "document.menu": css(".nav-hamburger-menu"),
  "document.home": { locator: { kind: "role", role: "link", name: "The Onshape logo." }, scope: "document", impact: "inspect", allowedActions: ["click"] },
  "document.units": { locator: { kind: "text", text: "Workspace units…", scope: '.hamburger-menu' }, scope: "document", impact: "inspect", allowedActions: ["click"] },
  "units.length": { ...css('select.selection-list-workspace:has(option[value="4: millimeter"])', "edit", ["select"]), read: "value" },
  "units.angle": { ...css('select.selection-list-workspace:has(option[value="1: radian"])', "edit", ["select"]), read: "value" },
  "units.mass": { ...css('select.selection-list-workspace:has(option[value="1: kilogram"])', "edit", ["select"]), read: "value" },
  "material.assign": { locator: { kind: "text", text: "Assign material…" }, scope: "document", impact: "edit", allowedActions: ["click"] },
  "material.edit": { locator: { kind: "text", text: "Edit material…" }, scope: "document", impact: "inspect", allowedActions: ["click"] },
  "material.library": { ...css('.material-dialog-content select.material-library-select-options', "edit", ["select"]), read: "value" },
  "material.name": { ...css('.material-dialog-content [data-parameter-id="Name"] input'), allowedActions: [], read: "value" },
  "material.density": { ...css('.material-dialog-content input[data-bs-original-title^="Density ("]'), allowedActions: [], read: "value" },
  "camera.isometric": { locator: { kind: "text", text: "Isometric" }, scope: "document", impact: "inspect", allowedActions: ["click"] },
  "select.open": button("Select box focus"),
  "select.search": { locator: { kind: "role", role: "searchbox", name: "Select box" }, scope: "document", impact: "inspect", allowedActions: ["fill"] },
  "select.option": { locator: { kind: "named-item", scope: "body", itemSelector: '[role="option"]' }, scope: "document", impact: "edit", allowedActions: ["click"] },
  ...Object.fromEntries(["Fastened", "Revolute", "Slider", "Planar", "Cylindrical", "Pin slot", "Ball", "Parallel"].map(label => [
    `mate.${label}`, css(`#osToolbar [command-id="mate"][data-bs-original-title="${label} mate (m)"]`, "edit"),
  ])),
  "canvas": { ...css("canvas#canvas", "edit", ["canvas-click", "press"]), canvas: true, allowedKeys: ["Escape"] },
  // Read-only physical-property context observed 2026-10-08. Overrides are
  // reported, never enabled by the agent to manufacture a desired result.
  ...Object.fromEntries(["PARTS", "MATE_CONNECTOR", "EnableInertia"].map(parameter => [
    `mass.context.${parameter}`, { ...css(`.mass-property-dialog [data-parameter-id="${parameter}"]`), allowedActions: [], read: "text" as const },
  ])),
  ...Object.fromEntries(["EnableMass", "EnableCoM", "EnableInertia", "SHOW_VARIANCE"].map(parameter => [
    `mass.checked.${parameter}`, { ...css(`.mass-property-dialog [data-parameter-id="${parameter}"] input[type="checkbox"]`), allowedActions: [], read: "checked" as const },
  ])),
  ...Object.fromEntries(["x", "y", "z"].map(axis => [
    `property.center.${axis}`, { ...css(`.mass-property-dialog input[data-bs-original-title^="Center of mass ${axis} coordinate:"]`), allowedActions: [], read: "value" as const },
  ])),
  ...Object.fromEntries(["Mass", "Volume", "Surface area", "Lxx", "Lxy", "Lxz", "Lyx", "Lyy", "Lyz", "Lzx", "Lzy", "Lzz"].map(label => [
    `property.${label}`, { ...css(`.mass-property-dialog input[data-bs-original-title^="${label}:"]`), allowedActions: [], read: "value" as const },
  ])),
};

export const ONSHAPE_UI_ATLAS_STATUS = {
  observedAt: "2026-10-07", onshapeBuild: "1.221.89963.13d10d36cb23",
  readbackObservedAt: "2026-10-08",
  transport: "playwright-ui-only", stage: "development-pilot",
  verifiedManually: ["new-document", "new-folder", "move-disposable-document", "sketch-top-plane", "rectangle", "explicit-sketch-dimensions", "extrude-explicit-mm", "missing-material-warning", "assign-material", "display-mass-inertia", "workspace-unit-changes", "isometric-view", "switch-document-tabs", "insert-existing-part-into-assembly", "part-studio-submenus"],
  notVerified: ["complete-toolbar-coverage", "assembly-mates", "drawings", "macOS-packaging", "Windows-packaging", "four-minute-complex-drawing"],
} as const;
