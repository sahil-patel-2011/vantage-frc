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
