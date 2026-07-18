import { describe, expect, it } from "vitest";
import {
  applyMention,
  filterMembersForMention,
  findActiveMention,
  pruneMentionIds,
  resolveMentionedUserIds,
  segmentMessageBody,
} from "./mentions";

const members = [
  { id: "u1", name: "Alex Rivera", email: "alex@team.org" },
  { id: "u2", name: "Alex", email: "a@team.org" },
  { id: "u3", name: "Sam Lee", email: "sam@team.org" },
];

describe("message mentions", () => {
  it("finds the active @query at the cursor", () => {
    expect(findActiveMention("hey @al", 7)).toEqual({ start: 4, end: 7, query: "al" });
    expect(findActiveMention("hey @al there", 7)).toEqual({ start: 4, end: 7, query: "al" });
    expect(findActiveMention("hey @al there", 13)).toBeNull();
    expect(findActiveMention("email me@", 9)).toBeNull();
  });

  it("filters and ranks members for autocomplete", () => {
    expect(filterMembersForMention(members, "al").map((item) => item.id)).toEqual(["u2", "u1"]);
    expect(filterMembersForMention(members, "sam").map((item) => item.id)).toEqual(["u3"]);
    expect(filterMembersForMention(members, "zzz")).toEqual([]);
  });

  it("inserts a selected mention and advances the cursor", () => {
    const result = applyMention("hey @al", 7, members[0]!);
    expect(result.text).toBe("hey @Alex Rivera ");
    expect(result.cursor).toBe("hey @Alex Rivera ".length);
  });

  it("prunes mention ids when their token is removed from the body", () => {
    expect(
      pruneMentionIds(
        "ping @Alex Rivera please",
        [
          { userId: "u1", name: "Alex Rivera" },
          { userId: "u3", name: "Sam Lee" },
        ],
        ["u1", "u3"],
      ),
    ).toEqual(["u1"]);
  });

  it("resolves mentions from claimed ids and body tokens", () => {
    expect(
      resolveMentionedUserIds("can @Alex Rivera and @Sam Lee help?", members, ["u1"], "author"),
    ).toEqual(["u1", "u3"]);
    expect(resolveMentionedUserIds("@Alex Rivera", members, ["u1"], "u1")).toEqual([]);
  });

  it("segments body text with mention highlights, longest name first", () => {
    const segments = segmentMessageBody("ask @Alex Rivera or @Alex", [
      { userId: "u1", name: "Alex Rivera" },
      { userId: "u2", name: "Alex" },
    ]);
    expect(segments).toEqual([
      { kind: "text", value: "ask " },
      { kind: "mention", value: "@Alex Rivera", userId: "u1", name: "Alex Rivera" },
      { kind: "text", value: " or " },
      { kind: "mention", value: "@Alex", userId: "u2", name: "Alex" },
    ]);
  });
});
