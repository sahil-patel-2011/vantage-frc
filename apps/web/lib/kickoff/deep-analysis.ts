/** Team 6925 deep game-guess UI helpers. Engine + Pi job live in @vantage/free-relay. */

export const DEEP_GAME_ANALYSIS_TEAM_NUMBER = 6925;

export function canUseDeepGameAnalysis(teamNumber: number | null | undefined): boolean {
  return Number(teamNumber) === DEEP_GAME_ANALYSIS_TEAM_NUMBER;
}

export type DeepAnalysisGuessView = {
  themeGuess: string | null;
  fieldGuess: string | null;
  scoringGuess: string[];
  rulesGuess: string[];
  robotImplications: string[];
  unknowns: string[];
  evidenceUrls: string[];
  speculation: string[];
  confidence: "none" | "low" | "medium" | "high";
  disclaimer: string;
};

export type DeepAnalysisSourceView = {
  url: string;
  title: string;
  kind: string;
  fetchOk: boolean | null;
  excerpt: string;
  error: string | null;
  fetchedAt: string | null;
};

export type DeepAnalysisLoopView = {
  sequence: number;
  status: string;
  startedAt: string;
  completedAt: string | null;
  focus: string;
  notes: string;
};

export type DeepAnalysisModelOption = {
  id: string;
  slug: string;
  label: string;
  metered?: boolean;
  note?: string;
};

export type DeepAnalysisRunView = {
  allowed: boolean;
  reason?: string;
  models?: DeepAnalysisModelOption[];
  run: {
    id: string;
    seasonYear: number;
    status: string;
    startedAt: string | null;
    completedAt: string | null;
    minHours: number;
    minLoops: number;
    loopCount: number;
    model: string | null;
    latestGuess: DeepAnalysisGuessView | null;
  } | null;
  sources: DeepAnalysisSourceView[];
  loops: DeepAnalysisLoopView[];
};

export function deepAnalysisStatusCopy(status: string | null | undefined): string {
  switch (status) {
    case "queued":
      return "Queued for the Pi — the Freebuff Coder UI sweep will start a continuous 5-hour think.";
    case "running":
      return "Thinking continuously on the Pi through Coder UI for five hours. Not an hourly schedule.";
    case "completed":
      return "Finished five continuous hours. Review the labeled guess — it is not the official manual.";
    case "cancelled":
      return "Stopped. Stored sources and loops stay; no new guess was invented.";
    case "failed":
      return "A pass failed. Check Pi / Coder UI and retry.";
    default:
      return "No deep analysis run yet for this season.";
  }
}

export function deepAnalysisElapsedCopy(startedAt: string | null | undefined, minHours: number): string {
  if (!startedAt) return `Will run continuously for ${minHours} hours.`;
  const elapsedMs = Date.now() - Date.parse(startedAt);
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return `Will run continuously for ${minHours} hours.`;
  const hours = elapsedMs / (60 * 60 * 1000);
  return `${hours.toFixed(1)} of ${minHours} hours elapsed · ${Math.max(0, minHours - hours).toFixed(1)} left.`;
}
