import { describe, expect, it } from "vitest";
import {
  fmtTimestamp,
  NOTE_TAGS,
  parseTimestampInput,
  parseVideoAction,
  sortNotes,
  tagCounts,
  type VideoNote,
} from "./video-review";

const ORG = "11111111-1111-4111-8111-111111111111";
const ID = "22222222-2222-4222-8222-222222222222";

function note(overrides: Partial<VideoNote>): VideoNote {
  return {
    id: "n1",
    reviewId: ID,
    atSeconds: 30,
    tag: "other",
    body: "Watch the intake here",
    createdByName: null,
    createdAt: "2026-03-01T12:00:00Z",
    ...overrides,
  };
}

describe("fmtTimestamp", () => {
  it("formats minutes and seconds", () => {
    expect(fmtTimestamp(65)).toBe("1:05");
    expect(fmtTimestamp(0)).toBe("0:00");
  });
  it("formats hours once the clock passes 60 minutes", () => {
    expect(fmtTimestamp(3723)).toBe("1:02:03");
    expect(fmtTimestamp(3600)).toBe("1:00:00");
  });
});

describe("parseTimestampInput", () => {
  it("accepts plain seconds", () => {
    expect(parseTimestampInput("83")).toBe(83);
  });
  it("accepts m:ss and h:mm:ss forms", () => {
    expect(parseTimestampInput("1:23")).toBe(83);
    expect(parseTimestampInput("1:02:03")).toBe(3723);
    expect(parseTimestampInput(" 0:07 ")).toBe(7);
  });
  it("rejects out-of-range colon parts", () => {
    expect(() => parseTimestampInput("1:75")).toThrow(/below 60/);
  });
  it("rejects negatives, junk, and empty input", () => {
    expect(() => parseTimestampInput("-5")).toThrow(/timestamp/i);
    expect(() => parseTimestampInput("abc")).toThrow(/timestamp/i);
    expect(() => parseTimestampInput("")).toThrow(/timestamp/i);
  });
  it("rejects totals beyond six hours", () => {
    expect(() => parseTimestampInput("6:00:01")).toThrow(/6 hours/);
    expect(parseTimestampInput("6:00:00")).toBe(21_600);
  });
});

describe("sortNotes", () => {
  it("orders ascending by seconds, then created time", () => {
    const sorted = sortNotes([
      note({ id: "a", atSeconds: 90 }),
      note({ id: "b", atSeconds: 15, createdAt: "2026-03-01T12:05:00Z" }),
      note({ id: "c", atSeconds: 15, createdAt: "2026-03-01T12:01:00Z" }),
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual(["c", "b", "a"]);
  });
});

describe("tagCounts", () => {
  it("zero-fills every tag and counts occurrences", () => {
    const counts = tagCounts([note({ tag: "auto" }), note({ id: "n2", tag: "auto" }), note({ id: "n3", tag: "defense" })]);
    expect(counts.auto).toBe(2);
    expect(counts.defense).toBe(1);
    expect(counts.endgame).toBe(0);
    expect(Object.keys(counts).sort()).toEqual([...NOTE_TAGS].sort());
  });
});

describe("parseVideoAction", () => {
  it("creates a review from a watch URL and derives the video id", () => {
    const action = parseVideoAction({
      action: "create_review",
      orgId: ORG,
      title: "Q42 vs 254",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    });
    expect(action).toMatchObject({ action: "create_review", videoId: "dQw4w9WgXcQ", matchKey: null, teamKey: null });
  });
  it("accepts youtu.be short links", () => {
    const action = parseVideoAction({
      action: "create_review",
      orgId: ORG,
      title: "Finals 1",
      url: "https://youtu.be/dQw4w9WgXcQ",
      matchKey: "2026casj_f1m1",
      teamKey: "frc254",
    });
    expect(action).toMatchObject({ videoId: "dQw4w9WgXcQ", matchKey: "2026casj_f1m1", teamKey: "frc254" });
  });
  it("rejects non-https and non-YouTube URLs", () => {
    expect(() =>
      parseVideoAction({ action: "create_review", orgId: ORG, title: "x", url: "http://www.youtube.com/watch?v=dQw4w9WgXcQ" }),
    ).toThrow(/valid YouTube URL/);
    expect(() =>
      parseVideoAction({ action: "create_review", orgId: ORG, title: "x", url: "https://vimeo.com/123456" }),
    ).toThrow(/valid YouTube URL/);
  });
  it("builds sparse review patches and rejects empty ones", () => {
    expect(parseVideoAction({ action: "update_review", orgId: ORG, id: ID, patch: { summary: "Strong auto" } })).toMatchObject({
      patch: { summary: "Strong auto" },
    });
    expect(parseVideoAction({ action: "update_review", orgId: ORG, id: ID, patch: { matchKey: "" } })).toMatchObject({
      patch: { matchKey: null },
    });
    expect(() => parseVideoAction({ action: "update_review", orgId: ORG, id: ID, patch: {} })).toThrow(/No changes/);
  });
  it("parses add_note timestamps from text or numeric seconds", () => {
    expect(
      parseVideoAction({ action: "add_note", orgId: ORG, reviewId: ID, timestamp: "1:23", tag: "auto", body: "Missed note" }),
    ).toMatchObject({ atSeconds: 83, tag: "auto" });
    expect(
      parseVideoAction({ action: "add_note", orgId: ORG, reviewId: ID, atSeconds: 45, body: "Pinned on the wall" }),
    ).toMatchObject({ atSeconds: 45, tag: "other" });
    expect(() =>
      parseVideoAction({ action: "add_note", orgId: ORG, reviewId: ID, timestamp: "1:99", tag: "auto", body: "x" }),
    ).toThrow(/below 60/);
  });
  it("builds sparse note patches with validated seconds", () => {
    expect(parseVideoAction({ action: "update_note", orgId: ORG, id: ID, patch: { atSeconds: 90 } })).toMatchObject({
      patch: { atSeconds: 90 },
    });
    expect(() => parseVideoAction({ action: "update_note", orgId: ORG, id: ID, patch: { atSeconds: 30_000 } })).toThrow(/Timestamp/);
    expect(() => parseVideoAction({ action: "update_note", orgId: ORG, id: ID, patch: {} })).toThrow(/No changes/);
  });
  it("rejects unsupported actions", () => {
    expect(() => parseVideoAction({ action: "rewind", orgId: ORG })).toThrow(/Unsupported/);
  });
});
