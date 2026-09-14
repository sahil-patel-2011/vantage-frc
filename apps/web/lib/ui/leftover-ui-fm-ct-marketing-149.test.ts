import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..", "..", "..");

describe("leftover Feature map Marketing choose team student copy", () => {
  it("uses student chrome", () => {
    const src = readFileSync(join(ROOT, "docs/FEATURE_MAP.md"), "utf8");
    expect(src).toContain("Public story: the season in one login. Hero is a Soft-UI Kickoff frame driven by `computeGameBrief` (2027 BIOCORE **Manual not out** / 2026 REBUILT **From the manual**) plus Home next actions — not a Good-evening mock. Below: Scouting / Learn CAD / Ask AI frames (**Needs setup**, CAD Video Tutor, **Connect Claude Code**). One primary **Join the waitlist**; Sign in is a text link. Waitlist upserts never drop an earlier email. Waitlist form degrades to a calm empty state when the marketing database is missing — never a crash, never **Setup required** on the page. No fake team counts or win %. Setup badge is **Needs setup**. No-team primary is **Choose your team**.");
  });
});
