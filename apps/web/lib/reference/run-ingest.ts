export type ReferenceIngestOptions = {
  preferOrgIds?: string[];
};

export function currentFrcSeasonYear(at = new Date()): number {
  // FRC season year rolls forward after kickoff planning in the fall.
  return at.getUTCMonth() >= 9 ? at.getUTCFullYear() + 1 : at.getUTCFullYear();
}

/** How many seasons the prediction engine counts (packages/prediction-strategy SEASON_WEIGHTS). */
export const HISTORY_SEASONS = 10;

export function assertCronAuthorized(request: Request): Response | null {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) {
    return Response.json(
      { error: "CRON_SECRET is not configured" },
      { status: 503 },
    );
  }
  const auth = request.headers.get("authorization");
  const bearer = auth?.replace(/^Bearer\s+/i, "").trim();
  const headerSecret = request.headers.get("x-cron-secret")?.trim();
  if (bearer === secret || headerSecret === secret) return null;
  return Response.json({ error: "Unauthorized" }, { status: 401 });
}
