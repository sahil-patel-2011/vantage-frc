export type ImportSource =
  | "notion"
  | "google_calendar"
  | "ics"
  | "csv"
  | "scoutingpass"
  | "lovat"
  | "sheets";

export type ImportProvenance = {
  source: ImportSource;
  importedAt: string;
  sourceUrl?: string;
  sourceId?: string;
  sourceFile?: string;
};

export type ImportDraftKind = "calendar" | "task" | "knowledge" | "scout" | "hours";

export type ImportDraft = {
  kind: ImportDraftKind;
  title: string;
  body?: string;
  startsAt?: string;
  endsAt?: string;
  payload?: Record<string, unknown>;
  provenance: ImportProvenance;
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
