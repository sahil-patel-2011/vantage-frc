/**
 * Onshape's Part Studio toolbar, as captured from a live session.
 *
 * Every entry here was read off the real toolbar in a signed-in browser on
 * 2026-09-18 (Onshape web client, Part Studio, 1600×900 viewport) — the eight
 * dropdowns were opened one at a time and their contents recorded, because
 * Onshape builds dropdown contents on demand rather than shipping them in the
 * DOM.
 *
 * WHAT THIS IS FOR — and what it is not.
 *
 * It is for *talking about* Onshape: telling a student where Circular pattern
 * lives ("under Linear pattern's arrow"), naming the shortcut for Fillet, or
 * letting the agent answer "how do I loft two profiles" with the actual path
 * through the actual UI. It is a map of the room.
 *
 * It is NOT how the agent should build geometry. That goes through the REST
 * API, which is versioned, documented, and complete: `featurespecs` reports
 * every feature type the account can create — 97 on a standard education plan
 * at capture time — each with its full parameter schema. Compare that to the
 * 60-odd labels below and the gap is not an accident: plenty of API features
 * have no toolbar button at all, and a toolbar button is one presentation of a
 * feature rather than the feature itself.
 *
 * ON STALENESS. Coordinates are viewport-dependent and Onshape ships UI
 * changes; treat `x` as "roughly here, left to right" rather than a click
 * target, and re-capture rather than trusting these pixels. Labels and grouping
 * age far better than positions. The live `featurespecs` call never goes stale
 * at all, which is the argument for preferring it wherever both would work.
 */

export type OnshapeToolbarEntry = {
  /** Label exactly as the toolbar renders it. */
  label: string;
  /** Keyboard shortcut Onshape shows beside it, when it shows one. */
  shortcut?: string;
};

export type OnshapeToolbarGroup = {
  /** The always-visible tool that heads this group. */
  label: string;
  /** Horizontal position at a 1600px viewport. Ordering, not a click target. */
  x: number;
  /** Everything behind the group's dropdown arrow, in menu order. */
  dropdown?: OnshapeToolbarEntry[];
};

/** Where the toolbar lives in the DOM. Stable across the captures taken so far. */
export const ONSHAPE_TOOLBAR_SELECTORS = {
  toolbar: "#osToolbar",
  /** One per toolset; each can hold several tools. */
  item: "#osToolbar .toolbar-item",
  /** The clickable tool itself — not a <button>, a div. */
  tool: "#osToolbar .tool.is-activatable",
  /** The chevron that opens a group. Present on 8 of the 11 groups. */
  dropdownArrow: "#osToolbar .dropdown-arrow",
  /** Where an opened dropdown's contents appear. */
  dropdownContent: ".os-tool-dropdown-content",
} as const;

/**
 * The toolbar, left to right.
 *
 * Note that the always-visible row already carries far more than the group
 * heads: Extrude's toolset shows Revolve, Sweep, Loft and Thicken beside it
 * without any dropdown being opened. Those are recorded as part of the row, so
 * `dropdown` holds only what is genuinely hidden behind the arrow.
 */
export const ONSHAPE_TOOLBAR: OnshapeToolbarGroup[] = [
  { label: "Undo", x: 58 },
  { label: "Redo", x: 92 },
  { label: "Sketch", x: 155 },
  { label: "Extrude", x: 219, dropdown: [{ label: "Thicken" }, { label: "Enclose" }] },
  { label: "Revolve", x: 253 },
  { label: "Sweep", x: 287 },
  { label: "Loft", x: 321 },
  { label: "Thicken", x: 355 },
  {
    label: "Fillet",
    x: 411,
    dropdown: [{ label: "Fillet", shortcut: "shift+f" }, { label: "Face blend" }],
  },
  { label: "Chamfer", x: 463 },
  { label: "Draft", x: 497, dropdown: [{ label: "Draft" }, { label: "Body draft" }] },
  { label: "Rib", x: 549 },
  { label: "Shell", x: 583 },
  { label: "Hole", x: 617 },
  { label: "External thread", x: 651 },
  {
    label: "Linear pattern",
    x: 689,
    dropdown: [
      { label: "Linear pattern" },
      { label: "Circular pattern" },
      { label: "Curve pattern" },
    ],
  },
  { label: "Mirror", x: 741 },
  { label: "Boolean", x: 779 },
  { label: "Split", x: 813 },
  {
    label: "Transform",
    x: 847,
    dropdown: [{ label: "Transform" }, { label: "Wrap" }, { label: "Decal" }],
  },
  { label: "Delete part", x: 899 },
  { label: "Modify fillet", x: 937 },
  { label: "Delete face", x: 971 },
  { label: "Move face", x: 1005 },
  { label: "Replace face", x: 1039 },
  {
    // The deepest menu by far: surfaces, curves, references and variables.
    label: "Plane",
    x: 1077,
    dropdown: [
      { label: "Plane" },
      { label: "Offset surface" },
      { label: "Boundary surface" },
      { label: "Fill" },
      { label: "Move boundary" },
      { label: "Ruled surface" },
      { label: "Mutual trim" },
      { label: "Constrained surface" },
      { label: "Helix" },
      { label: "3D fit spline" },
      { label: "Projected curve" },
      { label: "Bridging curve" },
      { label: "Composite curve" },
      { label: "Intersection curve" },
      { label: "Trim curve" },
      { label: "Isocline" },
      { label: "Offset curve" },
      { label: "Isoparametric curve" },
      { label: "Edit curve" },
      { label: "Routing curve" },
      { label: "Mate connector", shortcut: "ctrl+m" },
      { label: "Derived" },
      { label: "Variable" },
      { label: "Query variable" },
      { label: "Composite part" },
      { label: "Tag" },
    ],
  },
  {
    label: "Frame",
    x: 1133,
    dropdown: [
      { label: "Frame" },
      { label: "Frame trim" },
      { label: "Gusset" },
      { label: "End cap" },
      { label: "Cut list" },
    ],
  },
  {
    label: "Sheet metal model",
    x: 1189,
    dropdown: [
      { label: "Sheet metal model" },
      { label: "Flange" },
      { label: "Hem" },
      { label: "Tab" },
      { label: "Bend" },
      { label: "Jog" },
      { label: "Form" },
      { label: "Sheet metal loft" },
      { label: "Make joint" },
      { label: "Corner" },
      { label: "Bend relief" },
      { label: "Corner break" },
      { label: "Finish sheet metal model" },
      { label: "Flex PCB model" },
      { label: "Finish flex PCB model" },
    ],
  },
  { label: "Add custom features", x: 1245 },
];

/** Every label in the map, deduplicated — the row plus every dropdown. */
export function onshapeToolbarLabels(): string[] {
  const seen = new Set<string>();
  for (const group of ONSHAPE_TOOLBAR) {
    seen.add(group.label);
    for (const entry of group.dropdown ?? []) seen.add(entry.label);
  }
  return [...seen].sort();
}

/** Where a tool lives, for explaining it to someone looking at the screen. */
export function findOnshapeTool(
  label: string,
): { label: string; under: string; shortcut?: string } | null {
  const wanted = label.trim().toLowerCase();
  if (!wanted) return null;
  for (const group of ONSHAPE_TOOLBAR) {
    if (group.label.toLowerCase() === wanted) {
      return { label: group.label, under: "the toolbar" };
    }
    for (const entry of group.dropdown ?? []) {
      if (entry.label.toLowerCase() !== wanted) continue;
      // A dropdown repeating its own group head is the group's default, not a
      // nested item — say "the toolbar" so nobody hunts for a submenu.
      const under = entry.label === group.label ? "the toolbar" : `${group.label}'s dropdown`;
      return { label: entry.label, under, ...(entry.shortcut ? { shortcut: entry.shortcut } : {}) };
    }
  }
  return null;
}

/**
 * Said once, where the agent will read it: the map explains the UI, the API
 * builds the geometry.
 */
export const ONSHAPE_UI_MAP_GUIDANCE =
  "This map names Onshape's toolbar so you can tell someone where a tool is and which " +
  "shortcut it uses. Do not drive the UI to build geometry — call the REST API, and ask " +
  "onshape_feature_specs for the live list of every feature the account can create, each " +
  "with its parameter schema. The API covers features that have no toolbar button, and it " +
  "does not break when Onshape moves a button.";
