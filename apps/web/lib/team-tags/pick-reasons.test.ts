import { describe, expect, it } from "vitest";
import type { TeamTagAssignment } from "./group";
import {
  formatTeamTagPickLabel,
  pickReasonToneForSlug,
  pickReasonsForEvent,
  pickReasonsFromTeamTags,
} from "./pick-reasons";
import { pickReasonsForEvent as exportedForEvent, pickReasonsFromTeamTags as exportedFromTags } from "./index";

function tag(partial: Partial<TeamTagAssignment> & Pick<TeamTagAssignment, "id" | "tagSlug" | "tagName" | "teamNumber">): TeamTagAssignment {
  return {
    tagId: partial.tagId ?? partial.tagSlug,
    eventKey: partial.eventKey ?? "2026casj",
    matchKey: partial.matchKey ?? null,
    notes: partial.notes ?? null,
    ...partial,
  };
}

const rows: TeamTagAssignment[] = [
  tag({ id: "1", tagSlug: "defense", tagName: "Defense", teamNumber: 254 }),
  tag({
    id: "2",
    tagSlug: "defense",
    tagName: "Defense",
    teamNumber: 1678,
    notes: "bumper lock",
  }),
  tag({
    id: "3",
    tagSlug: "no_climb",
    tagName: "No climb",
    teamNumber: 254,
    matchKey: "qm12",
  }),
  tag({
    id: "4",
    tagSlug: "unreliable",
    tagName: "Unreliable",
    teamNumber: 254,
    eventKey: "2026nhdur",
  }),
];

describe("pickReasonsFromTeamTags", () => {
  it("stays empty until a real tag is applied", () => {
    expect(pickReasonsFromTeamTags([], { teamNumber: 254 })).toEqual([]);
    expect(pickReasonsFromTeamTags(rows, { teamNumber: 118 })).toEqual([]);
    expect(pickReasonsFromTeamTags(rows, { teamNumber: 0 })).toEqual([]);
  });

  it("reads event-robot tags as glanceable pick reasons", () => {
    const reasons = pickReasonsFromTeamTags(rows, { teamNumber: 254, eventKey: "2026casj" });
    expect(reasons.map((reason) => reason.label)).toEqual(["Defense", "No climb"]);
    expect(reasons.every((reason) => reason.source === "drive_team_tag")).toBe(true);
    expect(reasons.find((reason) => reason.tagSlug === "defense")?.tone).toBe("strong");
    expect(reasons.find((reason) => reason.tagSlug === "no_climb")?.tone).toBe("caution");
    expect(reasons.some((reason) => reason.tagSlug === "unreliable")).toBe(false);
  });

  it("keeps an optional note on the reason line", () => {
    const reasons = pickReasonsFromTeamTags(rows, { teamNumber: 1678, eventKey: "2026casj" });
    expect(reasons).toEqual([
      {
        label: "Defense — bumper lock",
        tone: "strong",
        tagSlug: "defense",
        teamNumber: 1678,
        source: "drive_team_tag",
      },
    ]);
  });

  it("dedupes the same slug and prefers the assignment with a note", () => {
    const duplicate: TeamTagAssignment[] = [
      tag({ id: "a", tagSlug: "defense", tagName: "Defense", teamNumber: 254 }),
      tag({ id: "b", tagSlug: "defense", tagName: "Defense", teamNumber: 254, notes: "late climb" }),
    ];
    expect(pickReasonsFromTeamTags(duplicate, { teamNumber: 254 })).toEqual([
      {
        label: "Defense — late climb",
        tone: "strong",
        tagSlug: "defense",
        teamNumber: 254,
        source: "drive_team_tag",
      },
    ]);
  });

  it("never invents DEMO labels", () => {
    const reasons = pickReasonsFromTeamTags(rows, { teamNumber: 254, eventKey: "2026casj" });
    expect(reasons.every((reason) => !/demo/i.test(reason.label))).toBe(true);
  });

  it("is exported from the team-tags package entry", () => {
    expect(exportedFromTags).toBe(pickReasonsFromTeamTags);
    expect(exportedForEvent).toBe(pickReasonsForEvent);
  });
});

describe("pickReasonsForEvent", () => {
  it("returns nothing without an event or applied tags", () => {
    expect(pickReasonsForEvent(rows, null)).toEqual([]);
    expect(pickReasonsForEvent(rows, "")).toEqual([]);
    expect(pickReasonsForEvent([], "2026casj")).toEqual([]);
  });

  it("lists every tagged event robot in team-number order", () => {
    const reasons = pickReasonsForEvent(rows, "2026casj");
    expect(reasons.map((reason) => `${reason.teamNumber}:${reason.tagSlug}`)).toEqual([
      "254:defense",
      "254:no_climb",
      "1678:defense",
    ]);
  });
});

describe("pick reason tone and labels", () => {
  it("maps the default vocabulary and leaves custom slugs neutral", () => {
    expect(pickReasonToneForSlug("defense")).toBe("strong");
    expect(pickReasonToneForSlug("strong_auto")).toBe("strong");
    expect(pickReasonToneForSlug("good_partner")).toBe("strong");
    expect(pickReasonToneForSlug("no_climb")).toBe("caution");
    expect(pickReasonToneForSlug("slow_cycles")).toBe("caution");
    expect(pickReasonToneForSlug("unreliable")).toBe("caution");
    expect(pickReasonToneForSlug("custom_fit")).toBe("neutral");
  });

  it("formats a short note and drops blank names", () => {
    expect(formatTeamTagPickLabel("Defense")).toBe("Defense");
    expect(formatTeamTagPickLabel("Defense", "  bumper lock  ")).toBe("Defense — bumper lock");
    expect(formatTeamTagPickLabel("   ")).toBe("");
    expect(formatTeamTagPickLabel("Defense", "x".repeat(80)).length).toBeLessThanOrEqual("Defense — ".length + 60);
  });
});
