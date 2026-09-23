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
  const { createProductionReferenceJobs } = await import("@vantage/reference/production-worker");
  const jobs = createProductionReferenceJobs(options);
  return jobs.syncSeason.run({ year: year ?? currentFrcSeasonYear() });
}

export async function runTbaEventDaySync(
  input: EventDaySyncInput = {},
  options: ReferenceIngestOptions = {},
): Promise<SyncSummary> {
  const { createProductionReferenceJobs } = await import("@vantage/reference/production-worker");
  const jobs = createProductionReferenceJobs(options);
  return jobs.syncEventDay.run({
    year: input.year ?? currentFrcSeasonYear(),
    ...input,
  });
}

/** A page-triggered refresh of one event runs at most once per window, across every instance. */
export const ON_DEMAND_REFRESH_WINDOW_MS = 60_000;

/**
 * Refresh one event because someone opened a page that needs it. Claims the event first
 * (sync_cursors, shared by every serverless instance), so twenty people at one event cost
 * one TBA refresh a minute rather than one per instance — and a refresh that failed still
 * holds the claim, so a TBA outage is not retried on every page view.
 */
export async function runOnDemandEventRefresh(
  eventKey: string,
  options: ReferenceIngestOptions & { windowMs?: number } = {},
): Promise<"refreshed" | "skipped"> {
  const { createProductionReferenceJobs } = await import("@vantage/reference/production-worker");
  const jobs = createProductionReferenceJobs(options);
  const windowMs = options.windowMs ?? readWindowMs();
  if (!(await jobs.claimOnDemandRefresh(`on-demand:${eventKey}`, windowMs))) return "skipped";
  await jobs.syncEventDay.run({ year: currentFrcSeasonYear(), eventKeys: [eventKey] });
  return "refreshed";
}

function readWindowMs(): number {
  const raw = Number(process.env.REFERENCE_ON_DEMAND_WINDOW_MS);
  return Number.isFinite(raw) && raw >= 5_000 ? raw : ON_DEMAND_REFRESH_WINDOW_MS;
}

export async function runNexusEventSync(eventKeys: string[]) {
  const { syncNexusEvents } = await import("@vantage/reference/nexus-ingest");
  return syncNexusEvents(eventKeys);
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
