import { describe, expect, it } from "vitest";
import { assignmentsForBoard, assignmentsForEvent, groupTeamTags, tagsForTeam, type TeamTagAssignment } from "./group";

const rows: TeamTagAssignment[] = [
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
  {
    id: "2",
    tagId: "def",
    tagSlug: "defense",
    tagName: "Defense",
    teamNumber: 1678,
    eventKey: "2026casj",
    matchKey: null,
    notes: "bumper lock",
  },
  {
    id: "3",
    tagId: "climb",
    tagSlug: "no_climb",
    tagName: "No climb",
    teamNumber: 254,
    eventKey: "2026casj",
    matchKey: "qm12",
    notes: null,
  },
];

describe("drive-team tag board", () => {
  it("stays empty until a real tag is applied", () => {
    expect(groupTeamTags([])).toEqual([]);
    expect(tagsForTeam([], 254)).toEqual([]);
  });

  it("groups robots under each qualitative tag", () => {
    const board = groupTeamTags(rows);
    expect(board.map((column) => column.slug)).toEqual(["defense", "no_climb"]);
    expect(board[0]?.teams.map((team) => team.teamNumber)).toEqual([254, 1678]);
    expect(tagsForTeam(rows, 254)).toEqual(["Defense", "No climb"]);
  });

  it("scopes event robots and leaves the board empty without an event tag", () => {
    expect(assignmentsForEvent(rows, null)).toEqual([]);
    expect(assignmentsForEvent(rows, "2026nhdur")).toEqual([]);
    expect(assignmentsForEvent(rows, "2026casj").map((row) => row.id)).toEqual(["1", "2", "3"]);
    expect(groupTeamTags(assignmentsForBoard(rows, "2026casj")).map((column) => column.slug)).toEqual([
      "defense",
      "no_climb",
    ]);
    expect(groupTeamTags(assignmentsForBoard(rows, "2026nhdur"))).toEqual([]);
    expect(assignmentsForBoard(rows, null).every((row) => row.eventKey == null)).toBe(true);
  });
});
