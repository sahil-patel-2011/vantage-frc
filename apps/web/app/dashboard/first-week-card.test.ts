import { describe, expect, it } from "vitest";
import { nextFirstWeekChecks } from "./first-week-card";
import type { RoleOnboardingView } from "../../lib/role-onboarding/types";

const check = (key: string, done = false) => ({ key, label: key, detail: "", href: "/x", done, completedAt: null });
const track = (key: string, checks: ReturnType<typeof check>[], dismissed = false) => ({
  key,
  title: key,
  summary: "",
  source: "role" as const,
  reason: "",
  dismissed,
  doneCount: checks.filter((c) => c.done).length,
  totalCount: checks.length,
  checks,
});

const view = (tracks: ReturnType<typeof track>[]): RoleOnboardingView => ({
  status: "live",
  orgId: "o",
  orgName: "Team 6925",
  teamRole: "student",
  crewRole: "programming",
  roleDescription: null,
  primaryFocus: "competition",
  subteamNames: [],
  doneCount: 0,
  totalCount: 0,
  tracks,
});

describe("nextFirstWeekChecks", () => {
  it("puts the person's own crew first, one step per list, skipping dismissed tracks", () => {
    const welcome = { ...track("welcome", [check("see_week", true), check("join_calendar")]), source: "welcome" as const };
    const crew = { ...track("programming", [check("prog_track"), check("open_code"), check("software_versions")]), source: "subteam" as const };
    const picked = nextFirstWeekChecks(view([welcome, track("hidden", [check("x")], true), crew]));
    expect(picked.map((row) => row.check.key)).toEqual(["prog_track", "join_calendar", "open_code"]);
  });

  it("shows nothing once every step is done or nothing loaded", () => {
    expect(nextFirstWeekChecks(view([track("welcome", [check("a", true)])]))).toEqual([]);
    expect(nextFirstWeekChecks(null)).toEqual([]);
    expect(nextFirstWeekChecks({ status: "setup_required", message: "" })).toEqual([]);
  });
});
