import { describe, expect, it } from "vitest";
import { teamJoinInvitePath } from "../onboarding/entry-journey";
import { joinCodeDigits, joinCodeHint, joinFailureMessage, teamJoinNextStep, teamNumberDigits } from "./join-code-flow";

describe("typing and pasting a join code (QA A3-13)", () => {
  it("keeps all six digits from a pasted code with a space or dash", () => {
    expect(joinCodeDigits("206 436")).toBe("206436");
    expect(joinCodeDigits("206-436")).toBe("206436");
    expect(joinCodeDigits("1234 56")).toBe("123456");
    expect(joinCodeDigits("1234567")).toBe("123456");
    expect(teamNumberDigits("Team 6925")).toBe("6925");
  });

  it("says what is missing instead of a silently grey Continue", () => {
    expect(joinCodeHint("20643")).toBe("Enter all 6 numbers (1 more to go).");
    expect(joinCodeHint("")).toBeNull();
    expect(joinCodeHint("206436")).toBeNull();
  });
});

describe("a refused code (QA A3-14)", () => {
  const at = (date: Date) => `${date.getUTCHours()}:${String(date.getUTCMinutes()).padStart(2, "0")} UTC`;
  it("names the time to come back when locked out", () => {
    expect(
      joinFailureMessage(429, { code: "join_code_locked", retryAt: "2026-10-11T20:42:00.000Z", error: "x" }, at),
    ).toBe("Too many wrong tries. Try again at 20:42 UTC, or ask a team admin for an email invite.");
  });

  it("never says to wait on a first wrong code", () => {
    const message = joinFailureMessage(400, { code: "join_code_wrong", error: "That team number and join code don't match." });
    expect(message).toBe("That team number and join code don't match.");
    expect(message).not.toMatch(/fifteen|wait/i);
    expect(joinFailureMessage(500, null)).toBe("Could not join. Check the details and try again.");
  });
});

const TOKEN = "a".repeat(43);
const ORG = "22222222-2222-4222-8222-222222222222";
const options = (signedIn: boolean) => ({ signedIn, validInvitePath: teamJoinInvitePath });

describe("after entering a team code", () => {
  it("sends a signed-out student straight to sign-in for the invitation", () => {
    const next = teamJoinNextStep({ href: `/invite?token=${TOKEN}`, orgName: "Robo Rangers", teamNumber: 6925 }, options(false));
    expect(next).toEqual({ kind: "go", href: `/signin?next=${encodeURIComponent(`/invite?token=${TOKEN}`)}` });
  });

  it("takes a signed-in person to the invitation itself", () => {
    expect(teamJoinNextStep({ href: `/invite?token=${TOKEN}` }, options(true))).toEqual({ kind: "go", href: `/invite?token=${TOKEN}` });
  });

  it("tells someone already on the team so, with Home, instead of a new invitation", () => {
    const next = teamJoinNextStep({ alreadyMember: true, orgId: ORG, orgName: "Robo Rangers", teamNumber: 6925 }, options(true));
    expect(next).toEqual({
      kind: "member",
      member: { orgId: ORG, orgName: "Robo Rangers", teamNumber: 6925, href: `/dashboard?orgId=${ORG}` },
    });
  });

  it("never follows anything but a same-site invitation", () => {
    for (const href of ["https://evil.example/invite?token=x", "/dashboard", "//evil.example", undefined]) {
      expect(teamJoinNextStep({ href }, options(false))).toEqual({ kind: "error" });
    }
    expect(teamJoinNextStep({ alreadyMember: true, orgId: "../../admin" }, options(true))).toEqual({ kind: "error" });
  });
});
