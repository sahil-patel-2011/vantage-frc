import { describe, expect, it } from "vitest";
import { BUG_DESCRIPTION_MAX } from "./bug-report";
import {
  FEEDBACK_DRAFT_KEY,
  clearFeedbackDraft,
  readFeedbackDraft,
  writeFeedbackDraft,
} from "./feedback-draft";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

const blocked = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

describe("the unsent feedback draft", () => {
  it("keeps what was typed and the kind, and hands it back", () => {
    const storage = memoryStorage();
    writeFeedbackDraft({ kind: "idea", text: "A dark pit-wall view" }, storage);
    expect(readFeedbackDraft(storage)).toEqual({ kind: "idea", text: "A dark pit-wall view" });
  });

  it("is cleared after a successful send", () => {
    const storage = memoryStorage();
    writeFeedbackDraft({ kind: "bug", text: "It froze" }, storage);
    clearFeedbackDraft(storage);
    expect(readFeedbackDraft(storage)).toBeNull();
    expect(storage.data.has(FEEDBACK_DRAFT_KEY)).toBe(false);
  });

  it("does not keep an empty box", () => {
    const storage = memoryStorage();
    writeFeedbackDraft({ kind: "bug", text: "something" }, storage);
    writeFeedbackDraft({ kind: "bug", text: "   " }, storage);
    expect(readFeedbackDraft(storage)).toBeNull();
  });

  it("ignores a stored value it cannot trust", () => {
    expect(readFeedbackDraft(memoryStorage({ [FEEDBACK_DRAFT_KEY]: "not json" }))).toBeNull();
    expect(readFeedbackDraft(memoryStorage({ [FEEDBACK_DRAFT_KEY]: JSON.stringify({ text: 5 }) }))).toBeNull();
    expect(readFeedbackDraft(memoryStorage({ [FEEDBACK_DRAFT_KEY]: JSON.stringify({ kind: "weird", text: "hi" }) }))).toEqual({
      kind: "bug",
      text: "hi",
    });
  });

  it("never returns more than the note can hold", () => {
    const storage = memoryStorage({ [FEEDBACK_DRAFT_KEY]: JSON.stringify({ kind: "bug", text: "x".repeat(9000) }) });
    expect(readFeedbackDraft(storage)?.text.length).toBe(BUG_DESCRIPTION_MAX);
  });

  it("works exactly the same when storage is blocked", () => {
    expect(() => writeFeedbackDraft({ kind: "bug", text: "hi" }, blocked)).not.toThrow();
    expect(() => clearFeedbackDraft(blocked)).not.toThrow();
    expect(readFeedbackDraft(blocked)).toBeNull();
    expect(readFeedbackDraft(null)).toBeNull();
  });
});
