/**
 * Strategy-engine text in the words a drive coach uses.
 *
 * The engine writes evidence for engineers ("MITIGATE match 2026gacmp_qm30 … red
 * leave-one-out 2481", "Scout entries: 024959fe, d1d22fb0", "frc118") and plans saved before
 * this change keep those strings. This rewrites them for display only; the stored text and
 * what the engine reasons with stay exactly as they were.
 */

const LEVEL: Record<string, string> = { qm: "Qual", ef: "Eighth", qf: "Quarter", sf: "Semi", f: "Final" };

/** "2026gacmp_qm31" → "Qual 31"; "2026gacmp_sf2m1" → "Semi 2-1". */
export function plainMatchKey(key: string): string {
  const match = /^\d{4}[a-z0-9]+_(qm|ef|qf|sf|f)(\d+)(?:m(\d+))?$/i.exec(key.trim());
  if (!match) return key;
  const level = LEVEL[match[1]!.toLowerCase()] ?? match[1]!.toUpperCase();
  return match[3] ? `${level} ${match[2]}-${match[3]}` : `${level} ${match[2]}`;
}

export function plainStrategyText(text: string | null | undefined): string {
  if (!text) return "";
  return (
    text
      // Internal row ids are proof for engineers, not for a drive coach.
      .replace(/\s*Scout provenance entry ids?:[^\n]*/gi, "")
      .replace(/\s*\(?\b(?:scout )?entr(?:y|ies):?\s*(?:[0-9a-f]{6,}(?:\s*,\s*|\s+))*[0-9a-f]{6,}\)?/gi, "")
      .replace(/\b\d{4}[a-z0-9]+_(?:qm|ef|qf|sf|f)\d+(?:m\d+)?\b/gi, (key) => plainMatchKey(key))
      .replace(/\bfrc(\d{1,5})\b/gi, "Team $1")
      .replace(/\bMITIGATE\b:?\s*/g, "Watch out: ")
      .replace(/\bleave-one-out\b/gi, "without that match")
      // "Team 254 (#254)" says the number twice; "EPA" is a statistics word, "rating" is not.
      .replace(/\bTeam (\d{1,5}) \(#\1\)/g, "Team $1")
      .replace(/\bHighest-EPA\b/g, "Highest-rated")
      .replace(/\bhighest-EPA\b/g, "highest-rated")
      .replace(/\bEPA\b/g, "rating")
      // The prediction engine labels its own provenance ("MODEL output — not an official TBA
      // result.", "Engine strategy-engine-max-v1 · depth 3 · Max.", "FACT TBA …", "MODEL: Org
      // scout … (capped)", "(n=7.6)"). That bookkeeping reads like a log file to a drive coach:
      // the pure labels go, and the parts that mean something are said plainly.
      .replace(/^\s*MODEL output\s*[—-]\s*not an official TBA [a-z ]+\.?\s*$/i, "")
      .replace(/^\s*MODEL [a-z0-9._-]+\s*[—-]\s*not an official TBA [a-z ]+\.?\s*$/i, "")
      .replace(/^\s*Engine\s+\S+.*$/i, "")
      .replace(/\s*via engine\s+\S+\s*\(depth \d+\)/gi, "")
      .replace(/^\s*Includes (\d+) org scout observations as operational adjustments\.?\s*$/i, "Uses $1 observations from our scouts.")
      .replace(/^\s*(\d+) FACT TBA match result\(s\) cited for alliance context\.?\s*$/i, "Uses $1 official match results.")
      .replace(/\bFACT TBA\b/g, "Official result,")
      .replace(
        /Protect (\d+)'s modeled contribution \((\d+)% of alliance rating\)\.?/gi,
        "$1 carries $2% of our alliance's rating: keep them scoring.",
      )
      // "Scout quality mean weight 49% — Scout 6925a000 downweighted to 45%: Scoring mean 51.3 vs
      // consensus 5 (Δ 46.3); weight 0.45." showed a student a user id prefix and the model's maths.
      .replace(/Scout quality mean weight \d+%\s*[—–-]\s*/gi, "")
      .replace(/Scout [0-9a-f]{6,}\s+downweighted to \d+%:[^;]*(?:;\s*weight\s*[\d.]+)?\.?/gi, "One scout's numbers were far from the others', so they count for less.")
      .replace(/\s*\(mean quality weight [\d.]+\)/gi, "")
      .replace(/\bscout trust blend capped at \d+%/gi, "some of our own scouting")
      .replace(/\bScoring mean [\d.]+ vs consensus [\d.]+\s*\(Δ\s*[-+]?[\d.]+\)(?:;\s*weight\s*[\d.]+)?\.?/gi, "")
      // "Scout quality downweights applied: frc6925 (mean 43%)." said to a student.
      .replace(/Scout quality downweights applied:\s*([^.]*)\./gi, (_all, list: string) => {
        const teams = list.replace(/\s*\(mean \d+%\)/gi, "").replace(/\bfrc/gi, "");
        return `Scouting on ${teams} counts for less: our scouts disagreed about them.`;
      })
      .replace(/Video-rescored scout entries:\s*([^.]*)\./gi, (_all, list: string) => {
        const teams = list.replace(/\s*\(\d+\)/g, "").replace(/\bfrc/gi, "");
        return `Some scouting on ${teams} was rechecked on video.`;
      })
      .replace(/\bMODEL:\s*/g, "")
      // Upper-case only: the engine's tag, not the word "model" in a sentence.
      .replace(/\bMODEL\s+[a-z][a-z0-9._-]*\s*[…:·—-]*\s*/g, "")
      .replace(/;?\s*not an? (?:official )?TBA(?:\/Statbotics)? (?:fact|result|figure)\.?/gi, "")
      .replace(/\bfrom sources?\s+[^.;)]*?(\d+)\s+weighted team-matches\b/gi, "from $1 matches of data")
      .replace(/\(sources?\s+[^)]*\)/gi, "")
      .replace(/\bweighted team-matches\b/gi, "matches of data")
      .replace(/\s*\(statbotics\)/gi, "")
      .replace(/\s*\(n=[\d.]+\)/gi, "")
      .replace(/\bevent\s+\d{4}[a-z0-9]+\b/gi, "this event")
      .replace(/\bOrg scout\b/g, "Our scouts'")
      .replace(/\bOrg scouting\b/g, "Our scouting")
      .replace(/\bOrg-private edge from your scouting \+ cached public (?:EPA|rating)\.?/gi, "Only our team sees this: what our scouting says, next to the public rating.")
      // Always follows the sentence above, which already says it: "Only our team sees this" twice.
      .replace(/\s*Not shared\. Not Statbotics\./gi, "")
      .replace(/\borg pEPA Monte Carlo prefers\b/gi, "our scouting prefers")
      .replace(/\s*\(\d+% of \d+ trials\)/gi, "")
      .replace(/\s*\(event metrics\)/gi, "")
      .replace(/\bAlliance rating totals\b/g, "Alliance ratings")
      // A margin is signed from red's side, so it read "-17.7" for the alliance that was ahead;
      // the two ratings say it without a sign. Drop the number, keep the words.
      .replace(/\s*\(margin [+-]?\d+(?:\.\d+)?\)/gi, "")
      .replace(/\bLogistic win model on alliance rating margin [+-]?\d+(?:\.\d+)?/gi, "Win chance worked out from the gap between the alliance ratings")
      .replace(/\bAlliance rating margin [+-]?\d+(?:\.\d+)?/g, "The gap between the alliance ratings")
      .replace(/\bWeighted (auto(?:nomous)?|teleop|endgame) rating margin [+-]?\d+(?:\.\d+)?/gi, (_all, part: string) =>
        `The ${part.toLowerCase().startsWith("auto") ? "autonomous" : part.toLowerCase()} ratings gap`,
      )
      .replace(/\bScout (auto|teleop|endgame) capability\b/g, (_all, part: string) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
      .replace(/\bScout teleop\/cycles noted for\b/g, "Teleop cycles noted for")
      .replace(/\bScout reliability\b/g, "Reliability")
      // "Defense noted in scout payloads: Team 1323": the database's word for a report.
      .replace(/\bDefense noted in scout payloads:\s*/gi, "Scouts saw defense from ")
      .replace(/\bscout payloads?\b/gi, "scout reports")
      .replace(/\bacross ([\d.]+) observations\b/gi, (_all, n: string) => `across ${Math.round(Number(n))} matches`)
      .replace(/\s*Influenced by\.?(?=\s|$)/gi, "")
      .replace(/\s*\(capped\)/gi, "")
      .replace(/\bofficial TBA\b/gi, "official")
      .replace(/\bTBA\b/g, "official")
      .replace(/\.{2,}/g, ".")
      .replace(/\s+([.,;])/g, "$1")
      .replace(/\b\d+\.\d{4,}\b/g, (whole) => String(Math.round(Number(whole) * 10) / 10))
      .replace(/\s{2,}/g, " ")
      .trim()
  );
}

const ENGINE_MATCH_CHIP = new RegExp("^match (Qual|Eighth|Quarter|Semi|Final) [0-9]", "i");

/**
 * Game-plan chips that only make sense to the engine ("match Qual 30", "red without that
 * match 67") are dropped from the briefing; the rest are kept in plain words.
 */
export function readablePlanChip(text: string | null | undefined): string | null {
  const plain = plainStrategyText(text);
  if (!plain) return null;
  if (/without that match/i.test(plain)) return null;
  if (ENGINE_MATCH_CHIP.test(plain)) return null;
  return plain;
}
