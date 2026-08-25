/**
 * Formatting for the owner/admin audited export of one member's DM history.
 *
 * This is a safeguarding record, not an analytics feature: it exports exactly one named member's
 * private conversations, it requires a written reason, and every call writes an audit row. Pure
 * formatting only — the authorisation lives in `org_member_dm_export` (migration 0455) and the
 * audit write lives in the route.
 */

export const DM_EXPORT_FORMATS = ["json", "csv"] as const;
export type DmExportFormat = (typeof DM_EXPORT_FORMATS)[number];

export const MIN_EXPORT_REASON = 8;
export const MAX_EXPORT_REASON = 500;

export function normalizeExportFormat(value: unknown): DmExportFormat {
  const raw = typeof value === "string" ? value.trim().toLowerCase() : "";
  return raw === "csv" ? "csv" : "json";
}

/**
 * A reason is required. An unexplained read of a student's private messages is the thing this
 * feature is supposed to make impossible to do quietly.
 */
export function normalizeExportReason(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw.length < MIN_EXPORT_REASON) {
    throw new Error(
      `Give a reason for this export (at least ${MIN_EXPORT_REASON} characters). It is recorded in the team's audit log.`,
    );
  }
  if (raw.length > MAX_EXPORT_REASON) {
    throw new Error(`Keep the reason under ${MAX_EXPORT_REASON} characters.`);
  }
  return raw;
}

export type DmExportRow = {
  conversationId: string;
  messageId: string;
  sentAt: string;
  deletedAt: string | null;
  authorUserId: string;
  authorName: string;
  authorEmail: string | null;
  body: string;
  counterparties: string;
  supervisors: string;
};

export const DM_EXPORT_COLUMNS = [
  "conversationId",
  "sentAt",
  "authorName",
  "authorEmail",
  "counterparties",
  "supervisors",
  "deletedAt",
  "body",
] as const satisfies readonly (keyof DmExportRow)[];

/** RFC 4180 quoting. A leading =,+,-,@ is prefixed with ' so spreadsheets do not run it. */
export function csvCell(value: string | null | undefined): string {
  const raw = value == null ? "" : String(value);
  const guarded = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${guarded.replace(/"/g, '""')}"`;
}

export function toDmExportCsv(rows: DmExportRow[]): string {
  const lines = [DM_EXPORT_COLUMNS.map((column) => csvCell(column)).join(",")];
  for (const row of rows) {
    lines.push(DM_EXPORT_COLUMNS.map((column) => csvCell(row[column])).join(","));
  }
  return `${lines.join("\r\n")}\r\n`;
}

/** Filenames go into a safeguarding file; keep them boring and filesystem-safe. */
export function dmExportFilename(memberName: string, format: DmExportFormat, now = new Date()): string {
  const slug =
    memberName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "member";
  const stamp = now.toISOString().slice(0, 10);
  return `dm-history-${slug}-${stamp}.${format}`;
}

export function dmExportSummary(rows: DmExportRow[]): {
  messageCount: number;
  conversationCount: number;
  deletedCount: number;
  firstSentAt: string | null;
  lastSentAt: string | null;
} {
  const conversations = new Set<string>();
  let deletedCount = 0;
  let firstSentAt: string | null = null;
  let lastSentAt: string | null = null;
  for (const row of rows) {
    conversations.add(row.conversationId);
    if (row.deletedAt) deletedCount += 1;
    if (!firstSentAt || row.sentAt < firstSentAt) firstSentAt = row.sentAt;
    if (!lastSentAt || row.sentAt > lastSentAt) lastSentAt = row.sentAt;
  }
  return {
    messageCount: rows.length,
    conversationCount: conversations.size,
    deletedCount,
    firstSentAt,
    lastSentAt,
  };
}
