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
  signInUnavailableCopy,
  WAITLIST_ONLY_MESSAGE,
} from "./sign-in-flow";

describe("sign-in Soft-UI helpers", () => {
  it("keeps email setup copy browser-safe and student-readable", () => {
    expect(publicEmailUnavailableCopy("needs RESEND_API_KEY and AUTH_EMAIL_FROM")).not.toMatch(
      /RESEND|AUTH_EMAIL_FROM/,
    );
    expect(emailOtpSetupRequired({ emailOtpAvailable: false })).toBe(true);
    expect(signInSetupCopy("email_otp").badge).toBe("Needs setup");
    expect(signInSetupCopy("email_otp").title).toMatch(/email codes are off/i);
    expect(signInSetupCopy("database").title).toMatch(/isn’t ready/i);
    expect(signInSetupCopy("database").title).not.toMatch(/workspace|database|deployment/i);
    expect(signInSetupCopy("database").description).not.toMatch(/DEPLOYMENT|OAuth|env/i);
  });

  it("uses one shared sign-in for invited humans", () => {
    expect(signInSubtitle({ email2faEnforced: true, emailOtpAvailable: true })).toMatch(/google or an email code/i);
    expect(signInSubtitle({ email2faEnforced: false, emailOtpAvailable: false })).toMatch(/invite-only/i);
    expect(googleReady({ googleSignInAvailable: false }, true)).toBe(true);
    expect(googleReady({ googleSignInAvailable: false }, false)).toBe(false);
  });

  it("exposes waitlist + raised pricing CTAs without inventing access", () => {
    const actions = signInNextActions();
    expect(actions.find((a) => a.id === "waitlist")?.href).toBe("/#waitlist");
    expect(actions.find((a) => a.id === "pricing")?.detail).toMatch(/\$20/);
    expect(raisedPricingStrip().map((p) => p.price)).toEqual(["$0", "$20", "$60", "$100"]);
  });

  it("only claims 'use another method' when another method actually exists", () => {
    expect(signInUnavailableCopy({ google: true, email: true })).toBeNull();
    expect(signInUnavailableCopy({ google: false, email: true })).toBeNull();

    const googleOnly = signInUnavailableCopy({ google: true, email: false });
    expect(googleOnly?.description).toMatch(/google/i);

    const nothing = signInUnavailableCopy({ google: false, email: false });
    expect(nothing?.title).toMatch(/isn’t ready/i);
    expect(nothing?.badge).toBe("Needs setup");
    expect(nothing?.description).toMatch(/nothing you type here would be sent/i);
    expect(nothing?.description).toMatch(/waitlist/i);
    expect(nothing?.description).not.toMatch(/RESEND|AUTH_EMAIL_FROM|DATABASE_|DEPLOYMENT|OAuth/);
  });

  it("maps OAuth waitlist denials to closed-access copy", () => {
    expect(oauthErrorMessage("signup_disabled")).toBe(WAITLIST_ONLY_MESSAGE);
    expect(oauthErrorMessage("other")).toMatch(/Google sign-in/i);
  });
});
