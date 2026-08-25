import { describe, expect, it } from "vitest";
import {
  AI_EXPAND_IDLE,
  expandedDisplay,
  expandFailureState,
  expandSuccessState,
} from "./ai-expand";

const DETERMINISTIC = "3 milestones are overdue: chassis (4d late).";

describe("expandedDisplay — the upgraded surfaces degrade to deterministic text", () => {
  it("shows the computed text with the computed label when idle", () => {
    const display = expandedDisplay(DETERMINISTIC, AI_EXPAND_IDLE);
    expect(display.text).toBe(DETERMINISTIC);
    expect(display.kind).toBe("computed");
    expect(display.aiText).toBeNull();
    expect(display.note).toBeNull();
  });

  it("degrades to the deterministic text when no adapter resolves (503 setup_required)", () => {
    const state = expandFailureState({ httpStatus: 503, code: "setup_required" });
    const display = expandedDisplay(DETERMINISTIC, state);
    expect(display.text).toBe(DETERMINISTIC);
    expect(display.kind).toBe("computed");
    expect(display.aiText).toBeNull();
    expect(display.note).toContain("configured model");
  });

  it("degrades with the error detail on other failures, keeping the deterministic text", () => {
    const state = expandFailureState({ httpStatus: 504, error: "Upstream chat request timed out after 50000ms" });
    const display = expandedDisplay(DETERMINISTIC, state);
    expect(display.text).toBe(DETERMINISTIC);
    expect(display.kind).toBe("computed");
    expect(display.note).toContain("timed out");
  });

  it("only earns the AI label when a real expansion text exists", () => {
    const ready = expandSuccessState({
      text: "Prioritize the chassis milestone; it gates the drivetrain practice window.",
      generatedAt: "2026-08-24T00:00:00.000Z",
      provider: "anthropic",
      model: "claude-x",
    });
    const display = expandedDisplay(DETERMINISTIC, ready);
    expect(display.kind).toBe("ai");
    expect(display.aiText).toContain("chassis milestone");
    // Deterministic text stays on screen next to the expansion.
    expect(display.text).toBe(DETERMINISTIC);
  });

  it("treats an empty AI response as unavailable, never a blank AI badge", () => {
    const state = expandSuccessState({ text: "   " });
    expect(state.status).toBe("unavailable");
    const display = expandedDisplay(DETERMINISTIC, state);
    expect(display.kind).toBe("computed");
    expect(display.aiText).toBeNull();
  });

  it("treats a malformed response body as unavailable", () => {
    expect(expandSuccessState(null).status).toBe("unavailable");
    expect(expandSuccessState("nope").status).toBe("unavailable");
    expect(expandSuccessState({}).status).toBe("unavailable");
  });
});
