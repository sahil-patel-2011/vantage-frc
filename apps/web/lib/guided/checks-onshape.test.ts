import { describe, expect, it } from "vitest";
import {
  classifyElements,
  countDrawingDimensions,
  isOnshapeApiCheck,
  onshapeAccessMessage,
  onshapeLinkProblem,
  parseOnshapeLink,
  referencesVariable,
  runOnshapeApiCheck,
  type OnshapeApiCheck,
  type OnshapeFetch,
} from "./checks-onshape";
import { ONSHAPE_TRACKS } from "./tracks-onshape";

/* Ids shaped like Onshape's (24 hex characters). */
const DID = "a1b2c3d4e5f6a7b8c9d0e1f2";
const WID = "0123456789abcdef01234567";
const PS = "1111111111111111aaaaaaaa";
const ASM = "2222222222222222bbbbbbbb";
const DRW = "3333333333333333cccccccc";
const STD_DOC = "12cfb8d2c8a6f5ef8cbfa8f1";
const MKCAD_DOC = "0e2f1c3a5b7d9e1f2a3b4c5d";

const psUrl = `https://cad.onshape.com/documents/${DID}/w/${WID}/e/${PS}`;
const asmUrl = `https://cad.onshape.com/documents/${DID}/w/${WID}/e/${ASM}`;
const drwUrl = `https://cad.onshape.com/documents/${DID}/w/${WID}/e/${DRW}`;
const base = `/d/${DID}/w/${WID}/e`;

type Route = unknown | ((init?: RequestInit) => unknown);
type Reply = { status: number; body: unknown };

/** A fake Onshape: path (with query) → JSON body, or { status } for errors. Records every call. */
function fakeOnshape(routes: Record<string, Route>) {
  const calls: string[] = [];
  const http: OnshapeFetch = async (path, init) => {
    const key = `${init?.method ?? "GET"} ${path}`;
    calls.push(key);
    const route = key in routes ? routes[key] : routes[key.split("?")[0]!];
    if (route === undefined) return new Response(JSON.stringify({ message: "not found" }), { status: 404 });
    const value = typeof route === "function" ? (route as (init?: RequestInit) => unknown)(init) : route;
    const reply = value && typeof value === "object" && "__status" in (value as object) ? (value as { __status: number }) : null;
    if (reply) return new Response("", { status: reply.__status });
    return new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { http, calls };
}
const fail = (status: number) => ({ __status: status }) as unknown as Reply;
const noSleep = async () => {};

const ELEMENTS = [
  { name: "Plate", id: PS, type: "Part Studio", elementType: "PARTSTUDIO", dataType: "onshape/partstudio", lengthUnits: "inch" },
  { name: "Pivot", id: ASM, type: "Assembly", elementType: "ASSEMBLY", dataType: "onshape/assembly" },
  { name: "Plate drawing", id: DRW, type: "Drawing", elementType: "APPLICATION", dataType: "onshape-app/drawing" },
];

const q = (id: string, expression: string) => ({ btType: "BTMParameterQuantity-147", parameterId: id, expression, isInteger: false });
const str = (id: string, value: string) => ({ btType: "BTMParameterString-149", parameterId: id, value });
const line = (id: string, construction = false) => ({
  btType: "BTMSketchCurveSegment-155",
  entityId: id,
  isConstruction: construction,
  startPointId: `${id}.start`,
  endPointId: `${id}.end`,
  geometry: { btType: "BTCurveGeometryLine-117", pntX: 0, pntY: 0, dirX: 1, dirY: 0 },
});
const circle = (id: string, construction = false) => ({
  btType: "BTMSketchCurve-4",
  entityId: id,
  isConstruction: construction,
  centerId: `${id}.center`,
  geometry: { btType: "BTCurveGeometryCircle-115", radius: 0.0143, xCenter: 0, yCenter: 0, xDir: 1, yDir: 0, clockwise: false },
});
const dim = (type: string, expression: string) => ({
  btType: "BTMSketchConstraint-2",
  constraintType: type,
  entityId: `${type}-${expression}`,
  parameters: [str("localFirst", "a"), { btType: "BTMParameterEnum-145", parameterId: "direction", value: "MINIMUM" }, q("length", expression)],
});
const geometric = (type: string) => ({ btType: "BTMSketchConstraint-2", constraintType: type, entityId: `${type}-c`, parameters: [str("localFirst", "a")] });

function feature(featureType: string, name: string, featureId: string, extra: Record<string, unknown> = {}) {
  return { btType: featureType === "newSketch" ? "BTMSketch-151" : "BTMFeature-134", featureType, featureId, name, suppressed: false, namespace: "", parameters: [], ...extra };
}

function featureList(features: Array<ReturnType<typeof feature>>, errors: string[] = []) {
  return {
    btType: "BTFeatureListResponse-2457",
    isComplete: true,
    serializationVersion: "1.2.12",
    sourceMicroversion: "d7a0c1e2f3b4a5c6d7e8f9a0",
    features,
    featureStates: Object.fromEntries(
      features.map((f) => [f.featureId, { btType: "BTFeatureState-1688", featureStatus: errors.includes(f.featureId) ? "ERROR" : "OK", inactive: false }]),
    ),
  };
}

const plateSketch = feature("newSketch", "Sketch 1", "FskA", {
  entities: [line("l1"), line("l2"), line("l3"), line("l4"), line("d1", true), line("d2", true)],
  constraints: [geometric("HORIZONTAL"), geometric("PERPENDICULAR"), dim("LENGTH", "6 in"), dim("LENGTH", "4 in")],
});
const thicknessVar = feature("assignVariable", "Variable 1", "FvarT", {
  parameters: [{ btType: "BTMParameterEnum-145", parameterId: "variableType", value: "LENGTH" }, str("name", "thickness"), q("lengthValue", "0.25 in")],
});
const extrude = (depth: string, id = "FexA", name = "Extrude 1") =>
  feature("extrude", name, id, { parameters: [{ btType: "BTMParameterEnum-145", parameterId: "operationType", value: "NEW" }, q("depth", depth)] });

const docRoutes = { [`GET /documents${base.replace(/\/e$/, "")}/elements`]: ELEMENTS };

async function run(check: OnshapeApiCheck, routes: Record<string, Route>, url = psUrl) {
  const fake = fakeOnshape({ ...docRoutes, ...routes });
  return { result: await runOnshapeApiCheck(fake.http, check, url, noSleep), calls: fake.calls };
}

describe("reading the pasted link", () => {
  it("parses workspace, version and bare document links and refuses other sites", () => {
    expect(parseOnshapeLink(psUrl)).toEqual({ documentId: DID, wvm: "w", wvmId: WID, elementId: PS });
    expect(parseOnshapeLink(`https://cad.onshape.com/documents/${DID}/v/${WID}/e/${PS}?renderMode=0`)?.wvm).toBe("v");
    expect(parseOnshapeLink(`https://cad.onshape.com/documents/${DID}`)).toEqual({ documentId: DID, wvm: null, wvmId: "", elementId: "" });
    expect(parseOnshapeLink("https://example.com/documents/abc")).toBeNull();
  });

  it("classifies drawings, which Onshape lists as APPLICATION elements", () => {
    expect(classifyElements(ELEMENTS).map((e) => e.tab)).toEqual(["PARTSTUDIO", "ASSEMBLY", "DRAWING"]);
  });

  it("uses the document's default workspace when the link has none", async () => {
    const fake = fakeOnshape({
      [`GET /documents/${DID}`]: { id: DID, name: "Mounting plate", defaultWorkspace: { id: WID, name: "Main" } },
      ...docRoutes,
    });
    const result = await runOnshapeApiCheck(fake.http, { kind: "onshape-tab", tab: "PARTSTUDIO", name: "Plate" }, `https://cad.onshape.com/documents/${DID}`, noSleep);
    expect(result.passed).toBe(true);
    expect(fake.calls).toContain(`GET /documents/d/${DID}/w/${WID}/elements`);
  });

  it("says plainly what to do when the link is wrong, private, or points at history", async () => {
    expect((await run({ kind: "onshape-material" }, {}, "not a link")).result.message).toMatch(/starts with https:\/\/cad.onshape.com/);
    const history = await run({ kind: "onshape-material" }, {}, `https://cad.onshape.com/documents/${DID}/m/${WID}/e/${PS}`);
    expect(history.result.message).toMatch(/older moment/);
    const forbidden = fakeOnshape({ [`GET /documents/d/${DID}/w/${WID}/elements`]: fail(403) });
    const denied = await runOnshapeApiCheck(forbidden.http, { kind: "onshape-material" }, psUrl, noSleep);
    expect(denied).toMatchObject({ passed: false });
    expect(denied.message).toMatch(/shared with the Onshape account you connected/);
  });

  it("turns 'not connected' into where to press, never an error", () => {
    expect(onshapeAccessMessage("Connect Onshape in CAD Connections before hosted CAD jobs can run.")).toMatch(/CAD → Connections, press Connect Onshape/);
    expect(onshapeAccessMessage("Onshape sign-in isn't switched on for Vantage yet.")).toMatch(/aren't switched on/);
    expect(onshapeAccessMessage("Onshape token refresh failed")).toMatch(/Reconnect Onshape/);
  });
});

describe("Your first part", () => {
  it("wants the Part Studio renamed Plate", async () => {
    expect((await run({ kind: "onshape-tab", tab: "PARTSTUDIO", name: "Plate" }, {})).result.passed).toBe(true);
    const unnamed = fakeOnshape({ [`GET /documents/d/${DID}/w/${WID}/elements`]: [{ ...ELEMENTS[0], name: "Part Studio 1" }] });
    const result = await runOnshapeApiCheck(unnamed.http, { kind: "onshape-tab", tab: "PARTSTUDIO", name: "Plate" }, psUrl, noSleep);
    expect(result.passed).toBe(false);
    expect(result.message).toBe("Not yet: the Part Studio is called “Part Studio 1”. Right-click its tab at the bottom, choose Rename, and call it “Plate”.");
  });

  it("passes a dimensioned rectangle and names what a near miss lacks", async () => {
    const check: OnshapeApiCheck = { kind: "onshape-sketch", minLines: 4, minDimensions: 2 };
    const good = await run(check, { [`GET /partstudios${base}/${PS}/features`]: featureList([plateSketch]) });
    expect(good.result).toMatchObject({ passed: true, message: "Checked: “Sketch 1” has 4 lines, 0 circles and 2 dimensions." });

    // Three real lines plus two construction diagonals, one dimension: close, not done.
    const rough = feature("newSketch", "Sketch 1", "FskA", {
      entities: [line("l1"), line("l2"), line("l3"), line("d1", true), line("d2", true)],
      constraints: [dim("LENGTH", "6 in"), { ...dim("LENGTH", "4 in"), drivenDimension: true }],
    });
    const near = await run(check, { [`GET /partstudios${base}/${PS}/features`]: featureList([rough]) });
    expect(near.result.passed).toBe(false);
    expect(near.result.message).toBe("Not yet: “Sketch 1” has 3 lines (needs 4), 1 dimension (needs 2).");
  });

  it("does not count an extrude that has an error", async () => {
    const check: OnshapeApiCheck = { kind: "onshape-part-features", expect: [{ featureType: "extrude", label: "an extrude" }] };
    const ok = await run(check, { [`GET /partstudios${base}/${PS}/features`]: featureList([plateSketch, extrude("0.25 in")]) });
    expect(ok.result.passed).toBe(true);
    const broken = await run(check, { [`GET /partstudios${base}/${PS}/features`]: featureList([plateSketch, extrude("0.25 in")], ["FexA"]) });
    expect(broken.result.passed).toBe(false);
    expect(broken.result.message).toMatch(/still needs an extrude\. “Extrude 1” has an error/);
  });

  it("wants #thickness to exist and to drive a feature", async () => {
    const check: OnshapeApiCheck = { kind: "onshape-variable", names: ["thickness"], where: "partstudio", usedInFeature: true };
    const used = await run(check, { [`GET /partstudios${base}/${PS}/features`]: featureList([thicknessVar, plateSketch, extrude("#thickness")]) });
    expect(used.result.passed).toBe(true);
    expect(used.result.evidence).toContain("“Extrude 1” uses #thickness");

    const unused = await run(check, { [`GET /partstudios${base}/${PS}/features`]: featureList([thicknessVar, plateSketch, extrude("0.25 in")]) });
    expect(unused.result.passed).toBe(false);
    expect(unused.result.message).toMatch(/#thickness exists, but no feature uses it/);

    const misnamed = await run(check, { [`GET /partstudios${base}/${PS}/features`]: featureList([{ ...thicknessVar, parameters: [str("name", "thick")] }, extrude("#thick")]) });
    expect(misnamed.result.message).toBe("Not yet: no variable called #thickness yet. Found #thick; names must match exactly.");
  });

  it("reads the material and mass, and names a part with no material", async () => {
    const parts = [{ name: "Plate", partId: "JHD", bodyType: "solid", isFlattenedBody: false, material: { id: "Aluminum_-_6061", displayName: "Aluminum - 6061", libraryName: "Onshape Material Library" } }];
    const mass = { bodies: { "-all-": { mass: [0.2641, 0.2641, 0.2641], volume: [9.83e-5, 9.83e-5, 9.83e-5], hasMass: true } }, microversionId: "x" };
    const good = await run({ kind: "onshape-material" }, { [`GET /parts${base}/${PS}`]: parts, [`GET /partstudios${base}/${PS}/massproperties`]: mass });
    expect(good.result.passed).toBe(true);
    expect(good.result.message).toBe("Checked: “Plate” is Aluminum - 6061; Onshape weighs it at 0.58 lb (0.264 kg).");

    const bare = await run({ kind: "onshape-material" }, { [`GET /parts${base}/${PS}`]: [{ ...parts[0], material: undefined }] });
    expect(bare.result.passed).toBe(false);
    expect(bare.result.message).toMatch(/“Plate” has no material\. Right-click it in the Parts list/);
    expect(bare.calls.some((c) => c.includes("massproperties"))).toBe(false);
  });
});

describe("Sheet metal", () => {
  const smStart = feature("sheetMetalStart", "Sheet metal model 1", "FsmS", { parameters: [q("thickness", "0.09 in"), q("radius", "0.09 in")] });
  const flange = feature("sheetMetalFlange", "Flange 1", "FsmF", { parameters: [q("distance", "1.5 in")] });
  const flatParts = [
    { name: "Part 1", partId: "JHD", bodyType: "solid", isFlattenedBody: false, material: { displayName: "Aluminum - 5052" } },
    { name: "Part 1", partId: "JHH", bodyType: "sheet", isFlattenedBody: true, unflattenedPartId: "JHD" },
  ];

  it("passes when Onshape reports a flat pattern for the sheet metal part", async () => {
    const { result, calls } = await run({ kind: "onshape-flat-pattern" }, {
      [`GET /partstudios${base}/${PS}/features`]: featureList([plateSketch, smStart, flange]),
      [`GET /parts${base}/${PS}?includeFlatParts=true`]: flatParts,
    });
    expect(result).toMatchObject({ passed: true, message: "Checked: Onshape has a flat pattern for “Part 1”." });
    expect(calls).toContain(`GET /parts${base}/${PS}?includeFlatParts=true`);
  });

  it("fails a plain extruded part and a flange with an error", async () => {
    const plain = await run({ kind: "onshape-flat-pattern" }, {
      [`GET /partstudios${base}/${PS}/features`]: featureList([plateSketch, extrude("0.09 in")]),
      [`GET /parts${base}/${PS}?includeFlatParts=true`]: [flatParts[0]],
    });
    expect(plain.result.message).toMatch(/no Sheet metal model/);
    const broken = await run({ kind: "onshape-flat-pattern" }, {
      [`GET /partstudios${base}/${PS}/features`]: featureList([plateSketch, smStart, flange], ["FsmF"]),
      [`GET /parts${base}/${PS}?includeFlatParts=true`]: flatParts,
    });
    expect(broken.result.passed).toBe(false);
    expect(broken.result.message).toMatch(/“Flange 1” has an error/);
  });
});

describe("Assemblies", () => {
  const instance = (id: string, name: string, documentId = DID, standard = false) => ({
    id,
    name,
    type: "Part",
    documentId,
    elementId: PS,
    partId: "JHD",
    isStandardContent: standard,
    suppressed: false,
    configuration: "default",
    fullConfiguration: "default",
    documentMicroversion: "5b0d3f8e2c1a4b7d9e6f0a1b",
  });
  const definition = (instances: unknown[], fixed: boolean[]) => ({
    rootAssembly: {
      documentId: DID,
      elementId: ASM,
      instances,
      occurrences: fixed.map((f, i) => ({ path: [`M${i}`], fixed: f, hidden: false, transform: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] })),
      features: [],
      patterns: [],
    },
    subAssemblies: [],
    parts: [],
    partStudioFeatures: [],
  });
  const mate = (id: string, name: string, mateType: string) => ({
    btType: "BTMMate-64",
    featureType: "mate",
    featureId: id,
    name,
    suppressed: false,
    mateType,
    parameters: [{ btType: "BTMParameterEnum-145", parameterId: "mateType", enumName: "Mate type", value: mateType }],
  });
  const mates = (list: unknown[], errors: string[] = []) => ({
    btType: "BTAssemblyFeatureListResponse-1174",
    features: [{ btType: "BTMMateConnector-66", featureType: "mateConnector", featureId: "MC1", name: "Mate connector 1" }, ...list],
    featureStates: Object.fromEntries((list as Array<{ featureId: string }>).map((m) => [m.featureId, { featureStatus: errors.includes(m.featureId) ? "ERROR" : "OK" }])),
  });
  const pivot: OnshapeApiCheck = {
    kind: "onshape-assembly",
    minInstances: 3,
    standardContent: 1,
    mates: [
      { mateType: "REVOLUTE", label: "a Revolute mate" },
      { mateType: "FASTENED", label: "a Fastened mate" },
    ],
  };
  const three = [instance("Ma", "Plate <1>"), instance("Mb", "Plate <2>"), instance("Mc", "Socket Head Cap Screw <1>", STD_DOC, true)];

  it("passes a pivot with a Revolute mate, a Fastened bolt and Standard content", async () => {
    const { result, calls } = await run(pivot, {
      [`GET /assemblies${base}/${ASM}?includeMateFeatures=true`]: definition(three, [true, false, false]),
      [`GET /assemblies${base}/${ASM}/features`]: mates([mate("m1", "Revolute 1", "REVOLUTE"), mate("m2", "Fastened 1", "FASTENED")]),
    }, asmUrl);
    expect(result.passed).toBe(true);
    expect(result.message).toBe("Checked: 3 instances; 1 from Standard content; mates: 1 Revolute, 1 Fastened.");
    expect(calls.every((c) => c.startsWith("GET "))).toBe(true);
  });

  it("names the missing mate, a broken one, and a missing fix", async () => {
    const onlyFastened = await run(pivot, {
      [`GET /assemblies${base}/${ASM}?includeMateFeatures=true`]: definition(three, [true, false, false]),
      [`GET /assemblies${base}/${ASM}/features`]: mates([mate("m2", "Fastened 1", "FASTENED")]),
    }, asmUrl);
    expect(onlyFastened.result.message).toBe("Not yet: a Revolute mate is missing. Mates found: 1 Fastened.");

    const broken = await run(pivot, {
      [`GET /assemblies${base}/${ASM}?includeMateFeatures=true`]: definition(three, [true, false, false]),
      [`GET /assemblies${base}/${ASM}/features`]: mates([mate("m1", "Revolute 1", "REVOLUTE"), mate("m2", "Fastened 1", "FASTENED")], ["m1"]),
    }, asmUrl);
    expect(broken.result.message).toMatch(/“Revolute 1” has an error/);

    const loose = await run({ kind: "onshape-assembly", minInstances: 2, needsFixed: true }, {
      [`GET /assemblies${base}/${ASM}?includeMateFeatures=true`]: definition(three.slice(0, 2), [false, false]),
      [`GET /assemblies${base}/${ASM}/features`]: mates([]),
    }, asmUrl);
    expect(loose.result.message).toBe("Not yet: nothing is fixed. Right-click the part that should stay still and choose Fix.");
  });

  it("finds the Assembly when the Part Studio's link was pasted, and falls back to the definition's mate data", async () => {
    const { result } = await run({ kind: "onshape-assembly", minInstances: 1, mates: [{ mateType: "REVOLUTE", label: "a Revolute mate" }] }, {
      [`GET /assemblies${base}/${ASM}?includeMateFeatures=true`]: {
        ...definition(three, [true]),
        rootAssembly: { ...definition(three, [true]).rootAssembly, features: [{ id: "m1", featureType: "mate", suppressed: false, featureData: { name: "Revolute 1", mateType: "REVOLUTE" } }] },
      },
      [`GET /assemblies${base}/${ASM}/features`]: fail(500),
    });
    expect(result.passed).toBe(true);
    expect(result.evidence?.[0]).toBe("Read “Pivot”");
  });

  it("counts parts from other documents (a parts library) apart from Standard content", async () => {
    const check: OnshapeApiCheck = { kind: "onshape-assembly", minInstances: 1, fromOtherDocuments: 1 };
    const withMotor = await run(check, {
      [`GET /assemblies${base}/${ASM}?includeMateFeatures=true`]: definition([instance("Mk", "Kraken X60 <1>", MKCAD_DOC)], [false]),
      [`GET /assemblies${base}/${ASM}/features`]: mates([]),
    }, asmUrl);
    expect(withMotor.result.passed).toBe(true);
    const boltsOnly = await run(check, {
      [`GET /assemblies${base}/${ASM}?includeMateFeatures=true`]: definition([instance("Mc", "Socket Head Cap Screw <1>", STD_DOC, true)], [false]),
      [`GET /assemblies${base}/${ASM}/features`]: mates([]),
    }, asmUrl);
    expect(boltsOnly.result.passed).toBe(false);
    expect(boltsOnly.result.message).toMatch(/every part in this Assembly comes from this document/);
  });

  it("asks which Assembly when there are several and none was pasted", async () => {
    const two = fakeOnshape({
      [`GET /documents/d/${DID}/w/${WID}/elements`]: [ELEMENTS[0], ELEMENTS[1], { ...ELEMENTS[1], id: "9999999999999999eeeeeeee", name: "Arm" }],
    });
    const result = await runOnshapeApiCheck(two.http, { kind: "onshape-assembly", minInstances: 1 }, psUrl, noSleep);
    expect(result.message).toBe("This document has 2 Assembly tabs (“Pivot”, “Arm”). Open the one for this step and copy its address.");
  });
});

describe("Drawings", () => {
  const views = (n: number) => ({ items: Array.from({ length: n }, (_, i) => ({ viewId: `v${i}`, changeId: "c", viewDirection: [0, 0, 1] })) });
  const drawingJson = (live: number, dangling: number) => ({
    sheets: [
      {
        name: "Sheet1",
        views: [{ viewId: "v0", viewType: "TopLevel" }],
        annotations: [
          ...Array.from({ length: live }, (_, i) => ({ type: "Onshape::Dimension::LineToLine", lineToLineDimension: { logicalId: `h:${i}`, isDangling: false } })),
          ...Array.from({ length: dangling }, (_, i) => ({ type: "Onshape::Dimension::PointToLine", pointToLineDimension: { logicalId: `h:d${i}`, isDangling: true } })),
          { type: "Onshape::Note", note: { contents: "{\\pxql;BREAK ALL EDGES}", isDangling: false } },
        ],
      },
    ],
  });
  const exportRoutes = (json: unknown, states = ["ACTIVE", "DONE"]) => {
    let poll = 0;
    return {
      [`POST /drawings${base}/${DRW}/translations`]: (init?: RequestInit) => {
        expect(JSON.parse(String(init?.body))).toEqual({ formatName: "DRAWING_JSON", storeInDocument: false });
        return { requestState: "ACTIVE", id: "tr1", href: "https://cad.onshape.com/api/v6/translations/tr1", resultExternalDataIds: null, documentId: DID };
      },
      "GET /translations/tr1": () => {
        const state = states[Math.min(poll++, states.length - 1)];
        return { requestState: state, id: "tr1", resultExternalDataIds: state === "DONE" ? ["ext1"] : null, failureReason: null };
      },
      [`GET /documents/d/${DID}/externaldata/ext1`]: json,
    };
  };

  it("counts views, then exports the drawing to count dimensions that are still attached", async () => {
    const check: OnshapeApiCheck = { kind: "onshape-drawing", minViews: 3, minDimensions: 4 };
    const good = await run(check, { [`GET /drawings${base}/${DRW}/views`]: views(3), ...exportRoutes(drawingJson(4, 1)) }, drwUrl);
    expect(good.result).toMatchObject({ passed: true, message: "Checked: the drawing has 3 views and 4 dimensions." });

    const near = await run(check, { [`GET /drawings${base}/${DRW}/views`]: views(3), ...exportRoutes(drawingJson(3, 1)) }, drwUrl);
    expect(near.result.passed).toBe(false);
    expect(near.result.message).toMatch(/^Not yet: the drawing has 3 dimensions; this step needs 4\. 1 dimension lost its edge/);
  });

  it("stops at the views when there are too few, and says so when Onshape is still exporting", async () => {
    const oneView = await run({ kind: "onshape-drawing", minViews: 3, minDimensions: 4 }, { [`GET /drawings${base}/${DRW}/views`]: views(1) }, drwUrl);
    expect(oneView.result.message).toMatch(/has 1 view; this step needs 3/);
    expect(oneView.calls.some((c) => c.startsWith("POST"))).toBe(false);

    const slow = await run({ kind: "onshape-drawing", minViews: 3, minDimensions: 4 }, { [`GET /drawings${base}/${DRW}/views`]: views(3), ...exportRoutes(drawingJson(4, 0), ["ACTIVE"]) }, drwUrl);
    expect(slow.result.message).toMatch(/still reading your drawing/);
  });

  it("counts only Onshape::Dimension annotations", () => {
    expect(countDrawingDimensions(drawingJson(2, 3))).toEqual({ live: 2, dangling: 3 });
  });
});

describe("Belt layout", () => {
  const variables = ["driverPD", "drivenPD", "centerDistance"].map((name, i) =>
    feature("assignVariable", `Variable ${i + 1}`, `Fv${i}`, { parameters: [str("name", name), q("lengthValue", "1 in")] }),
  );
  const layout = feature("newSketch", "Sketch 1", "FskL", {
    entities: [circle("c1", true), circle("c2", true), line("belt1"), line("belt2")],
    constraints: [dim("DIAMETER", "#driverPD"), dim("DIAMETER", "#drivenPD"), dim("DISTANCE", "#centerDistance"), geometric("TANGENT")],
  });
  const configured = {
    ...variables[2]!,
    parameters: [str("name", "centerDistance"), { btType: "BTMParameterConfigured-2222", parameterId: "lengthValue", configurationParameterId: "List_bQ1", values: [] }],
  };
  const config = (rows: string[]) => ({
    btType: "BTConfigurationResponse-2019",
    configurationParameters: [
      {
        btType: "BTMConfigurationParameterEnum-105",
        parameterId: "List_bQ1",
        parameterName: "Belt",
        defaultValue: "Default",
        options: rows.map((name, i) => ({ btType: "BTMEnumOption-592", option: i === 0 ? "Default" : `_${name.replace(/\W+/g, "_")}`, optionName: name })),
      },
    ],
    currentConfiguration: [],
  });

  it("wants the pitch circles driven by all three variables", async () => {
    const check: OnshapeApiCheck = { kind: "onshape-sketch", minCircles: 2, usesVariables: ["driverPD", "drivenPD", "centerDistance"] };
    const good = await run(check, { [`GET /partstudios${base}/${PS}/features`]: featureList([...variables, layout]) });
    expect(good.result.passed).toBe(true);
    const typed = { ...layout, constraints: [dim("DIAMETER", "#driverPD"), dim("DIAMETER", "#drivenPD"), dim("DISTANCE", "5.186 in")] };
    const near = await run(check, { [`GET /partstudios${base}/${PS}/features`]: featureList([...variables, typed]) });
    expect(near.result.message).toBe("Not yet: “Sketch 1” has no dimension set to #centerDistance.");
    expect(referencesVariable("#centerDistance2", "centerDistance")).toBe(false);
  });

  it("wants a Belt list with two rows that changes #centerDistance", async () => {
    const check: OnshapeApiCheck = { kind: "onshape-configuration", minOptions: 2, configuresVariable: "centerDistance" };
    const good = await run(check, {
      [`GET /elements${base}/${PS}/configuration`]: config(["80T (400 mm)", "90T (450 mm)"]),
      [`GET /elements${base}/${ASM}/configuration`]: { configurationParameters: [] },
      [`GET /partstudios${base}/${PS}/features`]: featureList([variables[0]!, variables[1]!, configured, layout]),
    });
    expect(good.result).toMatchObject({ passed: true, message: "Checked: the list “Belt” has 2 rows (80T (400 mm), 90T (450 mm)) and sets #centerDistance." });

    const notWired = await run(check, {
      [`GET /elements${base}/${PS}/configuration`]: config(["80T (400 mm)", "90T (450 mm)"]),
      [`GET /partstudios${base}/${PS}/features`]: featureList([...variables, layout]),
    });
    expect(notWired.result.message).toMatch(/#centerDistance doesn't change with it/);

    const oneRow = await run(check, { [`GET /elements${base}/${PS}/configuration`]: config(["80T (400 mm)"]) });
    expect(oneRow.result.message).toMatch(/has 1 row; this step needs 2/);
  });

  it("rebuilds every belt row and names the one that breaks", async () => {
    const check: OnshapeApiCheck = { kind: "onshape-rebuild", minFeatures: 5, everyConfiguration: true };
    const all = [...variables, layout, extrude("0.25 in", "FexP", "Plate")];
    const routes = {
      [`GET /partstudios${base}/${PS}/features`]: featureList(all),
      [`GET /elements${base}/${PS}/configuration`]: config(["80T (400 mm)", "90T (450 mm)"]),
      [`GET /partstudios${base}/${PS}/features?configuration=${encodeURIComponent("List_bQ1=Default")}`]: featureList(all),
    };
    const good = await run(check, { ...routes, [`GET /partstudios${base}/${PS}/features?configuration=${encodeURIComponent("List_bQ1=_90T_450_mm_")}`]: featureList(all) });
    expect(good.result.message).toBe("Checked: the Part Studio rebuilds with no errors in every row of “Belt” (80T (400 mm), 90T (450 mm)).");
    const bad = await run(check, { ...routes, [`GET /partstudios${base}/${PS}/features?configuration=${encodeURIComponent("List_bQ1=_90T_450_mm_")}`]: featureList(all, ["FexP"]) });
    expect(bad.result.passed).toBe(false);
    expect(bad.result.message).toBe("Not yet: with “Belt” set to “90T (450 mm)”, “Plate” has an error. Pick that row in the Configuration panel, fix it, then check again.");
  });
});

describe("Onshape track content", () => {
  it("covers zero to robot CAD, and every step after connecting reads the student's document", () => {
    expect(ONSHAPE_TRACKS.map((t) => t.id)).toEqual([
      "onshape-first-part",
      "onshape-first-assembly",
      "onshape-sheet-metal",
      "onshape-drawing",
      "onshape-cots",
      "onshape-belt-layout",
    ]);
    for (const track of ONSHAPE_TRACKS) {
      expect(track.steps[0]!.check.kind, `${track.id} starts by connecting`).toBe("onshape-connected");
      for (const step of track.steps.slice(1)) {
        expect(isOnshapeApiCheck(step.check), `${track.id}/${step.id} reads Onshape`).toBe(true);
        expect(step.do.length, `${track.id}/${step.id} says what to click`).toBeGreaterThan(0);
        expect(step.checkedBy, `${track.id}/${step.id} says what Vantage checks`).toMatch(/Vantage/);
      }
    }
  });

  it("keeps words a student knows out of the API's jargon", () => {
    const words = JSON.stringify(ONSHAPE_TRACKS.map((t) => [t.title, t.summary, t.steps.map((s) => [s.title, s.why, s.do, s.checkedBy])]));
    expect(words).not.toMatch(/featureType|API|endpoint|payload|schema|JSON response|\borg\b/);
  });
});

describe("links checked before Onshape is asked", () => {
  it("names an empty, foreign or history link without a network call", () => {
    expect(onshapeLinkProblem("")).toMatch(/Paste the address/);
    expect(onshapeLinkProblem("https://example.com/x")).toMatch(/isn't an Onshape document address/);
    expect(onshapeLinkProblem(`https://cad.onshape.com/documents/${DID}/m/${WID}/e/${PS}`)).toMatch(/older moment/);
    expect(onshapeLinkProblem(psUrl)).toBeNull();
  });
});
