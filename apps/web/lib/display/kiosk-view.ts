/**
 * What the pit TV draws, as pure data. The components in app/display/kiosk only lay it out.
 *
 * Every line here comes from the snapshot or the stored match intel. Nothing is filled in:
 * a match with no scouting says so, and a board with no match ahead says that instead of
 * showing numbers that belong to another match.
 */

import { matchLabel, stripFrc, type DisplayNextMatch, type DisplaySnapshot } from "../display";
import { predictionWinDisplay } from "../strategy/prediction-display";
import type { DisplayMatchIntel } from "./match-intel";

/**
 * "Team 6925 · Peachtree District Championship". The header used to read
 * "Team 6925 · #6925", the same thing twice, and never said where the team was.
 */
export function kioskBrandLine(
  organization: { name: string; teamNumber: number | null | undefined },
  eventName: string | null | undefined,
): string {
  const name = organization.name?.trim() ?? "";
  const number = organization.teamNumber;
  const who =
    number != null && Number.isFinite(number) && !name.includes(String(number))
      ? name
        ? `${name} · Team ${number}`
        : `Team ${number}`
      : name || (number != null ? `Team ${number}` : "Your team");
  const where = eventName?.trim();
  return where ? `${who} · ${where}` : who;
}

export type KioskSides = {
  ourColor: "red" | "blue" | null;
  partners: string[];
  opponents: string[];
  red: string[];
  blue: string[];
};

/** Who is with us and who is against us, as bare team numbers, from the posted alliances. */
export function kioskSides(match: Pick<DisplayNextMatch, "redAlliance" | "blueAlliance">, teamNumber: number | null | undefined): KioskSides {
  const red = (match.redAlliance?.teamKeys ?? []).map(stripFrc);
  const blue = (match.blueAlliance?.teamKeys ?? []).map(stripFrc);
  const own = teamNumber != null ? String(teamNumber) : "";
  const ourColor = own && red.includes(own) ? "red" : own && blue.includes(own) ? "blue" : null;
  const ours = ourColor === "red" ? red : ourColor === "blue" ? blue : [];
  const theirs = ourColor === "red" ? blue : ourColor === "blue" ? red : [];
  return {
    ourColor,
    partners: ours.filter((team) => team !== own),
    opponents: theirs,
    red,
    blue,
  };
}

export type KioskIntelLine = { team: string; words: string };

/**
 * One line per opponent, "1678 · Strong auto · Draws fouls", from the tendencies the
 * strategy engine saved from scouting. Opponents with nothing scouted are left out, and
 * the caller shows "No scouting notes" when the list is empty.
 */
export function kioskOpponentIntel(
  intel: DisplayMatchIntel | null | undefined,
  opponents: readonly string[],
): KioskIntelLine[] {
  if (!intel) return [];
  const out: KioskIntelLine[] = [];
  for (const team of opponents) {
    const row = intel.teams.find((entry) => stripFrc(entry.teamKey) === team);
    if (row?.tags.length) out.push({ team, words: row.tags.join(" · ") });
  }
  return out;
}

/**
 * Our win chance for the next match, labelled with that match and our colour:
 * value "28% to win", detail "Qual 37 · we're RED". Odds stored for any other match are
 * ignored, and a match with no grounded prediction says so rather than showing a number.
 */
export function kioskWinLine(
  snapshot: Pick<DisplaySnapshot, "nextMatch" | "prediction">,
  teamNumber: number | null | undefined,
): { value: string; detail: string } {
  const next = snapshot.nextMatch;
  if (!next) return { value: "No match ahead", detail: "Win chance shows once our next match is posted" };
  const label = matchLabel(next.compLevel, next.matchNumber);
  const { ourColor } = kioskSides(next, teamNumber);
  const prediction = snapshot.prediction && snapshot.prediction.matchKey === next.matchKey ? snapshot.prediction : null;
  const win = prediction && ourColor
    ? predictionWinDisplay({
        pRed: prediction.pRed,
        pBlue: prediction.pBlue,
        alliance: ourColor,
        modelVersion: prediction.modelVersion,
        caveats: prediction.caveats,
      })
    : null;
  // The next-match panel beside it already says the match and our colour; this says where the
  // number comes from.
  if (!win) return { value: "No prediction yet", detail: ourColor ? `For ${label}` : label };
  const at = prediction?.scoredAt ? new Date(prediction.scoredAt) : null;
  const updated =
    at && !Number.isNaN(at.getTime()) ? ` · updated ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "";
  return { value: `${win.label} to win`, detail: `${label} · Vantage prediction${updated}` };
}

/** Board layout: the first panel is the hero, the rest stack beside it. */
export function kioskHeroSplit<T>(panels: readonly T[]): { hero: T | null; rest: T[] } {
  if (!panels.length) return { hero: null, rest: [] };
  return { hero: panels[0]!, rest: panels.slice(1) };
}
