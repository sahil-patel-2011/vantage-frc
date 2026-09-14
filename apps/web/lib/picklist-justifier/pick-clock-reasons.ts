// Stored pick-list justifications → Pick Clock recommendation reasons.
//
// Pick Clock used to rebuild `reasons` from season rating / rank / notes and never read the
// justifier rows. This module is the read helper pick-clock imports: load the
// saved rationale (unified pick_list_entries columns + one-release sidecar
// fallback), turn it into glanceable {label, tone} lines, and merge those onto
// a recommendation. Do not invent metrics — skip teams with no stored row.
//
// Pick Clock should import from here rather than teaching pick-clock-board.ts
// how to parse justifier rows.

import type { PoolClient } from "@neondatabase/serverless";
import { studentRatingLabel } from "../ui/student-rating-label";
import type { PickClockJustificationReason, PicklistSourceRef } from "./types";

export type { PickClockJustificationReason };

const GLANCE_MAX = 80;
const CLOCK_REASON_CAP = 4;

export type StoredPicklistJustification = {
  pickListEntryId: string;
  teamKey: string;
  rationale: string;
  sources: PicklistSourceRef[];
  contradictionFlagged: boolean;
  contradictionReason: string | null;
  generatedAt: string | null;
};

export type StoredJustificationIndex = {
  byTeamKey: Map<string, StoredPicklistJustification>;
  byEntryId: Map<string, StoredPicklistJustification>;
};

type SavedJustificationRow = {
  pickListEntryId: string;
  teamKey: string;
  rationale: string;
  sources: unknown;
  contradictionFlagged: boolean;
  contradictionReason: string | null;
  createdAt: string | null;
};

const SOURCE_KINDS = new Set(["hard_metric", "scout_observation"]);

/** Collapse stored text to a clock-width label. Returns null instead of inventing a line. */
export function glanceableLabel(text: string | null | undefined, max = GLANCE_MAX): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  const sentence = trimmed.split(/(?<=\.)\s+/)[0] ?? trimmed;
  if (sentence.length <= max) return sentence;
  return `${sentence.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

/** Prefer the official-record clause of a stored contradiction so the clock keeps the win-rate fact. */
function glanceableContradiction(reason: string | null | undefined): string | null {
  if (typeof reason !== "string") return null;
  const afterBut = reason.match(/\bbut\s+(.+)/i)?.[1];
  return glanceableLabel(afterBut ?? reason);
}

export function parseJustificationSources(value: unknown): PicklistSourceRef[] {
  const raw = typeof value === "string" ? safeJsonArray(value) : value;
  if (!Array.isArray(raw)) return [];
  const sources: PicklistSourceRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const kind = typeof record.kind === "string" ? record.kind : "";
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const detail = typeof record.detail === "string" ? record.detail.trim() : "";
    if (!SOURCE_KINDS.has(kind) || !label) continue;
    sources.push({
      kind: kind as PicklistSourceRef["kind"],
      label,
      detail,
    });
  }
  return sources;
}

function safeJsonArray(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

/**
 * Build a stored-row shape from a pick-list entry that already carries justification
 * columns (listPickList / setJustification). Null when nothing was generated.
 */
export function storedJustificationFromEntry(entry: {
  id?: string | null;
  teamKey: string;
  justification?: string | null;
  justificationSources?: unknown;
  justificationContradiction?: boolean | null;
  justificationReason?: string | null;
  justificationGeneratedAt?: string | null;
}): StoredPicklistJustification | null {
  const rationale = entry.justification?.trim() ?? "";
  if (!rationale) return null;
  return {
    pickListEntryId: entry.id ?? "",
    teamKey: entry.teamKey,
    rationale,
    sources: parseJustificationSources(entry.justificationSources),
    contradictionFlagged: Boolean(entry.justificationContradiction),
    contradictionReason: entry.justificationReason ?? null,
    generatedAt: entry.justificationGeneratedAt ?? null,
  };
}

/** Rewrite leftover stored EPA / TBA labels so the clock stays student-readable. */
export function studentPickClockLabel(text: string): string {
  return studentRatingLabel(text);
}

/**
 * Glanceable clock lines from one stored justifier row.
 * Contradiction first (caution), then the rationale sentence, then cited sources.
 * Never invents season ratings / win-rate / scout counts that were not persisted.
 */
export function pickClockReasonsFromJustification(
  row: StoredPicklistJustification,
  options?: { maxReasons?: number },
): PickClockJustificationReason[] {
  const max = Math.max(0, options?.maxReasons ?? CLOCK_REASON_CAP);
  const reasons: PickClockJustificationReason[] = [];

  if (row.contradictionFlagged) {
    const caution = studentPickClockLabel(
      glanceableContradiction(row.contradictionReason) ?? "Scout story contradicts the official match record",
    );
    reasons.push({ label: caution, tone: "caution" });
  }

  const why = glanceableLabel(row.rationale);
  if (why) reasons.push({ label: studentPickClockLabel(why), tone: "strong" });

  for (const source of row.sources) {
    const label = glanceableLabel(source.detail ? `${source.label}: ${source.detail}` : source.label);
    if (!label) continue;
    reasons.push({
      label: studentPickClockLabel(label),
      tone: source.kind === "scout_observation" ? "strong" : "neutral",
    });
  }

  return dedupeReasons(reasons).slice(0, max);
}

export function pickClockReasonsByTeam(
  rows: Iterable<StoredPicklistJustification>,
): Map<string, PickClockJustificationReason[]> {
  const map = new Map<string, PickClockJustificationReason[]>();
  for (const row of rows) {
    map.set(row.teamKey, pickClockReasonsFromJustification(row));
  }
  return map;
}

function normalizeReasonKey(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase();
}

function dedupeReasons(reasons: PickClockJustificationReason[]): PickClockJustificationReason[] {
  const seen = new Set<string>();
  const out: PickClockJustificationReason[] = [];
  for (const reason of reasons) {
    const key = normalizeReasonKey(reason.label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(reason);
  }
  return out;
}

/** Stored justifier lines first, then existing clock lines — cap to what fits on a glance screen. */
export function mergePickClockReasons(
  stored: readonly PickClockJustificationReason[],
  existing: readonly PickClockJustificationReason[],
  max = CLOCK_REASON_CAP,
): PickClockJustificationReason[] {
  return dedupeReasons(
    [...stored, ...existing].map((reason) => ({
      ...reason,
      label: studentPickClockLabel(reason.label),
    })),
  ).slice(0, Math.max(0, max));
}

export type PickClockReasonCarrier = {
  teamKey: string;
  headline: string;
  reasons: PickClockJustificationReason[];
};

/**
 * Overlay stored justifier reasons onto one recommendation. Unchanged when that
 * team has no stored row — never fabricate a "why".
 */
export function applyStoredJustificationToRecommendation<T extends PickClockReasonCarrier>(
  recommendation: T,
  stored: StoredPicklistJustification | ReadonlyMap<string, StoredPicklistJustification> | null,
): T {
  const row =
    stored instanceof Map
      ? (stored.get(recommendation.teamKey) ?? null)
      : stored && typeof stored === "object" && "get" in stored && typeof stored.get === "function"
        ? (stored.get(recommendation.teamKey) ?? null)
        : stored && "teamKey" in stored && stored.teamKey === recommendation.teamKey
          ? stored
          : null;
  if (!row) return recommendation;
  const storedReasons = pickClockReasonsFromJustification(row);
  if (!storedReasons.length) return recommendation;
  return {
    ...recommendation,
    reasons: mergePickClockReasons(storedReasons, recommendation.reasons),
  };
}

export type PickClockResultCarrier<T extends PickClockReasonCarrier> = {
  recommendation: T | null;
  alternates: T[];
};

/** Apply stored reasons to the primary recommendation and every alternate. */
export function applyStoredJustificationsToPickClockResult<T extends PickClockReasonCarrier>(
  result: PickClockResultCarrier<T>,
  byTeam: ReadonlyMap<string, StoredPicklistJustification>,
): PickClockResultCarrier<T> {
  if (byTeam.size === 0) return result;
  return {
    ...result,
    recommendation: result.recommendation
      ? applyStoredJustificationToRecommendation(result.recommendation, byTeam)
      : null,
    alternates: result.alternates.map((alt) => applyStoredJustificationToRecommendation(alt, byTeam)),
  };
}

function emptyIndex(): StoredJustificationIndex {
  return { byTeamKey: new Map(), byEntryId: new Map() };
}

function indexRows(rows: StoredPicklistJustification[]): StoredJustificationIndex {
  const index = emptyIndex();
  for (const row of rows) {
    index.byTeamKey.set(row.teamKey, row);
    if (row.pickListEntryId) index.byEntryId.set(row.pickListEntryId, row);
  }
  return index;
}

function mapSavedRow(row: SavedJustificationRow): StoredPicklistJustification | null {
  const rationale = typeof row.rationale === "string" ? row.rationale.trim() : "";
  if (!rationale || !row.teamKey) return null;
  return {
    pickListEntryId: row.pickListEntryId,
    teamKey: row.teamKey,
    rationale,
    sources: parseJustificationSources(row.sources),
    contradictionFlagged: Boolean(row.contradictionFlagged),
    contradictionReason: row.contradictionReason,
    generatedAt: row.createdAt,
  };
}

/**
 * Resolve the same list Pick Clock writes — explicit id, else the most recently
 * touched list for the event, else the org's most recent list.
 */
export async function resolveJustifierPickListId(
  client: PoolClient,
  input: { orgId: string; pickListId?: string | null; eventKey?: string | null },
): Promise<string | null> {
  if (input.pickListId) return input.pickListId;
  const result = await client.query<{ id: string }>(
    `SELECT id
     FROM pick_lists
     WHERE org_id = $1::uuid
       AND ($2::text IS NULL OR event_key = $2::text)
     ORDER BY updated_at DESC
     LIMIT 1`,
    [input.orgId, input.eventKey ?? null],
  );
  return result.rows[0]?.id ?? null;
}

/**
 * Read helper Pick Clock imports.
 *
 * Unified columns on pick_list_entries win; the legacy sidecar is LEFT JOINed
 * for one release (migration 0454). Teams without a stored rationale are omitted
 * — the clock keeps its season-rating / rank fallback instead of inventing a "why".
 */
export async function loadStoredJustificationsForPickClock(
  client: PoolClient,
  input: {
    orgId: string;
    pickListId?: string | null;
    eventKey?: string | null;
    teamKeys?: readonly string[] | null;
  },
): Promise<StoredJustificationIndex> {
  const pickListId = await resolveJustifierPickListId(client, input);
  if (!pickListId) return emptyIndex();

  const teamKeys = [...new Set((input.teamKeys ?? []).filter(Boolean))];
  const result = await client.query<SavedJustificationRow>(
    `SELECT e.id AS "pickListEntryId",
            e.team_key AS "teamKey",
            COALESCE(e.justification, j.rationale) AS rationale,
            COALESCE(NULLIF(e.justification_sources, '[]'::jsonb), j.sources, '[]'::jsonb) AS sources,
            COALESCE(
              CASE WHEN e.justification IS NOT NULL THEN e.justification_contradiction END,
              j.contradiction_flagged, false
            ) AS "contradictionFlagged",
            COALESCE(
              CASE WHEN e.justification IS NOT NULL THEN e.justification_reason END,
              j.contradiction_reason
            ) AS "contradictionReason",
            COALESCE(e.justification_generated_at, j.created_at)::text AS "createdAt"
     FROM pick_list_entries e
     LEFT JOIN picklist_justifier_justifications j ON j.pick_list_entry_id = e.id
     WHERE e.org_id = $1::uuid AND e.pick_list_id = $2::uuid
       AND (e.justification IS NOT NULL OR j.rationale IS NOT NULL)
       AND ($3::text[] IS NULL OR e.team_key = ANY($3::text[]))`,
    [input.orgId, pickListId, teamKeys.length ? teamKeys : null],
  );

  const rows: StoredPicklistJustification[] = [];
  for (const row of result.rows) {
    const mapped = mapSavedRow(row);
    if (mapped) rows.push(mapped);
  }
  return indexRows(rows);
}
