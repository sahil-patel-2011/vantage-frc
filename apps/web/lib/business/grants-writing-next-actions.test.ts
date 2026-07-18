import { describe, expect, it } from "vitest";
import { grantsWritingNextActions } from "./grants-writing-next-actions";

describe("grantsWritingNextActions", () => {
  it("requires a workspace when org is missing", () => {
    const actions = grantsWritingNextActions({});
    expect(actions).toEqual([
      expect.objectContaining({
        id: "workspace",
        href: "/workspace",
        primary: true,
      }),
    ]);
  });

  it("points empty drafts at compose, impact, and related fundraising — never DEMO award $", () => {
    const actions = grantsWritingNextActions({
      orgId: "org-1",
      draftCount: 0,
      readyCount: 0,
      impactActivities: 0,
      communityHours: 0,
    });
    expect(actions.map((a) => a.id)).toEqual([
      "compose",
      "impact",
      "pipeline",
      "sponsors",
      "fundraisers",
    ]);
    expect(actions.every((a) => !/demo/i.test(`${a.label} ${a.detail}`))).toBe(true);
    expect(actions.every((a) => !/\$\d{2,}/.test(a.detail))).toBe(true);
    expect(actions.find((a) => a.id === "sponsors")?.href).toBe("/business?tab=sponsors&orgId=org-1");
    expect(actions.find((a) => a.id === "fundraisers")?.href).toBe("/fundraisers?orgId=org-1");
  });

  it("includes the writer path when drafts exist and impact is logged", () => {
    const actions = grantsWritingNextActions({
      orgId: "org-1",
      draftCount: 2,
      readyCount: 1,
      impactActivities: 3,
      communityHours: 12,
    });
    expect(actions.map((a) => a.id)).toContain("writer");
    expect(actions.find((a) => a.id === "writer")?.href).toBe("/writer?orgId=org-1");
    expect(actions.some((a) => a.id === "compose")).toBe(false);
  });
});
