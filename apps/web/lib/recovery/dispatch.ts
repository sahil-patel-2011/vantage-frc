import { start } from "workflow/api";
import { recoveryJournalReadiness } from "./readiness";
import { recoveryJournalWorkflow } from "./workflow";
import { hostedBackgroundWorkEnabled } from "../hosted-background-work";

export type RecoveryDispatch =
  | { accepted: true; runId: string }
  | { accepted: false; reason: "disabled" | "not_configured" | "current" };

/**
 * Start one recovery export if there is anything to export.
 *
 * Nothing calls this on a timer any more. A cron ran it every minute of every day, which is
 * 1,440 function calls a day to learn that nobody had changed anything. It now runs when a
 * team is using the app (the spreadsheet ping, shortly after a save) and once a day with the
 * season sync, so the hosting bill follows use instead of the clock. Readiness is checked
 * first: an idle or unconfigured call creates no workflow.
 */
export async function dispatchRecoveryJournal(): Promise<RecoveryDispatch> {
  if (!hostedBackgroundWorkEnabled()) return { accepted: false, reason: "disabled" };
  const readiness = await recoveryJournalReadiness();
  if (readiness !== "ready") return { accepted: false, reason: readiness };
  const run = await start(recoveryJournalWorkflow, []);
  return { accepted: true, runId: run.runId };
}
