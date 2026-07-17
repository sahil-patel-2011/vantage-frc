import { createProductionReferenceJobs } from "@vantage/reference/production-worker";
import type { EventDaySyncInput, SyncSummary } from "@vantage/reference";

export type ReferenceIngestOptions = {
  preferOrgIds?: string[];
};

export function currentFrcSeasonYear(at = new Date()): number {
  // FRC season year rolls forward after kickoff planning in the fall.
  return at.getUTCMonth() >= 9 ? at.getUTCFullYear() + 1 : at.getUTCFullYear();
}

export async function runTbaSeasonSync(
  year?: number,
  options: ReferenceIngestOptions = {},
): Promise<SyncSummary> {
  const jobs = createProductionReferenceJobs(options);
  return jobs.syncSeason.run({ year: year ?? currentFrcSeasonYear() });
}

export async function runTbaEventDaySync(
  input: EventDaySyncInput = {},
  options: ReferenceIngestOptions = {},
): Promise<SyncSummary> {
  const jobs = createProductionReferenceJobs(options);
  return jobs.syncEventDay.run({
    year: input.year ?? currentFrcSeasonYear(),
    ...input,
  });
}

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
