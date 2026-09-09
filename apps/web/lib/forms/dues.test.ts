import { describe, expect, it } from "vitest";
import { classifyDuesAnswer, classifyDuesValue, findDuesStatusQuestion, tallyDues } from "./dues";
import type { FormQuestion } from "./types";

function question(partial: Partial<FormQuestion> & { id: string; options?: string[] }): FormQuestion {
  return {
    id: partial.id,
    position: partial.position ?? 0,
    kind: partial.kind ?? "single_select",
    label: partial.label ?? "Payment status",
    help: "",
    required: false,
    config: partial.options ? { options: partial.options } : (partial.config ?? {}),
  };
}

const STARTER_OPTIONS = ["Paid in full", "Partial payment", "Requesting assistance", "Not yet paid"];

describe("classifying a dues answer", () => {
  it("reads the starter template's own options", () => {
    expect(classifyDuesValue("Paid in full")).toBe("paid");
    expect(classifyDuesValue("Partial payment")).toBe("owing");
    expect(classifyDuesValue("Requesting assistance")).toBe("assistance");
    expect(classifyDuesValue("Not yet paid")).toBe("owing");
  });

  it("recognises wording a team is likely to invent for asking for help", () => {
    for (const wording of [
      "Applying for the hardship fund",
      "Fee waiver requested",
      "Needs help paying",
      "Scholarship",
      "Cannot pay right now",
      "Reduced rate please",
      "Bursary",
    ]) {
      expect(classifyDuesValue(wording), wording).toBe("assistance");
    }
  });

  /**
   * The rule the whole feature exists for. Someone paying what they can while
   * asking for help is exactly the person a chasing email would hurt, so an
   * answer that mentions assistance is assistance no matter what else it says.
   */
  it("lets assistance win over every other signal in the same answer", () => {
    expect(classifyDuesAnswer("Partial payment | Requesting assistance")).toBe("assistance");
    expect(classifyDuesAnswer("Requesting assistance | Not yet paid")).toBe("assistance");
    expect(classifyDuesAnswer("Paid in full | Requesting assistance")).toBe("assistance");
  });

  it("never reads 'Not yet paid' as paid", () => {
    expect(classifyDuesAnswer("Not yet paid")).toBe("owing");
    expect(classifyDuesAnswer("Have not paid")).toBe("owing");
    expect(classifyDuesAnswer("Unpaid")).toBe("owing");
  });

  it("does not turn someone who paid early into someone who owes", () => {
    // "due" is deliberately absent from the owing pattern for exactly this.
    expect(classifyDuesAnswer("Paid before the due date")).toBe("paid");
  });

  it("returns unknown for an answer it cannot read, and unknown is never chased", () => {
    expect(classifyDuesAnswer("")).toBe("unknown");
    expect(classifyDuesAnswer("Talk to Coach Ramirez")).toBe("unknown");
    expect(classifyDuesAnswer("Option 1")).toBe("unknown");
  });

  it("tallies statuses without losing any", () => {
    const counts = tallyDues(["paid", "owing", "owing", "assistance", "unknown"]);
    expect(counts).toEqual({ paid: 1, owing: 2, assistance: 1, unknown: 1 });
  });
});

describe("finding the payment question", () => {
  it("picks the choice question that records payment status", () => {
    const check = findDuesStatusQuestion([
      question({ id: "name", kind: "short_text", label: "Student name" }),
      question({ id: "status", position: 1, options: STARTER_OPTIONS }),
    ]);
    expect(check.ok).toBe(true);
    if (check.ok) expect(check.question.id).toBe("status");
  });

  /**
   * A form that offers no way to say "I need help" cannot be used to chase
   * anyone: the students who would have ticked it are indistinguishable from
   * the ones who simply have not paid.
   */
  it("refuses a form with no assistance option", () => {
    const check = findDuesStatusQuestion([
      question({ id: "status", options: ["Paid in full", "Not yet paid"] }),
    ]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/financial assistance/i);
  });

  it("refuses a form with no payment question at all", () => {
    const check = findDuesStatusQuestion([
      question({ id: "name", kind: "short_text", label: "Student name" }),
      question({ id: "shirt", kind: "single_select", options: ["Small", "Medium", "Large"] }),
    ]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/payment status/i);
  });

  it("refuses a form with no multiple-choice question", () => {
    const check = findDuesStatusQuestion([question({ id: "note", kind: "long_text", label: "Notes" })]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toMatch(/multiple-choice/i);
  });
});
