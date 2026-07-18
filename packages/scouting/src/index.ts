import { lockScoutPayload } from "./identity";
export type Confidence = "high" | "normal" | "low";
export type EntrySource = "manual" | "voice" | "import" | "video";
export type EntryType = "match" | "pit";
export type FieldType = "number" | "boolean" | "text" | "select";

export {
  SCOUT_QR_EMBED_PREFIX,
  SCOUT_QR_HANDOFF_PREFIX,
  SCOUT_QR_MAX_EMBEDDED_BYTES,
  applyPendingToCoverage,
  decodeScoutQrContent,
  encodeScoutHandoffQr,
  encodeScoutQrPayload,
  embeddedQrByteLength,
  formatHandoffCode,
  importedToSyncEntries,
  mergeOfflineHandoff,
  needsShortCodeHandoff,
  normalizeHandoffCode,
  qrContentToImportJson,
  scoutHandoffUserCode,
  summarizeCoverage,
  syncEntriesToQrRecords,
  type CoverageDashboardCell,
  type OfflineMergeResult,
  type ScoutQrDecode,
  type ScoutQrRecord,
} from "./qr-handoff";
import { qrContentToImportJson } from "./qr-handoff";

export type FieldDefinition = {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  disagreementThreshold?: number;
};

export type SchemaDefinition = { title: string; fields: FieldDefinition[] };

export const DEFAULT_MATCH_SCHEMA: SchemaDefinition = {
  title: "Match scouting",
  fields: [
    { key: "auto_score", label: "Auto score", type: "number" },
    { key: "teleop_score", label: "Teleop score", type: "number" },
    {
      key: "endgame",
      label: "Endgame",
      type: "select",
      options: ["none", "partial", "full"],
    },
    { key: "disabled", label: "Disabled", type: "boolean" },
    { key: "notes", label: "Notes", type: "text" },
  ],
};

export const DEFAULT_PIT_SCHEMA: SchemaDefinition = {
  title: "Pit scouting",
  fields: [
    {
      key: "drivetrain",
      label: "Drivetrain",
      type: "select",
      options: ["swerve", "tank", "mecanum", "other"],
    },
    { key: "cycle_time", label: "Cycle time (s)", type: "number" },
    { key: "reliable", label: "Reliable", type: "boolean" },
    { key: "notes", label: "Notes", type: "text" },
  ],
};

export type ScoutSchema = {
  id: string;
  orgId: string;
  year: number;
  type: EntryType;
  version: number;
  definition: SchemaDefinition;
};

export type SyncEntry = {
  clientId: string;
  type: EntryType;
  eventKey: string;
  matchKey?: string;
  teamKey: string;
  schemaId: string;
  payload: Record<string, unknown>;
  confidence: Confidence;
  source: EntrySource;
  updatedAt: string;
  videoReviewId?: string;
  videoAtSeconds?: number;
};

export type FormulaExpression =
  | { op: "field"; field: string }
  | { op: "constant"; value: number }
  | {
      op: "add" | "subtract" | "multiply" | "divide" | "min" | "max";
      args: FormulaExpression[];
    };

export function validatePayload(
  schema: SchemaDefinition,
  payload: Record<string, unknown>,
): string[] {
  const errors: string[] = [];
  const allowed = new Set(schema.fields.map((field) => field.key));
  for (const key of Object.keys(payload)) {
    if (!allowed.has(key)) errors.push(`Unknown field: ${key}`);
  }
  for (const field of schema.fields) {
    const value = payload[field.key];
    if (field.required && (value === undefined || value === null || value === "")) {
      errors.push(`${field.label} is required`);
      continue;
    }
    if (value === undefined || value === null || value === "") continue;
    if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) {
      errors.push(`${field.label} must be a number`);
    } else if (field.type === "boolean" && typeof value !== "boolean") {
      errors.push(`${field.label} must be true or false`);
    } else if ((field.type === "text" || field.type === "select") && typeof value !== "string") {
      errors.push(`${field.label} must be text`);
    } else if (field.type === "select" && !field.options?.includes(String(value))) {
      errors.push(`${field.label} has an invalid option`);
    }
  }
  return errors;
}

export function evaluateFormula(
  expression: FormulaExpression,
  payload: Record<string, unknown>,
): number {
  if (expression.op === "constant") return expression.value;
  if (expression.op === "field") {
    const value = payload[expression.field];
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
  const values = expression.args.map((arg) => evaluateFormula(arg, payload));
  if (values.length === 0) return 0;
  switch (expression.op) {
    case "add":
      return values.reduce((sum, value) => sum + value, 0);
    case "subtract":
      return values.slice(1).reduce((result, value) => result - value, values[0] ?? 0);
    case "multiply":
      return values.reduce((result, value) => result * value, 1);
    case "divide":
      return values.slice(1).reduce(
        (result, value) => (value === 0 ? result : result / value),
        values[0] ?? 0,
      );
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
  }
}

export type Disagreement = {
  fieldKey: string;
  entryIds: string[];
  values: unknown[];
};

export function detectDisagreements(
  schema: SchemaDefinition,
  entries: Array<{ id: string; payload: Record<string, unknown>; confidence: Confidence }>,
): Disagreement[] {
  const eligible = entries.filter((entry) => entry.confidence !== "low");
  if (eligible.length < 2) return [];
  const disagreements: Disagreement[] = [];
  for (const field of schema.fields) {
    const observed = eligible
      .map((entry) => ({ id: entry.id, value: entry.payload[field.key] }))
      .filter(({ value }) => value !== undefined && value !== null);
    if (observed.length < 2) continue;
    const values = observed.map(({ value }) => value);
    const diverges =
      field.type === "number"
        ? Math.max(...values.map(Number)) - Math.min(...values.map(Number)) >
          (field.disagreementThreshold ?? 0)
        : new Set(values.map((value) => JSON.stringify(value))).size > 1;
    if (diverges) {
      disagreements.push({
        fieldKey: field.key,
        entryIds: observed.map(({ id }) => id),
        values,
      });
    }
  }
  return disagreements;
}

export interface MediaStorage {
  createUpload(input: {
    orgId: string;
    clientId: string;
    contentType: string;
    byteSize: number;
  }): Promise<{ storageKey: string; uploadUrl: string }>;
}

export class LocalMediaStorage implements MediaStorage {
  async createUpload(input: {
    orgId: string;
    clientId: string;
    contentType: string;
    byteSize: number;
  }) {
    return {
      storageKey: `${input.orgId}/local/${input.clientId}`,
      uploadUrl: `/api/scouting/media/${encodeURIComponent(input.clientId)}?orgId=${encodeURIComponent(input.orgId)}`,
    };
  }
}

export interface VoiceDraftAdapter {
  transcript(blob: Blob): Promise<string>;
}

export class BrowserVoiceDraftAdapter implements VoiceDraftAdapter {
  async transcript(): Promise<string> {
    throw new Error("Browser speech recognition must provide the transcript");
  }
}

export type ImportProvenance = {
  format: "csv" | "json" | "qr";
  source: "scoutingpass" | "scout_radioactive" | "frc_scouting" | "google_sheets" | "vantage" | "generic";
  importedAt: string;
  sourceFile?: string;
};

export type ImportedScoutRecord = {
  clientId: string;
  eventKey: string;
  matchKey?: string;
  teamKey: string;
  payload: Record<string, unknown>;
  provenance: ImportProvenance;
};

function parseCsvLine(line: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const character = line[index]!;
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index++;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else value += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted value");
  values.push(value);
  return values;
}

export function importScoutData(input: {
  content: string;
  format: "csv" | "json" | "qr";
  source?: ImportProvenance["source"];
  sourceFile?: string;
  now?: Date;
}): ImportedScoutRecord[] {
  const provenance: ImportProvenance = {
    format: input.format,
    source: input.source ?? "generic",
    importedAt: (input.now ?? new Date()).toISOString(),
    sourceFile: input.sourceFile,
  };
  let values: unknown[];
  if (input.format === "csv") {
    const lines = input.content.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = parseCsvLine(lines[0]!).map((header) => header.trim());
    values = lines.slice(1).map((line) =>
      Object.fromEntries(headers.map((header, index) => [header, parseCsvLine(line)[index] ?? ""])),
    );
  } else {
    const decoded =
      input.format === "qr" ? qrContentToImportJson(input.content) : input.content;
    const parsed = JSON.parse(decoded) as unknown;
    values = Array.isArray(parsed) ? parsed : [parsed];
  }
  return values.map((raw, index) => {
    if (!raw || typeof raw !== "object") throw new Error(`Import row ${index + 1} must be an object`);
    const row = raw as Record<string, unknown>;
    const normalized = new Map(Object.entries(row).map(([key,value])=>[key.toLowerCase().replace(/[^a-z0-9]/g,""),value]));
    const pick=(...aliases:string[])=>aliases.map((key)=>normalized.get(key.toLowerCase().replace(/[^a-z0-9]/g,""))).find((value)=>value!=null&&value!=="");
    const eventKey = String(pick("eventKey","event","eventCode","competition") ?? "").trim();
    const matchRaw=String(pick("matchKey","match","matchNumber","matchNum")??"").trim();
    const matchKey = matchRaw ? (/^\d+$/.test(matchRaw)?`qm${matchRaw}`:matchRaw) : undefined;
    const teamValue = String(pick("teamKey","team","teamNumber","teamNum","robot") ?? "").trim();
    const teamKey = /^frc\d+$/i.test(teamValue) ? teamValue.toLowerCase() : `frc${teamValue}`;
    if (!eventKey || !/^frc\d+$/.test(teamKey)) throw new Error(`Import row ${index + 1} lacks event/team identity`);
    const reserved = new Set([
      "clientId", "client_id", "eventKey", "event_key", "event", "matchKey", "match_key", "match",
      "teamKey", "team_key", "team", "teamNumber", "payload",
      "Event Key", "Event Code", "Match Number", "Match Num", "Team Number", "Team Num", "Robot",
    ]);
    const payload =
      row.payload && typeof row.payload === "object"
        ? (row.payload as Record<string, unknown>)
        : Object.fromEntries(Object.entries(row).filter(([key]) => !reserved.has(key)));
    return {
      clientId: String(row.clientId ?? row.client_id ?? `import-${index}-${eventKey}-${teamKey}`),
      eventKey,
      matchKey,
      teamKey,
      payload,
      provenance,
    };
  });
}

export function smallTeamAssignments(input: {
  scouts: string[];
  matches: Array<{ matchKey: string; teamKeys: string[] }>;
}) {
  if (!input.scouts.length) return [];
  return input.matches.flatMap((match, matchIndex) =>
    match.teamKeys.map((teamKey, teamIndex) => ({
      matchKey: match.matchKey,
      teamKey,
      userId: input.scouts[(matchIndex + teamIndex) % input.scouts.length]!,
      mode: "small-team" as const,
    })),
  );
}

export {
  assertSchemaIdentityLock,
  bindScoutIdentity,
  isScoutIdentityField,
  lockScoutPayload,
  stripScoutIdentityFields,
  type ScoutIdentity,
} from "./identity";

export {
  buildCoverageGapBoard,
  focusLiveCoverage,
  summarizeCoverageGaps,
  toGapStatus,
  type CoverageGapSlot,
  type CoverageGapStatus,
  type CoverageGapSummary,
  type CoverageSlotInput,
} from "./coverage";
