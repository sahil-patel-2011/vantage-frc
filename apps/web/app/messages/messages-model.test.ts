import { describe, expect, it } from "vitest";
import {
  formatTime,
  isArchived,
  labelFor,
  mentionsForRender,
  objectTypeLabel,
  type Conversation,
  type Member,
} from "./messages-model";

const team: Conversation = {
  id: "c1",
  kind: "team",
  title: "Match day",
  updatedAt: "2026-09-10T00:00:00.000Z",
  lastMessageAt: null,
  lastBody: null,
  peerUserId: null,
  peerName: null,
  unreadCount: 0,
};

const dm: Conversation = {
  ...team,
  id: "c2",
  kind: "dm",
  title: null,
  peerName: "Alex",
};

describe("messages-model", () => {
  it("labels team channels from the title and DMs from the peer, never DEMO", () => {
    expect(labelFor(team)).toBe("Match day");
    expect(labelFor({ ...team, title: null })).toBe("Team");
    expect(labelFor(dm)).toBe("Alex");
    expect(labelFor({ ...dm, peerName: null })).toBe("Private chat");
    expect(labelFor(team)).not.toMatch(/demo/i);
  });

  it("treats archivedAt as the only archive flag", () => {
    expect(isArchived(team)).toBe(false);
    expect(isArchived({ ...team, archivedAt: "2026-09-10T00:00:00.000Z" })).toBe(true);
  });

  it("prints nothing for a missing timestamp and never a DEMO clock", () => {
    expect(formatTime(null)).toBe("");
    expect(formatTime(undefined)).toBe("");
    expect(formatTime("not-a-date")).not.toMatch(/demo/i);
  });

  it("uses stored mention refs when present instead of guessing", () => {
    const members: Member[] = [
      { id: "u1", name: "Alex", email: "alex@team.org", role: "member" },
      { id: "u2", name: "Sam", email: "sam@team.org", role: "member" },
    ];
    expect(
      mentionsForRender("hi @Alex", [{ userId: "u1", name: "Alex" }], members),
    ).toEqual([{ userId: "u1", name: "Alex" }]);
    expect(mentionsForRender("hi @Sam", undefined, members)).toEqual([
      { userId: "u2", name: "Sam" },
    ]);
  });

  it("labels linked object types from the catalog", () => {
    expect(objectTypeLabel("task")).toBe("Task");
    expect(objectTypeLabel("cad_checkpoint")).toBe("CAD checkpoint");
  });
});
