import { describe, expect, it } from "vitest";
import {
  RELAYS_RELATED_INCLUDE,
  classifyRelaysShell,
  isRelaysQueueEmpty,
  labelRelayRole,
  relaysNextActions,
  relaysRelatedLinks,
  relaysSetupSteps,
  relaysShellCopy,
} from "./relays-related";
import { expectPlainCopy } from "../ui/copy-assertions";

describe("relaysRelatedLinks", () => {
  it("builds Connectors / Video / Storage via withOrgHref", () => {
    const links = relaysRelatedLinks("org-1", {
      include: [...RELAYS_RELATED_INCLUDE],
    });
    expect(links.map((link) => link.id)).toEqual(["connectors", "video", "storage"]);
    expect(links.find((link) => link.id === "connectors")?.href).toBe("/connectors?orgId=org-1");
    expect(links.find((link) => link.id === "video")?.href).toBe("/video-analysis?orgId=org-1");
    expect(links.find((link) => link.id === "storage")?.href).toBe("/team/storage?orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(relaysRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});

describe("relaysSetupSteps", () => {
  it("no-org setup is only Choose your team", () => {
    const steps = relaysSetupSteps(null);
    expect(steps.map((step) => step.id)).toEqual(["workspace"]);
    expect(steps[0]?.href).toBe("/workspace");
  });

  it("with a team there is no extra setup wall", () => {
    expect(relaysSetupSteps("org-1")).toEqual([]);
  });
});

describe("AI relays shell", () => {
  it("treats zero Pis as empty", () => {
    expect(isRelaysQueueEmpty({ nodeCount: 0 })).toBe(true);
    expect(isRelaysQueueEmpty({ nodeCount: 2 })).toBe(false);
  });

  it("classifies setup / empty / ready / error", () => {
    expect(classifyRelaysShell({ loading: true })).toBe("loading");
    expect(classifyRelaysShell({ orgId: null })).toBe("setup");
    expect(classifyRelaysShell({ orgId: "org-1", fetchFailed: true, nodeCount: 0 })).toBe("error");
    expect(
      classifyRelaysShell({ orgId: "org-1", fetchFailed: true, nodeCount: 0, errorStatus: 401 }),
    ).toBe("setup");
    expect(classifyRelaysShell({ orgId: "org-1", nodeCount: 0 })).toBe("empty");
    expect(classifyRelaysShell({ orgId: "org-1", nodeCount: 1 })).toBe("ready");
  });

  it("setup badges stay Needs setup and copy stays student-readable", () => {
    expect(relaysShellCopy("setup").badge).toBe("Needs setup");
    for (const kind of ["loading", "error", "setup", "empty", "ready"] as const) {
      const copy = relaysShellCopy(kind);
      expectPlainCopy(copy.description);
      expect(copy.title).not.toMatch(/Setup required/);
      expect(copy.description).not.toMatch(/Setup required/);
      expect(copy.description).not.toMatch(/freebuff\.com/i);
    }
    expectPlainCopy(relaysSetupSteps(null)[0]?.detail);
  });

  it("empty/setup keep no next-actions neighbor; ready paste stays on this page", () => {
    expect(relaysNextActions({ orgId: null, shell: "setup" }).map((action) => action.id)).toEqual([
      "workspace",
    ]);
    expect(relaysNextActions({ orgId: "org-1", shell: "empty" })).toEqual([]);
    const ready = relaysNextActions({ orgId: "org-1", shell: "ready", nodeCount: 1 });
    expect(ready[0]?.href).toBe("#relay-paste");
    expect(ready.map((action) => action.href)).not.toContain("/connectors?orgId=org-1");
    expect(ready.map((action) => action.href)).not.toContain("/video-analysis?orgId=org-1");
  });

  it("labels shop roles without wrapping Freebuff", () => {
    expect(labelRelayRole("chat")).toBe("Ask AI");
    expect(labelRelayRole("agent")).toBe("Bugbot");
    expect(labelRelayRole("video")).toBe("Video");
    expect(labelRelayRole("chat")).not.toMatch(/freebuff/i);
  });
});
