import { describe, expect, it } from "vitest";
import { parseControlMapAction, summarizeBindings, validateBinding } from "./control-map";

describe("validateBinding", () => {
  it("requires an input and a command", () => {
    expect(validateBinding({ controller: "driver", command: "Intake" }).ok).toBe(false);
    expect(validateBinding({ controller: "driver", inputLabel: "A button" }).ok).toBe(false);
  });
  it("rejects an invalid controller or mode", () => {
    expect(validateBinding({ controller: "coach", inputLabel: "A", command: "Intake" }).ok).toBe(false);
    expect(validateBinding({ controller: "driver", inputLabel: "A", command: "Intake", mode: "auto" }).ok).toBe(false);
  });
  it("accepts a valid binding and defaults mode to teleop", () => {
    const result = validateBinding({ controller: "operator", inputLabel: "Right trigger", command: "Shoot" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.mode).toBe("teleop");
  });
});

describe("summarizeBindings", () => {
  it("counts bindings per controller", () => {
    const summary = summarizeBindings([
      { controller: "driver" },
      { controller: "driver" },
      { controller: "operator" },
    ]);
    expect(summary.total).toBe(3);
    expect(summary.byController.driver).toBe(2);
    expect(summary.byController.operator).toBe(1);
    expect(summary.byController.other).toBe(0);
  });
});

describe("parseControlMapAction", () => {
  it("keeps the action discriminant even though a binding has its own command field", () => {
    const action = parseControlMapAction({ action: "create_binding", orgId: "o1", seasonYear: 2026, controller: "driver", inputLabel: "A button", command: "Intake" });
    // Regression guard: `command` must NOT clobber the `action` discriminant.
    expect(action.action).toBe("create_binding");
    expect(action).toMatchObject({ inputLabel: "A button", command: "Intake" });
  });
  it("rejects create_binding without season year", () => {
    expect(() => parseControlMapAction({ action: "create_binding", orgId: "o1", controller: "driver", inputLabel: "A", command: "Intake" })).toThrow(/seasonYear/);
  });
  it("rejects an unsupported action", () => {
    expect(() => parseControlMapAction({ action: "rebind_reality", orgId: "o1" })).toThrow(/Unsupported/);
  });
});
