import { describe, expect, it } from "vitest";
import { inviteAcceptanceFailure } from "./accept-error";

describe("invitation acceptance rejection", () => {
  it("directs a matching email with missing age confirmation to profile, not switch-account", () => {
    expect(inviteAcceptanceFailure(403, { code: "AGE_ELIGIBILITY_REQUIRED" }).kind).toBe("profile_required");
    expect(inviteAcceptanceFailure(403, { code: "INVITE_EMAIL_MISMATCH" }).kind).toBe("email_mismatch");
    expect(inviteAcceptanceFailure(403, { error: "Access unavailable" })).toEqual({ kind: "error", message: "Access unavailable" });
    expect(inviteAcceptanceFailure(401, {}).kind).toBe("auth_required");
  });
});
