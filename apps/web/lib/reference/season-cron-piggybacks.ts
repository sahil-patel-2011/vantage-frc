import { runScheduledResearchSweep } from "@vantage/intel-research/production-worker";
import { runProductReleasePublish } from "../run-product-release-publish";
import { runSponsorReminders } from "../run-sponsor-reminders";

export type SeasonCronPiggybacks = {
  sponsorReminders: unknown;
  productReleases: unknown;
  research:
    | { ok: true; summary: unknown }
    | { ok: false; error: string };
};

/**
 * Hobby allows two Vercel crons. Season TBA sync is the daily catch-all for
 * sponsor reminders, scheduled product releases, and the intel research sweep.
 * The research sweep no-ops when RESEARCH_SEARCH_* is unset so fixture jobs
 * do not burn Fluid Compute time. A piggyback failure must not fail TBA ingest.
 */
export async function runSeasonCronPiggybacks(): Promise<SeasonCronPiggybacks> {
  const sponsorReminders = await runSafely(() => runSponsorReminders());
  const productReleases = await runSafely(() => runProductReleasePublish());
  let research: SeasonCronPiggybacks["research"];
  try {
    research = { ok: true, summary: await runScheduledResearchSweep() };
  } catch (error) {
    research = {
      ok: false,
      error: error instanceof Error ? error.message : "Research sweep failed",
    };
  }
  return { sponsorReminders, productReleases, research };
}

async function runSafely(job: () => Promise<unknown>): Promise<unknown> {
  try {
    return await job();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Piggyback job failed" };
  }
}
