import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const web = (...parts: string[]) => readFileSync(join(__dirname, "..", ...parts), "utf8");

describe("Default yardstick labels stay honest", () => {
  it("labels mentor / impact / outreach / inspection defaults as not recorded goals", () => {
    expect(web("app/mentor-hours/mentor-hours-client.tsx")).toContain(
      "default yardstick of 200 mentor-hours",
    );
    expect(web("app/impact/impact-client.tsx")).toContain("default yardstick of 80 hours / 750 people");
    expect(web("app/outreach-calendar/outreach-calendar-client.tsx")).toContain(
      "default 80h / 750 people",
    );
    expect(
      web("app/inspection-copilot/inspection-copilot-client.tsx") +
        web("app/inspection-copilot/inspection-new-check-form.tsx"),
    ).toContain(
      "default 115 until you set one",
    );
    expect(web("app/readiness-score/readiness-score-client.tsx")).toContain(
      "115 lb / 120 A yardstick until you record your own budgets — not a measured weigh-in",
    );
    expect(web("app/leadership/leadership-client.tsx")).toContain(
      "not a recorded team goal",
    );
  });
});
