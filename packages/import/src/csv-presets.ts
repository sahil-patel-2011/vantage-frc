/**
 * Saved column-mapping presets and header auto-detection for the generic
 * Google Sheets / CSV importer.
 *
 * Two jobs:
 *  1. SUGGESTIONS. `suggestColumnMap` (csv-map.ts) only matches exact header
 *    aliases, so "Team #" or "Match Num" fall through to `ignore`. This adds
 *    fuzzy scoring with an explicit confidence, so the UI can show "we think
 *    this is the team column" without ever committing on the guess.
 *  2. PRESETS. A named mapping the org saves once, so week-2's export is one
 *    click. A preset is applied only to the columns it actually names —
 *    a header the preset does not know stays `ignore`, never a guess.
 *
 * Nothing here commits anything. `applyPreset` and `autoDetectColumns` both
 * return a proposal for a human to confirm.
 */

import { guessColumn, type ColumnGuess } from "./csv-map";

export type MappingConfidence = "exact" | "likely" | "unsure";

export type ColumnSuggestion = {
  header: string;
  target: ColumnGuess;
  confidence: MappingConfidence;
  /** Why this was proposed, shown next to the column in the review UI. */
  reason: string;
};

/** Word stems that point at a target when they appear anywhere in a header. */
const STEMS: Array<{ target: Exclude<ColumnGuess, "ignore">; stems: string[] }> = [
  { target: "event_key", stems: ["eventkey", "eventcode", "event", "comp", "regional", "tournament"] },
  { target: "match_key", stems: ["matchkey", "matchnumber", "matchnum", "match", "qual"] },
  { target: "team_key", stems: ["teamkey", "teamnumber", "teamnum", "team", "frc", "robot"] },
  { target: "hours", stems: ["hours", "hrs", "duration", "timespent", "worked"] },
  { target: "person", stems: ["name", "student", "member", "person", "scout", "email", "who"] },
  { target: "date", stems: ["date", "day", "when", "checkin", "loggedon", "timestamp"] },
];

function normalize(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * One header -> one proposal. `guessColumn`'s exact alias table wins; a stem
 * match is offered as "likely"; a stem that is only a prefix is "unsure".
 */
export function suggestColumn(header: string): ColumnSuggestion {
  const exact = guessColumn(header);
  if (exact !== "ignore") {
    return { header, target: exact, confidence: "exact", reason: `"${header}" is a known column name` };
  }
  const key = normalize(header);
  if (!key) {
    return { header, target: "ignore", confidence: "exact", reason: "the header is blank" };
  }
  for (const { target, stems } of STEMS) {
    const contained = stems.find((stem) => key.includes(stem));
    if (contained) {
      return {
        header,
        target,
        confidence: "likely",
        reason: `"${header}" contains "${contained}"`,
      };
    }
  }
  for (const { target, stems } of STEMS) {
    const prefix = stems.find((stem) => stem.length >= 4 && stem.startsWith(key) && key.length >= 3);
    if (prefix) {
      return {
        header,
        target,
        confidence: "unsure",
        reason: `"${header}" looks like an abbreviation of "${prefix}"`,
      };
    }
  }
  return { header, target: "ignore", confidence: "exact", reason: "no target matched this header" };
}

/**
 * Auto-detection for a whole header row. A target is only ever proposed once:
 * if two headers both look like the team column, the stronger match keeps it
 * and the weaker one is left as `ignore` for the user to resolve — a silent
 * double-map would make the committed rows depend on column order.
 */
export function autoDetectColumns(headers: string[]): ColumnSuggestion[] {
  const rank: Record<MappingConfidence, number> = { exact: 0, likely: 1, unsure: 2 };
  const suggestions = headers.map(suggestColumn);
  const claimed = new Map<ColumnGuess, number>();
  suggestions.forEach((suggestion, index) => {
    if (suggestion.target === "ignore") return;
    const held = claimed.get(suggestion.target);
    if (held === undefined) {
      claimed.set(suggestion.target, index);
      return;
    }
    const incumbent = suggestions[held]!;
    if (rank[suggestion.confidence] < rank[incumbent.confidence]) {
      suggestions[held] = {
        ...incumbent,
        target: "ignore",
        confidence: "unsure",
        reason: `"${suggestion.header}" is a closer match for ${incumbent.target} — pick one`,
      };
      claimed.set(suggestion.target, index);
    } else {
      suggestions[index] = {
        ...suggestion,
        target: "ignore",
        confidence: "unsure",
        reason: `"${incumbent.header}" is already mapped to ${suggestion.target} — pick one`,
      };
    }
  });
  return suggestions;
}

/** A named, org-scoped mapping saved from a reviewed import. */
export type MappingPreset = {
  id: string;
  name: string;
  /** header -> target. Headers absent here are left unmapped on purpose. */
  columns: Record<string, ColumnGuess>;
};

export type PresetApplication = {
  columns: ColumnSuggestion[];
  /** Preset headers this file does not have — the sheet changed shape. */
  missingHeaders: string[];
  /** File headers the preset says nothing about. */
  unknownHeaders: string[];
};

/**
 * Apply a saved preset to a fresh header row. Headers the preset does not name
 * fall back to auto-detection as a SUGGESTION, and every difference between the
 * preset and the file is reported so a changed sheet is visible before commit.
 */
export function applyPreset(preset: MappingPreset, headers: string[]): PresetApplication {
  const detected = new Map(autoDetectColumns(headers).map((item) => [item.header, item]));
  const columns: ColumnSuggestion[] = headers.map((header) => {
    const target = preset.columns[header];
    if (target !== undefined) {
      return {
        header,
        target,
        confidence: "exact",
        reason: `saved by the "${preset.name}" preset`,
      };
    }
    const fallback = detected.get(header);
    return (
      fallback ?? { header, target: "ignore", confidence: "exact", reason: "no target matched this header" }
    );
  });
  const fileHeaders = new Set(headers);
  return {
    columns,
    missingHeaders: Object.keys(preset.columns).filter((header) => !fileHeaders.has(header)),
    unknownHeaders: headers.filter((header) => preset.columns[header] === undefined),
  };
}

/** Reduce a reviewed mapping back to the shape a preset stores. */
export function presetColumnsFromMapping(
  mapping: Record<string, ColumnGuess>,
): Record<string, ColumnGuess> {
  return Object.fromEntries(
    Object.entries(mapping).filter(([header, target]) => header.trim() && target !== "ignore"),
  );
}
