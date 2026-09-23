import { describe, expect, it } from "vitest";
import { isRoleProfileDenied } from "./role-profile-copy";

describe("isRoleProfileDenied", () => {
  it("hides the editor when the API refused the role", () => {
    expect(isRoleProfileDenied("Organization administrator access required")).toBe(true);
    expect(isRoleProfileDenied("Organization access denied")).toBe(true);
    expect(isRoleProfileDenied("Could not load role profiles")).toBe(false);
  });
});