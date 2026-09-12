/**
 * Rewrite leftover stored EPA / TBA / MODEL labels so student boards stay
 * readable. Identifiers like epaTotal stay. Do not invent a last-snapshot.
 * Connect TBA / The Blue Alliance stay on connector catalog pages — only apply
 * this to painted prediction, dossier, clock, and Event Day strings.
 */

export function studentSourceLabel(source: string | null | undefined): string {
  if (!source) return "";
  switch (source.trim().toLowerCase()) {
    case "tba":
    case "reference":
      return "Official matches";
    case "statbotics":
      return "Season ratings";
    case "scout":
      return "Scout notes";
    case "db":
      return "Saved data";
    case "all":
      return "All data sources";
    default:
      return studentRatingLabel(source);
  }
}

export function studentRatingLabel(text: string): string {
  return text
    .replace(/\bTBA's official record\b/gi, "the official record")
    .replace(/\bTBA \(tba\)/gi, "Official record")
    .replace(/\bTBA\+scout trust blend\b/g, "Official + scout blend")
    .replace(/\bTBA\/Statbotics\b/g, "official matches")
    .replace(/\bofficial TBA result\b/gi, "official match result")
    .replace(/\bnot a TBA fact\b/gi, "not an official match fact")
    .replace(/\bTBA facts\b/gi, "official match facts")
    .replace(/\bTBA fact\b/gi, "official match fact")
    .replace(/\bFACT TBA match result\(s\)\b/g, "official match result(s)")
    .replace(/\bFACT TBA match results\b/g, "official match results")
    .replace(/\bFACT TBA\b/g, "Official")
    .replace(/\bTBA match results\b/gi, "official match results")
    .replace(/\bTBA match result\b/gi, "official match result")
    .replace(/\bcompleted TBA match\b/gi, "completed official match")
    .replace(/\bcompleted TBA\b/gi, "completed official")
    .replace(/\bfrom TBA team record cache\b/gi, "from the official team record")
    .replace(/\bfrom TBA\b/gi, "from official matches")
    .replace(/\bThe Blue Alliance\b/gi, "official matches")
    .replace(/\bStatbotics\b/gi, "season ratings")
    .replace(/\bTBA\b/g, "official matches")
    .replace(/\ban EPA of\b/gi, "a rating of")
    .replace(/\bAlliance EPA totals\b/gi, "Alliance rating totals")
    .replace(/\balliance EPA margin\b/gi, "alliance rating margin")
    .replace(/\bAutonomous EPA edge\b/gi, "Autonomous rating edge")
    .replace(/\bweighted autonomous EPA\b/gi, "weighted autonomous rating")
    .replace(/\bevent-vs-year EPA\b/gi, "event-vs-year rating")
    .replace(/\bprior-year EPA\b/gi, "prior-year rating")
    .replace(/\breference EPA\b/gi, "season ratings")
    .replace(/\bpublic EPA\b/gi, "season rating")
    .replace(/\bevent EPA\b/gi, "event rating")
    .replace(/\byear EPA\b/gi, "season rating")
    .replace(/\bSeason EPA\b/gi, "Season rating")
    .replace(/\bEndgame EPA\b/gi, "Endgame rating")
    .replace(/\bTeleop EPA\b/gi, "Teleop rating")
    .replace(/\bAuto EPA\b/gi, "Auto rating")
    .replace(/\bauto EPA\b/gi, "auto rating")
    .replace(/\bendgame EPA\b/gi, "endgame rating")
    .replace(/\bteleop EPA\b/gi, "teleop rating")
    .replace(/\bEPA totals\b/gi, "season ratings")
    .replace(/\bEPA total\b/gi, "Season rating")
    .replace(/\bEPA drift\b/gi, "Rating drift")
    .replace(/\bEPA edge\b/gi, "Rating edge")
    .replace(/\bEPA movers\b/gi, "season-score movers")
    .replace(/\bEPA\b/g, "Rating")
    .replace(/\bMODEL output — /g, "")
    .replace(/\bMODEL:\s*/g, "")
    .replace(/\bMODEL\s+/g, "");
}
