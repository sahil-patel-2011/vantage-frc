/**
 * Onshape checks for the guided CAD tracks.
 *
 * Every check here reads the student's own document through the Onshape REST API (their own
 * connection, read-only calls) and passes only when the thing the step asked for is really
 * there. Nothing is guessed: a feature with an error does not count, a suppressed one does not
 * count, and when Onshape cannot be read the message says why and what to do.
 *
 * Endpoints used (Onshape REST API, see cad.onshape.com/glassworks/explorer):
 *   GET  /documents/{did}                                         default workspace
 *   GET  /documents/d/{did}/{wvm}/{wvmid}/elements                the document's tabs
 *   GET  /partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/features      feature list + featureStates
 *   GET  /partstudios/d/{did}/{wvm}/{wvmid}/e/{eid}/massproperties
 *   GET  /parts/d/{did}/{wvm}/{wvmid}/e/{eid}[?includeFlatParts=true]
 *   GET  /variables/d/{did}/{wv}/{wvid}/e/{eid}/variables          Variable Studio tables
 *   GET  /elements/d/{did}/{wvm}/{wvmid}/e/{eid}/configuration
 *   GET  /assemblies/d/{did}/{wvm}/{wvmid}/e/{eid}                 definition (instances, fixed)
 *   GET  /assemblies/d/{did}/{wvm}/{wvmid}/e/{eid}/features        mates and relations
 *   GET  /drawings/d/{did}/{wvm}/{wvmid}/e/{eid}/views
 *   POST /drawings/d/{did}/{wv}/{wvid}/e/{eid}/translations        DRAWING_JSON, not stored in the document
 *   GET  /translations/{tid}, GET /documents/d/{did}/externaldata/{fid}
 *
 * This file has no runtime imports beyond the pure feature counter, so the track page (a Client
 * Component) can import the input labels without pulling server code into the browser.
 */
import { checkFeatures } from "./checks";
import type { CheckResult, FeatureExpectation } from "./types";

/** Same shape as @vantage/cad's OnshapeHttp: a path under /api/vN plus fetch options. */
export type OnshapeFetch = (path: string, init?: RequestInit) => Promise<Response>;

export type OnshapeTabType = "PARTSTUDIO" | "ASSEMBLY" | "DRAWING" | "VARIABLESTUDIO";

export type MateExpectation = {
  /** Onshape mate type: FASTENED, REVOLUTE, SLIDER, CYLINDRICAL, PIN_SLOT, PLANAR, BALL, PARALLEL. */
  mateType: string;
  min?: number;
  /** Plain words: "a Revolute mate". */
  label: string;
};

export type OnshapeApiCheck =
  /** The document has a tab of this type (optionally with this name). */
  | { kind: "onshape-tab"; tab: OnshapeTabType; name?: string }
  /** Counts live, error-free features in a Part Studio (featureType from the features list). */
  | { kind: "onshape-part-features"; expect: FeatureExpectation[]; anyOf?: boolean }
  /** One sketch that has enough lines, circles and dimensions, optionally driven by variables. */
  | { kind: "onshape-sketch"; minLines?: number; minCircles?: number; minDimensions?: number; usesVariables?: string[] }
  /** Variables with these names exist (Variable features or a Variable Studio); optionally used by a feature. */
  | { kind: "onshape-variable"; names: string[]; where: "partstudio" | "variablestudio" | "either"; usedInFeature?: boolean }
  /** Every solid part has a material, and Onshape reports a mass. */
  | { kind: "onshape-material" }
  /** A Sheet metal model whose flat pattern Onshape reports. */
  | { kind: "onshape-flat-pattern" }
  /** Reads an Assembly: instances, fixed parts, mates, relations, parts from other documents, standard content. */
  | {
      kind: "onshape-assembly";
      minInstances?: number;
      needsFixed?: boolean;
      mates?: MateExpectation[];
      relations?: MateExpectation[];
      fromOtherDocuments?: number;
      standardContent?: number;
    }
  /** A Drawing with enough views (and dimensions, read from Onshape's JSON export of the drawing). */
  | { kind: "onshape-drawing"; minViews: number; minDimensions?: number }
  /** A List configuration with enough rows; optionally a Variable whose value it configures. */
  | { kind: "onshape-configuration"; minOptions: number; configuresVariable?: string }
  /** The Part Studio rebuilds with no errors (in every row of its first List configuration, if asked). */
  | { kind: "onshape-rebuild"; minFeatures: number; everyConfiguration?: boolean };

export type OnshapeApiKind = OnshapeApiCheck["kind"];

const API_KINDS: ReadonlySet<string> = new Set<OnshapeApiKind>([
  "onshape-tab",
  "onshape-part-features",
  "onshape-sketch",
  "onshape-variable",
  "onshape-material",
  "onshape-flat-pattern",
  "onshape-assembly",
  "onshape-drawing",
  "onshape-configuration",
  "onshape-rebuild",
]);

export function isOnshapeApiCheck(check: { kind: string }): check is OnshapeApiCheck {
  return API_KINDS.has(check.kind);
}

const TAB_WORDS: Record<OnshapeTabType, string> = {
  PARTSTUDIO: "Part Studio",
  ASSEMBLY: "Assembly",
  DRAWING: "Drawing",
  VARIABLESTUDIO: "Variable Studio",
};

const TAB_CREATE_HINT: Record<OnshapeTabType, string> = {
  PARTSTUDIO: "Press + at the bottom-left of Onshape and choose Create Part Studio.",
  ASSEMBLY: "Press + at the bottom-left of Onshape and choose Create Assembly.",
  DRAWING: "In the Part Studio, right-click the part in the Parts list and choose Create drawing of …",
  VARIABLESTUDIO: "Press + at the bottom-left of Onshape and choose Create Variable Studio.",
};

/** Which tab the student should paste for a check, in words for the input label. */
export function onshapeInputLabel(kind: string): string {
  switch (kind) {
    case "onshape-assembly":
      return "Your Assembly's address";
    case "onshape-drawing":
      return "Your Drawing's address";
    case "onshape-tab":
      return "Your document's address (any tab)";
    default:
      return "Your Part Studio's address";
  }
}

/* ------------------------------------------------------------------ small helpers */

type Json = Record<string, unknown>;

const asRecord = (value: unknown): Json | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : null;
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string => (typeof value === "string" ? value : value == null ? "" : String(value));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const quote = (name: string) => `“${name}”`;
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `#name` in an Onshape expression, not `#name2`. Onshape names are letters, digits and _. */
export function referencesVariable(expression: string, name: string): boolean {
  return new RegExp(`#${escapeRegExp(name)}(?![A-Za-z0-9_])`, "i").test(expression);
}

type Got = { ok: true; body: unknown } | { ok: false; status: number };

async function getJson(http: OnshapeFetch, path: string, init?: RequestInit): Promise<Got> {
  let response: Response;
  try {
    response = await http(path, init);
  } catch {
    return { ok: false, status: 0 };
  }
  if (!response.ok) return { ok: false, status: response.status };
  try {
    const raw = await response.text();
    return { ok: true, body: raw ? (JSON.parse(raw) as unknown) : null };
  } catch {
    return { ok: false, status: -1 };
  }
}

/** Why Onshape could not be read, in words a student can act on. */
export function onshapeTrouble(status: number, what: string): CheckResult {
  const message =
    status === 0
      ? "Vantage couldn't reach Onshape just now. Check again in a minute."
      : status === 401
        ? "Onshape asked Vantage to sign in again. Open CAD → Connections, press Reconnect Onshape, then check again."
        : status === 403
          ? `Onshape wouldn't let Vantage open this ${what}. Use a document you own, or one shared with the Onshape account you connected.`
          : status === 404
            ? `Onshape couldn't find that ${what}. Open the tab in Onshape and copy the address again.`
            : status === 429
              ? "Onshape is limiting checks right now. Wait a minute, then check again."
              : status === -1
                ? `Onshape sent back something Vantage couldn't read for this ${what}. Check again in a minute.`
                : `Onshape answered with an error (${status}) for this ${what}. Check again in a minute.`;
  return { passed: false, message };
}

/**
 * Turns "not connected" into plain steps. The underlying loader's sentences talk about hosted
 * jobs; a student on a lesson page needs to know where to press.
 */
export function onshapeAccessMessage(raw: string): string {
  if (/switched on|isn't ready|not available|not configured/i.test(raw)) {
    return "Onshape connections aren't switched on for Vantage yet, so this step can't be checked here. Keep working in Onshape; the check will work once they are.";
  }
  if (/connect/i.test(raw) || !raw.trim()) {
    return "Vantage can't see your Onshape yet. Open CAD → Connections, press Connect Onshape and approve it, then come back and press Check.";
  }
  // Expired or unreadable tokens: the fix is the same button, and the raw error means nothing to a student.
  return "Vantage couldn't use your Onshape connection. Open CAD → Connections, press Reconnect Onshape, then check again.";
}

/* ------------------------------------------------------------------ the pasted link */

export type OnshapeLink = { documentId: string; wvm: "w" | "v" | "m" | null; wvmId: string; elementId: string };

const LINK_RE = /onshape\.com\/documents\/(?:d\/)?([0-9a-f]{16,32})(?:\/([wvm])\/([0-9a-f]{16,32}))?(?:\/e\/([0-9a-f]{16,32}))?/i;

export function parseOnshapeLink(input: string): OnshapeLink | null {
  const match = LINK_RE.exec(input.trim());
  if (!match) return null;
  return {
    documentId: match[1]!.toLowerCase(),
    wvm: (match[2]?.toLowerCase() as OnshapeLink["wvm"]) ?? null,
    wvmId: (match[3] ?? "").toLowerCase(),
    elementId: (match[4] ?? "").toLowerCase(),
  };
}

export type ElementRow = { id: string; name: string; tab: OnshapeTabType | "OTHER" };

/** Onshape's elements list. Drawings are APPLICATION elements whose dataType names a drawing. */
export function classifyElements(body: unknown): ElementRow[] {
  const items = Array.isArray(body) ? body : asArray(asRecord(body)?.items);
  return items.flatMap((item) => {
    const row = asRecord(item);
    if (!row?.id) return [];
    const type = text(row.elementType).toUpperCase();
    const hint = `${text(row.dataType)} ${text(row.type)} ${text(row.prettyType)}`;
    const tab: ElementRow["tab"] =
      type === "PARTSTUDIO" || type === "ASSEMBLY" || type === "VARIABLESTUDIO" || type === "DRAWING"
        ? type
        : type === "APPLICATION" && /drawing/i.test(hint)
          ? "DRAWING"
          : "OTHER";
    return [{ id: text(row.id).toLowerCase(), name: text(row.name) || "Untitled", tab }];
  });
}

export type Located = { documentId: string; wvm: "w" | "v"; wvmId: string; pastedElementId: string; elements: ElementRow[] };

type Outcome<T> = { ok: true; value: T } | { ok: false; result: CheckResult };

/** Reads the document behind a pasted link: which workspace, and every tab in it. */
export async function locateDocument(http: OnshapeFetch, raw: string): Promise<Outcome<Located>> {
  const link = parseOnshapeLink(raw);
  if (!link) {
    return {
      ok: false,
      result: { passed: false, message: "Paste the address of your Onshape tab from the browser. It starts with https://cad.onshape.com/documents/." },
    };
  }
  if (link.wvm === "m") {
    return {
      ok: false,
      result: {
        passed: false,
        message: "That link points at an older moment in the document's history. Open the document normally in Onshape and copy the address again.",
      },
    };
  }
  let wvm: "w" | "v" = link.wvm ?? "w";
  let wvmId = link.wvmId;
  if (!wvmId) {
    const doc = await getJson(http, `/documents/${link.documentId}`);
    if (!doc.ok) return { ok: false, result: onshapeTrouble(doc.status, "document") };
    wvmId = text(asRecord(asRecord(doc.body)?.defaultWorkspace)?.id).toLowerCase();
    wvm = "w";
    if (!wvmId) {
      return { ok: false, result: { passed: false, message: "Onshape didn't say which workspace to read. Open the document and copy the address again." } };
    }
  }
  const list = await getJson(http, `/documents/d/${link.documentId}/${wvm}/${wvmId}/elements`);
  if (!list.ok) return { ok: false, result: onshapeTrouble(list.status, "document") };
  return { ok: true, value: { documentId: link.documentId, wvm, wvmId, pastedElementId: link.elementId, elements: classifyElements(list.body) } };
}

/**
 * The tab a check should read. The pasted tab wins when it is the right type; otherwise the only
 * tab of that type; with several, the one with the wanted name; otherwise the student is asked
 * to open the right one.
 */
export function pickTab(where: Located, want: OnshapeTabType, name?: string): Outcome<{ row: ElementRow; note?: string }> {
  const candidates = where.elements.filter((row) => row.tab === want);
  const word = TAB_WORDS[want];
  if (candidates.length === 0) {
    return { ok: false, result: { passed: false, message: `Not yet: this document has no ${word} tab. ${TAB_CREATE_HINT[want]}` } };
  }
  const pasted = candidates.find((row) => row.id === where.pastedElementId);
  const named = name ? candidates.find((row) => sameName(row.name, name)) : undefined;
  const row = pasted ?? named ?? (candidates.length === 1 ? candidates[0] : undefined);
  if (!row) {
    return {
      ok: false,
      result: {
        passed: false,
        message: `This document has ${candidates.length} ${word} tabs (${candidates.map((c) => quote(c.name)).join(", ")}). Open the one for this step and copy its address.`,
      },
    };
  }
  const note = row.id === where.pastedElementId ? undefined : `Read the ${word} tab ${quote(row.name)} in this document.`;
  return { ok: true, value: { row, note } };
}

const elementPath = (prefix: string, where: Located, elementId: string) =>
  `/${prefix}/d/${where.documentId}/${where.wvm}/${where.wvmId}/e/${elementId}`;

/* ------------------------------------------------------------------ Part Studio features */

export type FeatureNode = {
  id: string;
  name: string;
  featureType: string;
  suppressed: boolean;
  /** OK, INFO, WARNING, ERROR or UNKNOWN from featureStates. */
  status: string;
  raw: Json;
};

/** Normalises a features response (current flat shape, or the older `message` wrapper). */
export function readFeatureList(body: unknown): FeatureNode[] {
  const root = asRecord(body);
  const states = new Map<string, string>();
  const rawStates = root?.featureStates;
  if (Array.isArray(rawStates)) {
    for (const entry of rawStates) {
      const row = asRecord(entry);
      const value = asRecord(asRecord(row?.value)?.message ?? row?.value);
      if (row?.key) states.set(text(row.key), text(value?.featureStatus));
    }
  } else if (asRecord(rawStates)) {
    for (const [key, value] of Object.entries(asRecord(rawStates)!)) {
      const state = asRecord(asRecord(value)?.message ?? value);
      states.set(key, text(state?.featureStatus));
    }
  }
  return asArray(root?.features).flatMap((entry) => {
    const outer = asRecord(entry);
    const feature = asRecord(outer?.message) ?? outer;
    if (!feature) return [];
    const id = text(feature.featureId ?? feature.nodeId ?? outer?.featureId);
    return [
      {
        id,
        name: text(feature.name) || "Feature",
        featureType: text(feature.featureType ?? outer?.typeName),
        suppressed: feature.suppressed === true,
        status: (states.get(id) || "OK").toUpperCase(),
        raw: feature,
      },
    ];
  });
}

const liveFeatures = (features: FeatureNode[]) => features.filter((f) => !f.suppressed && f.status !== "ERROR");
const erroredFeatures = (features: FeatureNode[]) => features.filter((f) => !f.suppressed && f.status === "ERROR");

/** Every string `expression` anywhere under a node (feature parameters, sketch dimensions). */
export function collectExpressions(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const item of node) collectExpressions(item, out);
  } else if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node as Json)) {
      if (key === "expression" && typeof value === "string") out.push(value);
      else if (value && typeof value === "object") collectExpressions(value, out);
    }
  }
  return out;
}

function parameter(feature: Json, id: string): Json | null {
  return (asArray(feature.parameters).map(asRecord).find((p) => p && text(p.parameterId) === id) as Json | undefined) ?? null;
}

/** A Variable feature's name (parameter "name"). */
export function variableFeatureName(feature: FeatureNode): string {
  const param = parameter(feature.raw, "name");
  return text(param?.value).trim();
}

/** Counts features the same way the first track always has, leaving out errored ones. */
export function checkPartFeatures(features: FeatureNode[], expect: FeatureExpectation[], anyOf = false): CheckResult {
  const live = liveFeatures(features);
  const result = checkFeatures(
    live.map((f) => ({ featureType: f.featureType, name: f.name })),
    expect,
    anyOf,
  );
  const suppressed = features.filter((f) => f.suppressed).length;
  const errored = erroredFeatures(features);
  const evidence = [...(result.evidence ?? [])];
  if (suppressed) evidence.push(`${plural(suppressed, "suppressed feature")} not counted`);
  if (errored.length) evidence.push(`Not counted because of an error: ${errored.map((f) => quote(f.name)).join(", ")}`);
  if (result.passed) return { ...result, evidence };
  const wanted = new Set(expect.map((e) => e.featureType));
  const brokenWanted = errored.filter((f) => wanted.has(f.featureType));
  const message = brokenWanted.length
    ? `${result.message} ${quote(brokenWanted[0]!.name)} has an error (it's red in the feature list), so it doesn't count. Fix it, then check again.`
    : result.message;
  return { passed: false, message, evidence };
}

/* ------------------------------------------------------------------ sketches */

export type SketchStats = { name: string; lines: number; circles: number; dimensions: number; expressions: string[] };

/** Lines and circles that are real geometry, and dimensions the student typed (not driven ones). */
export function sketchStats(feature: FeatureNode): SketchStats {
  let lines = 0;
  let circles = 0;
  for (const entry of asArray(feature.raw.entities)) {
    const entity = asRecord(entry);
    if (!entity) continue;
    const bt = text(entity.btType);
    const geometry = text(asRecord(entity.geometry)?.btType);
    if (bt.startsWith("BTMSketchCurveSegment") && /Line/i.test(geometry) && entity.isConstruction !== true) lines += 1;
    else if (bt.startsWith("BTMSketchCurve-") && /Circle/i.test(geometry)) circles += 1;
  }
  let dimensions = 0;
  for (const entry of asArray(feature.raw.constraints)) {
    const constraint = asRecord(entry);
    if (!constraint || constraint.drivenDimension === true) continue;
    const hasValue = asArray(constraint.parameters).some((p) => {
      const param = asRecord(p);
      return Boolean(param && text(param.btType).startsWith("BTMParameterQuantity") && text(param.expression).trim());
    });
    if (hasValue) dimensions += 1;
  }
  return { name: feature.name, lines, circles, dimensions, expressions: collectExpressions(feature.raw.constraints) };
}

export function checkSketch(
  features: FeatureNode[],
  want: { minLines?: number; minCircles?: number; minDimensions?: number; usesVariables?: string[] },
): CheckResult {
  const sketches = liveFeatures(features).filter((f) => f.featureType === "newSketch").map(sketchStats);
  const broken = erroredFeatures(features).filter((f) => f.featureType === "newSketch");
  if (sketches.length === 0) {
    return {
      passed: false,
      message: broken.length
        ? `Not yet: ${quote(broken[0]!.name)} has an error (it's red in the feature list). Fix it, then check again.`
        : "Not yet: this Part Studio has no sketch. Press Sketch, click a plane, draw, then press the green check.",
    };
  }
  const variables = want.usesVariables ?? [];
  const shortfalls = (s: SketchStats) => {
    const missing: string[] = [];
    if ((want.minLines ?? 0) > s.lines) missing.push(`${plural(s.lines, "line")} (needs ${want.minLines})`);
    if ((want.minCircles ?? 0) > s.circles) missing.push(`${plural(s.circles, "circle")} (needs ${want.minCircles})`);
    if ((want.minDimensions ?? 0) > s.dimensions) missing.push(`${plural(s.dimensions, "dimension")} (needs ${want.minDimensions})`);
    for (const name of variables) {
      if (!s.expressions.some((e) => referencesVariable(e, name))) missing.push(`no dimension set to #${name}`);
    }
    return missing;
  };
  const scored = sketches.map((s) => ({ s, missing: shortfalls(s) })).sort((a, b) => a.missing.length - b.missing.length);
  const best = scored[0]!;
  const evidence = sketches.map((s) => `${quote(s.name)}: ${plural(s.lines, "line")}, ${plural(s.circles, "circle")}, ${plural(s.dimensions, "dimension")}`);
  if (best.missing.length === 0) {
    const uses = variables.length ? `, driven by ${variables.map((v) => `#${v}`).join(" and ")}` : "";
    return {
      passed: true,
      message: `Checked: ${quote(best.s.name)} has ${plural(best.s.lines, "line")}, ${plural(best.s.circles, "circle")} and ${plural(best.s.dimensions, "dimension")}${uses}.`,
      evidence,
    };
  }
  return {
    passed: false,
    message: `Not yet: ${sketches.length > 1 ? `your closest sketch, ${quote(best.s.name)},` : quote(best.s.name)} has ${best.missing.join(", ")}.`,
    evidence,
  };
}

/* ------------------------------------------------------------------ variables */

export function variableStudioNames(body: unknown): string[] {
  const tables = Array.isArray(body) ? body : [body];
  return tables.flatMap((table) => asArray(asRecord(table)?.variables).map((v) => text(asRecord(v)?.name).trim()).filter(Boolean));
}

export function checkVariables(
  found: Array<{ name: string; from: string }>,
  names: string[],
  features: FeatureNode[] | null,
  usedInFeature: boolean,
): CheckResult {
  const evidence = found.length ? found.map((v) => `#${v.name} in ${v.from}`) : ["No variables found"];
  const missing = names.filter((name) => !found.some((v) => sameName(v.name, name)));
  if (missing.length) {
    const others = found.length ? ` Found ${found.map((v) => `#${v.name}`).join(", ")}; names must match exactly.` : "";
    return { passed: false, message: `Not yet: no variable called #${missing[0]} yet.${others}`, evidence };
  }
  if (usedInFeature && features) {
    const live = liveFeatures(features);
    for (const name of names) {
      const user = live.find(
        (f) => !(f.featureType === "assignVariable" && sameName(variableFeatureName(f), name)) && collectExpressions(f.raw).some((e) => referencesVariable(e, name)),
      );
      if (!user) {
        return {
          passed: false,
          message: `Not yet: #${name} exists, but no feature uses it. Edit the feature and type #${name} where the number goes.`,
          evidence,
        };
      }
      evidence.push(`${quote(user.name)} uses #${name}`);
    }
  }
  return {
    passed: true,
    message: `Checked: found ${names.map((n) => `#${n}`).join(", ")}${usedInFeature ? ", and your features use them" : ""}.`,
    evidence,
  };
}

/* ------------------------------------------------------------------ parts, material, mass */

export type PartRow = { name: string; material: string; flattened: boolean; solid: boolean };

export function readParts(body: unknown): PartRow[] {
  return asArray(body).flatMap((entry) => {
    const part = asRecord(entry);
    if (!part) return [];
    const bodyType = text(part.bodyType).toLowerCase();
    return [
      {
        name: text(part.name) || "Part",
        material: text(asRecord(part.material)?.displayName).trim(),
        flattened: part.isFlattenedBody === true,
        solid: !bodyType || bodyType === "solid",
      },
    ];
  });
}

/** Total mass in kg from a Part Studio mass-properties response (grouped "-all-" or summed). */
export function readMassKg(body: unknown): number | null {
  const bodies = asRecord(asRecord(body)?.bodies);
  if (!bodies) return null;
  const massOf = (value: unknown) => {
    const mass = asRecord(value)?.mass;
    const first = Array.isArray(mass) ? mass[0] : mass;
    return typeof first === "number" && Number.isFinite(first) ? first : null;
  };
  if (bodies["-all-"]) return massOf(bodies["-all-"]);
  const each = Object.values(bodies).map(massOf).filter((m): m is number => m != null);
  return each.length ? each.reduce((a, b) => a + b, 0) : null;
}

export function checkMaterial(parts: PartRow[], massKg: number | null): CheckResult {
  const solids = parts.filter((p) => p.solid && !p.flattened);
  if (solids.length === 0) {
    return { passed: false, message: "Not yet: this Part Studio has no solid part. Finish the part first, then give it a material." };
  }
  const evidence = solids.map((p) => `${quote(p.name)}: ${p.material || "no material"}`);
  const bare = solids.filter((p) => !p.material);
  if (bare.length) {
    return {
      passed: false,
      message: `Not yet: ${quote(bare[0]!.name)} has no material. Right-click it in the Parts list, choose Assign material, and pick one.`,
      evidence,
    };
  }
  if (massKg == null || massKg <= 0) {
    return { passed: false, message: "Onshape didn't report a mass for this Part Studio yet. Make sure every part is a solid with no errors, then check again.", evidence };
  }
  const pounds = massKg * 2.20462;
  const materials = [...new Set(solids.map((p) => p.material))].join(", ");
  return {
    passed: true,
    message: `Checked: ${solids.length === 1 ? `${quote(solids[0]!.name)} is ${materials}` : `${solids.length} parts, all with a material (${materials})`}; Onshape weighs it at ${pounds.toFixed(2)} lb (${massKg.toFixed(3)} kg).`,
    evidence,
  };
}

export function checkFlatPattern(features: FeatureNode[], parts: PartRow[]): CheckResult {
  const start = features.filter((f) => f.featureType === "sheetMetalStart" && !f.suppressed);
  if (start.length === 0) {
    return { passed: false, message: "Not yet: there is no Sheet metal model in this Part Studio. Press Sheet metal model on the toolbar to start one." };
  }
  const broken = erroredFeatures(features).filter((f) => f.featureType.startsWith("sheetMetal") || f.featureType === "hole");
  if (broken.length) {
    return { passed: false, message: `Not yet: ${quote(broken[0]!.name)} has an error (it's red in the feature list). A sheet metal part with errors has no reliable flat pattern.` };
  }
  const flats = parts.filter((p) => p.flattened);
  const evidence = [`${plural(start.length, "Sheet metal model")}`, `${plural(flats.length, "flat pattern")} reported by Onshape`];
  if (flats.length === 0) {
    return {
      passed: false,
      message: "Onshape didn't report a flat pattern yet. Open the flat view (the Sheet metal table and flat view button on the right) to make sure it shows, then check again.",
      evidence,
    };
  }
  return { passed: true, message: `Checked: Onshape has a flat pattern for ${flats.map((p) => quote(p.name)).join(", ")}.`, evidence };
}

/* ------------------------------------------------------------------ assemblies */

export type AssemblyRead = {
  instances: Array<{ name: string; documentId: string; standard: boolean }>;
  fixed: number;
  mates: Array<{ name: string; type: string; broken: boolean }>;
  relations: Array<{ name: string; type: string; broken: boolean }>;
};

function walkAssemblyFeatures(list: unknown[], states: Map<string, string>, out: AssemblyRead) {
  for (const entry of list) {
    const outer = asRecord(entry);
    const feature = asRecord(outer?.message) ?? outer;
    if (!feature) continue;
    const kind = text(feature.featureType);
    const bt = text(feature.btType ?? outer?.typeName);
    const suppressed = feature.suppressed === true;
    const id = text(feature.featureId ?? feature.id);
    const broken = (states.get(id) ?? text(outer?.status)).toUpperCase() === "ERROR";
    const name = text(feature.name ?? asRecord(feature.featureData)?.name) || "Mate";
    if (!suppressed && (kind === "mate" || bt.startsWith("BTMMate-64"))) {
      const type = text(feature.mateType ?? parameter(feature, "mateType")?.value ?? asRecord(feature.featureData)?.mateType).toUpperCase();
      out.mates.push({ name, type, broken });
    } else if (!suppressed && (kind === "mateRelation" || bt.startsWith("BTMMateRelation"))) {
      const type = text(parameter(feature, "relationType")?.value ?? asRecord(feature.featureData)?.relationType).toUpperCase();
      out.relations.push({ name, type, broken });
    }
    if (Array.isArray(feature.subFeatures)) walkAssemblyFeatures(feature.subFeatures, states, out);
  }
}

/** Instances and fixed parts from the definition; mates and relations from the features list. */
export function readAssembly(definition: unknown, features: unknown | null): AssemblyRead {
  const root = asRecord(asRecord(definition)?.rootAssembly);
  const out: AssemblyRead = { instances: [], fixed: 0, mates: [], relations: [] };
  for (const entry of asArray(root?.instances)) {
    const row = asRecord(entry);
    if (!row || row.suppressed === true) continue;
    out.instances.push({ name: text(row.name) || "Instance", documentId: text(row.documentId).toLowerCase(), standard: row.isStandardContent === true });
  }
  out.fixed = asArray(root?.occurrences).filter((o) => asRecord(o)?.fixed === true).length;
  const featureRoot = asRecord(features);
  const states = new Map<string, string>();
  for (const [key, value] of Object.entries(asRecord(featureRoot?.featureStates) ?? {})) {
    states.set(key, text(asRecord(asRecord(value)?.message ?? value)?.featureStatus));
  }
  const list = featureRoot && Array.isArray(featureRoot.features) ? featureRoot.features : asArray(root?.features);
  walkAssemblyFeatures(list, states, out);
  return out;
}

const MATE_WORDS: Record<string, string> = {
  FASTENED: "Fastened",
  REVOLUTE: "Revolute",
  SLIDER: "Slider",
  CYLINDRICAL: "Cylindrical",
  PIN_SLOT: "Pin slot",
  PLANAR: "Planar",
  BALL: "Ball",
  PARALLEL: "Parallel",
  GEAR: "Gear",
  RACK_AND_PINION: "Rack and pinion",
  SCREW: "Screw",
  LINEAR: "Linear",
};
const mateWord = (type: string) => MATE_WORDS[type] ?? (type ? type.charAt(0) + type.slice(1).toLowerCase() : "Unknown");

function tally(rows: Array<{ type: string; broken: boolean }>): string {
  const counts = new Map<string, number>();
  for (const row of rows.filter((r) => !r.broken)) counts.set(row.type, (counts.get(row.type) ?? 0) + 1);
  return [...counts.entries()].map(([type, n]) => `${n} ${mateWord(type)}`).join(", ") || "none";
}

export function checkAssembly(read: AssemblyRead, documentId: string, want: Extract<OnshapeApiCheck, { kind: "onshape-assembly" }>): CheckResult {
  const other = read.instances.filter((i) => !i.standard && i.documentId && i.documentId !== documentId);
  const standard = read.instances.filter((i) => i.standard);
  const evidence = [
    `${plural(read.instances.length, "instance")}: ${read.instances.slice(0, 8).map((i) => i.name).join(", ") || "none"}${read.instances.length > 8 ? ", …" : ""}`,
    `${read.fixed} fixed`,
    `Mates: ${tally(read.mates)}`,
    ...(read.relations.length ? [`Relations: ${tally(read.relations)}`] : []),
    `${plural(other.length, "instance")} from other documents, ${standard.length} from Standard content`,
  ];
  const fail = (message: string): CheckResult => ({ passed: false, message, evidence });
  const need = want.minInstances ?? 0;
  if (read.instances.length < need) {
    return fail(
      `Not yet: the Assembly has ${plural(read.instances.length, "instance")} in it; this step needs ${need}. Press Insert parts and assemblies (i) and click to place ${need - read.instances.length === 1 ? "one more" : "more"}.`,
    );
  }
  if (want.needsFixed && read.fixed === 0) {
    return fail("Not yet: nothing is fixed. Right-click the part that should stay still and choose Fix.");
  }
  if ((want.fromOtherDocuments ?? 0) > other.length) {
    return fail(
      other.length === 0
        ? "Not yet: every part in this Assembly comes from this document. Press Insert parts and assemblies (i), choose Other documents, search for the part and place it."
        : `Not yet: ${plural(other.length, "part")} from other documents; this step needs ${want.fromOtherDocuments}.`,
    );
  }
  if ((want.standardContent ?? 0) > standard.length) {
    return fail(
      `Not yet: ${plural(standard.length, "Standard content part")}; this step needs ${want.standardContent}. Press Insert parts and assemblies (i), choose Standard content, and pick the fastener.`,
    );
  }
  for (const [rows, expectations, what] of [
    [read.mates, want.mates ?? [], "mate"],
    [read.relations, want.relations ?? [], "relation"],
  ] as const) {
    for (const wanted of expectations) {
      const type = wanted.mateType.toUpperCase();
      const good = rows.filter((r) => r.type === type && !r.broken);
      const min = wanted.min ?? 1;
      if (good.length >= min) continue;
      const broken = rows.find((r) => r.type === type && r.broken);
      if (broken) return fail(`Not yet: ${quote(broken.name)} has an error (it's red in the list), so it doesn't count. Edit it and pick the mate connectors again.`);
      return fail(
        `Not yet: ${min === 1 ? wanted.label : `${min} × ${wanted.label} (found ${good.length})`} is missing. ${what === "mate" ? "Mates" : "Relations"} found: ${tally(rows)}.`,
      );
    }
  }
  const parts = [`${plural(read.instances.length, "instance")}`];
  if (want.needsFixed) parts.push(`${read.fixed} fixed`);
  if (want.fromOtherDocuments) parts.push(`${plural(other.length, "part")} from other documents`);
  if (want.standardContent) parts.push(`${standard.length} from Standard content`);
  if (want.mates?.length) parts.push(`mates: ${tally(read.mates)}`);
  if (want.relations?.length) parts.push(`relations: ${tally(read.relations)}`);
  return { passed: true, message: `Checked: ${parts.join("; ")}.`, evidence };
}

/* ------------------------------------------------------------------ drawings */

export function countDrawingViews(body: unknown): number {
  return asArray(asRecord(body)?.items).filter((v) => asRecord(v)?.viewId).length;
}

/** Dimensions in Onshape's drawing JSON: annotations typed Onshape::Dimension::…, split by dangling. */
export function countDrawingDimensions(json: unknown): { live: number; dangling: number } {
  let live = 0;
  let dangling = 0;
  const walk = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    const record = asRecord(node);
    if (!record) return;
    if (typeof record.type === "string" && record.type.startsWith("Onshape::Dimension::")) {
      const isDangling = Object.values(record).some((value) => asRecord(value)?.isDangling === true) || record.isDangling === true;
      if (isDangling) dangling += 1;
      else live += 1;
      return;
    }
    Object.values(record).forEach(walk);
  };
  walk(json);
  return { live, dangling };
}

export type Sleep = (ms: number) => Promise<void>;
const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** About 14 seconds in all, gentle on Onshape's rate limits. */
const EXPORT_POLL_MS = [1000, 1500, 2000, 2500, 3000, 4000];

/** Exports the drawing to JSON without storing a file in the student's document, then reads it. */
export async function exportDrawingJson(
  http: OnshapeFetch,
  where: Located,
  elementId: string,
  sleep: Sleep = realSleep,
): Promise<Outcome<unknown>> {
  const start = await getJson(http, elementPath("drawings", where, elementId) + "/translations", {
    method: "POST",
    body: JSON.stringify({ formatName: "DRAWING_JSON", storeInDocument: false }),
  });
  if (!start.ok) return { ok: false, result: onshapeTrouble(start.status, "drawing") };
  let job = asRecord(start.body);
  const id = text(job?.id);
  if (!id) return { ok: false, result: { passed: false, message: "Onshape didn't start reading the drawing. Check again in a minute." } };
  for (const wait of EXPORT_POLL_MS) {
    const state = text(job?.requestState).toUpperCase();
    if (state === "DONE" || state === "FAILED") break;
    await sleep(wait);
    const poll = await getJson(http, `/translations/${id}`);
    if (!poll.ok) return { ok: false, result: onshapeTrouble(poll.status, "drawing") };
    job = asRecord(poll.body);
  }
  const state = text(job?.requestState).toUpperCase();
  if (state === "FAILED") {
    return {
      ok: false,
      result: { passed: false, message: `Onshape couldn't read the drawing${job?.failureReason ? ` (${text(job.failureReason)})` : ""}. Fix any red views, then check again.` },
    };
  }
  if (state !== "DONE") {
    return { ok: false, result: { passed: false, message: "Onshape is still reading your drawing. Press Check again in half a minute." } };
  }
  const externalId = text(asArray(job?.resultExternalDataIds)[0]);
  const blobId = text(asArray(job?.resultElementIds)[0]);
  const download = externalId
    ? await getJson(http, `/documents/d/${where.documentId}/externaldata/${externalId}`, { headers: { accept: "application/octet-stream, application/json" } })
    : blobId
      ? await getJson(http, `/blobelements/d/${where.documentId}/${where.wvm}/${where.wvmId}/e/${blobId}`, { headers: { accept: "application/octet-stream, application/json" } })
      : ({ ok: false, status: -1 } as Got);
  if (!download.ok) return { ok: false, result: onshapeTrouble(download.status, "drawing") };
  return { ok: true, value: download.body };
}

/* ------------------------------------------------------------------ configurations */

export type ConfigInput = { id: string; name: string; list: boolean; options: Array<{ id: string; name: string }> };

export function readConfiguration(body: unknown): ConfigInput[] {
  return asArray(asRecord(body)?.configurationParameters).flatMap((entry) => {
    const outer = asRecord(entry);
    const param = asRecord(outer?.message) ?? outer;
    if (!param) return [];
    const bt = text(param.btType ?? outer?.typeName);
    const options = asArray(param.options).flatMap((o) => {
      const option = asRecord(asRecord(o)?.message) ?? asRecord(o);
      return option ? [{ id: text(option.option), name: text(option.optionName) || text(option.option) }] : [];
    });
    return [{ id: text(param.parameterId), name: text(param.parameterName) || "Configuration", list: bt.startsWith("BTMConfigurationParameterEnum") || options.length > 0, options }];
  });
}

/** True when the Variable feature for `name` has a value that changes with the configuration. */
export function variableIsConfigured(features: FeatureNode[], name: string): boolean {
  const feature = features.find((f) => f.featureType === "assignVariable" && !f.suppressed && sameName(variableFeatureName(f), name));
  return Boolean(feature && asArray(feature.raw.parameters).some((p) => text(asRecord(p)?.btType).startsWith("BTMParameterConfigured")));
}

/* ------------------------------------------------------------------ the runner */

async function readFeatures(http: OnshapeFetch, where: Located, elementId: string, configuration?: string): Promise<Outcome<FeatureNode[]>> {
  const query = configuration ? `?configuration=${encodeURIComponent(configuration)}` : "";
  const got = await getJson(http, elementPath("partstudios", where, elementId) + "/features" + query);
  if (!got.ok) return { ok: false, result: onshapeTrouble(got.status, "Part Studio") };
  return { ok: true, value: readFeatureList(got.body) };
}

function withNote(result: CheckResult, note?: string, tabName?: string): CheckResult {
  const evidence = [...(tabName ? [`Read ${quote(tabName)}`] : []), ...(result.evidence ?? [])];
  return { ...result, message: note && !result.passed ? `${result.message} (${note})` : result.message, evidence };
}

/**
 * Runs one Onshape API check against the pasted link, over the student's own connection.
 * Never throws: every failure comes back as a sentence saying what to do.
 */
export async function runOnshapeApiCheck(http: OnshapeFetch, check: OnshapeApiCheck, url: string, sleep: Sleep = realSleep): Promise<CheckResult> {
  try {
    return await runInner(http, check, url, sleep);
  } catch {
    return { passed: false, message: "Something went wrong reading Onshape. Check again in a minute." };
  }
}

async function runInner(http: OnshapeFetch, check: OnshapeApiCheck, url: string, sleep: Sleep): Promise<CheckResult> {
  const located = await locateDocument(http, url);
  if (!located.ok) return located.result;
  const where = located.value;

  const partStudio = (name?: string) => pickTab(where, "PARTSTUDIO", name);

  switch (check.kind) {
    case "onshape-tab": {
      const picked = pickTab(where, check.tab, check.name);
      if (!picked.ok) return picked.result;
      const { row } = picked.value;
      if (check.name && !sameName(row.name, check.name)) {
        return {
          passed: false,
          message: `Not yet: the ${TAB_WORDS[check.tab]} is called ${quote(row.name)}. Right-click its tab at the bottom, choose Rename, and call it ${quote(check.name)}.`,
        };
      }
      return { passed: true, message: `Checked: found the ${TAB_WORDS[check.tab]} ${quote(row.name)}.`, evidence: [`${plural(where.elements.length, "tab")} in the document`] };
    }
    case "onshape-part-features":
    case "onshape-sketch":
    case "onshape-rebuild": {
      const picked = partStudio();
      if (!picked.ok) return picked.result;
      const features = await readFeatures(http, where, picked.value.row.id);
      if (!features.ok) return features.result;
      if (check.kind === "onshape-part-features") {
        return withNote(checkPartFeatures(features.value, check.expect, check.anyOf === true), picked.value.note, picked.value.row.name);
      }
      if (check.kind === "onshape-sketch") return withNote(checkSketch(features.value, check), picked.value.note, picked.value.row.name);
      return withNote(await checkRebuild(http, where, picked.value.row.id, features.value, check), picked.value.note, picked.value.row.name);
    }
    case "onshape-variable": {
      const found: Array<{ name: string; from: string }> = [];
      let features: FeatureNode[] | null = null;
      const needStudio = check.where !== "variablestudio" || check.usedInFeature;
      let psName: string | undefined;
      if (needStudio) {
        const picked = partStudio();
        if (!picked.ok) return picked.result;
        const read = await readFeatures(http, where, picked.value.row.id);
        if (!read.ok) return read.result;
        features = read.value;
        psName = picked.value.row.name;
        if (check.where !== "variablestudio") {
          for (const f of liveFeatures(features).filter((x) => x.featureType === "assignVariable")) {
            const name = variableFeatureName(f);
            if (name) found.push({ name, from: quote(psName) });
          }
        }
      }
      if (check.where !== "partstudio") {
        const studios = where.elements.filter((row) => row.tab === "VARIABLESTUDIO").slice(0, 4);
        if (check.where === "variablestudio" && studios.length === 0) {
          return { passed: false, message: `Not yet: this document has no Variable Studio tab. ${TAB_CREATE_HINT.VARIABLESTUDIO}` };
        }
        for (const studio of studios) {
          const got = await getJson(http, elementPath("variables", where, studio.id) + "/variables");
          if (!got.ok) return onshapeTrouble(got.status, "Variable Studio");
          for (const name of variableStudioNames(got.body)) found.push({ name, from: quote(studio.name) });
        }
      }
      return withNote(checkVariables(found, check.names, features, check.usedInFeature === true), undefined, psName);
    }
    case "onshape-material": {
      const picked = partStudio();
      if (!picked.ok) return picked.result;
      const parts = await getJson(http, elementPath("parts", where, picked.value.row.id));
      if (!parts.ok) return onshapeTrouble(parts.status, "Part Studio");
      const rows = readParts(parts.body);
      let mass: number | null = null;
      if (rows.some((p) => p.solid && p.material)) {
        const got = await getJson(http, elementPath("partstudios", where, picked.value.row.id) + "/massproperties");
        mass = got.ok ? readMassKg(got.body) : null;
      }
      return withNote(checkMaterial(rows, mass), picked.value.note, picked.value.row.name);
    }
    case "onshape-flat-pattern": {
      const picked = partStudio();
      if (!picked.ok) return picked.result;
      const features = await readFeatures(http, where, picked.value.row.id);
      if (!features.ok) return features.result;
      const parts = await getJson(http, elementPath("parts", where, picked.value.row.id) + "?includeFlatParts=true");
      if (!parts.ok) return onshapeTrouble(parts.status, "Part Studio");
      return withNote(checkFlatPattern(features.value, readParts(parts.body)), picked.value.note, picked.value.row.name);
    }
    case "onshape-assembly": {
      const picked = pickTab(where, "ASSEMBLY");
      if (!picked.ok) return picked.result;
      const base = elementPath("assemblies", where, picked.value.row.id);
      const definition = await getJson(http, `${base}?includeMateFeatures=true`);
      if (!definition.ok) return onshapeTrouble(definition.status, "Assembly");
      const features = await getJson(http, `${base}/features`);
      const read = readAssembly(definition.body, features.ok ? features.body : null);
      return withNote(checkAssembly(read, where.documentId, check), picked.value.note, picked.value.row.name);
    }
    case "onshape-drawing": {
      const picked = pickTab(where, "DRAWING");
      if (!picked.ok) return picked.result;
      const views = await getJson(http, elementPath("drawings", where, picked.value.row.id) + "/views");
      if (!views.ok) return onshapeTrouble(views.status, "Drawing");
      const count = countDrawingViews(views.body);
      const evidence = [`${plural(count, "view")} on the drawing`];
      if (count < check.minViews) {
        return withNote(
          {
            passed: false,
            message:
              count === 0
                ? "Not yet: the drawing has no views. Click on the sheet to place the first view of your part."
                : `Not yet: the drawing has ${plural(count, "view")}; this step needs ${check.minViews}. Click a view, drag straight out from it and click to place a projected view.`,
            evidence,
          },
          picked.value.note,
          picked.value.row.name,
        );
      }
      if (!check.minDimensions) {
        return withNote({ passed: true, message: `Checked: the drawing has ${plural(count, "view")}.`, evidence }, picked.value.note, picked.value.row.name);
      }
      const exported = await exportDrawingJson(http, where, picked.value.row.id, sleep);
      if (!exported.ok) return withNote(exported.result, picked.value.note, picked.value.row.name);
      const dims = countDrawingDimensions(exported.value);
      evidence.push(`${plural(dims.live, "dimension")}${dims.dangling ? `, plus ${dims.dangling} dangling (attached to nothing)` : ""}`);
      if (dims.live < check.minDimensions) {
        return withNote(
          {
            passed: false,
            message: `Not yet: the drawing has ${plural(dims.live, "dimension")}; this step needs ${check.minDimensions}.${dims.dangling ? ` ${plural(dims.dangling, "dimension")} lost ${dims.dangling === 1 ? "its" : "their"} edge (shown in orange) and ${dims.dangling === 1 ? "doesn't" : "don't"} count.` : ""} Press Dimension (d), click two edges, and click to place it.`,
            evidence,
          },
          picked.value.note,
          picked.value.row.name,
        );
      }
      return withNote(
        { passed: true, message: `Checked: the drawing has ${plural(count, "view")} and ${plural(dims.live, "dimension")}.`, evidence },
        picked.value.note,
        picked.value.row.name,
      );
    }
    case "onshape-configuration": {
      const pasted = where.elements.find((row) => row.id === where.pastedElementId);
      const order = [
        ...(pasted && pasted.tab !== "OTHER" && pasted.tab !== "DRAWING" ? [pasted] : []),
        ...where.elements.filter((row) => row.id !== pasted?.id && (row.tab === "PARTSTUDIO" || row.tab === "VARIABLESTUDIO" || row.tab === "ASSEMBLY")),
      ].slice(0, 6);
      if (order.length === 0) return { passed: false, message: `Not yet: this document has no Part Studio. ${TAB_CREATE_HINT.PARTSTUDIO}` };
      const evidence: string[] = [];
      let best: { row: ElementRow; input: ConfigInput } | null = null;
      for (const row of order) {
        const got = await getJson(http, elementPath("elements", where, row.id) + "/configuration");
        if (!got.ok) {
          if (got.status === 404) continue;
          return onshapeTrouble(got.status, TAB_WORDS[row.tab as OnshapeTabType] ?? "tab");
        }
        const inputs = readConfiguration(got.body);
        for (const input of inputs) evidence.push(`${quote(row.name)}: ${input.list ? `List ${quote(input.name)} with ${plural(input.options.length, "row")}` : quote(input.name)}`);
        const list = inputs.filter((i) => i.list).sort((a, b) => b.options.length - a.options.length)[0];
        if (list && (!best || list.options.length > best.input.options.length)) best = { row, input: list };
      }
      if (!best) {
        return {
          passed: false,
          message: "Not yet: no configuration in this document. Open the Configuration panel (right side), press Configure Part Studio, and choose List.",
          evidence,
        };
      }
      if (best.input.options.length < check.minOptions) {
        return {
          passed: false,
          message: `Not yet: the list ${quote(best.input.name)} has ${plural(best.input.options.length, "row")}; this step needs ${check.minOptions}. Click the empty row at the bottom of the table and type a name.`,
          evidence,
        };
      }
      if (check.configuresVariable) {
        if (best.row.tab !== "PARTSTUDIO") {
          return { passed: false, message: `Not yet: put the list in the Part Studio that has #${check.configuresVariable}, so it can change that variable.`, evidence };
        }
        const features = await readFeatures(http, where, best.row.id);
        if (!features.ok) return features.result;
        if (!variableIsConfigured(features.value, check.configuresVariable)) {
          return {
            passed: false,
            message: `Not yet: the list ${quote(best.input.name)} is there, but #${check.configuresVariable} doesn't change with it. Click the Variable feature ${check.configuresVariable}, then click its value so it becomes a column in the table, and type a value for each row.`,
            evidence,
          };
        }
        evidence.push(`#${check.configuresVariable} changes with ${quote(best.input.name)}`);
      }
      return {
        passed: true,
        message: `Checked: the list ${quote(best.input.name)} has ${plural(best.input.options.length, "row")} (${best.input.options.map((o) => o.name).join(", ")})${check.configuresVariable ? ` and sets #${check.configuresVariable}` : ""}.`,
        evidence,
      };
    }
    default: {
      const exhaustive: never = check;
      return exhaustive;
    }
  }
}

async function checkRebuild(
  http: OnshapeFetch,
  where: Located,
  elementId: string,
  features: FeatureNode[],
  check: Extract<OnshapeApiCheck, { kind: "onshape-rebuild" }>,
): Promise<CheckResult> {
  const live = features.filter((f) => !f.suppressed);
  const evidence = [`${plural(live.length, "feature")} in the default configuration`];
  if (live.length < check.minFeatures) {
    return { passed: false, message: `Not yet: the Part Studio has ${plural(live.length, "feature")}; this step expects at least ${check.minFeatures}.`, evidence };
  }
  const broken = erroredFeatures(features);
  if (broken.length) {
    return { passed: false, message: `Not yet: ${quote(broken[0]!.name)} has an error (it's red in the feature list). Fix it, then check again.`, evidence };
  }
  if (!check.everyConfiguration) {
    return { passed: true, message: `Checked: all ${plural(live.length, "feature")} rebuild with no errors.`, evidence };
  }
  const config = await getJson(http, elementPath("elements", where, elementId) + "/configuration");
  if (!config.ok) return onshapeTrouble(config.status, "Part Studio");
  const list = readConfiguration(config.body).find((input) => input.list && input.options.length > 0);
  if (!list) {
    return { passed: false, message: "Not yet: this Part Studio has no List configuration to try. Do the configuration step first.", evidence };
  }
  const tried: string[] = [];
  for (const option of list.options.slice(0, 5)) {
    const read = await readFeatures(http, where, elementId, `${list.id}=${option.id}`);
    if (!read.ok) return read.result;
    const bad = erroredFeatures(read.value);
    evidence.push(`${quote(option.name)}: ${bad.length ? `${quote(bad[0]!.name)} has an error` : "no errors"}`);
    if (bad.length) {
      return {
        passed: false,
        message: `Not yet: with ${quote(list.name)} set to ${quote(option.name)}, ${quote(bad[0]!.name)} has an error. Pick that row in the Configuration panel, fix it, then check again.`,
        evidence,
      };
    }
    tried.push(option.name);
  }
  return { passed: true, message: `Checked: the Part Studio rebuilds with no errors in every row of ${quote(list.name)} (${tried.join(", ")}).`, evidence };
}
