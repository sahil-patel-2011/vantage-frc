import { describe, expect, it } from "vitest";
import { PENDING_INVITE_STORAGE_KEY } from "../../lib/invite";
import {
  codeExpiryCopy,
  continueAsLabel,
  describeSignInBusy,
  emailSubmitLabel,
  googleButtonLabel,
  inviteBannerBody,
  passwordSubmitLabel,
  resendLabel,
  sessionProbeFromPayload,
  storedInviteTokenFrom,
  type SignInBusy,
} from "./sign-in-model";

describe("sign-in-model", () => {
  it("maps the email-2FA probe without inventing a session", () => {
    expect(sessionProbeFromPayload({ ok: false, status: 401 }, null)).toEqual({ state: "none" });
    expect(sessionProbeFromPayload({ ok: false, status: 500 }, { authenticated: true })).toEqual({
      state: "none",
    });
    expect(sessionProbeFromPayload({ ok: true, status: 200 }, { authenticated: false })).toEqual({
      state: "none",
    });
    expect(
      sessionProbeFromPayload(
        { ok: true, status: 200 },
        { authenticated: true, requiresVerification: true, emailHint: "a***@team.org" },
      ),
    ).toEqual({ state: "needs_verification", emailHint: "a***@team.org" });
    expect(
      sessionProbeFromPayload({ ok: true, status: 200 }, { authenticated: true }),
    ).toEqual({ state: "active", emailHint: "" });
  });

  it("reads a pending invite token from storage and ignores blanks", () => {
    expect(storedInviteTokenFrom(null)).toBeNull();
    expect(
      storedInviteTokenFrom({
        getItem: (key) => (key === PENDING_INVITE_STORAGE_KEY ? "  invite-1  " : null),
      }),
    ).toBe("invite-1");
    expect(storedInviteTokenFrom({ getItem: () => "   " })).toBeNull();
  });

  it("keeps button copy exhaustive and honest", () => {
    const busy: SignInBusy[] = ["idle", "sending", "verifying", "resending", "google", "leaving"];
    expect(busy.map(describeSignInBusy)).toEqual([
      "idle",
      "sending a sign-in code",
      "verifying a sign-in code",
      "sending a new code",
      "opening Google",
      "continuing into the team",
    ]);
    expect(continueAsLabel(false, "")).toBe("Continue as this account");
    expect(continueAsLabel(true, "coach@team.org")).toBe("Continuing…");
    expect(googleButtonLabel("google")).toBe("Opening Google…");
    expect(googleButtonLabel("idle")).toBe("Continue with Google");
    expect(emailSubmitLabel("sending")).toBe("Sending code…");
    expect(emailSubmitLabel("idle")).toBe("Email me a sign-in code");
    expect(passwordSubmitLabel("reset", { resetSent: false, working: false })).toBe("Send reset code");
    expect(passwordSubmitLabel("reset", { resetSent: true, working: false })).toBe("Set new password");
    expect(passwordSubmitLabel("password", { resetSent: false, working: true })).toBe("Signing in…");
    expect(resendLabel({ ready: false, busy: "idle", seconds: 12 })).toMatch(/Resend in/);
    expect(codeExpiryCopy(true, 0)).toMatch(/no longer valid/i);
    expect(inviteBannerBody("a@team.org")).toMatch(/Sign in as a@team.org/);
    expect(inviteBannerBody(null)).toMatch(/acceptance screen/);
  });
});
