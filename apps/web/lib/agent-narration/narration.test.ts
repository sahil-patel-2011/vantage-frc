import { describe, expect, it } from "vitest";
import {
  buildExplainPrompt,
  CODE_RULE_LESSONS,
  fromChatToolUse,
  fromCodeFinding,
  fromToolCall,
  isExplainLevel,
  narrateAgentRun,
  narrateCodeFindings,
  narrateToolCalls,
  narrationCoverage,
  readReason,
  STEP_KIND_PRINCIPLES,
  TOOL_PRINCIPLES,
  type Narration,
} from "./narration";

/** Strip the truncation marker so a `why` can be checked as a substring of its own input. */
function core(why: string): string {
  return why.endsWith("…") ? why.slice(0, -1).trimEnd() : why;
}

describe("fromToolCall action phrasing", () => {
  it("uses only params that are actually present", () => {
    const n = fromToolCall("onshape_extrude", { depthMm: 6 }, { ok: true, featureId: "F1" });
    expect(n.action).toBe("Extruded the sketch 6 mm");
    expect(n.status).toBe("ok");
    expect(n.origin).toBe("tool_call");
  });

  it("omits a dimension the params never carried", () => {
    const n = fromToolCall("onshape_extrude", {}, { ok: true });
    expect(n.action).toBe("Extruded the sketch");
    expect(n.action).not.toMatch(/\d/);
  });

  it("renders a rectangle sketch with the plane it really used", () => {
    const n = fromToolCall("onshape_sketch_rectangle", { widthMm: 120, heightMm: 45.5, plane: "Top" });
    expect(n.action).toBe("Sketched a 120 × 45.5 mm rectangle on the Top plane");
  });

  it("falls back to a generic phrasing for an unknown tool", () => {
    const n = fromToolCall("some_new_tool", { alpha: "x", count: 3, flag: true });
    expect(n.action).toBe("Ran some new tool (alpha=x, count=3, flag=true)");
    expect(n.principle).toBeUndefined();
  });

  it("reads status honestly from the result", () => {
    expect(fromToolCall("fusion_status", {}, { setupRequired: true }).status).toBe("setup_required");
    expect(fromToolCall("web.fetch", { url: "https://x.test" }, { error: "403" }).status).toBe("error");
    expect(fromToolCall("onshape_describe", {}).status).toBe("pending");
  });

  it("keeps the recorded result as `outcome`, never as `why`", () => {
    const n = fromToolCall("web.search", { query: "bumper rules" }, { summary: "3 search hit(s)" });
    expect(n.outcome).toBe("3 search hit(s)");
    expect(n.why).toBeUndefined();
  });
});

describe("no reason in -> no reason out", () => {
  it("omits `why` when a CAD tool call carries no reason anywhere", () => {
    const n = fromToolCall("onshape_extrude", { depthMm: 6, plane: "Top" }, { ok: true, featureId: "F7" });
    expect(n.why).toBeUndefined();
  });

  it("surfaces `why` verbatim when the call really carried one", () => {
    const reason = "depth matches the 6 mm plate stock so the pocket cannot punch through";
    const n = fromToolCall("onshape_extrude", { depthMm: 6, reason }, { ok: true });
    expect(n.why).toBe(reason);
  });

  it("omits `why` for a finding with no recorded message", () => {
    const n = fromCodeFinding({ pattern: "blocking-robot-loop", evidence: "Timer.delay(0.5);" });
    expect(n.why).toBeUndefined();
    expect(n.action).toBe("Flagged blocking robot loop");
  });

  it("omits `why` for a plan step whose recorded JSON has no reason field", () => {
    const n = fromChatToolUse({
      sequence: 1,
      kind: "plan",
      resultSummary: '{"type":"tool_call","tool":"web.search","input":{"query":"bumper rules"}}',
      status: "ok",
    });
    expect(n.why).toBeUndefined();
    expect(n.action).toBe("Chose the next step");
  });

  it("never emits a `why` that is not verbatim in its own input", () => {
    const toolCases: Array<[string, unknown, unknown]> = [
      ["onshape_extrude", { depthMm: 6 }, { ok: true }],
      ["onshape_extrude", { depthMm: 6, reason: "  keeps the pocket blind  " }, { ok: true }],
      ["onshape_sketch_rectangle", { widthMm: 1, heightMm: 2 }, { rationale: "frame rail datum" }],
      ["web.fetch", { url: "https://x.test" }, { meta: { why: "primary manual source" } }],
      ["mystery_tool", { note: "not a reason field" }, { summary: "done" }],
      ["mystery_tool", { reason: "x".repeat(900) }, null],
    ];
    for (const [tool, params, result] of toolCases) {
      const n = fromToolCall(tool, params, result);
      if (!n.why) continue;
      const serialized = JSON.stringify({ params, result });
      expect(serialized).toContain(core(n.why));
    }

    const findingCases = [
      { pattern: "hardcoded-can-id", evidence: "new TalonFX(3)" },
      { pattern: "hardcoded-can-id", message: "Hard-coded CAN IDs can collide." },
      { finding: "Motor built without a supply current limit", location: "Drive.java", line: 12 },
      { severity: "low" },
    ];
    for (const finding of findingCases) {
      const n = fromCodeFinding(finding);
      if (!n.why) continue;
      expect(JSON.stringify(finding)).toContain(core(n.why));
    }

    const stepCases = [
      { kind: "plan", resultSummary: '{"type":"final","answer":"done"}' },
      { kind: "plan", resultSummary: '{"type":"tool_call","tool":"web.fetch","reason":"cite the manual"}' },
      { kind: "tool", toolName: "web.fetch", argsSummary: '{"url":"https://x.test"}' },
      { kind: "observe", toolName: "web.fetch", resultSummary: "Injected web.fetch result" },
      { kind: "error", resultSummary: "provider setup_required" },
    ];
    for (const step of stepCases) {
      const n = fromChatToolUse(step);
      if (!n.why) continue;
      expect(JSON.stringify(step)).toContain(core(n.why));
    }
  });

  it("readReason returns undefined for reason-free records and non-records", () => {
    expect(readReason({ depthMm: 6, note: "hello" })).toBeUndefined();
    expect(readReason(null)).toBeUndefined();
    expect(readReason("reason: because")).toBeUndefined();
    expect(readReason([{ reason: "nested in an array" }])).toBeUndefined();
    expect(readReason({ reason: "   " })).toBeUndefined();
    expect(readReason({ reason: 42 })).toBeUndefined();
  });
});

describe("principles come only from the authored catalog", () => {
  it("attaches a tool principle only for an exact tool name", () => {
    expect(fromToolCall("onshape_extrude", { depthMm: 6 }).principle).toBe(
      TOOL_PRINCIPLES.onshape_extrude,
    );
    expect(fromToolCall("onshape_extrude_v2", { depthMm: 6 }).principle).toBeUndefined();
  });

  it("attaches a code principle only for an exact matched rule id", () => {
    const known = fromCodeFinding({ pattern: "missing-supply-current-limit", message: "no limit set" });
    expect(known.principle).toBe(CODE_RULE_LESSONS["missing-supply-current-limit"].habit);
    expect(fromCodeFinding({ pattern: "invented-rule", message: "x" }).principle).toBeUndefined();
  });

  it("only ever emits principle strings that exist in a catalog", () => {
    const catalog = new Set<string>([
      ...Object.values(TOOL_PRINCIPLES),
      ...Object.values(STEP_KIND_PRINCIPLES),
      ...Object.values(CODE_RULE_LESSONS).map((lesson) => lesson.habit),
    ]);
    const all: Narration[] = [
      ...narrateToolCalls([
        { toolName: "onshape_extrude", params: { depthMm: 6 } },
        { toolName: "web.search", params: { query: "q" } },
        { toolName: "unknown_thing", params: {} },
      ]),
      ...narrateCodeFindings([
        { pattern: "blocking-robot-loop", message: "m" },
        { pattern: "nope", message: "m" },
      ]),
      ...narrateAgentRun([
        { kind: "observe", toolName: "web.fetch" },
        { kind: "generation" },
        { kind: "plan" },
      ]),
    ];
    for (const item of all) {
      if (item.principle) expect(catalog.has(item.principle)).toBe(true);
    }
  });
});

describe("fromCodeFinding", () => {
  it("names the rule, the place, and quotes the student's own line", () => {
    const n = fromCodeFinding({
      severity: "high",
      pattern: "blocking-robot-loop",
      finding: "Blocking the robot loop can starve command scheduling and safety feeds.",
      evidence: "Timer.delay(0.5);",
      location: "src/main/java/frc/robot/Robot.java",
      line: 42,
    });
    expect(n.action).toBe(
      "Flagged high-severity blocking robot loop in src/main/java/frc/robot/Robot.java:42",
    );
    expect(n.why).toBe("Blocking the robot loop can starve command scheduling and safety feeds.");
    expect(n.principle).toBe(CODE_RULE_LESSONS["blocking-robot-loop"].habit);
    expect(n.sources).toEqual([
      { label: "src/main/java/frc/robot/Robot.java:42", excerpt: "Timer.delay(0.5);" },
    ]);
  });

  it("prefers the CodeRisk message over the Bugbot finding text when both exist", () => {
    const n = fromCodeFinding({ pattern: "x", message: "from message", finding: "from finding" });
    expect(n.why).toBe("from message");
  });
});

describe("fromChatToolUse", () => {
  it("re-renders a recorded tool step from its argsSummary JSON", () => {
    const n = fromChatToolUse({
      sequence: 3,
      kind: "tool",
      toolName: "web.fetch",
      argsSummary: '{"url":"https://docs.test/manual"}',
      resultSummary: "Fetched 4,201 characters",
      sourceUrl: "https://docs.test/manual",
      status: "ok",
    });
    expect(n.action).toBe("Fetched https://docs.test/manual");
    expect(n.outcome).toBe("Fetched 4,201 characters");
    expect(n.why).toBeUndefined();
    expect(n.principle).toBe(TOOL_PRINCIPLES["web.fetch"]);
    expect(n.sources?.[0]?.url).toBe("https://docs.test/manual");
  });

  it("survives an unparseable argsSummary without inventing params", () => {
    const n = fromChatToolUse({ kind: "tool", toolName: "web.search", argsSummary: "not json" });
    expect(n.action).toBe("Ran a web search");
  });

  it("normalizes an unknown status to ok rather than dropping the step", () => {
    expect(fromChatToolUse({ kind: "observe", toolName: "web.fetch", status: "weird" }).status).toBe("ok");
    expect(fromChatToolUse({ kind: "tool", toolName: "web.fetch", status: "setup_required" }).status).toBe(
      "setup_required",
    );
  });
});

describe("batch helpers", () => {
  it("renumbers steps 1..n and keeps keys unique", () => {
    const list = narrateAgentRun([
      { sequence: 7, kind: "plan" },
      { sequence: 8, kind: "tool", toolName: "web.search", argsSummary: '{"query":"q"}' },
      { sequence: 9, kind: "observe", toolName: "web.search" },
    ]);
    expect(list.map((item) => item.step)).toEqual([1, 2, 3]);
    expect(new Set(list.map((item) => item.key)).size).toBe(3);
  });

  it("reports honest coverage counts", () => {
    const list = narrateCodeFindings([
      { pattern: "a", message: "explained" },
      { pattern: "b" },
      { pattern: "c" },
    ]);
    expect(narrationCoverage(list)).toEqual({ total: 3, explained: 1, unexplained: 2 });
  });
});

describe("buildExplainPrompt", () => {
  const base: Narration = {
    step: 2,
    action: "Extruded the sketch 6 mm",
    status: "ok",
    origin: "tool_call",
    key: "tool:onshape_extrude:2",
  };

  it("states plainly when no reason was recorded and forbids guessing", () => {
    const prompt = buildExplainPrompt(base, "new");
    expect(prompt).toContain("Reason recorded with the step: NONE");
    expect(prompt).toContain("Do not guess the intent.");
    expect(prompt).toContain("Extruded the sketch 6 mm");
  });

  it("passes a recorded reason through and switches register by level", () => {
    const withWhy: Narration = { ...base, why: "matches the plate stock" };
    expect(buildExplainPrompt(withWhy, "new")).toContain("first season");
    expect(buildExplainPrompt(withWhy, "maths")).toContain("governing relationship");
    expect(buildExplainPrompt(withWhy, "maths")).toContain("matches the plate stock");
  });

  it("only accepts the two supported levels", () => {
    expect(isExplainLevel("new")).toBe(true);
    expect(isExplainLevel("maths")).toBe(true);
    expect(isExplainLevel("expert")).toBe(false);
  });
});
