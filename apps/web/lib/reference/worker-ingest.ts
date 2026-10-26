import type { EventDaySyncInput, SyncSummary } from "@vantage/reference";
import { currentFrcSeasonYear, HISTORY_SEASONS, type ReferenceIngestOptions } from "./run-ingest";

/**
 * Worker-role reference ingest. CRON_SECRET routes import this module.
 * A signed-in team refresh posts to that route after its own role check.
 * The platform-admin data-connectors branch also loads it, and only after
 * assertPlatformAdmin and assertPlatformPrivilegeMfa.
 */

export async function runTbaSeasonSync(
  year?: number,
  options: ReferenceIngestOptions = {},
): Promise<SyncSummary> {
  const { createProductionReferenceJobs } = await import("@vantage/reference/production-worker");
  const jobs = createProductionReferenceJobs(options);
  return jobs.syncSeason.run({ year: year ?? currentFrcSeasonYear() });
}

/**
 * Load past seasons' team ratings (Statbotics only), oldest first, for the ten seasons ending at
 * `throughYear`. One year failing is reported and the rest carry on.
 */
export async function runTeamYearHistorySync(throughYear = currentFrcSeasonYear()) {
  const { createProductionReferenceJobs } = await import("@vantage/reference/production-worker");
  const jobs = createProductionReferenceJobs();
  const results: Array<{ year: number; teams: number } | { year: number; error: string }> = [];
  for (let year = throughYear - (HISTORY_SEASONS - 1); year <= throughYear; year += 1) {
    try {
      results.push(await jobs.teamYearHistory.run(year));
    } catch (error) {
      results.push({ year, error: error instanceof Error ? error.message : "Failed" });
    }
  }
  return results;
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

export async function runEventDirectory(year: number, options: ReferenceIngestOptions = {}): Promise<number | null> {
  const { createProductionReferenceJobs } = await import("@vantage/reference/production-worker");
  return createProductionReferenceJobs(options).eventDirectory.run(year);
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
