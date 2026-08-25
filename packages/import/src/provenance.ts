export type ImportSource =
  | "notion"
  | "google_calendar"
  | "ics"
  | "csv"
  | "scoutingpass"
  | "lovat"
  | "sheets"
  /** The Purple Standard community interchange JSON. */
  | "purple_standard"
  /** QRScout config.json (form) and delimiter-separated QR payload lines. */
  | "qrscout"
  /** Scoutradioz raw matchscouting/pitscouting documents. */
  | "scoutradioz"
  /** Trello board export JSON. */
  | "trello"
  /** FIRST STIMS / Dashboard youth-registration roster CSV. */
  | "stims";

export type ImportProvenance = {
  source: ImportSource;
  importedAt: string;
  sourceUrl?: string;
  sourceId?: string;
  sourceFile?: string;
};

export type ImportDraftKind =
  | "calendar"
  | "task"
  | "knowledge"
  | "scout"
  | "hours"
  /** A scouting form definition destined for the form builder as an unpublished draft. */
  | "form"
  /** A roster row the owner reviews before anything is sent. Never auto-invited. */
  | "invite";

export type ImportDraft = {
  kind: ImportDraftKind;
  title: string;
  body?: string;
  startsAt?: string;
  endsAt?: string;
  payload?: Record<string, unknown>;
  /**
   * Stable key the commit step uses to dedupe. Re-importing the same file must
   * change nothing, so this is derived from the source content, never from
   * position or import time.
   */
  idempotencyKey?: string;
  provenance: ImportProvenance;
};

/** A scouting entry draft — carries the identity the scouting repository needs. */
export type ScoutEntryDraft = ImportDraft & {
  kind: "scout";
  entryType: "match" | "pit";
  eventKey: string;
  matchKey?: string;
  teamKey: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
};

/**
 * One field of an imported form definition. Shaped like `FieldDefinition` from
 * `@vantage/scouting` so the form builder can load it without a translation
 * step; `type` is constrained by `VantageFieldType` at the call sites.
 */
export type ScoutFormFieldDraft = {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  helpText?: string;
  config?: Record<string, unknown>;
};

/**
 * A scouting form definition destined for the builder as an UNPUBLISHED draft.
 * `definition` is a `SchemaDefinition`, which is exactly what the builder's
 * `draftFromDefinition` consumes — nothing is published by importing.
 */
export type ScoutFormDraft = ImportDraft & {
  kind: "form";
  entryType: "match" | "pit";
  definition: { title: string; fields: ScoutFormFieldDraft[] };
};

/**
 * One roster row an owner reviews before anything is sent. Importing NEVER
 * invites: this draft only reaches the invite machinery when a human commits it.
 */
export type InviteDraft = ImportDraft & {
  kind: "invite";
  email: string;
  personName: string;
  idempotencyKey: string;
};

export function provenanceNow(
  source: ImportSource,
  extra?: Omit<ImportProvenance, "source" | "importedAt">,
  now: Date = new Date(),
): ImportProvenance {
  return {
    source,
    importedAt: now.toISOString(),
    ...extra,
  };
}
