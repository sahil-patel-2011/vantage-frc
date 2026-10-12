import { describe, expect, it } from "vitest";
import {
  autosavePayload,
  classifySaveStatus,
  decodeStoredDraft,
  draftsEqual,
  draftStorageKey,
  encodeStoredDraft,
  retryDelay,
  saveStatusText,
  type LessonDraft,
} from "./autosave";

const draft: LessonDraft = {
  title: "Wiring a PDH",
  summary: "Power distribution, step by step",
  audience: "Electrical rookies",
  minutes: 30,
  body: { steps: [{ id: "s-1", title: "Breakers", text: "40 A for drive motors" }], practice: [] },
};

describe("autosave status line", () => {
  it("says what is happening in a few quiet words", () => {
    const now = 1_000_000;
    expect(saveStatusText({ kind: "saving" }, now)).toBe("Saving…");
    expect(saveStatusText({ kind: "saved", at: now - 5_000 }, now)).toBe("Saved just now");
    expect(saveStatusText({ kind: "saved", at: now - 60_000 }, now)).toBe("Saved 1 minute ago");
    expect(saveStatusText({ kind: "saved", at: now - 5 * 60_000 }, now)).toBe("Saved 5 minutes ago");
    expect(saveStatusText({ kind: "retrying", attempt: 2 }, now)).toBe("Couldn't save — retrying");
    expect(saveStatusText({ kind: "conflict" }, now)).toBe("Someone else edited this — reload");
    expect(saveStatusText({ kind: "error", message: "Keep the title under 160 characters." }, now)).toBe(
      "Couldn't save: Keep the title under 160 characters.",
    );
  });
});

describe("what a save's answer means", () => {
  it("retries a dropped connection or a server hiccup, stops on a refusal, and flags a conflict", () => {
    expect(classifySaveStatus(200)).toBe("ok");
    expect(classifySaveStatus(409)).toBe("conflict");
    for (const status of [0, 408, 429, 500, 502, 503]) expect(classifySaveStatus(status)).toBe("retry");
    for (const status of [400, 401, 403, 404, 413, 415, 422]) expect(classifySaveStatus(status)).toBe("refused");
  });

  it("backs off and then keeps trying at the slowest pace", () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(retryDelay)).toEqual([2000, 4000, 8000, 15000, 30000, 30000, 30000]);
  });
});

describe("the copy kept in this browser", () => {
  it("round-trips a draft for the same lesson only", () => {
    const raw = encodeStoredDraft("lesson-1", 7, draft, 123);
    expect(decodeStoredDraft(raw, "lesson-1")).toEqual({ v: 1, lessonId: "lesson-1", baseVersion: 7, savedAt: 123, draft });
    expect(decodeStoredDraft(raw, "lesson-2")).toBeNull();
    expect(draftStorageKey("lesson-1")).toBe("vantage.team-lessons.draft.lesson-1");
  });

  it("ignores anything malformed instead of loading it into the editor", () => {
    expect(decodeStoredDraft(null, "lesson-1")).toBeNull();
    expect(decodeStoredDraft("{not json", "lesson-1")).toBeNull();
    const bad = JSON.parse(encodeStoredDraft("lesson-1", 1, draft, 1));
    bad.draft.body.steps[0].script = "<script>";
    expect(decodeStoredDraft(JSON.stringify(bad), "lesson-1")).toBeNull();
  });

  it("compares drafts by content", () => {
    expect(draftsEqual(draft, JSON.parse(JSON.stringify(draft)))).toBe(true);
    expect(draftsEqual(draft, { ...draft, title: "Wiring a PDH!" })).toBe(false);
    // The server trims the title and stores an empty one as "Untitled lesson".
    expect(draftsEqual(draft, { ...draft, title: "  Wiring a PDH " })).toBe(true);
    expect(draftsEqual({ ...draft, title: "" }, { ...draft, title: "Untitled lesson" })).toBe(true);
  });

  it("sends the version it was edited from with every field", () => {
    expect(JSON.parse(autosavePayload("org-1", 7, draft))).toEqual({ orgId: "org-1", version: 7, ...draft });
  });
});
