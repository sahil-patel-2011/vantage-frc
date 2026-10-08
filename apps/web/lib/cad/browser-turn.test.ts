import { describe, expect, it } from "vitest";
import { browserAvailableControls, browserTurnSchema, parseBrowserDecision, type BrowserTurnInput } from "./browser-turn";

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
      { observationId, controlId: "feature.depth", action: "fill", value: "2 in", postcondition: { controlId: "unmapped.confirmation", kind: "visible" } },
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

  it("defaults a legacy unqualified reply to partial instead of reporting completion", () => {
    expect(parseBrowserDecision('{"kind":"reply","text":"More measurements are needed."}', observationId)).toMatchObject({ kind: "reply", outcome: "partial" });
    expect(parseBrowserDecision('{"kind":"reply","outcome":"unsupported","text":"Open the missing dialog manually."}', observationId)).toMatchObject({ outcome: "unsupported" });
    expect(() => parseBrowserDecision('{"kind":"clarification","outcome":"complete","text":"Which size?"}', observationId)).toThrow();
  });

  const binding = { origin: "https://cad.onshape.com", documentId: "a".repeat(24), workspaceId: "b".repeat(24), elementId: "c".repeat(24) };
  const observed = (): BrowserTurnInput["observation"] => ({
    id: observationId, url: `${binding.origin}/documents/${binding.documentId}/w/${binding.workspaceId}/e/${binding.elementId}`,
    aria: "Part Studio", screenshotBase64: "png", viewport: { width: 1440, height: 900 }, binding,
    controls: {
      "feature.depth": { visible: true, enabled: true, count: 1, value: "5 mm" },
      "tree.item": { visible: true, enabled: true, count: 1, names: ["Sketch 1", "Extrude 1"] },
      canvas: { visible: true, enabled: true, count: 1 },
    },
    canvasBounds: { canvas: { x: 300, y: 100, width: 1100, height: 700 } },
  });

  it("requires current binding, visible availability and the control's supported operation", () => {
    const value = decision({ observationId, controlId: "feature.depth", action: "fill", value: "5 mm" });
    expect(parseBrowserDecision(value, observationId, observed())).toMatchObject({ kind: "action" });
    for (const observation of [
      { ...observed(), binding: null },
      { ...observed(), binding: { ...binding, elementId: "d".repeat(24) } },
      { ...observed(), controls: { "feature.depth": { visible: true, enabled: false, count: 1 } } },
      { ...observed(), controls: { "feature.depth": { visible: true, enabled: true, count: 2 } } },
    ]) expect(() => parseBrowserDecision(value, observationId, observation)).toThrow();
    expect(() => parseBrowserDecision(decision({ observationId, controlId: "feature.depth", action: "double-click" }), observationId, observed())).toThrow();
    expect(() => parseBrowserDecision(decision({ observationId, controlId: "feature.depth", action: "press", key: "ArrowDown" }), observationId, observed())).toThrow();
  });

  it("rejects unobserved or ambiguous named items and canvas points outside observed bounds", () => {
    for (const targetText of [undefined, "Missing feature"]) {
      expect(() => parseBrowserDecision(decision({ observationId, controlId: "tree.item", action: "click", targetText }), observationId, observed())).toThrow();
    }
    const ambiguous = observed(); ambiguous.controls["tree.item"]!.names = ["Sketch 1", "Sketch 1"];
    expect(() => parseBrowserDecision(decision({ observationId, controlId: "tree.item", action: "click", targetText: "Sketch 1" }), observationId, ambiguous)).toThrow();
    expect(() => parseBrowserDecision(decision({ observationId, controlId: "canvas", action: "canvas-click", x: 200, y: 200 }), observationId, observed())).toThrow();
    expect(parseBrowserDecision(decision({ observationId, controlId: "canvas", action: "canvas-click", x: 400, y: 200 }), observationId, observed())).toMatchObject({ kind: "action" });
  });

  it("accepts the engine's bounded named items and observed readback fields", () => {
    const observation = observed();
    observation.controls["tree.item"]!.names = Array.from({ length: 2000 }, (_, index) => `Feature ${index}`);
    observation.controls["feature.depth"] = { visible: true, enabled: true, count: 1, value: "5 mm", checked: false, text: "Depth", title: "Depth: 5 mm" };
    expect(browserTurnSchema.safeParse({ orgId: "00000000-0000-4000-8000-000000000001", requestId: "00000000-0000-4000-8000-000000000002", consent: true, task: "Check this feature", step: 0, history: [], evidence: [], observation }).success).toBe(true);
  });
});
