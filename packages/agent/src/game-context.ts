/**
 * What game the AI is talking about.
 *
 * The chat system prompt described the product, the honesty rules and the
 * tools, and never once said which FRC season it was. So a student asking
 * "how many points is a climb worth this year" got an answer drawn from
 * whatever the model remembered about some past game — confidently, and about
 * the wrong one. A model's training data is not the current manual, and last
 * season's scoring is the most plausible-sounding wrong answer available.
 *
 * This builds a short, factual description of the season from
 * `@vantage/game-year`: the name, whether the manual is out, and the scoring
 * keys a team actually records. It is our own structured description of the
 * game, not the manual's text — the manual is FIRST's and does not belong
 * copied into a prompt.
 *
 * The important half is the refusal. Vantage does not carry point values on
 * purpose: what an action is worth is in the manual and in the team's own
 * value formula, not in a model file. So the prompt says the season's actions
 * *by name* and tells the model to send people to their own formula rather
 * than invent a number, which is the same rule every other surface follows.
 */

import type { GameYearPack } from "@vantage/game-year";

export type GameContextInput = {
  pack: Pick<GameYearPack, "year" | "gameName" | "status" | "scoringKeys">;
};

/** Turn a scoring key into the words a student uses for it. */
function readable(key: string): string {
  return key.replace(/_/g, " ").trim();
}

/**
 * Lines to add to a system prompt. Empty array when there is no pack, so a
 * caller with nothing to say adds nothing rather than a sentence about not
 * knowing — the honesty rules already cover that.
 */
export function gameContextLines(input: GameContextInput | null | undefined): string[] {
  const pack = input?.pack;
  if (!pack || typeof pack.year !== "number" || !pack.gameName) return [];

  const lines: string[] = [];
  const name = `${pack.year} ${pack.gameName}`;

  if (pack.status === "published") {
    lines.push(
      `The current FRC season is ${name} and its game manual is published.`,
      // Naming the actions is the useful part: it stops the model answering
      // about cargo, cones or notes from a season that is not this one.
      ...(pack.scoringKeys.length
        ? [
            `Actions teams record this season: ${pack.scoringKeys.map(readable).join(", ")}.`,
          ]
        : []),
    );
  } else {
    lines.push(
      `The current FRC season is ${name} and its game manual is not published yet.`,
      "Do not describe this season's scoring, field or rules — nothing about them is known. Say the manual is not out, and talk about last season only when the person asks about last season.",
    );
  }

  lines.push(
    // The rule that keeps this from becoming a source of invented numbers.
    "You do not have the manual's point values. If asked what an action is worth, say Vantage uses the team's own value formula and send them to Scouting → Forms to set or check it. Never guess a point value, and never carry one over from a previous season.",
  );

  return lines;
}

/**
 * One line naming the season, for a surface that wants a label rather than
 * prompt lines.
 */
export function seasonLabel(input: GameContextInput | null | undefined): string | null {
  const pack = input?.pack;
  if (!pack || typeof pack.year !== "number" || !pack.gameName) return null;
  return pack.status === "published"
    ? `${pack.year} ${pack.gameName}`
    : `${pack.year} ${pack.gameName} (manual not out)`;
}
