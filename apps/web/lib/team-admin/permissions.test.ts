import { describe, expect, it } from "vitest";
import { assertOrgManager, isOrgManager } from "./permissions";

describe("isOrgManager", () => {
  it("admits owner and admin", () => {
    expect(isOrgManager("owner")).toBe(true);
    expect(isOrgManager("admin")).toBe(true);
  });

  it("refuses the read-only roles that could previously write to Roles and Training", () => {
    expect(isOrgManager("scout")).toBe(false);
    expect(isOrgManager("viewer")).toBe(false);
  });

  it("refuses a non-member and an unknown role rather than defaulting open", () => {
    expect(isOrgManager(null)).toBe(false);
    expect(isOrgManager(undefined)).toBe(false);
    expect(isOrgManager("")).toBe(false);
    expect(isOrgManager("Owner")).toBe(false);
  });
});

describe("assertOrgManager", () => {
  it("passes a manager through", () => {
    expect(() => assertOrgManager("admin", "certify a member")).not.toThrow();
  });

  it("names the action in the refusal so the member knows what was blocked", () => {
    expect(() => assertOrgManager("scout", "certify a member")).toThrow(
      "Only an owner or admin can certify a member",
    );
  });
});
