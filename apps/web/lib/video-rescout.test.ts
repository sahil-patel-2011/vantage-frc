import { DEFAULT_MATCH_SCHEMA } from "@vantage/scouting";
import { describe, expect, it } from "vitest";
import {
  aggregateTeamPayload,
  buildVideoRescoutSyncEntries,
  nextPlaybackRate,
  normalizeTeamKey,
  parseAssignedTeams,
  parseVideoRescoutAction,
  PLAYBACK_RATES,
  seekSeconds,
  videoRescoutClientId,
  type TimelineScore,
} from "./video-rescout";

const reviewId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const orgId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const schemaId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const scoreId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function score(partial: Partial<TimelineScore> & Pick<TimelineScore, "teamKey" | "fieldKey" | "value">): TimelineScore {
  return {
    id: partial.id ?? scoreId,
    reviewId: partial.reviewId ?? reviewId,
    atSeconds: partial.atSeconds ?? 10,
    createdByName: partial.createdByName ?? "Scout",
    createdAt: partial.createdAt ?? "2026-07-17T12:00:00.000Z",
    ...partial,
  };
}

describe("video-rescout helpers", () => {
  it("normalizes team keys and parses up to four assignments", () => {
    expect(normalizeTeamKey("254")).toBe("frc254");
    expect(normalizeTeamKey("FRC254")).toBe("frc254");
    expect(parseAssignedTeams(["254", "frc1678", "971"])).toEqual(["frc254", "frc1678", "frc971"]);
    expect(() => parseAssignedTeams(["1", "2", "3", "4", "5"])).toThrow(/at most 4/i);
    expect(() => parseAssignedTeams(["254", "254"])).toThrow(/duplicate/i);
  });

  it("seeks within playback bounds and cycles rates", () => {
    expect(seekSeconds(30, -5, 120)).toBe(25);
    expect(seekSeconds(118, 5, 120)).toBe(120);
    expect(seekSeconds(0, -10, 120)).toBe(0);
    expect(PLAYBACK_RATES).toEqual([1, 1.5, 2]);
    expect(nextPlaybackRate(1)).toBe(1.5);
    expect(nextPlaybackRate(1.5)).toBe(2);
    expect(nextPlaybackRate(2)).toBe(1);
  });

  it("aggregates numeric deltas and latest select/text values", () => {
    const payload = aggregateTeamPayload(
      [
        score({ teamKey: "frc254", fieldKey: "auto_score", value: 4, atSeconds: 10 }),
        score({ teamKey: "frc254", fieldKey: "auto_score", value: 2, atSeconds: 40 }),
        score({ teamKey: "frc254", fieldKey: "endgame", value: "partial", atSeconds: 50 }),
        score({ teamKey: "frc254", fieldKey: "endgame", value: "full", atSeconds: 90 }),
        score({ teamKey: "frc254", fieldKey: "notes", value: "late climb", atSeconds: 95 }),
      ],
      "frc254",
      DEFAULT_MATCH_SCHEMA,
    );
    expect(payload.auto_score).toBe(6);
    expect(payload.endgame).toBe("full");
    expect(payload.notes).toBe("late climb");
  });

  it("parses supported rescout actions with version-4/8 uuids", () => {
    expect(parseVideoRescoutAction({ action: "set_assigned_teams", orgId, reviewId, teamKeys: ["254"] })).toMatchObject({
      action: "set_assigned_teams",
      orgId,
      reviewId,
      teamKeys: ["frc254"],
    });
    expect(
      parseVideoRescoutAction({
        action: "add_score",
        orgId,
        reviewId,
        teamKey: "254",
        atSeconds: 37,
        fieldKey: "auto_score",
        value: 1,
      }),
    ).toMatchObject({ action: "add_score", atSeconds: 37, teamKey: "frc254" });
    expect(
      parseVideoRescoutAction({
        action: "delete_score",
        orgId,
        id: scoreId,
      }),
    ).toMatchObject({ action: "delete_score", id: scoreId });
    expect(
      parseVideoRescoutAction({
        action: "commit_rescout",
        orgId,
        reviewId,
        schemaId,
        confidence: "high",
      }),
    ).toMatchObject({ action: "commit_rescout", confidence: "high" });
    expect(() => parseVideoRescoutAction({ action: "set_assigned_teams", orgId: "not-a-uuid", reviewId, teamKeys: ["254"] })).toThrow(
      /organization/i,
    );
  });

  it("builds deterministic video sync entries", () => {
    const entries = buildVideoRescoutSyncEntries({
      reviewId,
      eventKey: "2026miket",
      matchKey: "2026miket_qm12",
      schemaId,
      assignedTeamKeys: ["frc254", "frc1678"],
      scores: [
        score({ teamKey: "frc254", fieldKey: "auto_score", value: 3, atSeconds: 12 }),
        score({ teamKey: "frc1678", fieldKey: "teleop_score", value: 5, atSeconds: 88 }),
      ],
      schema: DEFAULT_MATCH_SCHEMA,
      confidence: "normal",
      updatedAt: "2026-07-17T18:00:00.000Z",
    });
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      source: "video",
      clientId: videoRescoutClientId(reviewId, "frc254"),
      videoReviewId: reviewId,
      videoAtSeconds: 12,
      matchKey: "2026miket_qm12",
    });
    expect(entries[1]?.clientId).toBe(videoRescoutClientId(reviewId, "frc1678"));
    expect(entries[1]?.videoAtSeconds).toBe(88);
  });
});
