import { describe, expect, it } from "vitest";
import { validateOnshapeUiUrl, validateUiToolArguments, validateVantagePairingOrigin } from "./runtime";

describe("Onshape UI connector boundary validation", () => {
  it("never sends a pairing bearer token to arbitrary HTTPS hosts or paths", () => {
    expect(validateVantagePairingOrigin("https://vantagefrc.vercel.app").origin).toBe("https://vantagefrc.vercel.app");
    for (const value of ["https://attacker.test", "https://vantagefrc.vercel.app.attacker.test", "https://vantagefrc.vercel.app:8443", "https://user:password@vantagefrc.vercel.app", "http://vantagefrc.vercel.app", "https://vantagefrc.vercel.app/redirect", "https://vantagefrc.vercel.app/?target=evil"]) {
      expect(() => validateVantagePairingOrigin(value)).toThrow();
    }
  });

  it("permits document-list UI filters but refuses API, version and off-site navigation", () => {
    expect(validateOnshapeUiUrl("https://cad.onshape.com/documents?resourceType=resourcecompanyowner")).toContain("resourceType");
    for (const value of ["https://cad.onshape.com/api/v6/users/current", "https://attacker.test/documents", "https://cad.onshape.com/documents/aaaaaaaaaaaaaaaaaaaaaaaa/v/bbbbbbbbbbbbbbbbbbbbbbbb/e/cccccccccccccccccccccccc"]) {
      expect(() => validateOnshapeUiUrl(value)).toThrow();
    }
  });

  it("rejects raw selectors, scripts, unknown controls and unexpected arguments", () => {
    const base = { observationId: "observed", controlId: "feature.depth", action: "fill", value: "20 mm" };
    expect(validateUiToolArguments("onshape_ui_action", base)).toEqual(base);
    for (const input of [{ ...base, selector: "body" }, { ...base, script: "fetch('/api')" }, { ...base, controlId: "constructor" }, { ...base, action: "evaluate" }, [], null]) {
      expect(() => validateUiToolArguments("onshape_ui_action", input)).toThrow();
    }
    expect(() => validateUiToolArguments("onshape_ui_observe", { anything: true })).toThrow();
  });

  it("requires action-specific values and valid postcondition expectations", () => {
    const base = { observationId: "observed", controlId: "feature.depth", action: "fill" };
    expect(() => validateUiToolArguments("onshape_ui_action", base)).toThrow("text value");
    expect(() => validateUiToolArguments("onshape_ui_action", { ...base, value: "25 mm", postcondition: { controlId: "feature.depth", kind: "value" } })).toThrow("expected text");
    expect(() => validateUiToolArguments("onshape_ui_action", { ...base, value: "25 mm", postcondition: { controlId: "feature.depth", kind: "value", expected: 25 } })).toThrow("expected text");
    expect(() => validateUiToolArguments("onshape_ui_action", { observationId: "observed", controlId: "canvas", action: "canvas-click", x: Infinity, y: 100 })).toThrow("Invalid x");
  });

  it("bounds model text instead of passing arbitrary size payloads to Playwright", () => {
    expect(() => validateUiToolArguments("onshape_ui_action", { observationId: "observed", controlId: "feature.depth", action: "fill", value: "a".repeat(20_001) })).toThrow("Invalid value");
    expect(() => validateUiToolArguments("onshape_ui_bind", { observationId: "a".repeat(101) })).toThrow("observation ID");
  });

  it("keeps geometry independent of the workspace default units", () => {
    const base = { observationId: "observed", controlId: "feature.depth", action: "fill" };
    expect(validateUiToolArguments("onshape_ui_action", { ...base, value: "1 in" }).value).toBe("25.4 mm");
    expect(() => validateUiToolArguments("onshape_ui_action", { ...base, value: "25" })).toThrow();
    expect(() => validateUiToolArguments("onshape_ui_action", { ...base, value: "-2 mm" })).toThrow();
    expect(validateUiToolArguments("onshape_ui_action", { ...base, controlId: "sketch.dimension", value: "90 deg" }).value).toBe("90 deg");
  });
});
