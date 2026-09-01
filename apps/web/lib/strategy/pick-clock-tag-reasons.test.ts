import { describe, expect, it } from "vitest";
import type { TeamTagAssignment } from "../team-tags";
import {
  applyTeamTagReasonsToPickClock,
  applyTeamTagReasonsToPickClockResult,
  applyTeamTagReasonsToRecommendation,
  mergePickClockTagReasonsFromAssignments,
  mergeTeamTagReasonsIntoClock,
  pickClockTagReasonsFromAssignments,
  teamNumberFromPickClockTeam,
  toPickClockReason,
} from "./pick-clock-tag-reasons";

function tag(
  partial: Partial<TeamTagAssignment> &
    Pick<TeamTagAssignment, "id" | "tagSlug" | "tagName" | "teamNumber">,
): TeamTagAssignment {
  return {
    tagId: partial.tagId ?? partial.tagSlug,
    eventKey: partial.eventKey ?? "2026casj",
    matchKey: partial.matchKey ?? null,
    notes: partial.notes ?? null,
    ...partial,
  };
}

const casjTags: TeamTagAssignment[] = [
  tag({ id: "1", tagSlug: "defense", tagName: "Defense", teamNumber: 254 }),
  tag({
    id: "2",
    tagSlug: "no_climb",
    tagName: "No climb",
    teamNumber: 254,
    notes: "bumper lock",
  }),
  tag({
    id: "3",
    tagSlug: "good_partner",
    tagName: "Good partner",
    teamNumber: 1678,
  }),
  tag({
    id: "4",
    tagSlug: "unreliable",
    tagName: "Unreliable",
    teamNumber: 254,
    eventKey: "2026nhdur",
  }),
];

function rec(partial: { teamKey: string; teamNumber?: number | null; reasons?: { label: string; tone: "strong" | "caution" | "neutral" }[] }) {
  return {
    teamKey: partial.teamKey,
    teamNumber: partial.teamNumber ?? null,
    reasons: partial.reasons ?? [{ label: "EPA 45.2", tone: "neutral" as const }],
  };
}

describe("teamNumberFromPickClockTeam", () => {
  it("prefers a positive teamNumber and falls back to frcNNNN", () => {
    expect(teamNumberFromPickClockTeam({ teamNumber: 254, teamKey: "frc9" })).toBe(254);
    expect(teamNumberFromPickClockTeam({ teamNumber: null, teamKey: "frc1678" })).toBe(1678);
    expect(teamNumberFromPickClockTeam({ teamNumber: 0, teamKey: "frc118" })).toBe(118);
    expect(teamNumberFromPickClockTeam({ teamNumber: null, teamKey: "red-1" })).toBeNull();
  });
});

describe("pickClockTagReasonsFromAssignments", () => {
  it("stays empty until a real event tag exists", () => {
    expect(pickClockTagReasonsFromAssignments([], { teamNumber: 254, eventKey: "2026casj" })).toEqual([]);
    expect(pickClockTagReasonsFromAssignments(casjTags, { teamNumber: 254, eventKey: null })).toEqual([]);
    expect(pickClockTagReasonsFromAssignments(casjTags, { teamNumber: 254, eventKey: "" })).toEqual([]);
    expect(pickClockTagReasonsFromAssignments(casjTags, { teamNumber: 118, eventKey: "2026casj" })).toEqual([]);
  });

  it("projects event-robot tags through pickReasonsFromTeamTags", () => {
    const reasons = pickClockTagReasonsFromAssignments(casjTags, {
      teamNumber: 254,
      eventKey: "2026casj",
    });
    expect(reasons.map((reason) => reason.label)).toEqual(["Defense", "No climb — bumper lock"]);
    expect(reasons.every((reason) => reason.source === "drive_team_tag")).toBe(true);
    expect(reasons.every((reason) => reason.teamNumber === 254)).toBe(true);
    expect(reasons.some((reason) => reason.tagSlug === "unreliable")).toBe(false);
  });

  it("never invents DEMO tags", () => {
    const demoRows = [
      tag({ id: "d", tagSlug: "demo", tagName: "DEMO Defense", teamNumber: 254 }),
      tag({ id: "e", tagSlug: "defense", tagName: "Defense", teamNumber: 254, notes: "demo lock" }),
    ];
    const reasons = pickClockTagReasonsFromAssignments(demoRows, {
      teamNumber: 254,
      eventKey: "2026casj",
    });
    expect(reasons).toEqual([]);
    expect(reasons.every((reason) => !/demo/i.test(reason.label))).toBe(true);
  });
});

describe("toPickClockReason / mergeTeamTagReasonsIntoClock", () => {
  it("keeps only label and tone", () => {
    expect(
      toPickClockReason({
        label: "Defense",
        tone: "strong",
        tagSlug: "defense",
        teamNumber: 254,
        source: "drive_team_tag",
      }),
    ).toEqual({ label: "Defense", tone: "strong" });
  });

  it("drops DEMO labels and slugs instead of substituting a fake line", () => {
    expect(
      toPickClockReason({
        label: "DEMO Defense",
        tone: "strong",
        tagSlug: "defense",
        teamNumber: 254,
        source: "drive_team_tag",
      }),
    ).toBeNull();
    expect(
      toPickClockReason({
        label: "Defense",
        tone: "strong",
        tagSlug: "demo_tag",
        teamNumber: 254,
        source: "drive_team_tag",
      }),
    ).toBeNull();
  });

  it("prepends tag lines, dedupes labels, and caps at four glance rows", () => {
    const merged = mergeTeamTagReasonsIntoClock(
      [
        { label: "Defense", tone: "neutral" },
        { label: "EPA 45.2", tone: "neutral" },
        { label: "High reliability 90", tone: "strong" },
        { label: "Event rank #3", tone: "strong" },
        { label: "Endgame EPA 12", tone: "neutral" },
      ],
      [
        {
          label: "Defense",
          tone: "strong",
          tagSlug: "defense",
          teamNumber: 254,
          source: "drive_team_tag",
        },
        {
          label: "No climb",
          tone: "caution",
          tagSlug: "no_climb",
          teamNumber: 254,
          source: "drive_team_tag",
        },
      ],
    );
    expect(merged).toEqual([
      { label: "Defense", tone: "strong" },
      { label: "No climb", tone: "caution" },
      { label: "EPA 45.2", tone: "neutral" },
      { label: "High reliability 90", tone: "strong" },
    ]);
  });

  it("leaves existing clock reasons unchanged when there are no tags", () => {
    const existing = [{ label: "EPA 12.1", tone: "neutral" as const }];
    expect(mergeTeamTagReasonsIntoClock(existing, [])).toEqual(existing);
  });
});

describe("applyTeamTagReasonsToRecommendation", () => {
  it("merges tags for the recommended robot and leaves other teams alone", () => {
    const tags = pickClockTagReasonsFromAssignments(casjTags, {
      teamNumber: 254,
      eventKey: "2026casj",
    });
    const applied = applyTeamTagReasonsToRecommendation(rec({ teamKey: "frc254", teamNumber: 254 }), tags);
    expect(applied.reasons[0]).toEqual({ label: "Defense", tone: "strong" });
    expect(applied.reasons.some((reason) => reason.label === "EPA 45.2")).toBe(true);

    const other = applyTeamTagReasonsToRecommendation(rec({ teamKey: "frc118", teamNumber: 118 }), tags);
    expect(other.reasons).toEqual([{ label: "EPA 45.2", tone: "neutral" }]);
  });

  it("matches frcNNNN when teamNumber is missing", () => {
    const tags = pickClockTagReasonsFromAssignments(casjTags, {
      teamNumber: 1678,
      eventKey: "2026casj",
    });
    const applied = applyTeamTagReasonsToRecommendation(rec({ teamKey: "frc1678" }), tags);
    expect(applied.reasons[0]).toEqual({ label: "Good partner", tone: "strong" });
  });
});

describe("applyTeamTagReasonsToPickClockResult / merge from assignments", () => {
  it("overlays tags on the recommendation and alternates", () => {
    const result = mergePickClockTagReasonsFromAssignments(
      {
        recommendation: rec({ teamKey: "frc254", teamNumber: 254 }),
        alternates: [rec({ teamKey: "frc1678", teamNumber: 1678, reasons: [{ label: "EPA 12.1", tone: "neutral" }] })],
      },
      casjTags,
      "2026casj",
    );
    expect(result.recommendation?.reasons[0]?.label).toBe("Defense");
    expect(result.alternates[0]?.reasons[0]).toEqual({ label: "Good partner", tone: "strong" });
    expect(JSON.stringify(result)).not.toMatch(/DEMO/i);
  });

  it("no-ops without an event or applied tags", () => {
    const original = {
      recommendation: rec({ teamKey: "frc254", teamNumber: 254 }),
      alternates: [] as ReturnType<typeof rec>[],
    };
    expect(mergePickClockTagReasonsFromAssignments(original, casjTags, null)).toBe(original);
    expect(mergePickClockTagReasonsFromAssignments(original, casjTags, "")).toBe(original);
    expect(mergePickClockTagReasonsFromAssignments(original, [], "2026casj")).toBe(original);
    expect(applyTeamTagReasonsToPickClockResult(original, [])).toBe(original);
  });
});

describe("applyTeamTagReasonsToPickClock", () => {
  const orgId = "11111111-1111-1111-1111-111111111111";

  function clientWith(query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>) {
    return { query } as never;
  }

  it("does not query until a real event key exists", async () => {
    let queried = false;
    const original = {
      recommendation: rec({ teamKey: "frc254", teamNumber: 254 }),
      alternates: [] as ReturnType<typeof rec>[],
    };
    const result = await applyTeamTagReasonsToPickClock(clientWith(async () => {
      queried = true;
      return { rows: [] };
    }), {
      orgId,
      eventKey: "",
      result: original,
    });
    expect(result).toBe(original);
    expect(queried).toBe(false);
  });

  it("loads event tags through loadTeamTagPickReasons and merges them", async () => {
    const result = await applyTeamTagReasonsToPickClock(
      clientWith(async () => ({
        rows: [
          {
            id: "1",
            tagId: "def",
            tagSlug: "defense",
            tagName: "Defense",
            teamNumber: 254,
            eventKey: "2026casj",
            matchKey: null,
            notes: null,
          },
        ],
      })),
      {
        orgId,
        eventKey: "2026casj",
        result: {
          recommendation: rec({ teamKey: "frc254", teamNumber: 254 }),
          alternates: [],
        },
      },
    );
    expect(result.recommendation?.reasons[0]).toEqual({ label: "Defense", tone: "strong" });
    expect(result.recommendation?.reasons.some((reason) => reason.label === "EPA 45.2")).toBe(true);
  });

  it("degrades to the original clock when tag tables are missing", async () => {
    const original = {
      recommendation: rec({ teamKey: "frc254", teamNumber: 254 }),
      alternates: [] as ReturnType<typeof rec>[],
    };
    const result = await applyTeamTagReasonsToPickClock(
      clientWith(async () => {
        throw Object.assign(new Error("missing"), { code: "42P01" });
      }),
      { orgId, eventKey: "2026casj", result: original },
    );
    expect(result).toBe(original);
    expect(result.recommendation?.reasons).toEqual([{ label: "EPA 45.2", tone: "neutral" }]);
  });
});
