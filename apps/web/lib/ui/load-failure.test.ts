import { describe, expect, it } from "vitest";
import { classifyLoadFailure, loadFailureCopy, signInHref } from "./load-failure";

describe("classifyLoadFailure", () => {
  it("treats 401 as a signed-out session", () => {
    expect(classifyLoadFailure({ status: 401 })).toBe("auth");
  });

  it("treats 403 as a permissions problem, not a sign-in problem", () => {
    expect(classifyLoadFailure({ status: 403 })).toBe("forbidden");
  });

  it("treats 503 as setup required", () => {
    expect(classifyLoadFailure({ status: 503 })).toBe("setup");
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
    expect(loadFailureCopy("unknown", { message: "Upstream timeout" }).description).toBe(
      "Upstream timeout",
    );
  });

  it("never leaves a state without a description", () => {
    for (const kind of ["auth", "forbidden", "offline", "setup", "unknown"] as const) {
      const copy = loadFailureCopy(kind);
      expect(copy.title.length).toBeGreaterThan(0);
      expect(copy.description.length).toBeGreaterThan(0);
    }
  });

  it("ignores a blank message rather than rendering an empty description", () => {
    expect(loadFailureCopy("unknown", { message: "   " }).description).toBe(
      "That did not load. Try again in a moment.",
    );
  });
});
