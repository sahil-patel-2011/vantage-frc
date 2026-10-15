import { describe, expect, it } from "vitest";
import { discardDraftBody, isOldEmptyDraft, splitDrafts } from "./list";
import type { LessonSummary } from "./types";

const now = Date.parse("2026-10-15T12:00:00Z");
const daysAgo = (days: number) => new Date(now - days * 86_400_000).toISOString();

const draft = (patch: Partial<LessonSummary>): LessonSummary => ({
  id: "l",
  title: "Wiring",
  summary: "",
  audience: "",
  minutes: null,
  status: "draft",
  source: "editor",
  stepCount: 0,
  questionCount: 0,
  createdBy: "u",
  createdByName: null,
  updatedAt: daysAgo(1),
  publishedAt: null,
  canEdit: true,
  canDelete: true,
  best: null,
  ...patch,
});

describe("isOldEmptyDraft", () => {
  it("is an empty written draft untouched for over a month", () => {
    expect(isOldEmptyDraft(draft({ updatedAt: daysAgo(45) }), now)).toBe(true);
    expect(isOldEmptyDraft(draft({ updatedAt: daysAgo(5) }), now)).toBe(false);
  });

  it("never folds away a draft with content, a PDF lesson, or an archived lesson", () => {
    expect(isOldEmptyDraft(draft({ updatedAt: daysAgo(45), stepCount: 1 }), now)).toBe(false);
    expect(isOldEmptyDraft(draft({ updatedAt: daysAgo(45), questionCount: 2 }), now)).toBe(false);
    expect(isOldEmptyDraft(draft({ updatedAt: daysAgo(45), source: "pdf" }), now)).toBe(false);
    expect(isOldEmptyDraft(draft({ updatedAt: daysAgo(45), status: "archived" }), now)).toBe(false);
  });
});

describe("splitDrafts", () => {
  it("keeps the order and splits off old empty drafts", () => {
    const a = draft({ id: "a" });
    const b = draft({ id: "b", updatedAt: daysAgo(60) });
    const c = draft({ id: "c", stepCount: 2 });
    expect(splitDrafts([a, b, c], now)).toEqual({ current: [a, c], old: [b] });
  });
});

describe("discardDraftBody", () => {
  it("says what goes", () => {
    expect(discardDraftBody({ source: "editor", stepCount: 0, questionCount: 0 })).toBe("It has nothing written in it yet. This can't be undone.");
    expect(discardDraftBody({ source: "editor", stepCount: 1, questionCount: 3 })).toBe(
      "Its 1 step and 3 practice questions and its history are deleted. This can't be undone.",
    );
  });
});
