import { describe, expect, it } from "vitest";
import { teamTagsNextActions, teamTagsPickReasonsPayload, type TeamTagsView } from "./compute-team-tags";
import type { TeamTagAssignment } from "./group";

describe("team-tags next actions", () => {
  it("asks for a workspace when none is selected", () => {
    expect(teamTagsNextActions({})[0]?.id).toBe("workspace");
  });

  it("points empty boards at the first real tag", () => {
    const actions = teamTagsNextActions({ orgId: "org-1", assignmentCount: 0 });
    expect(actions[0]?.id).toBe("first-tag");
    expect(actions[0]?.href).toContain("/team-tags");
    expect(actions.some((action) => action.id === "pairwise")).toBe(true);
    expect(actions.every((action) => !/demo/i.test(`${action.label} ${action.detail}`))).toBe(true);
  });

  it("points applied event tags at pick-clock reasons", () => {
    const actions = teamTagsNextActions({
      orgId: "org-1",
      assignmentCount: 2,
      eventKey: "2026casj",
      eventAssignmentCount: 2,
    });
    expect(actions[0]?.id).toBe("pick-clock");
    expect(actions[0]?.href).toContain("pick-clock");
    expect(actions[0]?.detail).toMatch(/pick-clock reasons/i);
  });
});

describe("teamTagsPickReasonsPayload", () => {
  const assignment: TeamTagAssignment = {
    id: "1",
    tagId: "def",
    tagSlug: "defense",
    tagName: "Defense",
    teamNumber: 254,
    eventKey: "2026casj",
    matchKey: null,
    notes: null,
  };

  const live: Extract<TeamTagsView, { status: "live" }> = {
    status: "live",
    orgId: "org-1",
    teamNumber: 1678,
    seasonYear: 2026,
    eventKey: "2026casj",
    eventTeams: [254],
    defs: [],
    assignments: [assignment],
    board: [],
    pickReasons: [
      {
        label: "Defense",
        tone: "strong",
        tagSlug: "defense",
        teamNumber: 254,
        source: "drive_team_tag",
      },
    ],
    nextActions: [],
    computedAt: "2026-03-01T00:00:00.000Z",
  };

  it("returns an empty payload until the board is live", () => {
    const payload = teamTagsPickReasonsPayload({
      status: "setup_required",
      message: "Select a workspace",
      steps: [],
      orgId: null,
      seasonYear: 2026,
    });
    expect(payload.pickReasons).toEqual([]);
    expect(payload.status).toBe("setup_required");
  });

  it("filters the slim payload to one event robot", () => {
    expect(teamTagsPickReasonsPayload(live).pickReasons).toHaveLength(1);
    expect(teamTagsPickReasonsPayload(live, "118").pickReasons).toEqual([]);
    expect(teamTagsPickReasonsPayload(live, "254").pickReasons[0]?.label).toBe("Defense");
  });
});
