/**
 * Hand-written DXF fixtures for the CAD checker tests. Each is the smallest file that shows one
 * thing: a good shop drawing, a bare sketch on layer 0, and so on.
 */

type Pair = [number, string | number];

export function dxf(pairs: Pair[]): string {
  return pairs.map(([code, value]) => `${code}\n${value}`).join("\n") + "\n";
}

const section = (name: string, body: Pair[]): Pair[] => [[0, "SECTION"], [2, name], ...body, [0, "ENDSEC"]];

const header = (vars: Pair[][]): Pair[] => section("HEADER", vars.flat());

const layer = (name: string, opts: { color?: number; flags?: number; linetype?: string } = {}): Pair[] => [
  [0, "LAYER"],
  [2, name],
  [70, opts.flags ?? 0],
  [62, opts.color ?? 7],
  [6, opts.linetype ?? "CONTINUOUS"],
];

const layers = (entries: Pair[][]): Pair[] => section("TABLES", [[0, "TABLE"], [2, "LAYER"], [70, entries.length], ...entries.flat(), [0, "ENDTAB"]]);

const line = (layerName: string): Pair[] => [[0, "LINE"], [8, layerName], [10, 0], [20, 0], [11, 1], [21, 1]];
const circle = (layerName: string): Pair[] => [[0, "CIRCLE"], [8, layerName], [10, 0], [20, 0], [40, 0.25]];
const text = (layerName: string, height: number, value: string): Pair[] => [[0, "TEXT"], [8, layerName], [10, 0], [20, 0], [40, height], [1, value]];
const dimension = (layerName: string): Pair[] => [[0, "DIMENSION"], [8, layerName], [2, "*D1"], [70, 0], [42, 5]];

/** A good shop drawing in inches: named layers, dimensions, a filled title block block + insert. */
export const GOOD_DRAWING = dxf([
  [999, "Hand-written fixture"],
  ...header([
    [[9, "$ACADVER"], [1, "AC1015"]],
    [[9, "$INSUNITS"], [70, 1]],
    [[9, "$MEASUREMENT"], [70, 0]],
    [[9, "$DIMSCALE"], [40, 1]],
    [[9, "$LTSCALE"], [40, 1]],
  ]),
  ...layers([layer("0"), layer("Outline"), layer("Holes", { color: 1 }), layer("Dimensions", { color: 3 }), layer("Title")]),
  ...section("BLOCKS", [
    [0, "BLOCK"], [8, "0"], [2, "TITLE_BLOCK"], [70, 2], [10, 0], [20, 0],
    [0, "LINE"], [8, "Title"], [10, 0], [20, 0], [11, 10], [21, 0],
    [0, "ATTDEF"], [8, "Title"], [40, 0.125], [1, ""], [3, "Part name"], [2, "TITLE"], [70, 0],
    [0, "ATTDEF"], [8, "Title"], [40, 0.125], [1, ""], [3, "Drawn by"], [2, "DRAWN_BY"], [70, 0],
    [0, "ATTDEF"], [8, "Title"], [40, 0.125], [1, ""], [3, "Date"], [2, "DATE"], [70, 0],
    [0, "ATTDEF"], [8, "Title"], [40, 0.125], [1, ""], [3, "Scale"], [2, "SCALE"], [70, 0],
    [0, "ATTDEF"], [8, "Title"], [40, 0.125], [1, ""], [3, "Material"], [2, "MATERIAL"], [70, 0],
    [0, "ATTDEF"], [8, "Title"], [40, 0.125], [1, ""], [3, "Revision"], [2, "REV"], [70, 0],
    [0, "ENDBLK"], [8, "0"],
  ]),
  ...section("ENTITIES", [
    ...line("Outline"),
    ...line("Outline"),
    ...circle("Holes"),
    ...dimension("Dimensions"),
    ...text("Dimensions", 0.12, "ALL HOLES #10 CLEARANCE"),
    [0, "MTEXT"], [8, "Dimensions"], [40, 0.1], [3, "BREAK ALL\\PSHARP "], [1, "{\\fArial|b0;EDGES}"],
    [0, "INSERT"], [8, "Title"], [66, 1], [2, "TITLE_BLOCK"], [10, 0], [20, 0],
    [0, "ATTRIB"], [8, "Title"], [40, 0.125], [1, "Bearing plate"], [2, "TITLE"],
    [0, "ATTRIB"], [8, "Title"], [40, 0.125], [1, "6061"], [2, "MATERIAL"],
    [0, "SEQEND"], [8, "Title"],
  ]),
  [0, "EOF"],
]);

/** A bare sketch: unitless, everything on layer 0, a default-named empty layer, tiny text. */
export const BARE_SKETCH = dxf([
  ...header([[[9, "$ACADVER"], [1, "AC1009"]], [[9, "$INSUNITS"], [70, 0]], [[9, "$MEASUREMENT"], [70, 1]]]),
  ...layers([layer("0"), layer("Layer1")]),
  ...section("ENTITIES", [...line("0"), ...line("0"), ...circle("0"), ...text("0", 1.5, "note")]),
  [0, "EOF"],
]);

/** Metric, with a frozen layer and an off layer that still hold geometry, and exploded dimensions. */
export const HIDDEN_LAYERS = dxf([
  ...header([[[9, "$INSUNITS"], [70, 4]]]),
  ...layers([layer("0"), layer("Cut"), layer("Old revision", { flags: 1 }), layer("Notes", { color: -2 }), layer("Spare")]),
  ...section("ENTITIES", [
    ...line("Cut"),
    ...line("Old revision"),
    ...text("Notes", 1.2, "Ø6.35"),
    ...text("Cut", 3, "TITLE: Spacer"),
    ...text("Cut", 3, "DRAWN BY: AB"),
    ...text("Cut", 3, "SCALE 1:1"),
  ]),
  [0, "EOF"],
]);

/** A DXF with sections but nothing drawn. */
export const EMPTY_DRAWING = dxf([...header([[[9, "$INSUNITS"], [70, 1]]]), ...layers([layer("0")]), ...section("ENTITIES", []), [0, "EOF"]]);
