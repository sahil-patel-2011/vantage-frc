import { describe, expect, it } from "vitest";
import { describeAllowedSignInMethods } from "@vantage/core";
import {
  GENERIC_LOAD_FAILURE,
  apiErrorMessage,
  classifyLoadFailure,
  isTeamReadableMessage,
  loadFailureCopy,
  signInHref,
} from "./load-failure";

describe("classifyLoadFailure", () => {
  it("treats 401 as a signed-out session", () => {
    expect(classifyLoadFailure({ status: 401 })).toBe("auth");
  });

  it("treats 403 as a permissions problem, not a sign-in problem", () => {
    expect(classifyLoadFailure({ status: 403 })).toBe("forbidden");
  });

  it("distinguishes a temporary service outage from missing configuration", () => {
    expect(classifyLoadFailure({ status: 503 })).toBe("unknown");
    expect(classifyLoadFailure({ status: 503, message: "This service is temporarily unavailable. Try again." })).toBe("unknown");
    expect(classifyLoadFailure({ status: 503, message: "Database is not configured." })).toBe("setup");
  });

  it("prefers offline over any status, since nothing else can succeed", () => {
    expect(classifyLoadFailure({ status: 401, online: false })).toBe("offline");
    expect(classifyLoadFailure({ status: 500, online: false })).toBe("offline");
  });

  it("classifies from the API message when no status was kept", () => {
    expect(classifyLoadFailure({ message: "Authentication required" })).toBe("auth");
    expect(classifyLoadFailure({ message: "Unauthorized" })).toBe("auth");
    expect(classifyLoadFailure({ message: "Session expired, please sign in" })).toBe("auth");
    expect(classifyLoadFailure({ message: "Forbidden" })).toBe("forbidden");
    expect(classifyLoadFailure({ message: "You are not a member of this org" })).toBe("forbidden");
    expect(classifyLoadFailure({ message: "setup_required" })).toBe("setup");
  });

  it("is case insensitive on message text", () => {
    expect(classifyLoadFailure({ message: "AUTHENTICATION REQUIRED" })).toBe("auth");
  });

  it("reads a role message as forbidden rather than signed-out", () => {
    expect(classifyLoadFailure({ message: "Insufficient role: permission denied" })).toBe("forbidden");
  });

  it("reads an admin-only 400 as a role denial, not a crash", () => {
    const message = "Organization administrator access required";
    expect(classifyLoadFailure({ status: 400, message })).toBe("forbidden");
    const copy = loadFailureCopy("forbidden", { message });
    expect(copy.title).toBe("You don't have access to this");
    expect(copy.showRetry).toBe(false);
    expect(copy.badge).toBe("No access");
    expect(copy.description).toBe(
      "Your team role does not include this section. An owner or admin can change that.",
    );
    expect(copy.description).not.toMatch(/Security/);
    expect(copy.primary).toEqual({ label: "Back to Home", href: "/dashboard" });
  });

  it("falls back to unknown for a generic failure", () => {
    expect(classifyLoadFailure({ status: 500, message: "Internal error" })).toBe("unknown");
    expect(classifyLoadFailure({})).toBe("unknown");
    expect(classifyLoadFailure({ message: "" })).toBe("unknown");
  });

  it("lets an explicit status win over misleading text", () => {
    expect(classifyLoadFailure({ status: 403, message: "Authentication required" })).toBe("forbidden");
  });
});

describe("signInHref", () => {
  it("round-trips the destination", () => {
    expect(signInHref("/team?tab=calendar")).toBe("/signin?next=%2Fteam%3Ftab%3Dcalendar");
  });

  it("ignores a non-app destination so it cannot be used as an open redirect", () => {
    expect(signInHref("https://evil.example.com")).toBe("/signin");
    expect(signInHref(null)).toBe("/signin");
    expect(signInHref(undefined)).toBe("/signin");
    expect(signInHref("")).toBe("/signin");
  });

  it("drops protocol-relative paths that would leave the app", () => {
    expect(signInHref("//evil.example.com")).toBe("/signin");
    expect(signInHref("/\\evil.example.com")).toBe("/signin");
  });
});

describe("loadFailureCopy", () => {
  it("offers sign-in and hides Retry for an expired session", () => {
    const copy = loadFailureCopy("auth", { nextPath: "/batteries" });
    expect(copy.showRetry).toBe(false);
    expect(copy.primary?.label).toBe("Sign in again");
    expect(copy.primary?.href).toBe("/signin?next=%2Fbatteries");
    expect(copy.title).toBe("Your session ended");
  });

  it("does not offer Retry for a permissions failure either", () => {
    const copy = loadFailureCopy("forbidden");
    expect(copy.showRetry).toBe(false);
    expect(copy.primary?.href).toBe("/dashboard");
  });

  it("keeps Retry where retrying can plausibly work", () => {
    expect(loadFailureCopy("offline").showRetry).toBe(true);
    expect(loadFailureCopy("unknown").showRetry).toBe(true);
    expect(loadFailureCopy("setup").showRetry).toBe(true);
  });

  it("surfaces the real API message for setup and unknown failures", () => {
    expect(loadFailureCopy("setup", { message: "Connect The Blue Alliance key" }).description).toBe(
      "Connect The Blue Alliance key",
    );
    expect(loadFailureCopy("unknown", { message: "The match schedule is not published yet." }).description).toBe(
      "The match schedule is not published yet.",
    );
  });

  it("never prints the exception text a program produced (A6-12, A2-20)", () => {
    for (const raw of [
      "signal timed out",
      "Upstream timeout",
      "Failed to fetch",
      "TypeError: Cannot read properties of undefined (reading 'map')",
      "Unexpected token '<', \"<!DOCTYPE \"... is not valid JSON",
      'relation "org_billing" does not exist',
      "DATABASE_URL is not set",
      "500 Internal Server Error",
      "connect ECONNREFUSED 127.0.0.1:5432",
    ]) {
      expect(isTeamReadableMessage(raw), raw).toBe(false);
      expect(loadFailureCopy("unknown", { message: raw }).description, raw).toBe(GENERIC_LOAD_FAILURE);
    }
    expect(isTeamReadableMessage("Only an owner can delete the team.")).toBe(true);
  });

  it("never leaves a state without a description", () => {
    for (const kind of ["auth", "forbidden", "offline", "slow", "setup", "unknown"] as const) {
      const copy = loadFailureCopy(kind);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
    }
  });

  it("ignores a blank message rather than rendering an empty description", () => {
    expect(loadFailureCopy("unknown", { message: "   " }).description).toBe(GENERIC_LOAD_FAILURE);
    // Says what happened and what to do next, unlike "Something went wrong".
    expect(loadFailureCopy("unknown").title).toBe("This didn't load");
    expect(GENERIC_LOAD_FAILURE).toMatch(/Try again/);
  });

  it("treats a slow, dropped or rate-limited connection as slow, with Retry", () => {
    for (const message of ["signal timed out", "TimeoutError: signal timed out", "Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource."]) {
      expect(classifyLoadFailure({ message }), message).toBe("slow");
    }
    expect(classifyLoadFailure({ status: 429 })).toBe("slow");
    expect(classifyLoadFailure({ status: 504 })).toBe("slow");
    const copy = loadFailureCopy("slow");
    expect(copy.title).toBe("This is taking longer than usual");
    expect(copy.badge).toBe("Slow connection");
    expect(copy.showRetry).toBe(true);
  });
});

describe("a 403 about how you signed in is not a 403 about who you are", () => {
  const REAUTH_MESSAGES = [
    "Re-authenticate with a sign-in method allowed by this organization.",
    "This organization requires authenticator-app 2FA enrollment.",
    "Authenticator verification is required to enter this organization.",
  ];

  it("classifies every org auth-policy refusal as reauth, not forbidden", () => {
    for (const message of REAUTH_MESSAGES) {
      expect(classifyLoadFailure({ status: 403, message })).toBe("reauth");
    }
  });

  it("never tells an owner their role is the problem when it is not", () => {
    // The screenshot bug: an owner opening Scouting was told "Your team role
    // does not include this section" and sent to a Security page with nothing
    // wrong on it. Their role was fine; their sign-in method was not.
    for (const message of REAUTH_MESSAGES) {
      const copy = loadFailureCopy(classifyLoadFailure({ status: 403, message }), { message });
      expect(copy.description).not.toContain("team role");
      expect(copy.description).not.toContain("Security");
      expect(copy.primary?.label).toBe("Sign in again");
    }
  });

  it("repeats the API's own sentence, which says which method or which step", () => {
    const message = "This organization requires authenticator-app 2FA enrollment.";
    const copy = loadFailureCopy("reauth", { message });
    expect(copy.description).toBe(message);
  });

  it("still calls a real role refusal forbidden", () => {
    expect(classifyLoadFailure({ status: 403, message: "Insufficient role" })).toBe("forbidden");
    expect(classifyLoadFailure({ status: 403, message: "Not a member of this organization" })).toBe(
      "forbidden",
    );
    expect(classifyLoadFailure({ status: 403 })).toBe("forbidden");
  });

  it("does not offer a retry that cannot work", () => {
    expect(loadFailureCopy("reauth", {}).showRetry).toBe(false);
  });
});

describe("the classifier and the message that produces it cannot drift apart", () => {
  it("classifies every message packages/core actually emits", () => {
    // These live in a different package from the classifier, so nothing but
    // this test stops somebody rewording one and silently turning an
    // actionable "sign in again" back into "your role is wrong".
    const policy = {
      allowPassword: false,
      allowGoogle: true,
      allowEmailOtp: true,
      mfaPolicy: "required" as const,
      rememberedDeviceDays: 14,
    };
    const emitted = [
      `This team does not allow the way you signed in. Sign in again with ${describeAllowedSignInMethods(policy)} to open this.`,
      "This organization requires authenticator-app 2FA enrollment.",
      "Authenticator verification is required to enter this organization.",
    ];
    for (const message of emitted) {
      expect(classifyLoadFailure({ status: 403, message }), message).toBe("reauth");
    }
  });

  it("names the methods that would actually work", () => {
    expect(
      describeAllowedSignInMethods({
        allowPassword: false,
        allowGoogle: true,
        allowEmailOtp: true,
        mfaPolicy: "optional",
        rememberedDeviceDays: 14,
      }),
    ).toBe("Google or an emailed code");
  });
});

describe("apiErrorMessage", () => {
  const json = (body: unknown, status = 403) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("returns the sentence the route sent", async () => {
    const refusal = "This team does not allow the way you signed in. Sign in again with Google or an emailed code to open this.";
    expect(await apiErrorMessage(json({ error: refusal }))).toBe(refusal);
  });

  it("leaves the body readable for the caller", async () => {
    // Callers parse the body themselves; reading the reason must not consume it.
    const response = json({ error: "Nope", detail: 7 });
    await apiErrorMessage(response);
    expect(await response.json()).toEqual({ error: "Nope", detail: 7 });
  });

  it("returns null rather than throwing on a body that is not JSON", async () => {
    expect(await apiErrorMessage(new Response("<html>502</html>", { status: 502 }))).toBeNull();
    expect(await apiErrorMessage(new Response("", { status: 403 }))).toBeNull();
    expect(await apiErrorMessage(json({ error: "   " }))).toBeNull();
    expect(await apiErrorMessage(json({ message: "wrong field" }))).toBeNull();
  });

  /**
   * The whole point of the helper, end to end: what the route actually sends
   * has to survive the trip and come out as "sign in again", not "your role is
   * wrong". This is the bug an owner hit on Competition → Scouting.
   */
  it("carries a real 403 through to the right advice", async () => {
    const response = json({
      error:
        "This team does not allow the way you signed in. Sign in again with Google or an emailed code to open this.",
    });
    const message = await apiErrorMessage(response);
    const kind = classifyLoadFailure({ status: 403, message });
    expect(kind).toBe("reauth");

    const copy = loadFailureCopy(kind, { nextPath: "/competition?tab=scouting", message });
    expect(copy.title).toBe("Sign in again to open this");
    expect(copy.description).toContain("Google or an emailed code");
    expect(copy.primary?.href).toBe("/signin?next=%2Fcompetition%3Ftab%3Dscouting");
    expect(copy.description).not.toContain("role");
  });

  it("falls back to the status when the route sent no reason", async () => {
    // A bare 403 really is unexplained, and "your role" is the honest guess.
    const message = await apiErrorMessage(json({}));
    expect(classifyLoadFailure({ status: 403, message })).toBe("forbidden");
  });
});
