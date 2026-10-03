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
 */
describe("vercel.json crons", () => {
  it("runs nothing more often than once a day", () => {
    for (const cron of crons) {
      const [minute, hour] = cron.schedule.trim().split(/\s+/);
      expect(minute, `${cron.path} minute`).toMatch(/^\d+$/);
      expect(hour, `${cron.path} hour`).toMatch(/^\d+$/);
    }
  });

  it("schedules only the two daily sync jobs", () => {
    expect(crons.map((cron) => cron.path).sort()).toEqual([
      "/api/cron/tba-sync?mode=event-day",
      "/api/cron/tba-sync?mode=season",
    ]);
  });
});
