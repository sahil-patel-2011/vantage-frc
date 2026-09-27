import { sleep } from "workflow";
import { exportRecoveryJournal } from "./journal";

/** Cron starts one bounded durable run; short pauses do not occupy a serverless process. */
export async function recoveryJournalWorkflow() {
  "use workflow";
  for (let cycle = 0; cycle < 3; cycle++) {
    if (cycle) await sleep("20s");
    await exportRecoveryJournal();
  }
}
