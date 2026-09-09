import { runScheduledResearchSweep } from "@vantage/intel-research/production-worker";
import { runMemberOnboarding } from "../member-onboarding/run-member-onboarding";
import { runProductReleasePublish } from "../run-product-release-publish";
import { runSponsorReminders } from "../run-sponsor-reminders";
import { runTeamDossierRefresh } from "../team-dossier/refresh";

export type SeasonCronPiggybacks = {
  sponsorReminders: unknown;
  productReleases: unknown;
  memberOnboarding: unknown;
  teamDossiers: unknown;
  research:
    | { ok: true; summary: unknown }
    | { ok: false; error: string };
};

/**
 * Hobby allows two Vercel crons. Season TBA sync is the daily catch-all for
 * sponsor reminders, scheduled product releases, the intel research sweep, and
 * the new-member onboarding sequence. The research sweep no-ops when
 * RESEARCH_SEARCH_* is unset so fixture jobs do not burn Fluid Compute time.
 * A piggyback failure must not fail TBA ingest.
 *
 * Member onboarding rides here rather than taking a cron of its own precisely
 * because of that ceiling — a fourth entry in vercel.json would make the whole
 * cron config invalid on this plan, not just the fourth job. Its route still
 * exists for `?orgId=` testing and for a Pro-plan ticker that wants its own
 * schedule; it is simply not what Vercel calls.
 */
export async function runSeasonCronPiggybacks(): Promise<SeasonCronPiggybacks> {
  const sponsorReminders = await runSafely(() => runSponsorReminders());
  const productReleases = await runSafely(() => runProductReleasePublish());
  const memberOnboarding = await runSafely(() => runMemberOnboarding({}));
  // Team dossiers older than a week: a handful of TBA calls per team, at most
  // twenty teams a day, through the same coordinated client as the sync.
  const teamDossiers = await runSafely(() => runTeamDossierRefresh());
  let research: SeasonCronPiggybacks["research"];
  try {
    research = { ok: true, summary: await runScheduledResearchSweep() };
  } catch (error) {
    research = {
      ok: false,
      error: error instanceof Error ? error.message : "Research sweep failed",
    };
  }
  return { sponsorReminders, productReleases, memberOnboarding, teamDossiers, research };
}

async function runSafely(job: () => Promise<unknown>): Promise<unknown> {
  try {
    return await job();
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Piggyback job failed" };
  }
}
