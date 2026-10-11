import { describe, expect, it } from "vitest";
import {
  LifecycleError,
  lifecycleAnswer,
  lifecycleRefusal,
  normalizeTeamName,
  refusalMessage,
  sessionIsFresh,
  teamConfirmPhrase,
  teamDisplayName,
} from "./model";

describe("team lifecycle refusals", () => {
  it("reads the reason the 0720 functions raise, and nothing else", () => {
    expect(lifecycleRefusal({ code: "42501", detail: "vantage:last_owner" })).toBe("last_owner");
    expect(lifecycleRefusal({ code: "22023", detail: "vantage:confirm_mismatch" })).toBe("confirm_mismatch");
    expect(lifecycleRefusal(new LifecycleError("reauth_required"))).toBe("reauth_required");
    // The View only refusal and ordinary database errors are someone else's to explain.
    expect(lifecycleRefusal({ code: "42501", detail: "vantage:view_only" })).toBeNull();
    expect(lifecycleRefusal({ code: "23503", detail: "Key (org_id)=(…) is still referenced" })).toBeNull();
    expect(lifecycleRefusal(new Error("boom"))).toBeNull();
  });

  it("tells the last owner what to do instead, in the words of the action", () => {
    expect(refusalMessage("last_owner", "leave")).toMatch(/only owner.*Hand the team over/);
    expect(refusalMessage("last_owner", "delete_account")).toMatch(/before you delete your account/);
    expect(lifecycleAnswer("last_owner", "leave").status).toBe(409);
  });

  it("never shows database words", () => {
    for (const reason of ["not_a_member", "last_owner", "not_owner", "confirm_mismatch", "paid_plan", "reauth_required"] as const) {
      for (const action of ["leave", "delete_team", "delete_account", "rename"] as const) {
        expect(refusalMessage(reason, action)).not.toMatch(/sql|vantage:|org_id|constraint/i);
      }
    }
  });
});

describe("team names and confirmation", () => {
  it("stores a tidy name and refuses an empty or very long one", () => {
    expect(normalizeTeamName("  QA   2  Alpha ")).toBe("QA 2 Alpha");
    expect(normalizeTeamName("   ")).toBeNull();
    expect(normalizeTeamName("x".repeat(81))).toBeNull();
    expect(normalizeTeamName(42)).toBeNull();
  });

  it("asks for the team number, or the name when there is no number", () => {
    expect(teamConfirmPhrase({ teamNumber: 9201, name: "QA 2 Alpha" })).toBe("9201");
    expect(teamConfirmPhrase({ teamNumber: null, name: " Robotics Club " })).toBe("Robotics Club");
  });

  it("labels a team the way the chooser does", () => {
    expect(teamDisplayName({ teamNumber: 9201, name: "QA 2 Alpha" })).toBe("Team 9201 · QA 2 Alpha");
    expect(teamDisplayName({ teamNumber: 9203, name: "Team 9203" })).toBe("Team 9203");
  });
});

describe("fresh sign-in for deletions", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  it("accepts a sign-in from today and refuses an old one", () => {
    expect(sessionIsFresh(new Date("2026-10-11T02:00:00Z"), now)).toBe(true);
    expect(sessionIsFresh("2026-10-09T12:00:00Z", now)).toBe(false);
    expect(sessionIsFresh(null, now)).toBe(false);
  });
});
