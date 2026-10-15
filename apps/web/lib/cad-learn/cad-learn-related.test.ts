import { describe, expect, it } from "vitest";
import { expectPlainCopy } from "../ui/copy-assertions";
import {
  CAD_LEARN_PAGE_DESCRIPTION,
  CAD_LEARN_RELATED_INCLUDE,
  cadLearnCheckNote,
  cadLearnFactorLabel,
  cadLearnNextActions,
  cadLearnRelatedLinks,
  cadLearnShellCopy,
  classifyCadLearnShell,
} from "./cad-learn-related";

describe("cadLearnRelatedLinks", () => {
  it("puts the workbench and Learn in the header strip, and no page that is switched off", () => {
    const links = cadLearnRelatedLinks("org-1", { include: [...CAD_LEARN_RELATED_INCLUDE] });
    expect(links.map((link) => link.id)).toEqual(["cad", "learn-hub"]);
    expect(links.some((link) => link.href.includes("/assembly-manual"))).toBe(false);
  });

  it("never repeats a header destination in Next actions", () => {
    const header = cadLearnRelatedLinks("org-1", { include: [...CAD_LEARN_RELATED_INCLUDE] }).map((link) => link.href);
    const actions = cadLearnNextActions({ orgId: "org-1", firstUndoneId: "extrude", remainingLessons: 8 });
    for (const action of actions) expect(header).not.toContain(action.href);
    // Explore Onshape is a section of the page; Next actions does not link to it again.
    expect(actions.some((action) => action.href === "#explore")).toBe(false);
    expect(new Set(actions.map((action) => action.href)).size).toBe(actions.length);
  });
});

describe("cadLearnNextActions", () => {
  it("returns nothing without a team — the curriculum still paints", () => {
    expect(
      cadLearnNextActions({ orgId: null, firstUndoneId: "sketch", remainingLessons: 12 }),
    ).toEqual([]);
  });

  it("on a team points at the next lesson and the vault", () => {
    const actions = cadLearnNextActions({
      orgId: "org-1",
      firstUndoneId: "extrude",
      remainingLessons: 8,
    });
    expect(actions[0]?.href).toBe("#extrude");
    expect(actions.find((action) => action.id === "vault")?.href).toBe("/cad-vault?orgId=org-1");
    expectPlainCopy(actions[0]?.detail ?? "");
  });
});

describe("cadLearn student copy", () => {
  it("says how heavy / how hard it is to spin instead of MOI", () => {
    expect(cadLearnFactorLabel("mass")).toBe("How heavy");
    expect(cadLearnFactorLabel("moment_of_inertia")).toBe("How hard it is to spin");
    expect(cadLearnCheckNote("Mass and MOI are off by about the same proportion.")).toBe(
      "Mass and spin are off by about the same proportion.",
    );
    expect(cadLearnCheckNote("Look at the moment of inertia.")).toMatch(/how hard it is to spin/i);
    expectPlainCopy(CAD_LEARN_PAGE_DESCRIPTION);
  });

  it("401 asks to sign in; 403 is Choose your team with Needs setup", () => {
    expect(classifyCadLearnShell({ signedOut: true })).toBe("signin");
    expect(cadLearnShellCopy("signin").title).toBe("Sign in to save your progress");
    expect(cadLearnShellCopy("signin").title).not.toMatch(/team/i);
    expectPlainCopy(cadLearnShellCopy("signin").description);
    expect(classifyCadLearnShell({ authBlocked: true })).toBe("setup");
    expect(classifyCadLearnShell({ fetchFailed: true })).toBe("error");
    expect(classifyCadLearnShell({ ready: false })).toBe("loading");
    expect(cadLearnShellCopy("setup").badge).toBe("Needs setup");
    expect(cadLearnShellCopy("setup").title).toBe("Choose your team");
    expectPlainCopy(cadLearnShellCopy("setup").description);
  });
});
