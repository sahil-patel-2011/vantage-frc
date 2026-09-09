import { describe, expect, it } from "vitest";
import { formInsight, summarizeQuestion, MULTI_SEPARATOR, type AnswerRow } from "./results";
import type { FormQuestion } from "./types";

function question(partial: Partial<FormQuestion> & Pick<FormQuestion, "kind">): FormQuestion {
  return {
    id: partial.id ?? "q1",
    position: partial.position ?? 0,
    label: partial.label ?? "Question",
    help: "",
    required: false,
    config: partial.config ?? {},
    kind: partial.kind,
  };
}

function answers(questionId: string, values: Array<string | [string, number | null]>): AnswerRow[] {
  return values.map((value, index) => {
    const [valueText, valueNumber] = Array.isArray(value) ? value : [value, null];
    return { questionId, responseId: `r${index}`, valueText, valueNumber };
  });
}

describe("summarizeQuestion", () => {
  it("keeps options nobody chose, because an unstaffed subteam is the finding", () => {
    const q = question({
      kind: "multi_select",
      label: "Subteams",
      config: { options: ["Mechanical", "Programming", "Business"] },
    });
    const summary = summarizeQuestion(
      q,
      answers("q1", [`Mechanical${MULTI_SEPARATOR}Business`, "Mechanical"]),
      2,
    );
    expect(summary.buckets.map((b) => [b.label, b.count])).toEqual([
      ["Mechanical", 2],
      ["Business", 1],
      ["Programming", 0],
    ]);
    expect(summary.reading).toContain("Nobody chose Programming");
  });

  it("computes multi-select share against respondents, not picks", () => {
    const q = question({
      kind: "multi_select",
      config: { options: ["A", "B", "C"] },
    });
    // One person picked all three. Share must be 100% each, never 33%.
    const summary = summarizeQuestion(q, answers("q1", [`A${MULTI_SEPARATOR}B${MULTI_SEPARATOR}C`]), 1);
    expect(summary.buckets.every((b) => b.share === 100)).toBe(true);
  });

  it("excludes unparseable answers from numeric stats instead of counting them as zero", () => {
    const q = question({ kind: "scale", config: { min: 1, max: 5 } });
    const summary = summarizeQuestion(q, answers("q1", [["4", 4], ["2", 2], ["not sure", null]]), 3);
    expect(summary.stats).toEqual({ count: 2, min: 2, max: 4, mean: 3, median: 3 });
  });

  it("treats a zero rating as a real answer", () => {
    const q = question({ kind: "scale", config: { min: 0, max: 5 } });
    const summary = summarizeQuestion(q, answers("q1", [["0", 0], ["4", 4]]), 2);
    expect(summary.stats?.count).toBe(2);
    expect(summary.stats?.mean).toBe(2);
  });

  it("says nothing about a distribution of one", () => {
    const q = question({ kind: "single_select", config: { options: ["A", "B"] } });
    expect(summarizeQuestion(q, answers("q1", ["A"]), 1).reading).toBeNull();
  });

  it("reports skips so a low answer count is never mistaken for consensus", () => {
    const q = question({ kind: "single_select", config: { options: ["A", "B"] } });
    const summary = summarizeQuestion(q, answers("q1", ["A", "A"]), 10);
    expect(summary.reading).toContain("8 of 10 skipped it");
  });

  it("returns no reading when nothing was answered", () => {
    const q = question({ kind: "long_text" });
    const summary = summarizeQuestion(q, [], 4);
    expect(summary.answered).toBe(0);
    expect(summary.reading).toBeNull();
  });

  it("keeps free text verbatim rather than bucketing it", () => {
    const q = question({ kind: "long_text" });
    const summary = summarizeQuestion(q, answers("q1", ["chain skipped", "battery sagged"]), 2);
    expect(summary.textAnswers).toContain("chain skipped");
    expect(summary.buckets).toEqual([]);
  });
});

describe("formInsight", () => {
  it("does not pretend to read an empty form", () => {
    const insight = formInsight({ purpose: "intake", totalResponses: 0, assignedCount: 0, summaries: [] });
    expect(insight.headline).toBe("No responses yet");
    expect(insight.provisional).toBe(false);
  });

  it("names outstanding assignees so leadership can chase them", () => {
    const insight = formInsight({ purpose: "travel", totalResponses: 4, assignedCount: 12, summaries: [] });
    expect(insight.detail).toContain("4 of 12");
    expect(insight.detail).toContain("8 outstanding");
  });

  /**
   * Coverage must be about the people who were asked. A form assigned to four
   * students and also shared as a link can hold four responses of which one came
   * from a stranger — and reading "4 of 4 have answered" off the response count
   * makes coverage rise when the wrong people reply, which is the same shape of
   * lie as a readiness score that climbs while a team enters less.
   */
  it("does not count a stranger's link answer as an assignee's", () => {
    const insight = formInsight({
      purpose: "travel",
      totalResponses: 4,
      assignedCount: 4,
      respondedAssignees: 3,
      summaries: [],
    });
    expect(insight.detail).toContain("3 of 4");
    expect(insight.detail).toContain("1 outstanding");
    expect(insight.detail).toContain("1 more answered through the link");
    expect(insight.detail).not.toContain("4 of 4");
  });

  it("flags a reading built on very few responses as provisional", () => {
    expect(formInsight({ purpose: "feedback", totalResponses: 2, assignedCount: 0, summaries: [] }).provisional).toBe(true);
    expect(formInsight({ purpose: "feedback", totalResponses: 9, assignedCount: 0, summaries: [] }).provisional).toBe(false);
  });

  it("turns intake answers into a recruiting gap rather than a vanity count", () => {
    const q = question({
      kind: "multi_select",
      label: "Which subteams interest you?",
      config: { options: ["Mechanical", "Programming", "Business"] },
    });
    const summaries = [
      summarizeQuestion(q, answers("q1", ["Mechanical", "Mechanical", "Business"]), 3),
    ];
    const insight = formInsight({ purpose: "intake", totalResponses: 3, assignedCount: 0, summaries });
    expect(insight.detail).toContain("nobody picked Programming");
  });

  it("surfaces unpaid dues and routes assistance requests to a private follow-up", () => {
    const q = question({
      kind: "single_select",
      label: "Payment status",
      config: { options: ["Paid in full", "Partial payment", "Requesting assistance", "Not yet paid"] },
    });
    const summaries = [
      summarizeQuestion(q, answers("q1", ["Paid in full", "Not yet paid", "Requesting assistance"]), 3),
    ];
    const insight = formInsight({ purpose: "dues", totalResponses: 3, assignedCount: 0, summaries });
    expect(insight.detail).toContain("1 still owe");
    expect(insight.detail).toContain("follow up privately");
  });

  /**
   * Someone who is paying what they can while asking for help is one person, and
   * they belong in the assistance count only. Counting them in both made a
   * three-person form read as four, and put a family who asked for help into the
   * group a treasurer chases.
   */
  it("counts an assistance request once, not as an unpaid balance as well", () => {
    const q = question({
      kind: "single_select",
      label: "Payment status",
      config: { options: ["Paid in full", "Partial payment — requesting assistance", "Not yet paid"] },
    });
    const summaries = [
      summarizeQuestion(
        q,
        answers("q1", ["Paid in full", "Not yet paid", "Partial payment — requesting assistance"]),
        3,
      ),
    ];
    const insight = formInsight({ purpose: "dues", totalResponses: 3, assignedCount: 0, summaries });
    expect(insight.detail).toContain("1 still owe");
    expect(insight.detail).toContain("1 asked for assistance");
    expect(insight.detail).not.toContain("2 still owe");
  });

  it("treats an unsafe answer as a shop-floor consequence", () => {
    const q = question({ kind: "yes_no", label: "Completed shop safety training?" });
    const summaries = [summarizeQuestion(q, answers("q1", ["Yes", "No", "Yes"]), 3)];
    const insight = formInsight({ purpose: "safety", totalResponses: 3, assignedCount: 0, summaries });
    expect(insight.detail).toContain("should not be in the shop");
  });
});
