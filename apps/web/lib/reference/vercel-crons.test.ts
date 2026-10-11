import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type Cron = { path: string; schedule: string };
const crons = (JSON.parse(readFileSync(new URL("../../../../vercel.json", import.meta.url), "utf8")).crons ?? []) as Cron[];

/**
 * Hosting should cost what people use, not what the clock does. Two crons on "* * * * *"
 * called a function 2,880 times a day whether or not anyone had opened the app, and before
 * they checked for work first, each call also started a paid workflow. Anything that has to
 * happen more often than daily belongs on a request a person made (see lib/recovery/dispatch.ts
 * and the spreadsheet ping), not on a timer.
 *
 * Repository cron schedules are now off entirely (AGENTS.md, "Hosting and compute policy"):
 * the old daily season job also dispatched research, reminders, spreadsheet copies and
 * recovery work. The sync routes stay deployed and can still be called on purpose.
 */
describe("vercel.json crons", () => {
  it("runs nothing more often than once a day", () => {
    for (const cron of crons) {
      const [minute, hour] = cron.schedule.trim().split(/\s+/);
      expect(minute, `${cron.path} minute`).toMatch(/^\d+$/);
      expect(hour, `${cron.path} hour`).toMatch(/^\d+$/);
    }
  });

  it("schedules no repository cron jobs", () => {
    expect(crons).toEqual([]);
  });
});
