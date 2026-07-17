// Strategy Whiteboard — framework-free domain logic shared by the API route, the
// client UI, and unit tests. No server or React imports belong here.

/** Normalized drawing space: FRC field aspect (~16.5m x 8.1m) as 1000 x 500. */
export const FIELD_W = 1000;
export const FIELD_H = 500;

export const STROKE_TOOLS = ["pen", "arrow"] as const;
export type StrokeTool = (typeof STROKE_TOOLS)[number];

export const STROKE_COLORS = ["ink", "red", "blue", "green", "orange"] as const;
export type StrokeColor = (typeof STROKE_COLORS)[number];

export type Stroke = {
  tool: StrokeTool;
  color: StrokeColor;
  points: Array<[number, number]>;
};

export type RobotToken = {
  id: "r1" | "r2" | "r3" | "b1" | "b2" | "b3";
  alliance: "red" | "blue";
  x: number;
  y: number;
};

export type WhiteboardPlay = {
  id: string;
  title: string;
  matchKey: string | null;
  description: string;
  strokes: Stroke[];
  robots: RobotToken[];
  createdByName: string | null;
  updatedAt: string;
};

export type WhiteboardContext = {
  orgId: string | null;
  orgName: string | null;
  teamNumber: number | null;
  role: string | null;
};

export type WhiteboardView =
  | { status: "ready"; context: WhiteboardContext; plays: WhiteboardPlay[] }
  | { status: "setup_required"; context: WhiteboardContext; message: string };

/** Default token layout: three robots per alliance staged near their walls. */
export function defaultRobots(): RobotToken[] {
  return [
    { id: "r1", alliance: "red", x: 90, y: 125 },
    { id: "r2", alliance: "red", x: 90, y: 250 },
    { id: "r3", alliance: "red", x: 90, y: 375 },
    { id: "b1", alliance: "blue", x: 910, y: 125 },
    { id: "b2", alliance: "blue", x: 910, y: 250 },
    { id: "b3", alliance: "blue", x: 910, y: 375 },
  ];
}

// ---------------------------------------------------------------------------
// Geometry helpers (pure, unit-tested).
// ---------------------------------------------------------------------------

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/**
 * Drop consecutive points closer than `epsilon` so freehand strokes stay light.
 * Always keeps the first and last point.
 */
export function simplifyStroke(points: Array<[number, number]>, epsilon = 4): Array<[number, number]> {
  if (points.length <= 2) return points;
  const result: Array<[number, number]> = [points[0]!];
  for (let index = 1; index < points.length - 1; index += 1) {
    const [px, py] = result[result.length - 1]!;
    const [x, y] = points[index]!;
    if (Math.hypot(x - px, y - py) >= epsilon) result.push(points[index]!);
  }
  result.push(points[points.length - 1]!);
  return result;
}

const MAX_STROKES = 200;
const MAX_TOTAL_POINTS = 8000;

/**
 * Validate and normalize untrusted stroke JSON: known tools/colors, numeric
 * points clamped to the field, capped counts. Throws on structural garbage.
 */
export function sanitizeStrokes(input: unknown): Stroke[] {
  if (input == null) return [];
  if (!Array.isArray(input)) throw new Error("Strokes must be an array");
  if (input.length > MAX_STROKES) throw new Error(`Too many strokes (max ${MAX_STROKES})`);
  let totalPoints = 0;
  const strokes: Stroke[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") throw new Error("Invalid stroke");
    const stroke = raw as Record<string, unknown>;
    const tool = String(stroke.tool ?? "pen") as StrokeTool;
    if (!STROKE_TOOLS.includes(tool)) throw new Error("Unknown stroke tool");
    const color = String(stroke.color ?? "ink") as StrokeColor;
    if (!STROKE_COLORS.includes(color)) throw new Error("Unknown stroke color");
    if (!Array.isArray(stroke.points) || stroke.points.length < 2) continue; // drop degenerate strokes
    const points: Array<[number, number]> = [];
    for (const point of stroke.points as unknown[]) {
      if (!Array.isArray(point) || point.length < 2) throw new Error("Invalid stroke point");
      const x = Number(point[0]);
      const y = Number(point[1]);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid stroke point");
      points.push([Math.round(clamp(x, 0, FIELD_W) * 10) / 10, Math.round(clamp(y, 0, FIELD_H) * 10) / 10]);
    }
    totalPoints += points.length;
    if (totalPoints > MAX_TOTAL_POINTS) throw new Error("Play drawing is too detailed — clear some strokes");
    strokes.push({ tool, color, points });
  }
  return strokes;
}

const TOKEN_IDS = new Set(["r1", "r2", "r3", "b1", "b2", "b3"]);

/** Validate robot-token JSON; unknown/duplicate ids rejected, coords clamped. */
export function sanitizeRobots(input: unknown): RobotToken[] {
  if (input == null) return defaultRobots();
  if (!Array.isArray(input)) throw new Error("Robots must be an array");
  const seen = new Set<string>();
  const robots: RobotToken[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") throw new Error("Invalid robot token");
    const token = raw as Record<string, unknown>;
    const id = String(token.id ?? "");
    if (!TOKEN_IDS.has(id)) throw new Error("Unknown robot token id");
    if (seen.has(id)) throw new Error("Duplicate robot token");
    seen.add(id);
    const x = Number(token.x);
    const y = Number(token.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("Invalid robot position");
    robots.push({
      id: id as RobotToken["id"],
      alliance: id.startsWith("r") ? "red" : "blue",
      x: Math.round(clamp(x, 0, FIELD_W)),
      y: Math.round(clamp(y, 0, FIELD_H)),
    });
  }
  return robots.length ? robots : defaultRobots();
}

// ---------------------------------------------------------------------------
// Action validation (mirrors the other module parse patterns).
// ---------------------------------------------------------------------------

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} is required`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer`);
  return text;
}

function optionalText(value: unknown, max: number) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;
  if (text.length > max) throw new Error(`Value must be ${max} characters or fewer`);
  return text;
}

function uuid(value: unknown, label: string) {
  const text = requiredText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text)) {
    throw new Error(`${label} is invalid`);
  }
  return text;
}

const has = (body: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(body, key);

export type PlayPatch = {
  title?: string;
  description?: string;
  matchKey?: string | null;
  strokes?: Stroke[];
  robots?: RobotToken[];
};

export type WhiteboardAction =
  | { action: "create_play"; orgId: string; title: string; matchKey: string | null }
  | { action: "update_play"; orgId: string; id: string; patch: PlayPatch }
  | { action: "delete_play"; orgId: string; id: string };

export function parseWhiteboardAction(input: unknown): WhiteboardAction {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid whiteboard action");
  const body = input as Record<string, unknown>;
  const action = requiredText(body.action, "Action", 40);
  const orgId = uuid(body.orgId, "Organization");

  switch (action) {
    case "create_play":
      return {
        action,
        orgId,
        title: requiredText(body.title, "Play title", 120),
        matchKey: optionalText(body.matchKey, 80),
      };

    case "update_play": {
      const patch: PlayPatch = {};
      if (has(body, "title")) patch.title = requiredText(body.title, "Play title", 120);
      if (has(body, "description")) patch.description = optionalText(body.description, 2_000) ?? "";
      if (has(body, "matchKey")) patch.matchKey = optionalText(body.matchKey, 80);
      if (has(body, "strokes")) patch.strokes = sanitizeStrokes(body.strokes);
      if (has(body, "robots")) patch.robots = sanitizeRobots(body.robots);
      if (Object.keys(patch).length === 0) throw new Error("No changes provided");
      return { action, orgId, id: uuid(body.id, "Play"), patch };
    }

    case "delete_play":
      return { action, orgId, id: uuid(body.id, "Play") };

    default:
      throw new Error("Unsupported whiteboard action");
  }
}
