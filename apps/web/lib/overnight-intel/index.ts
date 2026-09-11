// Pure, framework-free helpers for the Overnight Intel brief. No I/O — callers pass in rows
// already scoped (via RLS) to the requesting org/event; these functions only shape and
// summarize what is actually there.

import type {
  OvernightIntelBrief,
  OvernightIntelEpaMover,
  OvernightIntelResearchHighlight,
  OvernightIntelScoutingHighlight,
} from "./types";

export * from "./types";

const EPA_MOVER_THRESHOLD = 0.75;
const MAX_RESEARCH_HIGHLIGHTS = 15;
const MAX_EPA_MOVERS = 12;
const MAX_SCOUTING_HIGHLIGHTS = 15;

export type RawResearchFindingRow = {
  teamKey: string;
  teamNumber: number | null;
  title: string | null;
  summary: string;
  sourceType: string;
  sourceUrl: string;
  foundAt: string;
};

export function summarizeResearchFindings(rows: RawResearchFindingRow[]): OvernightIntelResearchHighlight[] {
  return rows
    .map((row) => ({
      teamKey: row.teamKey,
      teamNumber: row.teamNumber,
      title: (row.title ?? "").trim() || "Untitled finding",
      summary: row.summary.trim().slice(0, 400),
      sourceType: row.sourceType,
      sourceUrl: row.sourceUrl,
      foundAt: row.foundAt,
    }))
    .sort((a, b) => (a.foundAt < b.foundAt ? 1 : -1))
    .slice(0, MAX_RESEARCH_HIGHLIGHTS);
}

export type RawEpaRow = { teamKey: string; teamNumber: number | null; epaTotal: number };
export type RawEpaSnapshotRow = { teamKey: string; epaTotal: number | null; capturedAt: string };

/** Diffs current EPA against the most recent stored snapshot per team; only real deltas, sorted by magnitude. */
export function buildEpaMovers(current: RawEpaRow[], previous: RawEpaSnapshotRow[]): OvernightIntelEpaMover[] {
  const previousByTeam = new Map(previous.map((row) => [row.teamKey, row]));
  const movers: OvernightIntelEpaMover[] = current.map((row) => {
    const prior = previousByTeam.get(row.teamKey);
    const previousEpa = prior?.epaTotal ?? null;
    return {
      teamKey: row.teamKey,
      teamNumber: row.teamNumber,
      previousEpa,
      currentEpa: row.epaTotal,
      deltaEpa: previousEpa != null ? Math.round((row.epaTotal - previousEpa) * 100) / 100 : null,
      previousCapturedAt: prior?.capturedAt ?? null,
    };
  });
  return movers
    .filter((mover) => mover.deltaEpa != null && Math.abs(mover.deltaEpa) >= EPA_MOVER_THRESHOLD)
    .sort((a, b) => Math.abs(b.deltaEpa ?? 0) - Math.abs(a.deltaEpa ?? 0))
    .slice(0, MAX_EPA_MOVERS);
}

export type RawScoutingActivityRow = {
  teamKey: string;
  teamNumber: number | null;
  newEntries: number;
  lastScoutedAt: string;
};

export function summarizeScoutingActivity(rows: RawScoutingActivityRow[]): OvernightIntelScoutingHighlight[] {
  return rows
    .filter((row) => row.newEntries > 0)
    .sort((a, b) => b.newEntries - a.newEntries)
    .slice(0, MAX_SCOUTING_HIGHLIGHTS)
    .map((row) => ({
      teamKey: row.teamKey,
      teamNumber: row.teamNumber,
      newEntries: row.newEntries,
      lastScoutedAt: row.lastScoutedAt,
    }));
}

function teamLabel(teamKey: string, teamNumber: number | null): string {
  return teamNumber != null ? `Team ${teamNumber}` : teamKey;
}

/** Deterministic, zero-hallucination narrative woven only from the grounded signals passed in. */
export function buildOvernightSummaryText(input: {
  eventName: string;
  briefDate: string;
  researchHighlights: OvernightIntelResearchHighlight[];
  epaMovers: OvernightIntelEpaMover[];
  scoutingHighlights: OvernightIntelScoutingHighlight[];
}): string {
  const { eventName, briefDate, researchHighlights, epaMovers, scoutingHighlights } = input;
  const parts: string[] = [`Overnight brief for ${eventName} — ${briefDate}.`];

  if (researchHighlights.length > 0) {
    const teams = new Set(researchHighlights.map((r) => r.teamKey)).size;
    parts.push(
      `${researchHighlights.length} new research finding(s) surfaced across ${teams} team(s), most recently: "${researchHighlights[0]!.title}".`,
    );
  } else {
    parts.push("No new research findings since the last brief.");
  }

  if (epaMovers.length > 0) {
    const top = epaMovers[0]!;
    const direction = (top.deltaEpa ?? 0) >= 0 ? "up" : "down";
    parts.push(
      `${epaMovers.length} team(s) moved on season rating; the largest swing is ${teamLabel(top.teamKey, top.teamNumber)} ${direction} ${Math.abs(top.deltaEpa ?? 0)} to ${top.currentEpa}.`,
    );
  } else {
    parts.push("No material season-rating movement detected.");
  }

  if (scoutingHighlights.length > 0) {
    const totalEntries = scoutingHighlights.reduce((sum, row) => sum + row.newEntries, 0);
    parts.push(
      `${totalEntries} new scouting entr${totalEntries === 1 ? "y" : "ies"} logged across ${scoutingHighlights.length} team(s).`,
    );
  } else {
    parts.push("No new scouting entries logged overnight.");
  }

  return parts.join(" ");
}

export function briefDateKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function mapBriefRow(row: {
  id: string;
  eventKey: string;
  seasonYear: number;
  briefDate: string;
  summary: string;
  researchHighlights: unknown;
  epaMovers: unknown;
  scoutingHighlights: unknown;
  generatedAt: string;
}): OvernightIntelBrief {
  return {
    id: row.id,
    eventKey: row.eventKey,
    seasonYear: row.seasonYear,
    briefDate: row.briefDate,
    summary: row.summary,
    researchHighlights: Array.isArray(row.researchHighlights)
      ? (row.researchHighlights as OvernightIntelResearchHighlight[])
      : [],
    epaMovers: Array.isArray(row.epaMovers) ? (row.epaMovers as OvernightIntelEpaMover[]) : [],
    scoutingHighlights: Array.isArray(row.scoutingHighlights)
      ? (row.scoutingHighlights as OvernightIntelScoutingHighlight[])
      : [],
    generatedAt: row.generatedAt,
  };
}
