import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Scouting empty primary student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Main Scouting Hub empty/setup + next actions; Match / Pit / QR / Conflicts / Trust are a ToolStrip (not a second tab bar). Hub strip: **Forms · Coverage · Shifts · Pit mesh · Training · Field value · Data quality**. Accuracy, Cross-check, Disagreements, Data impact, Assisted count, Schema sync, Heat signals, and Schema A/B stay on their routes and in search — they are not strip chips. OfflineBanner from real outbox counts; cloud voice STT UsageCutoffBanner; empty state has one primary action. Setup badge is **Needs setup**. No-team primary is **Choose your team**. Empty keeps one primary.");
  });
});
