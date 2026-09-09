import { describe, expect, it } from "vitest";
import {
  deterministicSentence,
  factSheet,
  nameSubAssembly,
  numbersIn,
  sentenceIsGrounded,
  writeStepSentences,
  type StepWriteFacts,
} from "./write";

const step: StepWriteFacts = {
  stepNumber: 3,
  primaryName: "1x1 box tube",
  quantity: 1,
  subassembly: "Drive rail",
  attachesTo: ["Gearbox plate", "Frame rail"],
  hardware: ["4 x 10-32 x 1.00 SHCS"],
  fabrication: ["Cut 1.00 in x 1.00 in stock to 17.50 in"],
  cautions: [],
};

describe("deterministicSentence", () => {
  it("says what the step does, from the facts and nothing else", () => {
    expect(deterministicSentence(step)).toBe(
      "Fit 1x1 box tube onto Gearbox plate, Frame rail. Secure with 4 x 10-32 x 1.00 SHCS.",
    );
  });

  it("handles a first step with nothing to attach to", () => {
    expect(deterministicSentence({ ...step, attachesTo: [], hardware: [] })).toBe("Fit 1x1 box tube.");
  });

  it("counts when there is more than one", () => {
    expect(deterministicSentence({ ...step, quantity: 4, attachesTo: [], hardware: [] })).toBe(
      "Fit 4 × 1x1 box tube.",
    );
  });

  it("summarises rather than listing twelve prerequisites", () => {
    const many = { ...step, attachesTo: ["A", "B", "C", "D", "E"], hardware: [] };
    expect(deterministicSentence(many)).toContain("and 2 more");
  });
});

describe("sentenceIsGrounded", () => {
  it("accepts a sentence whose numbers all appear in the facts", () => {
    expect(sentenceIsGrounded("Bolt the 1x1 box tube to the gearbox plate with 4 screws.", step)).toBe(true);
  });

  it("rejects a number the CAD never mentioned", () => {
    expect(sentenceIsGrounded("Cut the tube to 18.25 in and bolt it on.", step)).toBe(false);
  });

  it("rejects a torque spec, which no CAD model in this pipeline carries", () => {
    expect(sentenceIsGrounded("Bolt the tube on and torque to spec.", step)).toBe(false);
    expect(sentenceIsGrounded("Apply threadlocker to each screw.", step)).toBe(false);
    expect(sentenceIsGrounded("Grease the shaft before fitting.", step)).toBe(false);
  });

  it("allows a process word the team put in a part name themselves", () => {
    const greased = { ...step, primaryName: "Grease fitting", hardware: [], fabrication: [] };
    expect(sentenceIsGrounded("Fit the grease fitting to the plate.", greased)).toBe(true);
  });

  it("allows the step and quantity numbers even when they are not repeated in a fact line", () => {
    expect(numbersIn("Step 3, fit 1 tube")).toEqual(["3", "1"]);
    expect(sentenceIsGrounded("Fit 1 tube.", { ...step, fabrication: [], hardware: [] })).toBe(true);
  });

  it("puts every fact in the sheet the model is graded against", () => {
    const sheet = factSheet(step);
    expect(sheet).toContain("part: 1x1 box tube");
    expect(sheet).toContain("attaches to: Gearbox plate, Frame rail");
    expect(sheet).toContain("hardware: 4 x 10-32 x 1.00 SHCS");
    expect(sheet).toContain("fabrication: Cut 1.00 in x 1.00 in stock to 17.50 in");
  });
});

describe("writeStepSentences", () => {
  const batch: StepWriteFacts[] = [step, { ...step, stepNumber: 4, primaryName: "Gearbox plate" }];

  it("completes the manual with no model at all", async () => {
    const result = await writeStepSentences(batch, null);
    expect(result.steps.map((entry) => entry.source)).toEqual(["deterministic", "deterministic"]);
    expect(result.modelCalls).toBe(0);
    expect(result.note).toContain("None of them come from the model.".replace("None", "none"));
  });

  it("uses a grounded model sentence when it gets one", async () => {
    const result = await writeStepSentences(batch, async () =>
      JSON.stringify([
        { step: 3, sentence: "Slide the 1x1 box tube against the gearbox plate and bolt it through." },
        { step: 4, sentence: "Set the gearbox plate onto the rail." },
      ]),
    );
    expect(result.steps.every((entry) => entry.source === "model")).toBe(true);
    expect(result.rejected).toBe(0);
  });

  it("throws away a sentence that invents a measurement and says how many it threw away", async () => {
    const result = await writeStepSentences(batch, async () =>
      JSON.stringify([
        { step: 3, sentence: "Cut the tube to 22.00 in and bolt it on." },
        { step: 4, sentence: "Set the gearbox plate onto the rail." },
      ]),
    );
    expect(result.steps[0]!.source).toBe("deterministic");
    expect(result.steps[1]!.source).toBe("model");
    expect(result.rejected).toBe(1);
    expect(result.note).toContain("1 model-written sentence");
  });

  it("survives a fenced code block, which is the usual model failure", async () => {
    const result = await writeStepSentences([step], async () =>
      '```json\n[{"step": 3, "sentence": "Bolt the tube to the plate."}]\n```',
    );
    expect(result.steps[0]!.sentence).toBe("Bolt the tube to the plate.");
  });

  it("falls back cleanly on unparseable output", async () => {
    const result = await writeStepSentences([step], async () => "I'm sorry, I can't help with that.");
    expect(result.steps[0]!.source).toBe("deterministic");
  });

  it("falls back and reports when the model call throws", async () => {
    const result = await writeStepSentences([step], async () => {
      throw new Error("relay offline");
    });
    expect(result.steps[0]!.source).toBe("deterministic");
    expect(result.note).toContain("relay offline");
  });

  it("does nothing for an empty batch", async () => {
    expect(await writeStepSentences([], null)).toEqual({ steps: [], note: "", modelCalls: 0, rejected: 0 });
  });
});

describe("nameSubAssembly", () => {
  const members = ["Gearbox plate", "NEO motor", "Frame rail"];

  it("accepts a name assembled from words that appear in the part names", async () => {
    const named = await nameSubAssembly(members, "Gearbox plate", async () => "NEO Gearbox");
    expect(named).toEqual({ name: "NEO Gearbox", source: "model" });
  });

  it("rejects a name containing a word from nowhere in the CAD", async () => {
    const named = await nameSubAssembly(members, "Gearbox plate", async () => "Swerve Module");
    expect(named).toEqual({ name: "Gearbox plate", source: "deterministic" });
  });

  it("rejects a name that runs on", async () => {
    const named = await nameSubAssembly(members, "Gearbox plate", async () => "Gearbox plate NEO motor Frame rail");
    expect(named.source).toBe("deterministic");
  });

  it("falls back with no model, and when the call fails", async () => {
    expect(await nameSubAssembly(members, "Fallback", null)).toEqual({ name: "Fallback", source: "deterministic" });
    const thrown = await nameSubAssembly(members, "Fallback", async () => {
      throw new Error("offline");
    });
    expect(thrown.source).toBe("deterministic");
  });
});
