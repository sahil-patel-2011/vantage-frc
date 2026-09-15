/**
 * Dossier cards from real match/pit payloads. Missing keys stay omitted —
 * never a 0 fill or demo metric.
 */

import type { DossierFactCard } from "@vantage/prediction-strategy";

export type ScoutAnswerPayload = {
  entryType: "match" | "pit";
  payload: Record<string, unknown>;
};

function textOf(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim().replaceAll("_", " ");
  return null;
}

function numberOf(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function boolOf(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function round1(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10);
}

function average(values: number[]): number | null {
  if (!values.length) return null;
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

function modeText(values: string[]): string | null {
  if (!values.length) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

function latestText(rows: ScoutAnswerPayload[], key: string): string | null {
  for (const row of rows) {
    const text = textOf(row.payload[key]);
    if (text) return text;
  }
  return null;
}

function averageKey(rows: ScoutAnswerPayload[], key: string): number | null {
  return average(
    rows
      .map((row) => numberOf(row.payload[key]))
      .filter((value): value is number => value != null),
  );
}

function card(
  id: string,
  title: string,
  value: string,
  teamKey: string,
  sample: number,
): DossierFactCard {
  return {
    id,
    category: "scout",
    title,
    value,
    citation: {
      source: "scout",
      detail: `From our scouting payloads for ${teamKey} (n=${sample}). Not a TBA/Statbotics fact.`,
    },
  };
}

/** Observable answers from org scout payloads. Empty list when nothing was logged. */
export function scoutAnswerCards(
  teamKey: string,
  rows: ScoutAnswerPayload[],
): DossierFactCard[] {
  if (!rows.length) return [];
  const pit = rows.filter((row) => row.entryType === "pit");
  const match = rows.filter((row) => row.entryType === "match");
  const cards: DossierFactCard[] = [];

  const drivetrain = latestText(pit, "drivetrain_type");
  if (drivetrain) cards.push(card("scout-drivetrain", "Drivetrain", drivetrain, teamKey, pit.length));

  const language = latestText(pit, "programming_language");
  if (language) {
    cards.push(card("scout-language", "Programming language", language, teamKey, pit.length));
  }

  const driverSeasons = averageKey(pit, "driver_seasons");
  if (driverSeasons != null) {
    cards.push(
      card("scout-driver-seasons", "Driver seasons", round1(driverSeasons), teamKey, pit.length),
    );
  }

  const intake = latestText(pit, "intake_visible");
  if (intake) cards.push(card("scout-intake", "Intake hardware", intake, teamKey, pit.length));

  const pitTrench = pit.map((row) => boolOf(row.payload.trench)).find((value) => value != null);
  if (pitTrench != null) {
    cards.push(card("scout-pit-trench", "Pit trench clearance", pitTrench ? "Yes" : "No", teamKey, pit.length));
  }
  const pitBump = pit.map((row) => boolOf(row.payload.bump)).find((value) => value != null);
  if (pitBump != null) {
    cards.push(card("scout-pit-bump", "Pit bump clearance", pitBump ? "Yes" : "No", teamKey, pit.length));
  }

  const autoFuel = averageKey(match, "auto_fuel");
  if (autoFuel != null) {
    cards.push(card("scout-auto-fuel", "Auto fuel (avg)", round1(autoFuel), teamKey, match.length));
  }
  const teleopFuel = averageKey(match, "teleop_fuel");
  if (teleopFuel != null) {
    cards.push(card("scout-teleop-fuel", "Teleop fuel (avg)", round1(teleopFuel), teamKey, match.length));
  }
  const passed = averageKey(match, "fuel_passed");
  if (passed != null) {
    cards.push(card("scout-fuel-passed", "Fuel passed (avg)", round1(passed), teamKey, match.length));
  }
  const climb = modeText(
    match
      .map((row) => textOf(row.payload.tower_level))
      .filter((value): value is string => Boolean(value)),
  );
  if (climb) cards.push(card("scout-tower", "Tower climb (typical)", climb, teamKey, match.length));

  const driver = averageKey(match, "driver_ability");
  if (driver != null) {
    cards.push(card("scout-driver", "Driver ability (avg)", round1(driver), teamKey, match.length));
  }
  const defense = averageKey(match, "defense_time");
  if (defense != null) {
    cards.push(
      card("scout-defense-time", "Contact defense (avg s)", round1(defense), teamKey, match.length),
    );
  }

  const broke = match
    .map((row) => boolOf(row.payload.robot_broke) ?? boolOf(row.payload.disabled))
    .filter((value): value is boolean => value != null);
  if (broke.length) {
    const count = broke.filter(Boolean).length;
    cards.push(
      card("scout-broke", "Broke / disabled", `${count} of ${broke.length} matches`, teamKey, match.length),
    );
  }

  return cards;
}
