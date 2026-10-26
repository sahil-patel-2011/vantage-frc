/**
 * Loader for the committed 2026 match file. The JSON is the public record;
 * this only adds the phase and qualification index the replay needs.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { phaseForEvent, type CategoryScores, type ReplayMatch } from "../src/walk-forward";

export type FixtureScore = {
  auto: number;
  teleop: number;
  endgame: number;
  foul: number;
  fuel: number;
  adjust: number;
  teleopTotal: number;
  total: number;
};

export type FixtureMatch = {
  key: string;
  event: string;
  level: string;
  set: number;
  number: number;
  order: number;
  red: number[];
  blue: number[];
  winner: string;
  redScore: FixtureScore;
  blueScore: FixtureScore;
};

export type FixtureEvent = {
  key: string;
  name: string;
  start: string;
  end: string;
  page: string;
  matchesListed: number;
};

export type FixtureFile = {
  fetched: string;
  source: string;
  identity: string;
  events: FixtureEvent[];
  matchCount: number;
  listedCount: number;
  identityMisses: number;
  incomplete: unknown[];
  matches: FixtureMatch[];
};

export function load2026FixtureFile(): FixtureFile {
  const here = dirname(fileURLToPath(import.meta.url));
  return JSON.parse(readFileSync(join(here, "fixtures/2026-played-matches.json"), "utf8")) as FixtureFile;
}

function side(score: FixtureScore): CategoryScores {
  return {
    auto: score.auto,
    teleop: score.teleop,
    endgame: score.endgame,
    foul: score.foul,
    total: score.total,
  };
}

/** Play order within an event is the order the public page listed the matches. */
export function replayMatchesFromFixture(file: FixtureFile): ReplayMatch[] {
  const qualCount = new Map<string, number>();
  for (const match of file.matches) {
    if (match.level === "qm") qualCount.set(match.event, (qualCount.get(match.event) ?? 0) + 1);
  }
  const qualSeen = new Map<string, number>();
  return file.matches.map((match) => {
    let qualIndex: number | null = null;
    if (match.level === "qm") {
      const next = qualSeen.get(match.event) ?? 0;
      qualIndex = next;
      qualSeen.set(match.event, next + 1);
    }
    return {
      key: match.key,
      event: match.event,
      phase: phaseForEvent(match.event),
      order: match.order,
      level: match.level,
      qualIndex,
      qualCount: qualCount.get(match.event) ?? 0,
      red: match.red.map((team) => `frc${team}`),
      blue: match.blue.map((team) => `frc${team}`),
      redScore: side(match.redScore),
      blueScore: side(match.blueScore),
    };
  });
}
