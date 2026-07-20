import { describe, expect, it } from "vitest";
import {
  buildMediaPostDraft,
  isMediaReminderOverdue,
  mediaCalendarItems,
  mediaDraftItems,
  mediaReminderItems,
} from "./media-content-helpers";
import type { MediaContentItem } from "./types";

function item(partial: Partial<MediaContentItem> & Pick<MediaContentItem, "id" | "title">): MediaContentItem {
  return {
    seasonYear: 2026,
    kind: "post",
    status: "draft",
    platform: "instagram",
    caption: null,
    dueAt: null,
    remindAt: null,
    remindedAt: null,
    assignedTo: null,
    createdBy: "u1",
    updatedBy: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("buildMediaPostDraft", () => {
  it("returns null when title and notes are empty — never DEMO captions", () => {
    expect(buildMediaPostDraft({ title: "  ", notes: "", platform: "instagram" })).toBeNull();
  });

  it("builds a caption and suggested due_at from a real title", () => {
    const draft = buildMediaPostDraft({
      title: "Kickoff reveal",
      platform: "instagram",
      notes: "Behind the scenes",
      now: new Date("2026-07-20T12:00:00.000Z"),
    });
    expect(draft).not.toBeNull();
    expect(draft!.caption).toContain("Kickoff reveal");
    expect(draft!.caption).toContain("Behind the scenes");
    expect(draft!.caption).not.toMatch(/DEMO/i);
    expect(draft!.dueAt).toBe("2026-07-21T18:00:00.000Z");
  });
});

describe("media content filters", () => {
  const items = [
    item({ id: "1", title: "Draft A", status: "draft" }),
    item({
      id: "2",
      title: "Scheduled B",
      status: "scheduled",
      dueAt: "2026-07-22T18:00:00.000Z",
      remindAt: "2026-07-21T12:00:00.000Z",
    }),
    item({
      id: "3",
      title: "Posted C",
      status: "posted",
      dueAt: "2026-07-10T18:00:00.000Z",
    }),
    item({
      id: "4",
      title: "Reminder D",
      status: "draft",
      remindAt: "2026-07-19T12:00:00.000Z",
    }),
  ];

  it("lists calendar items without inventing rows", () => {
    expect(mediaCalendarItems(items).map((row) => row.id)).toEqual(["2"]);
  });

  it("lists drafts only", () => {
    expect(mediaDraftItems(items).map((row) => row.id)).toEqual(["1", "4"]);
  });

  it("lists undismissed reminders", () => {
    expect(mediaReminderItems(items).map((row) => row.id)).toEqual(["4", "2"]);
  });

  it("flags overdue reminders", () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    expect(isMediaReminderOverdue(items[3]!, now)).toBe(true);
    expect(isMediaReminderOverdue(items[1]!, now)).toBe(false);
  });
});
