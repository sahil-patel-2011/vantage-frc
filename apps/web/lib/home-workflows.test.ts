import { describe, expect, it } from "vitest";
import {
  buildMentorHomeStrip,
  buildSeasonFirstRunSteps,
  buildStudentHomeStrip,
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
    ]);
    expect(strip[0]!.tone).toBe("warn");
    expect(strip[0]!.href).toContain("orgId=org-1");
    expect(strip[1]!.tone).toBe("ok");
    expect(strip[2]!.tone).toBe("warn");
  });

  it("builds student strip with practice, hotel, todos, and kickoff", () => {
    const strip = buildStudentHomeStrip({
      orgId: "org-1",
      nextPracticeTitle: "Drive practice",
      nextPracticeAt: "2026-01-20T22:00:00.000Z",
      hotelName: "Marriott",
      roomLabel: "412",
      mineOpenTodos: 3,
      kickoffReady: true,
    });
    expect(strip).toHaveLength(4);
    expect(strip[0]!.detail).toContain("Drive practice");
    expect(strip[1]!.detail).toBe("Marriott · Room 412");
    expect(strip[2]!.detail).toBe("3 open");
    expect(strip[2]!.href).toContain("/todos");
    expect(strip[3]!.href).toContain("/kickoff");
    expect(formatStripWhen("not-a-date")).toBeNull();
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
