import { describe, expect, it } from "vitest";
import { knowledgeRelatedLinks, knowledgeSetupNextActions } from "./knowledge-related";

describe("knowledge-related Soft-UI helpers", () => {
  it("builds Messages / FMEA / CAD cross-links", () => {
    const links = knowledgeRelatedLinks("org-1");
    expect(links.find((l) => l.id === "messages")?.href).toBe("/team?tab=messages&orgId=org-1");
    expect(links.find((l) => l.id === "fmea")?.href).toBe("/team?tab=fmea&orgId=org-1");
    expect(links.find((l) => l.id === "cad")?.href).toBe("/build?tab=cad&orgId=org-1");
    expect(links.find((l) => l.id === "decisions")?.href).toContain("/decisions");
    expect(links.find((l) => l.id === "assistant")?.href).toContain("/chat");
  });

  it("excludes active and respects include", () => {
    const links = knowledgeRelatedLinks("org-1", {
      active: "messages",
      include: ["fmea", "cad"],
    });
    expect(links.map((l) => l.id)).toEqual(["fmea", "cad"]);
  });

  it("never uses DEMO labels", () => {
    const links = knowledgeRelatedLinks("org-1");
    expect(links.every((l) => !/demo/i.test(l.label))).toBe(true);
    const actions = knowledgeSetupNextActions("org-1");
    expect(actions.every((a) => !/\bdemo\b/i.test(`${a.label} ${a.detail}`))).toBe(true);
  });

  it("returns workspace-only setup without inventing pages", () => {
    const actions = knowledgeSetupNextActions(null);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe("workspace");
  });
});
