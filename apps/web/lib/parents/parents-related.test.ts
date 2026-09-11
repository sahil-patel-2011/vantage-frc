import { describe, expect, it } from "vitest";
import {
  PARENTS_RELATED_INCLUDE,
  classifyParentsShell,
  parentsNextActions,
  parentsRelatedLinks,
  parentsSetupSteps,
  parentsShellCopy,
} from "./parents-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("parentsRelatedLinks", () => {
  it("builds Calendar / People / Forms cross-links", () => {
    const links = parentsRelatedLinks("org-1", {
      include: [...PARENTS_RELATED_INCLUDE],
    });
    expect(links.map((l) => l.id)).toEqual(["calendar", "attendance", "team-forms"]);
    expect(links.find((l) => l.id === "calendar")?.href).toBe("/team?tab=calendar&orgId=org-1");
    expect(links.find((l) => l.id === "attendance")?.label).toBe("People");
    expect(links.find((l) => l.id === "team-forms")?.label).toBe("Forms");
  });
});

describe("parentsNextActions", () => {
  it("gates on Choose your team when org is missing", () => {
    const actions = parentsNextActions({ orgId: null, shell: "setup" });
    expect(actions[0]?.href).toBe("/workspace");
    expect(actions[0]?.label).toBe("Choose your team");
    expect(actions).toHaveLength(1);
  });

  it("setup actions match setup steps", () => {
    const steps = parentsSetupSteps("org-1");
    const actions = parentsNextActions({ orgId: "org-1", shell: "setup" });
    expect(actions.map((a) => a.id)).toEqual(steps.map((s) => s.id));
    expect(actions.map((a) => a.href)).toEqual(steps.map((s) => s.href));
  });

  it("restricted boards open Home", () => {
    const actions = parentsNextActions({ orgId: "org-1", shell: "restricted" });
    expect(actions[0]?.id).toBe("home");
    expect(actions[0]?.label).toBe("Open Home");
    expect(actions[0]?.href).toBe("/dashboard");
    expect(actions).toHaveLength(1);
  });

  it("empty boards keep next-actions off so Add a parent contact is the one primary", () => {
    const actions = parentsNextActions({ orgId: "org-1", shell: "empty", contactCount: 0 });
    expect(actions).toEqual([]);
  });

  it("ready boards send the digest and do not repeat Calendar or Forms", () => {
    const actions = parentsNextActions({ orgId: "org-1", shell: "ready", contactCount: 2 });
    expect(actions.map((a) => a.id)).toEqual(["digest"]);
    expect(actions[0]?.href).toContain("#parent-digest");
    expect(JSON.stringify(actions)).not.toMatch(/calendar|team-forms|Open Calendar|Open Forms/i);
  });
});

describe("classifyParentsShell + copy", () => {
  it("classifies loading / error / setup / restricted / empty / ready", () => {
    expect(classifyParentsShell({ loading: true })).toBe("loading");
    expect(classifyParentsShell({ loading: false, fetchFailed: true })).toBe("error");
    expect(
      classifyParentsShell({ loading: false, status: "setup_required", orgId: "org-1" }),
    ).toBe("setup");
    expect(
      classifyParentsShell({ loading: false, status: "restricted", orgId: "org-1" }),
    ).toBe("restricted");
    expect(
      classifyParentsShell({
        loading: false,
        status: "ready",
        orgId: "org-1",
        contactCount: 0,
      }),
    ).toBe("empty");
    expect(
      classifyParentsShell({
        loading: false,
        status: "ready",
        orgId: "org-1",
        contactCount: 3,
      }),
    ).toBe("ready");
  });

  it("copy stays student-readable", () => {
    for (const kind of ["loading", "error", "setup", "restricted", "empty", "ready"] as const) {
      const copy = parentsShellCopy(kind);
      expectPlainCopy(`${copy.title} ${copy.description}`);
      if (kind === "setup") expect(copy.badge).toBe("Needs setup");
    }
  });
});
