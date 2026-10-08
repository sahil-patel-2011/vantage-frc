import { describe, expect, it } from "vitest";
import { browserAvailableControls, parseBrowserDecision } from "./browser-turn";

describe("native browser CAD decision boundary", () => {
  const observationId = "current-observation";
  const decision = (args: Record<string, unknown>) => JSON.stringify({ kind: "action", text: "Enter the explicit depth.", tool: { name: "action", arguments: args } });

  it("normalizes explicit dimensions and retains one current observation", () => {
    const result = parseBrowserDecision(decision({ observationId, controlId: "feature.depth", action: "fill", value: "2 in" }), observationId);
    expect(result).toMatchObject({ kind: "action", tool: { arguments: { value: "50.8 mm", observationId } } });
  });

  it("rejects stale observations, implicit dimensions, scripts and batches", () => {
    for (const args of [
      { observationId: "old", controlId: "feature.depth", action: "fill", value: "2 in" },
      { observationId, controlId: "feature.depth", action: "fill", value: "2" },
      { observationId, controlId: "canvas", action: "evaluate", value: "fetch('/api')" },
    ]) expect(() => parseBrowserDecision(decision(args), observationId)).toThrow();
    expect(() => parseBrowserDecision(JSON.stringify([{ kind: "reply", text: "Done" }]), observationId)).toThrow();
  });

  it("does not allow destructive registry entries in the conversational path", () => {
    expect(browserAvailableControls()).not.toHaveProperty("menuitem.deleteFace");
    expect(() => parseBrowserDecision(decision({ observationId, controlId: "menuitem.deleteFace", action: "click" }), observationId)).toThrow();
  });

  it("keeps clarification separate from operations and refuses hidden tool payloads", () => {
    expect(parseBrowserDecision('{"kind":"clarification","text":"What is the thickness, including units?"}', observationId)).toEqual({ kind: "clarification", text: "What is the thickness, including units?" });
    expect(() => parseBrowserDecision('{"kind":"reply","text":"Done","tool":{}}', observationId)).toThrow();
    expect(() => parseBrowserDecision("Probably done", observationId)).toThrow();
  });
});
