import { describe, expect, it } from "vitest";
import { NO_ANSWER_PLACEHOLDER, answerText, buildAwardExport, slugForFile } from "./awards-export";

const SUBMISSION = {
  id: "sub-1",
  seasonYear: 2026,
  eventKey: "2026mnmi",
  awardType: "impact",
  title: "Impact Award",
  status: "in_review",
  priority: "normal",
  deadline: "2026-02-20",
  summary: "Our regional Impact packet.",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const ITEMS = [
  { id: "b", kind: "essay", prompt: "How does your team sustain itself?", content: "", charLimit: 500, done: false, sortOrder: 1 },
  {
    id: "a",
    kind: "essay",
    prompt: "Describe your outreach programs.",
    content: "  We ran 12 STEM nights.\r\nReached 900 students.  ",
    charLimit: 10,
    done: true,
    sortOrder: 0,
  },
];

describe("buildAwardExport", () => {
  it("numbers answers in sort order and produces per-question plain text", () => {
    const result = buildAwardExport(SUBMISSION, ITEMS, { exportedAt: "2026-02-01T00:00:00.000Z" });
    expect(result.answers.map((a) => a.itemId)).toEqual(["a", "b"]);
    expect(result.answers[0]?.text).toBe(
      "Q1. Describe your outreach programs.\n\nWe ran 12 STEM nights.\nReached 900 students.",
    );
    expect(result.answers[0]?.overLimit).toBe(true);
    expect(result.answers[1]?.text).toContain(NO_ANSWER_PLACEHOLDER);
    expect(result.answers[1]?.characterCount).toBe(0);
  });

  it("assembles one document with a header and a JSON bundle with honest totals", () => {
    const result = buildAwardExport(SUBMISSION, ITEMS, { exportedAt: "2026-02-01T00:00:00.000Z" });
    expect(result.text.startsWith("Impact Award — 2026\nStatus: in review · Event: 2026mnmi · Deadline: 2026-02-20")).toBe(true);
    expect(result.text).toContain("\n\n---\n\nQ1.");
    expect(result.bundle.format).toBe("vantage-award-export");
    expect(result.bundle.totals).toEqual({ questions: 2, answered: 1, characters: 44 });
    expect(result.bundle.submission.awardName).toBe("Impact Award");
    expect(result.fileStem).toBe("impact-award-2026");
  });

  it("never invents an answer for an empty submission", () => {
    const result = buildAwardExport({ ...SUBMISSION, title: null, summary: null }, []);
    expect(result.answers).toEqual([]);
    expect(result.bundle.totals.answered).toBe(0);
    expect(result.text).toContain("impact — 2026");
  });

  it("falls back to the item kind when a prompt is blank", () => {
    expect(answerText({ index: 3, prompt: "  ", content: null, kind: "task" })).toBe(`Q3. task 3\n\n${NO_ANSWER_PLACEHOLDER}`);
    expect(slugForFile("Woodie Flowers Finalist Award!")).toBe("woodie-flowers-finalist-award");
    expect(slugForFile("***")).toBe("award");
  });
});
