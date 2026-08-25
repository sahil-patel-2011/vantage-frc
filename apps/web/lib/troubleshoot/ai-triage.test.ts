import { describe, expect, it } from "vitest";
import { buildTriagePrompt, clampDescription, parseTriageResponse } from "./ai-triage";
import { SYMPTOMS } from "./symptom-tree";

describe("buildTriagePrompt", () => {
  const prompt = buildTriagePrompt("our roboRIO won't image and we have four of them");

  it("shows the model every symptom id it is allowed to pick", () => {
    for (const symptom of SYMPTOMS) {
      expect(prompt).toContain(`id: ${symptom.id}`);
    }
  });

  it("never shows the model a fix, so it cannot leak one", () => {
    for (const symptom of SYMPTOMS) {
      for (const fix of symptom.fixes) {
        expect(prompt).not.toContain(fix.title);
        for (const step of fix.steps) expect(prompt).not.toContain(step);
      }
    }
  });

  it("forbids inventing advice in the instructions", () => {
    expect(prompt).toContain("you may not suggest a fix");
    expect(prompt).toContain("our roboRIO won't image");
  });

  it("clamps a runaway description", () => {
    const long = "x".repeat(5000);
    expect(clampDescription(long).length).toBe(1200);
    expect(clampDescription("  lots   of\n whitespace ")).toBe("lots of whitespace");
  });
});

describe("parseTriageResponse", () => {
  it("accepts a well-formed suggestion", () => {
    const parsed = parseTriageResponse(
      '{"symptomId":"ds-no-comms","restatedCheck":"Check the rio and radio lights first.","rationale":"You said the DS is red."}',
    );
    expect(parsed).toEqual({
      symptomId: "ds-no-comms",
      restatedCheck: "Check the rio and radio lights first.",
      rationale: "You said the DS is red.",
    });
  });

  it("tolerates a code fence and surrounding prose", () => {
    const parsed = parseTriageResponse('Sure!\n```json\n{"symptomId":"brownout"}\n```');
    expect(parsed?.symptomId).toBe("brownout");
    // Falls back to the tree's own wording rather than leaving the step blank.
    expect(parsed?.restatedCheck).toContain("Log File Viewer");
  });

  it("rejects a symptom id that is not in the tree", () => {
    expect(parseTriageResponse('{"symptomId":"replace-the-robot"}')).toBeNull();
    expect(parseTriageResponse('{"symptomId":null}')).toBeNull();
  });

  it("rejects junk instead of guessing", () => {
    expect(parseTriageResponse("")).toBeNull();
    expect(parseTriageResponse("I think you should reflash the firmware.")).toBeNull();
    expect(parseTriageResponse("{not json")).toBeNull();
    expect(parseTriageResponse('["ds-no-comms"]')).toBeNull();
  });

  it("clamps model text so a long answer cannot dominate the UI", () => {
    const parsed = parseTriageResponse(
      JSON.stringify({ symptomId: "deploy-fails", restatedCheck: "y".repeat(900), rationale: "z".repeat(900) }),
    );
    expect(parsed?.restatedCheck.length).toBe(320);
    expect(parsed?.rationale.length).toBe(240);
  });
});
