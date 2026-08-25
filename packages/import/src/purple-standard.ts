/**
 * The Purple Standard (TPS) — the community scouting interchange schema.
 * https://github.com/The-Purple-Warehouse/the-purple-standard
 *
 * Verified against the published spec and the repo's own examples:
 *  - An entry has six OPTIONAL root buckets: abilities, counters, data,
 *    metadata, ratings, timers.
 *  - Fields are referenced by dot path (`data.notes`, `metadata.scouter.name`).
 *  - metadata carries `event`, `match {level,number,set}`, `bot`, `scouter
 *    {name,team,app}`, `timestamp`, `modified-timestamp`.
 *  - `level` is one of qm / sf / f.
 *  - A file is either a single entry, a bare array of entries, or
 *    `{ "entries": [ ... ] }` (the repo ships both example shapes).
 *  - The dedupe hash is "SHA-256 on the stringified JSON entry where each field
 *    in the JSON is sorted in alphabetical order".
 *
 * Round trip: packages/export-center emits our match payload in the `data`
 * bucket, so importing exposes `data` keys BOTH bare (which is what makes a
 * Vantage -> TPS -> Vantage round trip lossless for our own fields) and as dot
 * paths (which is what preserves a foreign team's TPS file for review).
 */

import { createHash } from "node:crypto";
import { provenanceNow, type ScoutEntryDraft } from "./provenance";
import {
  emptyResult,
  isRecord,
  parseJsonOrReject,
  rejectShape,
  type ImportResult,
} from "./result";

export const PURPLE_STANDARD_BUCKETS = [
  "abilities",
  "counters",
  "data",
  "metadata",
  "ratings",
  "timers",
] as const;

export type PurpleStandardBucket = (typeof PURPLE_STANDARD_BUCKETS)[number];

export const PURPLE_STANDARD_MATCH_LEVELS = ["qm", "sf", "f"] as const;
export type PurpleStandardMatchLevel = (typeof PURPLE_STANDARD_MATCH_LEVELS)[number];

export type PurpleStandardMatch = {
  level?: string;
  number?: number;
  set?: number;
};

export type PurpleStandardMetadata = {
  event?: string;
  match?: PurpleStandardMatch;
  bot?: string | number;
  scouter?: { name?: string; team?: string | number; app?: string };
  timestamp?: number;
  "modified-timestamp"?: number;
};

export type PurpleStandardEntry = {
  abilities?: Record<string, unknown>;
  counters?: Record<string, unknown>;
  data?: Record<string, unknown>;
  metadata?: PurpleStandardMetadata;
  ratings?: Record<string, unknown>;
  timers?: Record<string, unknown>;
};

const EXPECTED =
  "a Purple Standard entry, a bare array of entries, or { \"entries\": [ ... ] }, " +
  "where each entry has at least one of abilities / counters / data / metadata / ratings / timers.";

/** Recursively sort object keys so the hash is deterministic, per the spec. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = canonicalize(value[key]);
    return sorted;
  }
  return value;
}

/**
 * The TPS entry hash: SHA-256 over the alphabetically key-sorted JSON. Used as
 * the idempotency key so re-importing the same file writes nothing new.
 */
export function purpleStandardHash(entry: PurpleStandardEntry): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(entry))).digest("hex");
}

function looksLikeEntry(value: unknown): value is PurpleStandardEntry {
  if (!isRecord(value)) return false;
  return PURPLE_STANDARD_BUCKETS.some((bucket) => bucket in value);
}

/** Accepts all three published container shapes; rejects anything else by name. */
export function readPurpleStandardEntries(content: string): PurpleStandardEntry[] {
  const parsed = parseJsonOrReject(content, EXPECTED);
  const candidates: unknown[] = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed.entries)
      ? parsed.entries
      : [parsed];
  if (!candidates.length) return [];
  if (!candidates.some(looksLikeEntry)) {
    const found = isRecord(parsed)
      ? `That JSON has top-level keys ${Object.keys(parsed).slice(0, 8).join(", ") || "(none)"}.`
      : "That JSON is not a Purple Standard entry container.";
    rejectShape(found, EXPECTED);
  }
  return candidates.filter(looksLikeEntry);
}

/** Mirrors the match-key form our Purple Standard export writes. */
export function purpleStandardMatchKey(
  eventKey: string,
  match: PurpleStandardMatch | undefined,
): { matchKey: string } | { error: string } {
  if (!match || typeof match !== "object") return { error: "metadata.match is missing" };
  const level = typeof match.level === "string" ? match.level.toLowerCase() : "";
  const number = Number(match.number);
  if (!Number.isInteger(number) || number < 1) {
    return { error: "metadata.match.number must be a positive whole number" };
  }
  if (level === "qm") return { matchKey: `${eventKey}_qm${number}` };
  const set = Number(match.set);
  if (!Number.isInteger(set) || set < 1) {
    return { error: `metadata.match.set is required for level "${level}"` };
  }
  if (level === "sf") return { matchKey: `${eventKey}_sf${set}m${number}` };
  if (level === "f") return { matchKey: `${eventKey}_f${set}m${number}` };
  return {
    error: `metadata.match.level "${match.level ?? ""}" is not one of ${PURPLE_STANDARD_MATCH_LEVELS.join(" / ")}`,
  };
}

function flattenBucket(
  prefix: string,
  bucket: unknown,
  into: Record<string, unknown>,
): void {
  if (!isRecord(bucket)) return;
  for (const [key, value] of Object.entries(bucket)) into[`${prefix}.${key}`] = value;
}

export type PurpleStandardImportInput = {
  content: string;
  /** Only entries for this event are imported when set; others are skipped by name. */
  eventKey?: string;
  sourceFile?: string;
  now?: Date;
};

/**
 * TPS JSON -> scouting entry drafts. Entries missing event, bot, or a usable
 * match are skipped with the exact field that was missing — never guessed.
 */
export function purpleStandardEntriesToDrafts(
  input: PurpleStandardImportInput,
): ImportResult<ScoutEntryDraft> {
  const result = emptyResult<ScoutEntryDraft>();
  const entries = readPurpleStandardEntries(input.content);
  const now = input.now ?? new Date();
  const seen = new Set<string>();

  entries.forEach((entry, index) => {
    const ref = `entry ${index + 1}`;
    const metadata = isRecord(entry.metadata) ? (entry.metadata as PurpleStandardMetadata) : null;
    if (!metadata) {
      result.skipped.push({ ref, reason: "metadata is missing, so the entry has no event or team" });
      return;
    }
    const eventKey = typeof metadata.event === "string" ? metadata.event.trim() : "";
    if (!eventKey) {
      result.skipped.push({ ref, reason: "metadata.event is missing" });
      return;
    }
    if (input.eventKey && eventKey !== input.eventKey) {
      result.skipped.push({
        ref,
        reason: `metadata.event is ${eventKey}, not the selected event ${input.eventKey}`,
      });
      return;
    }
    const bot = String(metadata.bot ?? "").trim();
    if (!/^\d+$/.test(bot)) {
      result.skipped.push({ ref, reason: "metadata.bot must be an FRC team number" });
      return;
    }
    const match = purpleStandardMatchKey(eventKey, metadata.match);
    if ("error" in match) {
      result.skipped.push({ ref, reason: match.error });
      return;
    }

    const payload: Record<string, unknown> = {};
    for (const bucket of PURPLE_STANDARD_BUCKETS) {
      if (bucket === "metadata") continue;
      flattenBucket(bucket, entry[bucket], payload);
    }
    // Bare `data` keys last: this is where our own export writes the Vantage
    // payload, which is what makes the round trip lossless for shared fields.
    if (isRecord(entry.data)) Object.assign(payload, entry.data);

    const hash = purpleStandardHash(entry);
    if (seen.has(hash)) {
      result.skipped.push({ ref, reason: "duplicate of an earlier entry (identical TPS hash)" });
      return;
    }
    seen.add(hash);

    result.drafts.push({
      kind: "scout",
      entryType: "match",
      title: `frc${bot} · ${match.matchKey}`,
      eventKey,
      matchKey: match.matchKey,
      teamKey: `frc${bot}`,
      idempotencyKey: `tps:${hash}`,
      payload,
      provenance: provenanceNow(
        "purple_standard",
        { sourceId: hash, sourceFile: input.sourceFile },
        now,
      ),
    });
  });

  return result;
}
