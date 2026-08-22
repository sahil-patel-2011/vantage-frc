import { describe, expect, it } from "vitest";
import {
  emailOtpSetupRequired,
  googleReady,
  oauthErrorMessage,
  publicEmailUnavailableCopy,
  raisedPricingStrip,
  signInNextActions,
  signInSetupCopy,
  signInSubtitle,
  WAITLIST_ONLY_MESSAGE,
} from "./sign-in-flow";

describe("sign-in Soft-UI helpers", () => {
  it("keeps email setup_required copy browser-safe", () => {
    expect(publicEmailUnavailableCopy("needs RESEND_API_KEY and AUTH_EMAIL_FROM")).not.toMatch(
      /RESEND|AUTH_EMAIL_FROM/,
    );
    expect(emailOtpSetupRequired({ emailOtpAvailable: false })).toBe(true);
    expect(signInSetupCopy("email_otp").badge).toBe("setup_required");
    expect(signInSetupCopy("email_otp").title).toMatch(/mail provider/i);
  });

  it("clarifies Google vs email OTP in the subtitle", () => {
    expect(signInSubtitle({ email2faEnforced: true, emailOtpAvailable: true })).toMatch(/authorized/i);
    expect(signInSubtitle({ email2faEnforced: false, emailOtpAvailable: false })).toMatch(/authorized/i);
    expect(googleReady({ googleSignInAvailable: false }, true)).toBe(true);
    expect(googleReady({ googleSignInAvailable: false }, false)).toBe(false);
  });

  it("exposes waitlist + raised pricing CTAs without inventing access", () => {
    const actions = signInNextActions();
    expect(actions.find((a) => a.id === "waitlist")?.href).toBe("/#waitlist");
    expect(actions.find((a) => a.id === "pricing")?.detail).toMatch(/\$69/);
    expect(raisedPricingStrip().map((p) => p.price)).toEqual(["$0", "$109 / $159", "$299 / $549"]);
  });

  it("maps OAuth waitlist denials to closed-access copy", () => {
    expect(oauthErrorMessage("signup_disabled")).toBe(WAITLIST_ONLY_MESSAGE);
    expect(oauthErrorMessage("other")).toMatch(/Google sign-in/i);
  });
});
