import { describe, expect, it } from "vitest";
import { PUBLIC_SIGNUP_DATE_LABEL, PUBLIC_SIGNUP_EARLIEST } from "@vantage/core/public-signup";
import {
  LAUNCH_TIMELINE,
  WaitlistServerError,
  waitlistEmailProblem,
  waitlistJoinedCopy,
  waitlistSubmitErrorMessage,
} from "./waitlist-copy";

describe("one launch timeline (QA A1-05)", () => {
  it("names the day the signup gate opens, in New York time", () => {
    const day = new Date(PUBLIC_SIGNUP_EARLIEST).toLocaleDateString("en-US", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    expect(PUBLIC_SIGNUP_DATE_LABEL).toBe(day);
    expect(LAUNCH_TIMELINE).toContain(PUBLIC_SIGNUP_DATE_LABEL);
  });

  it("tells a waitlisted mentor the same date, not 'a few days'", () => {
    const copy = waitlistJoinedCopy({ email: "mentor@school.org", team: "9101" });
    expect(copy.body).toContain("mentor@school.org");
    expect(copy.body).toContain("team 9101");
    expect(copy.body).toContain(PUBLIC_SIGNUP_DATE_LABEL);
    expect(copy.body).not.toMatch(/few days/);
    // Said to everyone, so it reveals nothing about who was already listed.
    expect(copy.kept).toMatch(/Already on the list\? We kept the details/);
    expect(waitlistJoinedCopy(null).body).toMatch(/^We'll email you when your team can be set up/);
  });

  it("is what the public pages say", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const web = join(__dirname, "..", "..");
    for (const file of ["components/marketing/launch-availability.tsx", "app/sign-in/sign-in-chrome.tsx", "components/marketing/waitlist-form.tsx"]) {
      const source = readFileSync(join(web, file), "utf8");
      expect(source, file).not.toMatch(/December 1, 2026|few days/);
    }
  });
});

describe("waitlist send failures (QA A1-06)", () => {
  it("never shows the browser's own words", () => {
    expect(waitlistSubmitErrorMessage(new TypeError("Failed to fetch"))).toBe(
      "We couldn't reach Vantage. Your details are still here. Check your connection and try again.",
    );
    expect(waitlistSubmitErrorMessage(new Error("NetworkError when attempting to fetch resource."))).not.toMatch(/NetworkError/);
    expect(waitlistSubmitErrorMessage("boom")).toMatch(/couldn't reach Vantage/);
  });

  it("says a timeout is safe to retry", () => {
    const timeout = Object.assign(new Error("signal timed out"), { name: "TimeoutError" });
    expect(waitlistSubmitErrorMessage(timeout)).toMatch(/will not create a duplicate/);
  });

  it("shows the server's own sentence", () => {
    expect(waitlistSubmitErrorMessage(new WaitlistServerError("Please wait before trying again."))).toBe("Please wait before trying again.");
  });
});

describe("email field messages (QA A1-24)", () => {
  it("names the actual mistake", () => {
    expect(waitlistEmailProblem("")).toMatch(/Enter the email/);
    expect(waitlistEmailProblem("a b@school.org")).toMatch(/spaces/);
    expect(waitlistEmailProblem("mentor@")).toMatch(/after the @/);
    expect(waitlistEmailProblem("@school.org")).toMatch(/before the @/);
    expect(waitlistEmailProblem("mentor")).toMatch(/missing the @/);
    expect(waitlistEmailProblem("a@b@school.org")).toMatch(/only one @/);
    expect(waitlistEmailProblem("mentor@school")).toMatch(/after the dot/);
    expect(waitlistEmailProblem("mentor@school.")).toMatch(/after the dot/);
    expect(waitlistEmailProblem("  mentor@school.org ")).toBeNull();
  });
});
