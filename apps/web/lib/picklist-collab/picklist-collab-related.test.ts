import { describe, expect, it } from "vitest";
import {
  classifyPicklistCollabShell,
  picklistCollabSetupSteps,
  picklistCollabShellCopy,
} from "./picklist-collab-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("picklistCollabSetupSteps", () => {
  it("no-org setup is only Choose your team", () => {
    expect(picklistCollabSetupSteps(null).map((s) => s.id)).toEqual(["workspace"]);
  });

  it("setup with a team is only Set active event", () => {
    const steps = picklistCollabSetupSteps("org-1");
    expect(steps.map((s) => s.id)).toEqual(["command"]);
    expect(steps[0]?.href).toBe("/competition?tab=command&orgId=org-1");
  });
});

describe("classifyPicklistCollabShell", () => {
  it("classifies shells", () => {
    expect(classifyPicklistCollabShell({ loading: true })).toBe("loading");
    expect(classifyPicklistCollabShell({ fetchFailed: true, orgId: "o" })).toBe("error");
    expect(
      classifyPicklistCollabShell({ status: "live", orgId: "o", listCount: 0 }),
    ).toBe("empty");
    expect(
      classifyPicklistCollabShell({ status: "live", orgId: "o", listCount: 1 }),
    ).toBe("ready");
  });

  it("sends a team with no lists to the create form, not to Choose your team", () => {
    expect(
      classifyPicklistCollabShell({ status: "setup_required", orgId: "o", setupStepIds: ["create-list"] }),
    ).toBe("empty");
    expect(classifyPicklistCollabShell({ status: "setup_required", orgId: "o", setupStepIds: ["workspace"] })).toBe(
      "setup",
    );
    expect(classifyPicklistCollabShell({ status: "setup_required", orgId: null })).toBe("setup");
  });
});

describe("picklistCollabShellCopy", () => {
  it("never invents DEMO ranks", () => {
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = picklistCollabShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
    }
  });
});
