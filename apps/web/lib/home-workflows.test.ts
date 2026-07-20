import { describe, expect, it } from "vitest";
import {
  buildMentorHomeStrip,
  buildSeasonFirstRunSteps,
  buildStudentHomeStrip,
  formatHomeLodgingDetail,
  formatStripWhen,
  homeAudienceFromTeamRole,
} from "./home-workflows";

describe("home-workflows", () => {
  it("buckets coach with mentor and everyone else as student", () => {
    expect(homeAudienceFromTeamRole("mentor")).toBe("mentor");
    expect(homeAudienceFromTeamRole("coach")).toBe("mentor");
    expect(homeAudienceFromTeamRole("student")).toBe("student");
    expect(homeAudienceFromTeamRole("parent")).toBe("student");
    expect(homeAudienceFromTeamRole(null)).toBe("student");
  });

  it("builds mentor strip with warn tones only when counts are real", () => {
    const strip = buildMentorHomeStrip({
      orgId: "org-1",
      needsAssignment: 2,
      lodgingGaps: 0,
      unsignedChecklists: 1,
    });
    expect(strip.map((item) => item.key)).toEqual([
      "needs_assignment",
      "lodging_gaps",
      "unsigned_checklists",
      "event_day",
    ]);
    expect(strip[0]!.tone).toBe("warn");
    expect(strip[0]!.href).toContain("orgId=org-1");
    expect(strip[1]!.tone).toBe("ok");
    expect(strip[2]!.tone).toBe("warn");
    expect(strip[3]!.href).toContain("/competition?tab=command");
  });

  it("surfaces visit host gaps on mentor strip when present", () => {
    const strip = buildMentorHomeStrip({
      orgId: "org-1",
      needsAssignment: 0,
      lodgingGaps: 0,
      unsignedChecklists: 0,
      visitHostGaps: 2,
    });
    expect(strip.some((item) => item.key === "visit_hosts")).toBe(true);
    expect(strip.find((item) => item.key === "visit_hosts")?.href).toContain("/visit-invites");
    expect(strip.find((item) => item.key === "visit_hosts")?.tone).toBe("warn");
  });

  it("builds student strip with practice, hotel, travel, todos, and kickoff", () => {
    const strip = buildStudentHomeStrip({
      orgId: "org-1",
      nextPracticeTitle: "Drive practice",
      nextPracticeAt: "2026-01-20T22:00:00.000Z",
      hotelName: "Marriott",
      roomLabel: "412",
      nextTravelLabel: "Leave for venue",
      nextTravelAt: "2026-03-01T12:00:00.000Z",
      mineOpenTodos: 3,
      kickoffReady: true,
    });
    expect(strip.map((item) => item.key)).toEqual([
      "next_practice",
      "my_hotel",
      "next_travel",
      "my_todos",
      "kickoff_summary",
    ]);
    expect(strip[0]!.detail).toContain("Drive practice");
    expect(strip[1]!.detail).toBe("Marriott · Room 412");
    expect(strip[2]!.detail).toContain("Leave for venue");
    expect(strip[3]!.detail).toBe("3 open");
    expect(strip[3]!.href).toContain("/todos");
    expect(strip[4]!.href).toContain("/build?tab=kickoff");
    expect(formatStripWhen("not-a-date")).toBeNull();
    expect(formatHomeLodgingDetail(null, null)).toBe("No lodging assigned yet");
  });

  it("exposes season first-run steps for subteam → wiki → logistics → kickoff → CAD", () => {
    const steps = buildSeasonFirstRunSteps({
      orgId: "org-1",
      joinedSubteam: true,
      hasKnowledge: false,
      hasLogistics: false,
      kickoffReady: false,
      openedCadBrief: false,
    });
    expect(steps.map((step) => step.key)).toEqual([
      "subteam",
      "knowledge",
      "logistics",
      "kickoff",
      "cad_brief",
    ]);
    expect(steps[0]!.done).toBe(true);
    expect(steps[1]!.href).toContain("/team/knowledge");
    expect(steps[2]!.href).toContain("/logistics");
    expect(steps[4]!.href).toContain("/cad");
  });
});
