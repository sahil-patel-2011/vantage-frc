import { describe, expect, it } from "vitest";
import {
  analyzeCadBrief,
  CAD_MODE_PROPOSAL_TTL_MS,
  classifyBrief,
  isCadAgentMode,
  isModeProposalExpired,
  normalizeCadTasks,
  parseCadPlanResponse,
  parseCadTasksResponse,
  shouldProposeModeSwitch,
} from "../src/agent-modes";
import { WEB_CAD_AGENT_INSTRUCTIONS } from "../src/cad-agent-action";

describe("mode guards", () => {
  it("accepts only the three agent modes", () => {
    expect(isCadAgentMode("simple")).toBe(true);
    expect(isCadAgentMode("plan")).toBe(true);
    expect(isCadAgentMode("multitask")).toBe(true);
    expect(isCadAgentMode("turbo")).toBe(false);
    expect(isCadAgentMode(null)).toBe(false);
  });
});

describe("analyzeCadBrief", () => {
  it("extracts deterministic signals without AI", () => {
    const signals = analyzeCadBrief(
      "Make an 80×50×6 mm plate, then drill four 5 mm holes. What spacing should I use?",
    );
    expect(signals.partNouns).toContain("plate");
    expect(signals.orderingWords).toBeGreaterThanOrEqual(1);
    expect(signals.questionMarks).toBe(1);
    expect(signals.dimensionCount).toBeGreaterThanOrEqual(3); // 6 mm + 5 mm + two × separators
  });

  it("counts × chains as dimensions", () => {
    expect(analyzeCadBrief("plate 100x40x5 mm").dimensionCount).toBeGreaterThanOrEqual(3);
  });
});

describe("classifyBrief", () => {
  it("keeps a fully-dimensioned single part in simple mode", () => {
    const result = classifyBrief("80×50×6 mm plate, sketch on Top, extrude 6 mm.");
    expect(result.suggestedMode).toBe("simple");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("suggests plan when the user asks for steps", () => {
    expect(classifyBrief("Give me a plan for a motor mount before building").suggestedMode).toBe("plan");
    expect(classifyBrief("walk me through this bracket step by step").suggestedMode).toBe("plan");
  });

  it("suggests multitask for many distinct parts", () => {
    const result = classifyBrief(
      "Build the drivetrain sidewall: a plate 3 mm, a bearing spacer 10 mm, and a gusset 40 mm tall.",
    );
    expect(result.suggestedMode).toBe("multitask");
    expect(result.reasons.join(" ")).toMatch(/distinct parts/);
  });

  it("suggests multitask for explicit multi-part phrasing", () => {
    expect(classifyBrief("I need several parts for the intake, each 5 mm thick").suggestedMode).toBe("multitask");
  });

  it("suggests plan when the brief is question-heavy", () => {
    expect(
      classifyBrief("Can you make a bracket? Not sure about the thickness. What clearance do we need?").suggestedMode,
    ).toBe("plan");
  });

  it("suggests plan when a long brief has no controlling dimension", () => {
    expect(
      classifyBrief("Please build a mounting bracket for the intake that clears the electronics and looks reasonable")
        .suggestedMode,
    ).toBe("plan");
  });

  it("suggests plan when the brief sequences operations", () => {
    expect(
      classifyBrief("Sketch the outline 120 mm wide first, then extrude 6 mm, then add the boss after that.").suggestedMode,
    ).toBe("plan");
  });
});

describe("shouldProposeModeSwitch", () => {
  it("proposes a switch only when the suggestion differs and is not simple", () => {
    const proposal = shouldProposeModeSwitch(
      "simple",
      "Build a plate, a spacer, and a gusset for the drivetrain, several parts total.",
    );
    expect(proposal.proposedMode).toBe("multitask");
    expect(proposal.reasons.length).toBeGreaterThan(0);
  });

  it("never proposes when the current mode already fits", () => {
    expect(shouldProposeModeSwitch("plan", "Give me a plan for a motor mount").proposedMode).toBeNull();
  });

  it("never proposes a downgrade to simple", () => {
    expect(shouldProposeModeSwitch("plan", "80×50×6 mm plate, extrude 6 mm.").proposedMode).toBeNull();
    expect(shouldProposeModeSwitch("multitask", "80×50×6 mm plate, extrude 6 mm.").proposedMode).toBeNull();
  });
});

describe("isModeProposalExpired (the 15-second rule)", () => {
  const now = Date.parse("2026-08-23T12:00:00.000Z");

  it("treats fresh proposals as live and old ones as declined", () => {
    expect(isModeProposalExpired(new Date(now - 5_000), now)).toBe(false);
    expect(isModeProposalExpired(new Date(now - CAD_MODE_PROPOSAL_TTL_MS - 1), now)).toBe(true);
  });

  it("treats missing or invalid timestamps as expired", () => {
    expect(isModeProposalExpired(null, now)).toBe(true);
    expect(isModeProposalExpired("not-a-date", now)).toBe(true);
  });

  it("accepts ISO strings", () => {
    expect(isModeProposalExpired(new Date(now - 1000).toISOString(), now)).toBe(false);
  });
});

describe("parseCadPlanResponse", () => {
  it("parses the canonical plan shape with questions", () => {
    const plan = parseCadPlanResponse(
      JSON.stringify({
        plan: {
          steps: [
            { title: "Sketch 80×50 mm rectangle on Top plane", detail: "origin at corner" },
            { title: "Extrude 6 mm" },
          ],
          questions: ["What is the mount hole spacing?"],
        },
      }),
    );
    expect(plan?.steps).toHaveLength(2);
    expect(plan?.steps[0]).toMatchObject({ index: 1, detail: "origin at corner" });
    expect(plan?.questions).toEqual(["What is the mount hole spacing?"]);
  });

  it("parses bare steps, string steps, and fenced JSON", () => {
    const plan = parseCadPlanResponse('```json\n{"steps":["Sketch outline","Extrude 6 mm"],"questions":[]}\n```');
    expect(plan?.steps.map((s) => s.title)).toEqual(["Sketch outline", "Extrude 6 mm"]);
  });

  it("returns null for prose or empty plans", () => {
    expect(parseCadPlanResponse("I would love to help you plan this part.")).toBeNull();
    expect(parseCadPlanResponse('{"plan":{"steps":[]}}')).toBeNull();
  });
});

describe("task parsing", () => {
  it("parses the canonical tasks shape and defaults status/ids", () => {
    const tasks = parseCadTasksResponse('{"tasks":[{"id":"outline","title":"Plate outline"},{"title":"Hole pattern"}]}');
    expect(tasks).toHaveLength(2);
    expect(tasks?.[0]).toMatchObject({ id: "outline", status: "pending" });
    expect(tasks?.[1]?.id).toBe("t2");
  });

  it("parses bare arrays of strings", () => {
    const tasks = parseCadTasksResponse('["Plate outline","Pocketing"]');
    expect(tasks?.map((t) => t.title)).toEqual(["Plate outline", "Pocketing"]);
  });

  it("caps tasks at 8 and rejects empty input", () => {
    const many = normalizeCadTasks(Array.from({ length: 12 }, (_, i) => `Task ${i + 1}`));
    expect(many).toHaveLength(8);
    expect(normalizeCadTasks([])).toBeNull();
    expect(parseCadTasksResponse("no json here")).toBeNull();
  });
});

describe("spatial guardrails in the shared system prompt", () => {
  it("states mm restatement, sketch plane/origin, pocket-depth check, and refuse-on-missing-dimension", () => {
    expect(WEB_CAD_AGENT_INSTRUCTIONS).toMatch(/millimetres/);
    expect(WEB_CAD_AGENT_INSTRUCTIONS).toMatch(/sketch plane/);
    expect(WEB_CAD_AGENT_INSTRUCTIONS).toMatch(/origin reference/);
    expect(WEB_CAD_AGENT_INSTRUCTIONS).toMatch(/stock thickness/);
    expect(WEB_CAD_AGENT_INSTRUCTIONS).toMatch(/controlling dimension/);
  });
});
