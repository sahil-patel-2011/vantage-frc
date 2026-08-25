import { describe, expect, it } from "vitest";
import { buildCoachPrompt, cleanCoachParagraph, LEARNING_COACH_FEATURE } from "./coach-prompt";

const base = {
  surface: "gearbox" as const,
  fieldLabel: "Output speed",
  unit: " RPM",
  predicted: 1200,
  actual: 923,
  closeness: "off",
  deterministic: "The compound reduction you assumed (5:1) is 23% low against 6.5:1.",
  inputSummary: "14:50 → 28:16 from a 6000 RPM free speed",
};

describe("buildCoachPrompt", () => {
  it("hands the model the deterministic answer and forbids restating it", () => {
    const prompt = buildCoachPrompt(base);
    expect(prompt).toContain("Gearbox ratio");
    expect(prompt).toContain(base.deterministic);
    expect(prompt).toContain("do not restate the numbers");
    expect(prompt).toContain("do not invent any");
  });

  it("passes a matched misconception through when there is one", () => {
    const prompt = buildCoachPrompt({ ...base, misconception: "That is motor RPM × reduction." });
    expect(prompt).toContain("motor RPM × reduction");
  });

  it("stays honest when there are no inputs to describe", () => {
    expect(buildCoachPrompt({ ...base, inputSummary: "" })).toContain("not provided");
  });

  it("uses one stable feature tag for metering", () => {
    expect(LEARNING_COACH_FEATURE).toBe("learning_coach");
  });
});

describe("cleanCoachParagraph", () => {
  it("keeps the first paragraph and collapses whitespace", () => {
    expect(cleanCoachParagraph("First one.\nStill first.\n\nSecond one.")).toBe("First one. Still first.");
  });

  it("strips a leading bullet the model added anyway", () => {
    expect(cleanCoachParagraph("- Check the pinion.")).toBe("Check the pinion.");
  });

  it("truncates a runaway reply", () => {
    const long = Array.from({ length: 200 }, () => "word").join(" ");
    const cleaned = cleanCoachParagraph(long, 10)!;
    expect(cleaned.split(" ")).toHaveLength(10);
    expect(cleaned.endsWith("…")).toBe(true);
  });

  it("returns null for nothing usable so the caller keeps the deterministic text", () => {
    expect(cleanCoachParagraph("")).toBeNull();
    expect(cleanCoachParagraph("   \n\n  ")).toBeNull();
    expect(cleanCoachParagraph(null)).toBeNull();
    expect(cleanCoachParagraph(undefined)).toBeNull();
  });
});
