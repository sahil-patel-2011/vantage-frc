import type { EventMetricRow, YearMetricRow } from "./signals";
import type { TeamOperationalSignal } from "./types";

export type DossierSource = "tba" | "statbotics" | "scout";

export type DossierCitation = {
  source: DossierSource;
  detail: string;
  syncedAt?: string | null;
  eventKey?: string | null;
  eventName?: string | null;
  year?: number | null;
};

function eventDisplayLabel(eventKey: string, eventName?: string | null): string {
  const name = eventName?.trim();
  if (name) return name;
  if (eventKey.includes("custom-")) return "Your event";
  return eventKey;
}

export type DossierFactCard = {
  id: string;
  category: "identity" | "season_epa" | "event" | "record" | "scout";
  title: string;
  value: string;
  citation: DossierCitation;
};

export type TeamIdentity = {
  teamKey: string;
  teamNumber: number;
  nickname: string | null;
  name: string | null;
  city: string | null;
  stateProv: string | null;
  country: string | null;
  rookieYear: number | null;
  /** Provenance for identity fields (almost always TBA cache). */
  source?: DossierSource;
  syncedAt?: string | null;
};

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

/** The public name of a rating source ("tba" → "The Blue Alliance"), for the dossier's source notes. */
function sourceName(source: string): string {
  const key = source.toLowerCase();
  if (key === "tba") return "The Blue Alliance";
  if (key === "statbotics") return "Statbotics";
  return source;
}

function normalizeSource(source?: string | null): DossierSource | null {
  if (source === "tba" || source === "statbotics" || source === "scout") return source;
  return null;
}

function preferMetric<T extends { source?: string | null; syncedAt?: string | null }>(
  rows: T[],
): T | null {
  if (!rows.length) return null;
  return [...rows].sort((a, b) => {
    const rank = (source?: string | null) =>
      source === "statbotics" ? 0 : source === "tba" ? 1 : 2;
    const bySource = rank(a.source) - rank(b.source);
    if (bySource !== 0) return bySource;
    return String(b.syncedAt ?? "").localeCompare(String(a.syncedAt ?? ""));
  })[0]!;
}

/**
 * Build season-long dossier fact cards from cached TBA/Statbotics/scout only.
 * Omits cards when the underlying fact is missing — never invents EPA, ranks, or scout rates.
 */
export function buildTeamDossierFacts(input: {
  identity: TeamIdentity;
  yearMetrics: YearMetricRow[];
  eventMetrics: EventMetricRow[];
  operations?: TeamOperationalSignal[];
  /** Limit season EPA cards to this many most-recent years (default 3). */
  maxSeasonYears?: number;
}): DossierFactCard[] {
  const cards: DossierFactCard[] = [];
  const identitySource = input.identity.source ?? "tba";
  const location = [input.identity.city, input.identity.stateProv, input.identity.country]
    .filter(Boolean)
    .join(", ");

  cards.push({
    id: "identity-name",
    category: "identity",
    title: `Team ${input.identity.teamNumber}`,
    value: input.identity.nickname ?? input.identity.name ?? input.identity.teamKey,
    citation: {
      source: identitySource,
      detail: "From The Blue Alliance.",
      syncedAt: input.identity.syncedAt ?? null,
    },
  });

  if (location) {
    cards.push({
      id: "identity-location",
      category: "identity",
      title: "Location",
      value: location,
      citation: {
        source: identitySource,
        detail: "From The Blue Alliance.",
        syncedAt: input.identity.syncedAt ?? null,
      },
    });
  }

  if (input.identity.rookieYear != null) {
    cards.push({
      id: "identity-rookie",
      category: "identity",
      title: "Rookie year",
      value: String(input.identity.rookieYear),
      citation: {
        source: identitySource,
        detail: "From The Blue Alliance.",
        syncedAt: input.identity.syncedAt ?? null,
      },
    });
  }

  const years = [
    ...new Set(input.yearMetrics.map((row) => row.year).filter((year) => Number.isFinite(year))),
  ].sort((a, b) => b - a);
  const seasonLimit = Math.max(1, input.maxSeasonYears ?? 3);
  for (const year of years.slice(0, seasonLimit)) {
    const preferred = preferMetric(input.yearMetrics.filter((row) => row.year === year));
    const source = normalizeSource(preferred?.source);
    if (!preferred || preferred.epaTotal == null || !source) continue;
    const parts = [`EPA ${round1(preferred.epaTotal)}`];
    if (preferred.epaAuto != null) parts.push(`auto ${round1(preferred.epaAuto)}`);
    if (preferred.epaTeleop != null) parts.push(`teleop ${round1(preferred.epaTeleop)}`);
    if (preferred.epaEndgame != null) parts.push(`endgame ${round1(preferred.epaEndgame)}`);
    cards.push({
      id: `season-epa-${year}`,
      category: "season_epa",
      title: `${year} season EPA`,
      value: parts.join(" · "),
      citation: {
        source,
        detail: `From ${sourceName(source)}, ${year} season.`,
        syncedAt: preferred.syncedAt ?? null,
        year,
      },
    });
  }

  const eventKeys = [
    ...new Set(
      input.eventMetrics
        .map((row) => row.eventKey)
        .filter((key): key is string => Boolean(key)),
    ),
  ].sort();
  for (const eventKey of eventKeys) {
    const preferred = preferMetric(input.eventMetrics.filter((row) => row.eventKey === eventKey));
    const source = normalizeSource(preferred?.source);
    if (!preferred || !source) continue;
    const label = eventDisplayLabel(eventKey, preferred.eventName);
    if (preferred.epaTotal != null) {
      cards.push({
        id: `event-epa-${eventKey}`,
        category: "event",
        title: `${label} EPA`,
        value: String(round1(preferred.epaTotal)),
        citation: {
          source,
          detail: `From ${sourceName(source)}, ${label}.`,
          syncedAt: preferred.syncedAt ?? null,
          eventKey,
          eventName: label,
          year: preferred.year,
        },
      });
    }
    const wins = preferred.wins;
    const losses = preferred.losses;
    const ties = preferred.ties;
    if (wins != null || losses != null || ties != null) {
      const record = `${wins ?? 0}-${losses ?? 0}-${ties ?? 0}`;
      const rankBit = preferred.rank != null ? ` · rank ${preferred.rank}` : "";
      cards.push({
        id: `event-record-${eventKey}`,
        category: "record",
        title: `${label} record`,
        value: `${record}${rankBit}`,
        citation: {
          source,
          detail: `From ${sourceName(source)}: record${preferred.rank != null ? " and rank" : ""} at ${label}.`,
          syncedAt: preferred.syncedAt ?? null,
          eventKey,
          eventName: label,
          year: preferred.year,
        },
      });
    }
  }

  const op = (input.operations ?? []).find((row) => row.teamKey === input.identity.teamKey);
  if (op && op.scoutSample > 0) {
    if (op.reliability != null) {
      cards.push({
        id: "scout-reliability",
        category: "scout",
        title: "Scout reliability",
        value: `${Math.round(op.reliability)}% (n=${op.scoutSample})`,
        citation: {
          source: "scout",
          detail: "From our scouts' match and pit entries, not an official figure.",
        },
      });
    }
    if (op.foulRate != null) {
      cards.push({
        id: "scout-fouls",
        category: "scout",
        title: "Scout foul rate",
        value: `~${round1(op.foulRate)} / match (n=${op.scoutSample})`,
        citation: {
          source: "scout",
          detail: "From our scouts' match entries, not an official figure.",
        },
      });
    }
  }

  return cards;
}

/** Honest empty-state helper when reference caches have no cited facts beyond identity. */
export function dossierHasReferenceFacts(cards: DossierFactCard[]) {
  return cards.some(
    (card) =>
      card.category === "season_epa" ||
      card.category === "event" ||
      card.category === "record" ||
      card.category === "scout",
  );
}
