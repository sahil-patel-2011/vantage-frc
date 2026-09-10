import { describe, expect, it } from "vitest";
import { FILES_RELATED_INCLUDE, filesRelatedLinks } from "./files-related";

describe("filesRelatedLinks", () => {
  it("lands on Playbook, Team chat, and CAD with orgId", () => {
    const links = filesRelatedLinks("org-1", { include: [...FILES_RELATED_INCLUDE] });
    expect(links.map((link) => link.id)).toEqual(["playbook", "messages", "cad"]);
    expect(links.find((link) => link.id === "playbook")?.href).toBe("/team?tab=knowledge&orgId=org-1");
    expect(links.find((link) => link.id === "messages")?.href).toBe("/team?tab=messages&orgId=org-1");
    expect(links.find((link) => link.id === "cad")?.href).toBe("/build?tab=cad&orgId=org-1");
  });

  it("never uses DEMO labels or hrefs", () => {
    const blob = JSON.stringify(filesRelatedLinks("org-1"));
    expect(blob).not.toMatch(/DEMO/i);
  });
});
