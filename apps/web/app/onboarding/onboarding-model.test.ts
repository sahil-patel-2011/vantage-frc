import { describe, expect, it } from "vitest";
import { githubConnectionHref, isCrew, isGender, isRole } from "../../app/onboarding/onboarding-model";

describe("onboarding-model helpers", () => {
  it("stamps GitHub admin href with orgId when present", () => {
    expect(githubConnectionHref(null)).toBe("/team/admin#github-connection");
    expect(githubConnectionHref("org-1")).toBe("/team/admin?orgId=org-1#github-connection");
  });

  it("narrows role / crew / gender without DEMO values", () => {
    expect(isRole("student")).toBe(true);
    expect(isRole("DEMO")).toBe(false);
    expect(isCrew("scout")).toBe(true);
    expect(isCrew("")).toBe(false);
    expect(isGender("prefer_not_to_say")).toBe(true);
    expect(isGender("unknown")).toBe(false);
  });
});
