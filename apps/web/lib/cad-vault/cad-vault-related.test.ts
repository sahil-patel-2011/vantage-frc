import { describe, expect, it } from "vitest";
import { expectPlainCopy } from "../ui/copy-assertions";
import {
  CAD_VAULT_RELATED_INCLUDE,
  cadVaultGeometryCopy,
  cadVaultNextActions,
  cadVaultRelatedLinks,
  cadVaultShellCopy,
  classifyCadVaultShell,
} from "./cad-vault-related";

describe("cadVaultRelatedLinks", () => {
  it("puts Learn CAD, Assembly manual, and the CAD workbench in the header strip", () => {
    const links = cadVaultRelatedLinks("org-1", { include: [...CAD_VAULT_RELATED_INCLUDE] });
    expect(links.map((link) => link.id)).toEqual(["cad-learn", "assembly-manual", "cad"]);
    expect(links.find((link) => link.id === "cad-learn")?.href).toBe("/cad-learn?orgId=org-1");
    expect(links.find((link) => link.id === "cad")?.href).toBe("/build?tab=cad&orgId=org-1");
  });
});

describe("cadVaultNextActions", () => {
  it("returns nothing on setup or empty — those shells keep one EmptyState primary", () => {
    expect(cadVaultNextActions({ orgId: "org-1", shell: "setup", documentCount: 0, linkedCount: 0 })).toEqual([]);
    expect(cadVaultNextActions({ orgId: "org-1", shell: "empty", documentCount: 0, linkedCount: 0 })).toEqual([]);
    expect(cadVaultNextActions({ orgId: null, shell: "ready", documentCount: 1, linkedCount: 1 })).toEqual([]);
  });

  it("on ready asks to link Onshape or Fusion when nothing is linked yet", () => {
    const actions = cadVaultNextActions({
      orgId: "org-1",
      shell: "ready",
      documentCount: 2,
      linkedCount: 0,
    });
    expect(actions[0]?.id).toBe("link");
    expect(actions[0]?.href).toBe("#link-cad");
    expect(actions.some((action) => action.id === "learn")).toBe(true);
  });
});

describe("cadVaultShellCopy", () => {
  it("uses Choose your team and link-first empty copy", () => {
    expect(classifyCadVaultShell({ loading: true })).toBe("loading");
    expect(classifyCadVaultShell({ fetchFailed: true })).toBe("error");
    expect(classifyCadVaultShell({ authBlocked: true })).toBe("setup");
    expect(classifyCadVaultShell({ authBlocked: true, fetchFailed: true })).toBe("setup");
    expect(classifyCadVaultShell({ status: "setup_required" })).toBe("setup");
    expect(classifyCadVaultShell({ status: "empty" })).toBe("empty");
    expect(classifyCadVaultShell({ status: "ready" })).toBe("ready");
    expectPlainCopy(cadVaultShellCopy("setup").title);
    expectPlainCopy(cadVaultShellCopy("setup").description);
    expectPlainCopy(cadVaultShellCopy("empty").description);
    expect(cadVaultShellCopy("setup").title).toBe("Choose your team");
    expect(cadVaultShellCopy("empty").description).toMatch(/Onshape or Fusion/i);
    expect(cadVaultGeometryCopy({ triangleCount: 1200, format: "stl" })).toMatch(/not a weight in kilograms/i);
    expect(cadVaultGeometryCopy({ triangleCount: null, format: "step" })).toMatch(/Open the Onshape or Fusion link/i);
  });
});
