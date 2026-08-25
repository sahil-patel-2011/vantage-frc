import { describe, expect, it } from "vitest";
import {
  canResendCode,
  canSubmitCode,
  classifyOtpFailure,
  codeSecondsRemaining,
  initialSignInState,
  invitedOnlyHint,
  inviteReturnPath,
  inviteTokenFromNext,
  isCodeExpired,
  postAuthDestination,
  resendSecondsRemaining,
  restoreInviteNextPath,
  signInFlowReducer,
  signInStepCopy,
  type SignInFlowEvent,
  type SignInFlowState,
} from "./sign-in-machine";

const NOW = 1_700_000_000_000;

function run(state: SignInFlowState, ...events: SignInFlowEvent[]): SignInFlowState {
  return events.reduce(signInFlowReducer, state);
}

describe("sign-in flow transitions", () => {
  it("walks email -> code -> done in one path", () => {
    const identity = initialSignInState();
    expect(identity.step).toBe("identity");

    const typed = run(identity, { type: "email_changed", email: "Scout@Team254.org" });
    expect(typed.email).toBe("Scout@Team254.org");

    const sent = run(typed, { type: "code_sent", now: NOW, email: "Scout@Team254.org" });
    expect(sent.step).toBe("code");
    expect(sent.email).toBe("scout@team254.org");
    expect(sent.code).toBe("");
    // The server answers 200 for unknown addresses, so delivery is conditional.
    expect(sent.notice).toMatch(/if that address belongs to a team/i);
    expect(codeSecondsRemaining(sent, NOW)).toBe(300);

    const typing = run(sent, { type: "code_changed", code: "40 29 17" });
    expect(typing.code).toBe("402917");
    expect(canSubmitCode(typing, NOW)).toBe(true);

    const done = run(typing, { type: "verified", destination: "/dashboard" });
    expect(done.step).toBe("done");
    expect(done.destination).toBe("/dashboard");
  });

  it("returns to the email step with the code cleared when Edit is used", () => {
    const sent = run(initialSignInState(), {
      type: "code_sent",
      now: NOW,
      email: "scout@team254.org",
    });
    const back = run(sent, { type: "code_changed", code: "4029" }, { type: "edit_email" });
    expect(back.step).toBe("identity");
    expect(back.code).toBe("");
    expect(back.codeExpiresAt).toBeNull();
    // The address survives so a one-character typo fix is one keystroke.
    expect(back.email).toBe("scout@team254.org");
  });

  it("has no editable address on the second factor", () => {
    const second = run(initialSignInState(), {
      type: "second_factor_required",
      emailHint: "s***@team254.org",
    });
    expect(second.channel).toBe("email-2fa");
    expect(second.email).toBe("");
    expect(second.emailHint).toBe("s***@team254.org");

    const sent = run(second, { type: "code_sent", now: NOW, expiresInSeconds: 300 });
    expect(sent.notice).toMatch(/finish signing in/i);
    // Editing is meaningless once the address comes from the session.
    expect(run(sent, { type: "edit_email" })).toEqual(sent);
  });
});

describe("resend cooldown math", () => {
  it("blocks resend for the local cooldown, then allows it", () => {
    const sent = run(initialSignInState(), {
      type: "code_sent",
      now: NOW,
      email: "scout@team254.org",
    });
    expect(resendSecondsRemaining(sent, NOW)).toBe(30);
    expect(canResendCode(sent, NOW)).toBe(false);
    expect(canResendCode(sent, NOW + 29_000)).toBe(false);
    expect(canResendCode(sent, NOW + 30_000)).toBe(true);
  });

  it("honours the server's retry-after over the local default", () => {
    const sent = run(initialSignInState(), {
      type: "code_sent",
      now: NOW,
      email: "scout@team254.org",
    });
    // `rateLimitedResponse` sends `retry-after: 60`.
    const limited = run(sent, {
      type: "code_failed",
      now: NOW,
      failure: classifyOtpFailure({ channel: "email-otp", status: 429, retryAfterSeconds: 60 }),
    });
    expect(resendSecondsRemaining(limited, NOW)).toBe(60);
    expect(canResendCode(limited, NOW + 59_000)).toBe(false);
    expect(canResendCode(limited, NOW + 60_000)).toBe(true);
    // A rate limit is not a bad code — the digits stay put.
    expect(limited.code).toBe(sent.code);
  });

  it("lets a dead code be replaced immediately", () => {
    const sent = run(
      initialSignInState(),
      { type: "code_sent", now: NOW, email: "scout@team254.org" },
      { type: "code_changed", code: "402917" },
    );
    const expired = run(sent, {
      type: "code_failed",
      now: NOW + 1_000,
      failure: classifyOtpFailure({ channel: "email-otp", status: 400, code: "OTP_EXPIRED" }),
    });
    expect(expired.resendAvailableAt).toBeNull();
    expect(canResendCode(expired, NOW + 1_000)).toBe(true);
  });
});

describe("expired vs wrong code", () => {
  it("keeps the digits and stays retryable on a wrong code", () => {
    // Better Auth's first-factor rejection code.
    const failure = classifyOtpFailure({ channel: "email-otp", status: 400, code: "INVALID_OTP" });
    expect(failure.kind).toBe("wrong_code");
    expect(failure.keepDigits).toBe(true);
    expect(failure.needsNewCode).toBe(false);

    const state = run(
      initialSignInState(),
      { type: "code_sent", now: NOW, email: "scout@team254.org" },
      { type: "code_changed", code: "402917" },
      { type: "code_failed", now: NOW + 1_000, failure },
    );
    expect(state.code).toBe("402917");
    expect(state.failedAttempts).toBe(1);
    expect(isCodeExpired(state, NOW + 1_000)).toBe(false);
    // Editing one character clears the error rather than shouting through it.
    expect(run(state, { type: "code_changed", code: "40291" }).failure).toBeNull();
  });

  it("marks an expired code dead no matter what is retyped", () => {
    const failure = classifyOtpFailure({ channel: "email-otp", status: 400, code: "OTP_EXPIRED" });
    expect(failure.kind).toBe("expired");
    expect(failure.needsNewCode).toBe(true);

    const state = run(
      initialSignInState(),
      { type: "code_sent", now: NOW, email: "scout@team254.org" },
      { type: "code_changed", code: "402917" },
      { type: "code_failed", now: NOW + 1_000, failure },
    );
    expect(isCodeExpired(state, NOW + 1_000)).toBe(true);
    expect(canSubmitCode(state, NOW + 1_000)).toBe(false);
    expect(run(state, { type: "code_changed", code: "402918" }).failure?.kind).toBe("expired");
  });

  it("wipes the digits when the code is locked out", () => {
    const failure = classifyOtpFailure({
      channel: "email-2fa",
      status: 400,
      message: "Too many attempts. Request a new code.",
    });
    expect(failure.kind).toBe("too_many_attempts");
    const state = run(
      initialSignInState({ channel: "email-2fa" }),
      { type: "code_sent", now: NOW },
      { type: "code_changed", code: "402917" },
      { type: "code_failed", now: NOW + 1_000, failure },
    );
    expect(state.code).toBe("");
  });

  it("treats a thrown fetch as a network problem that preserves the digits", () => {
    const failure = classifyOtpFailure({ channel: "email-otp", networkError: true });
    expect(failure.kind).toBe("network");
    expect(failure.keepDigits).toBe(true);
    expect(failure.needsNewCode).toBe(false);
    expect(failure.message).toMatch(/connection/i);
  });

  it("names the closed-access reason instead of repeating 'wrong code'", () => {
    const wrong = classifyOtpFailure({ channel: "email-otp", status: 400, code: "INVALID_OTP" });
    let state = run(initialSignInState(), {
      type: "code_sent",
      now: NOW,
      email: "outsider@example.com",
    });
    state = run(state, { type: "code_failed", now: NOW, failure: wrong });
    expect(invitedOnlyHint(state)).toBeNull();
    state = run(state, { type: "code_failed", now: NOW, failure: wrong });
    expect(invitedOnlyHint(state)).toMatch(/invite-only/i);
    // The second factor already proved the account exists — no hint there.
    expect(invitedOnlyHint({ ...state, channel: "email-2fa" })).toBeNull();
  });

  it("says nothing was sent when the mail provider is down", () => {
    const failure = classifyOtpFailure({
      channel: "email-otp",
      status: 500,
      message: "Email sign-in is unavailable until RESEND_API_KEY and AUTH_EMAIL_FROM are configured.",
    });
    expect(failure.kind).toBe("unavailable");
    expect(failure.message).toMatch(/nothing was sent/i);
    // Never leak the env var names into the browser.
    expect(failure.message).not.toMatch(/RESEND|AUTH_EMAIL_FROM/);
  });
});

describe("invite context preservation", () => {
  it("pulls the token out of a next= path", () => {
    expect(inviteTokenFromNext("/invite?token=abc123")).toBe("abc123");
    expect(inviteTokenFromNext("/invite")).toBeNull();
    expect(inviteTokenFromNext("/dashboard?token=abc123")).toBeNull();
    expect(inviteTokenFromNext("https://evil.example/invite?token=abc123")).toBeNull();
    expect(inviteReturnPath("abc 123")).toBe("/invite?token=abc%20123");
  });

  it("puts the token back when proxy.ts drops the query string", () => {
    // `proxy.ts` builds its second-factor bounce from `pathname` alone.
    expect(restoreInviteNextPath("/invite", "abc123")).toBe("/invite?token=abc123");
    expect(restoreInviteNextPath("/invite?token=fromurl", "stashed")).toBe("/invite?token=fromurl");
    expect(restoreInviteNextPath("/dashboard", "abc123")).toBe("/dashboard");
    expect(restoreInviteNextPath("", "abc123")).toBe("/dashboard");
    expect(restoreInviteNextPath("/invite", null)).toBe("/invite");
  });

  it("returns to the acceptance screen instead of onboarding or the dashboard", () => {
    // The exact drop-through this exists to stop: a fresh invitee has no
    // completed onboarding, and /onboarding would strand the invite unaccepted.
    expect(
      postAuthDestination({
        nextPath: "/invite?token=abc123",
        gate: { complete: false, accessStatus: "none" },
      }),
    ).toBe("/invite?token=abc123");
    expect(
      postAuthDestination({
        nextPath: "/dashboard",
        gate: { complete: false, accessStatus: "none" },
        inviteToken: "abc123",
      }),
    ).toBe("/invite?token=abc123");
    expect(
      postAuthDestination({ nextPath: "/scouting", gate: { complete: true, accessStatus: "approved" } }),
    ).toBe("/scouting");
    expect(
      postAuthDestination({ nextPath: "/scouting", gate: { complete: false, accessStatus: "none" } }),
    ).toBe("/onboarding?next=%2Fscouting");
    // No gate answer (offline / setup_required) must not invent an onboarding bounce.
    expect(postAuthDestination({ nextPath: "/scouting", gate: null })).toBe("/scouting");
  });

  it("keeps the team named on every step of the card", () => {
    const identity = initialSignInState({ email: "scout@team254.org" });
    expect(signInStepCopy(identity).title).toBe("Sign in");
    expect(signInStepCopy(identity, "You’re joining Team 254").title).toBe("You’re joining Team 254");

    const code = run(identity, { type: "code_sent", now: NOW, email: "scout@team254.org" });
    expect(signInStepCopy(code, "You’re joining Team 254").title).toBe("You’re joining Team 254");
    expect(signInStepCopy(code).sub).toContain("scout@team254.org");

    const second = run(initialSignInState(), {
      type: "second_factor_required",
      emailHint: "s***@team254.org",
    });
    const secondCode = run(second, { type: "code_sent", now: NOW });
    expect(signInStepCopy(secondCode).sub).toContain("s***@team254.org");
  });
});
